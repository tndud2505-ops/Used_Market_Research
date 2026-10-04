"""Linux-only filesystem safety checks; uses disposable synthetic SQLite files."""
import gzip
import datetime
import importlib.util
import os
from pathlib import Path
import sqlite3
import sys
import json
import tempfile
import time

module_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'aws-runner/maintain-backup-storage.py'
spec = importlib.util.spec_from_file_location('storage', module_path)
storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storage)


def fixture(p):
    with sqlite3.connect(p) as db:
        db.execute('create table sample (value text)')
        db.execute("insert into sample values ('retained evidence')")
    old = time.time() - 172800
    os.utime(p, (old, old))
    return p


def refuses(fn):
    try:
        fn()
    except ValueError:
        return
    raise AssertionError('Unsafe action was accepted')


with tempfile.TemporaryDirectory(prefix='used-web-storage-test-') as td:
    root = Path(td).resolve()
    original = fixture(root / 'manual.sqlite')
    checksum = storage.validate_archive(original)
    before = original.stat().st_mtime_ns
    storage.compress(root, original, False)
    assert original.exists() and not Path(str(original) + '.gz').exists()
    result = storage.compress(root, original, True)
    archived = Path(result['archive'])
    assert not original.exists() and storage.validate_archive(archived) == checksum
    assert archived.stat().st_mtime_ns == before
    # Resume a crash between publishing .gz and unlinking its verified source.
    with gzip.open(archived, 'rb') as src:
        original.write_bytes(src.read())
    os.utime(original, ns=(before, before))
    storage.compress(root, original, True)
    assert not original.exists() and storage.validate_archive(archived) == checksum
    fresh = fixture(root / 'fresh.sqlite')
    os.utime(fresh, None)
    refuses(lambda: storage.compress(root, fresh, True))
    busy = fixture(root / 'sidecar.sqlite')
    Path(str(busy) + '-wal').write_bytes(b'pending transaction')
    refuses(lambda: storage.compress(root, busy, True))
    alias = root / 'alias.sqlite'
    alias.symlink_to(busy)
    refuses(lambda: storage.compress(root, alias, True))
    refuses(lambda: storage.safe_file(root, Path('/etc/passwd')))
    today = datetime.datetime.now(datetime.timezone.utc).date()
    days = [(today - datetime.timedelta(days=offset)).isoformat() for offset in [4, 3, 2, 1]]
    for i, day in enumerate(days):
        p = fixture(root / f'search-index-{day}.sqlite')
        if i % 2:
            storage.compress(root, p, True)
    manual = fixture(root / 'search-index-pre-migration-v9.sqlite')
    impossible = fixture(root / 'search-index-9999-99-99.sqlite')
    future = fixture(root / 'search-index-9999-01-01.sqlite')
    events = []
    storage.maintain_daily(root, False, events.append)
    assert len(storage.daily_files(root)) == 4
    storage.maintain_daily(root, True, events.append)
    assert {storage.daily_date(p) for p in storage.daily_files(root)} == set(days[1:])
    assert manual.exists() and archived.exists() and impossible.exists() and future.exists()
    old_manual = fixture(root / 'search-index-pre-migration-v1.sqlite')
    os.utime(old_manual, (time.time() - 10 * 86400,) * 2)
    pinned = fixture(root / 'search-index-pre-migration-v2.sqlite')
    os.utime(pinned, (time.time() - 10 * 86400,) * 2)
    Path(str(pinned) + '.keep').write_text('unresolved rollback')
    storage.expire_manual_backups(root, True, events.append)
    assert not old_manual.exists() and pinned.exists() and manual.exists()
    # A corrupt retained gzip must prevent expiry of the older known backup.
    old = fixture(root / 'search-index-2026-08-31.sqlite')
    (root / f'search-index-{days[-1]}.sqlite.gz').write_bytes(b'corrupt')
    try:
        storage.maintain_daily(root, True, events.append)
        raise AssertionError('Corrupt survivor accepted')
    except (OSError, ValueError):
        pass
    assert old.exists()
    staging = root / 'staging'
    staging.mkdir()
    database = root / 'ledger.sqlite'
    with sqlite3.connect(database) as db:
        db.execute('create table pc_publication_runtime(publication_id text)')
        db.execute("insert into pc_publication_runtime values ('current')")
        db.execute('create table pc_stored_price_publications(publication_id text,row_count integer,published_at text)')
        db.executemany('insert into pc_stored_price_publications values (?,?,?)',
                       [('old', 3, '2026-01-01'), ('current', 3, '2026-02-01')])
    def stage(name, pub='old', complete=True, pinned=False):
        folder = staging / name
        folder.mkdir()
        (folder / 'publication-status').write_text('complete' if complete else 'failed')
        (folder / 'publication.json').write_text(json.dumps({'published': True, 'verifier': 'aws-readback-v1',
            'publication_id': pub, 'row_count': 3, 'published_at': '2025-01-01T00:00:00Z'}))
        (folder / 'prepared-publication.json').write_text('disposable prepared output')
        if pinned:
            (folder / '.keep').write_text('open recovery')
        for f in folder.iterdir():
            os.utime(f, (time.time() - 10 * 86400,) * 2)
        return folder
    completed = stage('completed')
    failed = stage('failed', complete=False)
    current = stage('current', pub='current')
    pinned_stage = stage('pinned', pinned=True)
    unknown = stage('unknown', pub='not-in-ledger')
    storage.expire_completed_staging(staging, database, False, events.append)
    assert completed.exists()
    storage.expire_completed_staging(staging, database, True, events.append)
    assert not completed.exists()
    assert all(p.exists() for p in [failed, current, pinned_stage, unknown])
print('backup storage contract passed: roundtrip, dry-run, age, sidecar, scope, retention, corrupt survivor')
