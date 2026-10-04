#!/usr/bin/env python3
"""Lossless archive compression and three-date daily-backup retention.

Dry-run by default. Never opens or changes the operating SQLite database.
Manual SQLite backups expire after seven days only with a newer verified daily
recovery point. A .keep marker preserves unresolved rollback evidence.
"""
import argparse
import datetime
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import tempfile
import time

DAILY = re.compile(r"^search-index-(\d{4}-\d{2}-\d{2})\.sqlite(?:\.gz)?$")
CHUNK = 1024 * 1024
VERIFIED_SQLITE_HASHES = set()


def daily_date(p):
    match = DAILY.fullmatch(p.name)
    if not match:
        return None
    try:
        date = datetime.date.fromisoformat(match[1])
    except ValueError:
        return None
    if date > datetime.datetime.now(datetime.timezone.utc).date():
        return None
    return date.isoformat()


def digest(stream):
    h = hashlib.sha256()
    size = 0
    while chunk := stream.read(CHUNK):
        h.update(chunk)
        size += len(chunk)
    return h.hexdigest(), size


def identity(p):
    s = p.stat(follow_symlinks=False)
    return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns


def safe_file(root, p, min_age=86400):
    p = Path(p).absolute()
    if p.is_symlink() or p.resolve() != p or not p.is_relative_to(root):
        raise ValueError(f"Outside archive root or symbolic path: {p}")
    s = p.stat(follow_symlinks=False)
    if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or not s.st_size:
        raise ValueError(f"Not a nonempty single-link regular file: {p}")
    if time.time() - s.st_mtime < min_age:
        raise ValueError(f"Archive is less than 24 hours old: {p}")
    for suffix in ("-wal", "-journal"):
        sidecar = Path(str(p) + suffix)
        if sidecar.exists() and sidecar.stat().st_size:
            raise ValueError(f"Archive has a nonempty SQLite sidecar: {p}")
    assert_unused(p)
    return p


def assert_unused(p, tree=False):
    # Inspect all processes, including standalone operator jobs outside systemd.
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit() or int(proc.name) == os.getpid():
            continue
        try:
            argv = (proc / 'cmdline').read_bytes().split(b'\0')
            if any(os.fsencode(p) in arg for arg in argv):
                raise ValueError(f"Archive referenced by process {proc.name}: {p}")
            if tree:
                cwd = os.readlink(proc / 'cwd')
                if cwd == str(p) or cwd.startswith(str(p) + '/'):
                    raise ValueError(f'Active staging working directory: {p}')
            for fd in (proc / 'fd').iterdir():
                try:
                    target = os.readlink(fd).removesuffix(' (deleted)')
                    if target == str(p) or (tree and target.startswith(str(p) + '/')):
                        raise ValueError(f"Archive open by process {proc.name}: {p}")
                except FileNotFoundError:
                    pass
        except (FileNotFoundError, ProcessLookupError):
            pass
        except PermissionError as e:
            raise ValueError('Run as root to verify all active file references') from e


def validate_archive(p):
    opener = gzip.open if p.suffix == '.gz' else open
    with opener(p, 'rb') as f:
        if f.read(16) != b'SQLite format 3\x00':
            raise ValueError(f"Not a SQLite backup: {p}")
    with opener(p, 'rb') as f:
        return digest(f)  # Reading to EOF also verifies gzip CRC/truncation.


def verify_recovery(p):
    checksum, size = validate_archive(p)
    if checksum in VERIFIED_SQLITE_HASHES:
        return
    print(json.dumps({'action': 'recovery_check_started', 'path': str(p)}), flush=True)
    restored = None
    try:
        source = p
        if p.suffix == '.gz':
            if shutil.disk_usage(p.parent).free < size + 1024**3:
                raise ValueError('Insufficient space to test backup restoration')
            fd, name = tempfile.mkstemp(prefix='.restore-check-', suffix='.sqlite', dir=p.parent)
            restored = Path(name)
            with os.fdopen(fd, 'wb') as out, gzip.open(p, 'rb') as src:
                shutil.copyfileobj(src, out, CHUNK)
            source = restored
        db = sqlite3.connect(source.as_uri() + '?mode=ro&immutable=1', uri=True)
        try:
            db.execute('PRAGMA query_only=ON')
            db.execute('PRAGMA cache_size=-32768')
            deadline = time.monotonic() + 1800
            db.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
            if db.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                raise ValueError('Recovery database quick_check failed')
        finally:
            db.close()
        VERIFIED_SQLITE_HASHES.add(checksum)
        print(json.dumps({'action': 'recovery_check_passed', 'path': str(p), 'sha256': checksum}), flush=True)
    finally:
        if restored is not None:
            restored.unlink(missing_ok=True)


