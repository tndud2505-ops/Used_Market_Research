"""Linux-only filesystem safety checks; uses disposable synthetic SQLite files."""
import gzip
import fcntl
import hashlib
from contextlib import closing
import datetime
import importlib.util
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import json
import tempfile
import time

module_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'aws-runner/maintain-backup-storage.py'
spec = importlib.util.spec_from_file_location('storage', module_path)
storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storage)


def fixture(p):
    with closing(sqlite3.connect(p)) as db, db:
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


def inventory(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file() and p.name != '.storage-maintenance.lock'}


def run_cli(root, *args, succeeds=True):
    result = subprocess.run([sys.executable, '-B', str(module_path.resolve()),
                             '--backup-root', str(root), *args],
                            capture_output=True, text=True, timeout=60)
    assert (result.returncode == 0) == succeeds, result.stderr or result.stdout
    return [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]


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
    # Exercise bounded dirty-page flushing, not just sub-buffer toy archives.
    large = fixture(root / 'buffered-restore.sqlite')
    with closing(sqlite3.connect(large)) as db, db:
        db.execute('insert into sample values (zeroblob(?))', (32 * 1024 * 1024,))
    os.utime(large, (time.time() - 172800,) * 2)
    large_archive = Path(storage.compress(root, large, True)['archive'])
    storage.verify_recovery(large_archive)
    assert not list(root.glob('.restore-check-*.sqlite'))
    # Resume a crash between publishing .gz and unlinking its verified source.
    with gzip.open(archived, 'rb') as src:
        original.write_bytes(src.read())
    os.utime(original, ns=(before, before))
    storage.compress(root, original, True)
    assert not original.exists() and storage.validate_archive(archived) == checksum
    mismatched = fixture(root / 'mismatched.sqlite')
    mismatched_gz = Path(str(mismatched) + '.gz')
    mismatched_gz.write_bytes(gzip.compress(b'SQLite format 3\x00different recovery content'))
    pair_before = (mismatched.read_bytes(), mismatched_gz.read_bytes())
    refuses(lambda: storage.compress(root, mismatched, True))
    assert (mismatched.read_bytes(), mismatched_gz.read_bytes()) == pair_before
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
    os.utime(old_manual, (time.time() - 8 * 86400,) * 2)
    os.utime(manual, (time.time() - 6 * 86400,) * 2)
    pinned = fixture(root / 'search-index-pre-migration-v2.sqlite')
    os.utime(pinned, (time.time() - 10 * 86400,) * 2)
    Path(str(pinned) + '.keep').write_text('unresolved rollback')
    storage.expire_manual_backups(root, True, events.append)
    assert not old_manual.exists() and pinned.exists() and manual.exists()
    scratch = fixture(root / '.restore-check-abandoned.sqlite')
    scratch_pin = fixture(root / '.restore-check-pinned.sqlite')
    Path(str(scratch_pin) + '.keep').write_text('retained')
    scratch_fresh = fixture(root / '.restore-check-fresh.sqlite')
    os.utime(scratch_fresh, None)
    storage.expire_abandoned_checks(root, False, events.append)
    assert scratch.exists()
    storage.expire_abandoned_checks(root, True, events.append)
    assert not scratch.exists() and scratch_pin.exists() and scratch_fresh.exists()
    legacy_root = root / 'legacy-host'
    legacy_backups = legacy_root / 'backups'
    legacy_backups.mkdir(parents=True)
    fixture(legacy_backups / f'search-index-{today.isoformat()}.sqlite')
    operating = fixture(legacy_root / 'search-index.sqlite')
    legacy = fixture(legacy_root / 'search-index.sqlite.pre-local-reconcile-2026-09-17T04-25-30-207Z')
    os.utime(legacy, (time.time() - 10 * 86400,) * 2)
    Path(str(legacy) + '.keep').write_text('unresolved')
    storage.expire_manual_backups(legacy_backups, True, events.append, legacy_parent=True)
    assert legacy.exists()
    Path(str(legacy) + '.keep').unlink()
    storage.expire_manual_backups(legacy_backups, False, events.append, legacy_parent=True)
    assert legacy.exists()
    storage.expire_manual_backups(legacy_backups, True, events.append, legacy_parent=True)
    assert not legacy.exists() and operating.exists()
    recent_daily = fixture(legacy_backups / f'search-index-{(today - datetime.timedelta(days=1)).isoformat()}.sqlite')
    os.utime(recent_daily, (time.time() - 7200,) * 2)
    storage.maintain_daily(legacy_backups, True, events.append)
    assert not recent_daily.exists() and Path(str(recent_daily) + '.gz').exists()
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
    with closing(sqlite3.connect(database)) as db, db:
        db.execute('create table pc_publication_runtime(publication_id text)')
        db.execute("insert into pc_publication_runtime values ('current')")
        db.execute('create table pc_stored_price_publications(publication_id text,row_count integer,published_at text)')
        db.executemany('insert into pc_stored_price_publications values (?,?,?)',
                       [('old', 3, '2026-01-01'), ('current', 3, '2026-02-01')])
    database_before = database.read_bytes()
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
    assert database.read_bytes() == database_before, 'staging cleanup must not modify the operating ledger'

