import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SearchIndex } from '../aws-runner/search-index.mjs';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';
import { DaangnTrialPublisher, daangnPublicationItems } from '../aws-runner/publish-daangn-trial.mjs';
import { pcCatalogResponse } from '../cloudflare/pc-directory-http.mjs';
import { getPcSource, validateSourceActivation } from '../collector/logic/pc-source-registry.mjs';
import { daangnDeliveryRestriction } from '../collector/logic/daangn-public-search.mjs';
import { trialTargets, selectTrialQuery, reserveAttempt, kstDay, inTrialWindow, lockIsHeld, categoryTrialTargets, TRIAL_CATEGORIES, trialRunOptions, resumeStoppedTrial, deferTransientTrial } from '../aws-runner/daangn-trial-core.mjs';
const targets = trialTargets();
assert.ok(targets.length > 100);
assert.equal(new Set(targets.map(x => x.productId)).size, targets.length);
let state = { day: '2026-11-10', attempted: 0, cursor: 0 };
for (let i = 0; i < 100; i++) {
  const next = reserveAttempt(JSON.parse(JSON.stringify(state)), state.day, targets);
  assert.ok(next); state = next.state;
}
assert.equal(reserveAttempt(state, state.day, targets), null);
const coverageTargets = categoryTrialTargets();
assert.equal(coverageTargets.length, TRIAL_CATEGORIES.length * 2);
assert.deepEqual([...new Set(coverageTargets.map(target => target.category))], [...TRIAL_CATEGORIES]);
let extended = { ...state }; const extra = [];
for (let i = 0; i < 100; i++) {
  const next = reserveAttempt(extended, state.day, targets, { dailyLimit: 200, coverageTargets });
  assert.ok(next); extra.push(next.target); extended = JSON.parse(JSON.stringify(next.state));
}
assert.equal(extended.attempted, 200); assert.equal(extended.cursor, 200);
assert.equal(extended.rotation_cursor, state.cursor + 100 - coverageTargets.length);
assert.equal(extra[coverageTargets.length].query, selectTrialQuery(targets, state.cursor).query,
  'coverage queries must not skip models in the ongoing rotation');
assert.equal(reserveAttempt(extended, state.day, targets, { dailyLimit: 200, coverageTargets }), null);
assert.deepEqual(extra.slice(0, coverageTargets.length).map(target => target.query), coverageTargets.map(target => target.query));
assert.equal(trialRunOptions([], '2026-11-11').dailyLimit, 100);
assert.equal(trialRunOptions(['--daily-limit=200', '--trial-day=2026-11-10'], state.day).dailyLimit, 200);
assert.throws(() => trialRunOptions(['--daily-limit=200', '--trial-day=2026-11-10'], '2026-11-11'));
assert.throws(() => trialRunOptions(['--daily-limit=200', '--trial-day=2026-11-10', '--scheduled'], state.day));
const nextDay = reserveAttempt(state, '2026-11-11', targets);
assert.equal(nextDay.state.attempted, 1);
assert.equal(nextDay.state.cursor, 101);
assert.equal(reserveAttempt({ ...state, attempted: 3, stopped_day: state.day }, state.day, targets), null);
assert.notEqual(selectTrialQuery(targets, 0).query, selectTrialQuery(targets, targets.length).query);
assert.equal(kstDay(Date.parse('2026-11-09T15:00:00Z')), '2026-11-10');
assert.ok(inTrialWindow(Date.parse('2026-11-09T17:00:00Z')));
assert.ok(inTrialWindow(Date.parse('2026-11-09T17:50:00Z')));
assert.ok(inTrialWindow(Date.parse('2026-11-10T13:00:00Z')));
assert.ok(!inTrialWindow(Date.parse('2026-11-10T14:00:00Z')));
assert.ok(!inTrialWindow(Date.parse('2026-11-09T16:59:00Z')));
const stopped = { day: state.day, attempted: 1, cursor: 201, stopped_day: state.day,
  coverage_day: state.day, coverage_cursor: 1, rotation_cursor: 200 };