def compress(root, p, apply):
    p = safe_file(root, p)
    if p.suffix == '.gz':
        raise ValueError(f"Already compressed: {p}")
    dest = Path(str(p) + '.gz')
    if dest.exists():
        # Recover an interrupted atomic publication, without overwriting or
        # assuming that two equally named files contain the same bytes.
        safe_file(root, dest, min_age=0)
        before = identity(p)
        archive_before = identity(dest)
        with p.open('rb') as source:
            original = digest(source)
        if validate_archive(dest) != original:
            raise ValueError(f"Existing archive differs from source: {dest}")
        safe_file(root, p)
        if identity(p) != before or identity(dest) != archive_before:
            raise ValueError(f"Archive pair changed during verification: {p}")
        if apply:
            p.unlink()
        return {'action': 'deduplicated' if apply else 'deduplicate',
                'path': str(p), 'archive': str(dest), 'sha256': original[0],
                'reclaimed_bytes': before[2] if apply else 0}
    before = identity(p)
    if not apply:
        return {'action': 'compress', 'path': str(p), 'source_bytes': before[2]}
    # A failed or incompressible attempt must not exhaust the filesystem.
    if shutil.disk_usage(root).free < before[2] + 1024**3:
        raise ValueError(f"Insufficient temporary space for {p}")
    s = p.stat()
    fd, name = tempfile.mkstemp(prefix=p.name + '.', suffix='.partial', dir=p.parent)
    temp = Path(name)
    try:
        original = hashlib.sha256()
        with os.fdopen(fd, 'wb') as output:
            os.fchmod(output.fileno(), stat.S_IMODE(s.st_mode))
            os.fchown(output.fileno(), s.st_uid, s.st_gid)
            with gzip.GzipFile(filename='', mode='wb', fileobj=output, compresslevel=1, mtime=0) as gz:
                with p.open('rb') as source:
                    if source.read(16) != b'SQLite format 3\x00':
                        raise ValueError(f"Not a SQLite backup: {p}")
                    source.seek(0)
                    while chunk := source.read(CHUNK):
                        original.update(chunk)
                        gz.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        with gzip.open(temp, 'rb') as check:
            checksum, restored_size = digest(check)
        if checksum != original.hexdigest() or restored_size != before[2]:
            raise ValueError(f"Archive roundtrip mismatch: {p}")
        safe_file(root, p)
        if identity(p) != before:
            raise ValueError(f"Source changed during compression: {p}")
        os.utime(temp, ns=(s.st_atime_ns, s.st_mtime_ns))
        os.link(temp, dest)  # Atomic publication, never replace another archive.
        temp.unlink()
        directory = os.open(p.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        p.unlink()  # Only after verified, durably published replacement exists.
        return {'action': 'compressed', 'path': str(p), 'archive': str(dest),
                'sha256': checksum, 'source_bytes': before[2],
                'archive_bytes': dest.stat().st_size,
                'reclaimed_bytes': before[2] - dest.stat().st_size}
    finally:
        if temp.exists():
            temp.unlink()


def daily_files(root):
    return sorted((p for p in root.iterdir() if daily_date(p)),
                  key=lambda p: (daily_date(p), p.name), reverse=True)


def maintain_daily(root, apply, emit):
    if (root / '.keep').exists():
        emit({'action': 'daily_kept', 'reason': 'backup_root_pinned'})
        return
    files = daily_files(root)
    dates = sorted({daily_date(p) for p in files}, reverse=True)
    cutoff = (datetime.datetime.now(datetime.timezone.utc).date() - datetime.timedelta(days=6)).isoformat()
    keep = set(date for date in dates[:3] if date >= cutoff)
    # Never erase the last recovery point because a daily job stopped running.
    if not keep and dates:
        keep.add(dates[0])
    keep.update(daily_date(p) for p in files if Path(str(p) + '.keep').exists())
    expired = [p for p in files if daily_date(p) not in keep]
    retained = [p for p in files if daily_date(p) in keep]
    # Validate every retained date before expiring any older recovery point.
    if expired:
        verify_recovery(retained[0])
        validated = {}
        for day in sorted(keep):
            candidates = [p for p in retained if daily_date(p) == day]
            for p in candidates:
                safe_file(root, p, min_age=0)
                validated[p] = identity(p)
                validate_archive(p)
        for p in expired:
            for survivor, expected in validated.items():
                safe_file(root, survivor, min_age=0)
                if identity(survivor) != expected:
                    raise ValueError(f'Retained backup changed: {survivor}')
            safe_file(root, p)
            size = p.stat().st_size
            if apply:
                p.unlink()
            emit({'action': 'expired' if apply else 'expire', 'path': str(p),
                  'reclaimed_bytes': size if apply else 0, 'bytes': size})
    for p in retained:
        if p.suffix == '.gz' or time.time() - p.stat().st_mtime < 86400:
            continue
        emit(compress(root, p, apply))
    emit({'action': 'retention', 'daily_dates': sorted(keep), 'keep_dates': 3,
          'max_age_days': 7, 'last_recovery_exception': bool(keep and min(keep) < cutoff)})


def expire_manual_backups(root, apply, emit):
    """Seven-day rollback policy, independent of long-lived price aggregates.

    Only SQLite backup files expire here; code, credentials, repair evidence and
    unknown formats are untouched. A .keep file on any parent pins recovery.
    """
    daily = daily_files(root)
    if not daily:
        emit({'action': 'manual_expiry_skipped', 'reason': 'no_daily_recovery'})
        return
    recovery = daily[0]
    safe_file(root, recovery, min_age=0)
    if time.time() - recovery.stat().st_mtime >= 7 * 86400:
        emit({'action': 'manual_expiry_skipped', 'reason': 'daily_recovery_stale'})
        return
    verify_recovery(recovery)
    recovery_identity = identity(recovery)
    pattern = re.compile(r'^search-index(?:[-.].*)?\.sqlite(?:\.pre)?(?:\.gz)?$')
    # The common subdirectory form has exactly the basename search-index.sqlite.
    for directory, dirs, names in os.walk(root, followlinks=False):
        parent = Path(directory)
        if (parent / '.keep').exists():
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if not (parent / d).is_symlink()]
        for name in names:
            p = parent / name
            if DAILY.fullmatch(p.name) and parent == root:
                continue
            if not (pattern.fullmatch(name) or name in ('search-index.sqlite', 'search-index.sqlite.gz',
                                                       'search-index.sqlite.pre', 'search-index.sqlite.pre.gz')):
                continue
            if time.time() - p.lstat().st_mtime < 7 * 86400 or Path(str(p) + '.keep').exists():
                continue
            try:
                safe_file(root, p, min_age=7 * 86400)
                if p.stat().st_mtime >= recovery.stat().st_mtime:
                    raise ValueError('Recovery does not supersede this backup')
                if identity(recovery) != recovery_identity:
                    raise ValueError('Validated daily recovery changed')
                if any((parent / '.keep').exists() for parent in [p.parent, *p.parents] if parent.is_relative_to(root)) or Path(str(p) + '.keep').exists():
                    raise ValueError('Recovery backup was pinned')
                size = p.stat().st_size
                if apply:
                    p.unlink()
                emit({'action': 'expired_manual' if apply else 'expire_manual',
                      'path': str(p), 'recovery': str(recovery), 'bytes': size,
                      'reclaimed_bytes': size if apply else 0})
            except ValueError as error:
                emit({'action': 'manual_expiry_skipped', 'path': str(p), 'reason': str(error)})