# Exercise the real CLI/lock boundary, not only imported helper functions.
with tempfile.TemporaryDirectory(prefix='used-web-storage-cli-') as td:
    host = Path(td).resolve()
    backups = host / 'backups'
    backups.mkdir()
    (host / 'staging').mkdir()
    today = datetime.datetime.now(datetime.timezone.utc).date()
    daily = fixture(backups / f'search-index-{today.isoformat()}.sqlite')
    operating = fixture(host / 'search-index.sqlite')
    with closing(sqlite3.connect(operating)) as db, db:
        db.execute('create table listings (id text, status text, price integer)')
        db.executemany('insert into listings values (?,?,?)', [('active', 'ACTIVE', 50000), ('sold', 'SOLD', 49000)])
        db.execute('create table daily_price_stats (date text, mean integer)')
        db.execute("insert into daily_price_stats values ('2023-01-01', 49500)")
        db.execute('create table pc_publication_runtime (publication_id text)')
        db.execute('create table pc_stored_price_publications (publication_id text, row_count integer, published_at text)')
        db.execute("insert into pc_stored_price_publications values ('current', 1, '2023-01-01')")
    operating_bytes = operating.read_bytes()
    legacy = fixture(host / 'search-index.sqlite.pre-local-reconcile-2026-09-17T04-25-30-207Z')
    os.utime(legacy, (time.time() - 10 * 86400,) * 2)
    scratch = fixture(backups / '.restore-check-stale.sqlite')
    live_scratch = fixture(backups / '.restore-check-active.sqlite')
    unrelated = fixture(backups / 'operator-evidence.sqlite')
    outside = fixture(host / 'unrelated-service.sqlite')
    before = inventory(host)
    events = run_cli(backups, '--daily')
    assert events[-1]['action'] == 'complete' and not events[-1]['apply']
    assert inventory(host) == before, 'dry run must not change data or leak scratch files'
    # A competing maintenance lock must reject a second invocation before work.
    with (backups / '.storage-maintenance.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        run_cli(backups, '--daily', '--apply', succeeds=False)
    assert inventory(host) == before
    # Keep a real child process referencing scratch while the cleaner runs.
    child = subprocess.Popen([sys.executable, '-c',
        'import sys; f=open(sys.argv[1], "rb"); print("ready", flush=True); sys.stdin.read()', str(live_scratch)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        assert child.stdout.readline().strip() == 'ready'
        events = run_cli(backups, '--daily', '--apply')
        assert live_scratch.exists(), 'active file references must survive cleanup'
        assert any(e.get('action') == 'scratch_kept' for e in events)
    finally:
        child.communicate('', timeout=10)
    assert not scratch.exists() and not daily.exists() and Path(str(daily) + '.gz').exists()
    assert legacy.exists(), 'ordinary daily cleanup must not expire sibling legacy files'
    run_cli(backups, '--daily', '--apply', '--legacy-reconcile')
    assert not legacy.exists() and not live_scratch.exists()
    after = inventory(host)
    events = run_cli(backups, '--daily', '--apply', '--legacy-reconcile')
    assert inventory(host) == after, 'reruns must neither create copies nor delete additional retained data'
    assert sum(e.get('reclaimed_bytes', 0) for e in events) == 0
    assert operating.read_bytes() == operating_bytes, 'live listings and historical price DB must be byte-for-byte unchanged'
    assert unrelated.exists() and outside.exists(), 'unrecognized files and other services are outside cleanup scope'
    assert not list(backups.glob('*.partial')) and not list(backups.glob('.restore-check-*.sqlite'))

# Age limits must not remove the last recovery point when daily creation stops.
with tempfile.TemporaryDirectory(prefix='used-web-storage-retention-') as td:
    root = Path(td).resolve()
    today = datetime.datetime.now(datetime.timezone.utc).date()
    newest_day = (today - datetime.timedelta(days=8)).isoformat()
    older_day = (today - datetime.timedelta(days=9)).isoformat()
    pinned_day = (today - datetime.timedelta(days=12)).isoformat()
    for day in [newest_day, older_day, pinned_day]:
        p = fixture(root / f'search-index-{day}.sqlite')
        os.utime(p, (time.time() - 10 * 86400,) * 2)
    Path(str(root / f'search-index-{pinned_day}.sqlite') + '.keep').write_text('unresolved recovery')
    manual = fixture(root / 'search-index-pre-migration-v1.sqlite')
    os.utime(manual, (time.time() - 20 * 86400,) * 2)
    events = []
    (root / '.keep').write_text('freeze recovery set')
    before = inventory(root)
    storage.maintain_daily(root, True, events.append)
    storage.expire_manual_backups(root, True, events.append)
    assert inventory(root) == before, 'a root recovery pin must prevent cleanup'
    (root / '.keep').unlink()
    storage.maintain_daily(root, True, events.append)
    assert {storage.daily_date(p) for p in storage.daily_files(root)} == {newest_day, pinned_day}
    storage.expire_manual_backups(root, True, events.append)
    assert manual.exists(), 'a stale daily recovery must not authorize manual backup expiry'
    assert any(e.get('last_recovery_exception') is True for e in events)
print('backup storage contract passed: lossless archives, retention, pins, live-file/lock safety, CLI dry-run, idempotence, operating DB preservation')