const failedRecord = { attempt: 1, status: 'FAILED', error: 'DAANGN_SEARCH_FETCH_ERROR: transport failed', target: coverageTargets[0] };
let resumed = resumeStoppedTrial(stopped, state.day, failedRecord);
assert.equal(resumed.attempted, 1, 'operator recovery must preserve the request budget');
const retried = reserveAttempt(resumed, state.day, targets, { coverageTargets });
assert.equal(retried.state.attempted, 2);
assert.equal(retried.state.cursor, 201, 'a transport retry must not skip another model');
assert.equal(retried.state.coverage_cursor, 1);
assert.equal(retried.target.query, coverageTargets[0].query);
assert.equal(reserveAttempt({ ...resumed, attempted: 100 }, state.day, targets), null);
assert.throws(() => resumeStoppedTrial(stopped, '2026-11-11', failedRecord));
assert.throws(() => resumeStoppedTrial(stopped, state.day, { ...failedRecord, error: 'DAANGN_SEARCH_HTTP_403: denied' }));
assert.throws(() => resumeStoppedTrial(stopped, state.day, { ...failedRecord, attempt: 2 }));
const canonicalFailure = { ...failedRecord, error: 'DAANGN_SEARCH_REDIRECT: Redirects are not allowed',
  error_details: { response: { status: 301, location: '/kr/search/buy-sell/?only_on_sale=true&q=CPU' } } };
assert.throws(() => resumeStoppedTrial(stopped, state.day, canonicalFailure));
assert.equal(resumeStoppedTrial(stopped, state.day, canonicalFailure, { canonicalSearchMigration: true }).attempted, 1);
for (const location of ['https://evil.test/kr/search/buy-sell/?only_on_sale=true&q=CPU',
  '/kr/search/buy-sell/?only_on_sale=false&q=CPU', '/kr/search/buy-sell/?only_on_sale=true&q=GPU',
  '/kr/search/buy-sell/?only_on_sale=true&q=CPU&token=unexpected']) {
  assert.throws(() => resumeStoppedTrial(stopped, state.day,
    { ...canonicalFailure, error_details: { response: { status: 301, location } } }, { canonicalSearchMigration: true }));
}
const retryNow = Date.parse('2026-11-10T01:00:00Z');
for (let i = 1; i <= 3; i++) {
  const deferred = deferTransientTrial(resumed, failedRecord.target, retryNow);
  resumed = deferred.state;
  assert.equal(deferred.deferred, i === 3);
}
assert.equal(Date.parse(resumed.retry_after) - retryNow, 4 * 3600000);
const freshDay = reserveAttempt(resumed, '2026-11-11', targets, { coverageTargets });
assert.equal(freshDay.state.attempted, 1);
assert.equal(freshDay.state.pending_target, undefined, 'yesterday retry must not displace new category coverage');
const locks = '1: FLOCK ADVISORY WRITE 100 08:01:12345 0 EOF';
assert.ok(lockIsHeld(locks, [{ dev: 2049n, ino: 12345n }]));
assert.ok(!lockIsHeld(locks, [{ dev: 2049n, ino: 23456n }]));
assert.ok(!lockIsHeld('1: -> FLOCK ADVISORY WRITE 100 08:01:12345 0 EOF', [{ dev: 2049n, ino: 12345n }]));
assert.ok(pcCatalogResponse().sources.some(source => source.source_id === 'daangn'));
assert.equal(daangnDeliveryRestriction({ title: '커세어 케이스', description: '택배불가라 직거래만 가능합니다.' }), 'DELIVERY_LOCAL_ONLY');
assert.equal(daangnDeliveryRestriction({ title: 'NZXT 케이스', description: '대방동 직거래만 합니다!!! 직거래만!!' }), 'DELIVERY_LOCAL_ONLY');
// Saved public candidate daangn:wxvchanu325s: preserve its actual wording.
assert.equal(daangnDeliveryRestriction({ title: '인텔 코어 i5-10400F CPU',
  description: '10400f 팔아요 지감 사용중이라 사진은 앖어서 대체했고 11400으로 업글 예정이라 싸게 팔아요 서멀 구리스도 같이 드릴게요 케이스가 없어서 배송문제로 직거만 하겠습니다 단품입니다 연락 많이주세여 11400 11700등 lga 1200소캣 제품들 추가금액드리고 교환도 합니다 네고 가능하니 편하게 찔러 주세요' }), 'DELIVERY_LOCAL_ONLY');