def expire_completed_staging(root, database, apply, emit):
    """Expire only successful, durably recorded publications after seven days."""
    if not root.is_dir() or not database.is_file():
        return
    if root.is_symlink() or root.resolve() != root:
        raise ValueError('Staging root must not be a symlink')
    db = sqlite3.connect(f'file:{database}?mode=ro', uri=True, timeout=2)
    db.execute('PRAGMA query_only=ON')
    try:
        active = {r[0] for r in db.execute('SELECT publication_id FROM pc_publication_runtime')}
        newest = db.execute('SELECT publication_id FROM pc_stored_price_publications ORDER BY published_at DESC LIMIT 1').fetchone()
        if newest:
            active.add(newest[0])
        for folder in sorted(root.iterdir()):
            if folder.is_symlink() or not folder.is_dir() or (folder / '.keep').exists():
                continue
            status, receipt = folder / 'publication-status', folder / 'publication.json'
            if not status.is_file() or not receipt.is_file():
                emit({'action': 'staging_kept', 'path': str(folder), 'reason': 'no_success_receipt'})
                continue
            if status.is_symlink() or receipt.is_symlink() or receipt.stat().st_size > 1024 * 1024:
                continue
            try:
                assert_unused(folder, tree=True)
                proof = json.loads(receipt.read_text())
                published = datetime.datetime.fromisoformat(proof['published_at'].replace('Z', '+00:00'))
                if (status.read_text().strip() != 'complete' or proof.get('published') is not True
                        or proof.get('verifier') != 'aws-readback-v1'
                        or proof.get('publication_id') in active
                        or time.time() - published.timestamp() < 7 * 86400):
                    continue
                stored = db.execute('SELECT row_count FROM pc_stored_price_publications WHERE publication_id=?',
                                    (proof['publication_id'],)).fetchone()
                if not stored or stored[0] != proof.get('row_count') or stored[0] <= 0:
                    continue
                files, directories = [], []
                for parent, dirs, names in os.walk(folder, followlinks=False):
                    p = Path(parent)
                    directories.append(p)
                    if '.keep' in names or any((p / d).is_symlink() for d in dirs):
                        raise ValueError('Pinned or symbolic staging contents')
                    for name in names:
                        f = p / name
                        entry = f.lstat()
                        if not stat.S_ISREG(entry.st_mode) or entry.st_nlink != 1:
                            raise ValueError('Non-regular staging file')
                        if entry.st_size:
                            safe_file(root, f, min_age=7 * 86400)
                        if f.is_symlink() or f.resolve() != f or not f.is_relative_to(root):
                            raise ValueError('Unsafe staging file')
                        if time.time() - f.stat().st_mtime < 7 * 86400:
                            raise ValueError('Recently changed staging file')
                        files.append((f, identity(f)))
                total = sum(expected[2] for _, expected in files)
                if apply:
                    assert_unused(folder, tree=True)
                    if any((p / '.keep').exists() for p in directories):
                        raise ValueError('Staging was pinned during validation')
                    actual_files = {p for p in folder.rglob('*') if not p.is_dir()}
                    if actual_files != {p for p, _ in files} or any(identity(f) != expected for f, expected in files):
                        raise ValueError('Staging tree changed since inventory')
                    for f, expected in files:
                        if identity(f) != expected:
                            raise ValueError('Staging file changed since inventory')
                        f.unlink()
                    for p in reversed(directories):
                        p.rmdir()  # New/unrecognized files prevent directory removal.
                emit({'action': 'expired_staging' if apply else 'expire_staging',
                      'path': str(folder), 'publication_id': proof['publication_id'],
                      'bytes': total, 'reclaimed_bytes': total if apply else 0})
            except (ValueError, KeyError, OSError) as error:
                emit({'action': 'staging_kept', 'path': str(folder), 'reason': str(error)})
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup-root', default='/var/lib/used-market-runner/backups')
    parser.add_argument('--daily', action='store_true')
    parser.add_argument('--archive', action='append', default=[])
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = Path(args.backup_root).absolute()
    if root.resolve() != root or not root.is_dir():
        raise ValueError('Backup root must be a real directory without symlinks')
    if not args.daily and not args.archive:
        parser.error('Specify --daily and/or explicit --archive paths')
    def emit(value):
        print(json.dumps(value), flush=True)
    # Prevent duplicate maintenance. Lock file contains no credentials or state.
    with (root / '.storage-maintenance.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = shutil.disk_usage(root).free
        emit({'action': 'start', 'apply': args.apply, 'free_bytes': before,
              'at': datetime.datetime.now(datetime.timezone.utc).isoformat()})
        for p in args.archive:
            emit(compress(root, Path(p), args.apply))
        if args.daily:
            maintain_daily(root, args.apply, emit)
            expire_manual_backups(root, args.apply, emit)
            expire_completed_staging(root.parent / 'staging', root.parent / 'search-index.sqlite', args.apply, emit)
        emit({'action': 'complete', 'apply': args.apply,
              'free_bytes': shutil.disk_usage(root).free})


if __name__ == '__main__':
    main()