for (const description of [
  '직거만 하겠습니다', '직거래만 원합니다', '직거래 전용', '택배는 불가합니다', '배송 불가입니다',
  '택배 안됨, 직거래 원해요', '택배 가능하지 않습니다',
  '택배 가능하지 않습니다. 직거래만 가능합니다.',
  '택배 불가. 가격 협의는 하지 않습니다.', '택배 불가 환불은 안합니다', '택배불가 가격협의 안함',
  '다른 부품은 택배 가능합니다. 이 케이스는 직거래만 합니다.',
  '이전에는 택배 가능. 지금은 택배 불가, 직거래만 합니다.',
  '예전에는 택배 불가였지만 지금은 택배 가능하지 않습니다.',
  '예전에는 택배 불가. 다른 부품은 현재 택배 가능합니다.',
]) {
  assert.equal(daangnDeliveryRestriction({ title: '케이스', description }), 'DELIVERY_LOCAL_ONLY', description);
}
for (const description of [
  '', '직거래 선호', '직거래시 할인', '직거래만 이천원 할인', '배송 문의 주세요',
  '직거래 또는 택배 가능', '직거래 가능합니다. 택배도 가능합니다.',
  '직거래만 하는 것은 아니고 택배도 가능합니다', '직거래만은 아닙니다',
  '직거래만이 가능한건 아니고 택배도 됩니다',
  '택배불가는 아니에요', '택배불가 아님. 보내드릴 수 있어요.', '직거래 전용이 아닙니다',
  '직거래 불가, 택배만 가능합니다', '직거래 선호, 택배 가능합니다',
  '예전에는 택배 불가. 지금은 택배 가능합니다.',
  '직거래만 가능했지만 현재는 택배 가능합니다.',
  '예전엔 택배 불가였지만 현재는 직거래 또는 택배 가능합니다',
  '제주도 배송 불가, 내륙 택배 가능', '도서산간 택배는 불가합니다',
  '배송 불가 지역은 제주도입니다', '반값택배 불가 일반택배 가능',
  '무료배송 불가, 착불 택배 가능', '배송비 지원은 불가합니다', '택배비는 네고 불가',
]) {
  assert.equal(daangnDeliveryRestriction({ title: '케이스', description }), null, description);
}
assert.equal(getPcSource('daangn').policy_status, 'DENIED');
assert.equal(validateSourceActivation('daangn').ok, false, 'listing publication does not approve general collection');
const root = await mkdtemp(path.join(os.tmpdir(), 'daangn-publication-'));
const index = new SearchIndex({ filePath: path.join(root, 'index.sqlite') });
const ledger = new PcPartsLedger({ db: index.db }); ledger.migrate();
const pipeline = new PcShadowPipeline({ ledger }); await pipeline.initialize();
const day = '2026-11-10', observedAt = '2026-11-09T15:24:00.000Z';
const record = { status: 'OK', target: { productId: 'gpu:nvidia:rtx-5090' },
  diagnostics: { scope: 'PUBLIC_SEARCH_PAGE', observed_at: observedAt },
  items: [{ id: 'abc123', title: 'RTX 3060 12GB 정상 작동 팝니다', price: 200000,
    currency: 'KRW', url: 'https://www.daangn.com/kr/buy-sell/rtx3060-abc123/',
    description: '', location: '가음동', lifecycle_status: 'ACTIVE', shipping_evidence: 'BUY_NOW_BADGE',
    shipping_fee: null, observed_at: observedAt }] };
const publisher = new DaangnTrialPublisher({ root, index, pipeline });
try {
  await mkdir(path.join(root, day));
  await writeFile(path.join(root, day, '001.json'), JSON.stringify(record));
  assert.equal((await publisher.publishDay(day)).inserted, 1);
  const snapshotCount = ledger.db.prepare('SELECT COUNT(*) n FROM listing_snapshots').get().n;
  const receipt = await readFile(path.join(root, day, 'publication.json'), 'utf8');
  assert.equal((await publisher.publishDay(day)).published_files, 0);
  assert.equal(await readFile(path.join(root, day, 'publication.json'), 'utf8'), receipt);
  assert.equal(ledger.db.prepare('SELECT COUNT(*) n FROM listing_snapshots').get().n, snapshotCount);
  const listing = index.browsePcListings({ categoryCode: 'GPU', sites: ['daangn'], limit: 10 }).items[0];
  assert.ok(listing, 'the existing listing query exposes the imported source');
  assert.equal(listing.location, '가음동');
  assert.equal(listing.shipping_evidence, 'BUY_NOW_BADGE');
  assert.equal(listing.shipping_fee, null);
  assert.equal(listing.canonical_product_id, 'gpu:nvidia:rtx-3060', 'search target must not become product identity');
  assert.equal(listing.statistics_eligible, false);
  assert.ok(listing.statistics_exclusion_reasons.includes('SHIPPING_COST_UNVERIFIED'));
  assert.equal(ledger.db.prepare('SELECT statistics_eligible FROM normalized_listings LIMIT 1').get().statistics_eligible, 0);
  const updated = pipeline.recordItem({ ...daangnPublicationItems(record)[0],
    title: 'RTX 3060 12GB 정상 작동 제목변경' }, '2026-11-09T15:25:00.000Z', { reclassification: true });
  index.upsertPublicProjections([updated], { observedAt: '2026-11-09T15:25:00.000Z' });
  assert.equal(index.db.prepare('SELECT COUNT(*) n FROM listing_fts WHERE item_id=?').get(updated.item_id).n, 1);
  assert.equal(index.db.prepare("SELECT COUNT(*) n FROM listing_fts WHERE listing_fts MATCH '제목변경'").get().n, 1,
    'an existing identity replaces its old search text without duplicate FTS rows');
  const localOnly = pipeline.recordItem({ ...daangnPublicationItems(record)[0],
    description: '택배불가라 직거래만 가능합니다.' }, '2026-11-09T15:26:00.000Z', { reclassification: true });
  index.upsertPublicProjections([localOnly], { observedAt: '2026-11-09T15:26:00.000Z' });
  assert.equal(index.browsePcListings({ categoryCode: 'GPU', sites: ['daangn'], limit: 10 }).items.length, 0);
  assert.equal(index.db.prepare("SELECT COUNT(*) n FROM raw_listings WHERE source_id='daangn'").get().n > 0, true);
  index.now = () => Date.parse(observedAt) + 8 * 86400000;
  assert.equal(index.browsePcListings({ categoryCode: 'GPU', sites: ['daangn'], limit: 10 }).items.length, 0,
    'unobserved trial candidates cannot remain selling listings indefinitely');
  assert.throws(() => daangnPublicationItems({ ...record, items: [{ ...record.items[0], id: 'wrong' }] }), /INVALID_DAANGN_CANDIDATE/u);
  assert.throws(() => daangnPublicationItems({ ...record, items: [{ ...record.items[0], url: 'https://evil.test/kr/buy-sell/abc123/' }] }), /INVALID_DAANGN_CANDIDATE/u);
} finally { index.close(); await rm(root, { recursive: true, force: true }); }
console.log('daangn trial contract passed');
