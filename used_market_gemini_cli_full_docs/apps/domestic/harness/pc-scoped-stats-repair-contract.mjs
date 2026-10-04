import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { calculateScopedReplacements, planScopedStatsRepair } from '../aws-runner/pc-stats-repair-plan.mjs';
import { statsChecksum } from '../cloudflare/public-product-stats.mjs';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';

const asOf='2026-10-03T18:00:00.000Z';
const versions={normalization:1,parser:'pc-parser-v1',rule:'pc-rules-v1',filter:'pc-filter-v1'};
const row=(id,price)=>({canonical_product_id:id,market_pool:'KR_C2C_USED',condition_code:'USED_WORKING',currency:'KRW',days:30,as_of:asOf,
  stats_json:{versions,as_of:asOf,active:{sample_count:5,mean:price,median:price},sold:{sample_count:0},daily:[],by_source:[]}});
const base={publication_id:'fixture-base',created_at:asOf,normalization_version:1,parser_version:versions.parser,
  rule_version:versions.rule,filter_version:versions.filter,expected_row_count:3,
  rows:[row('gpu:nvidia:rtx-3060',300000),row('gpu:nvidia:gtx-1080-ti',200000),row('ram:samsung:ddr4:16gb',100000)]};
base.checksum=await statsChecksum(base.rows);
const small=row('gpu:nvidia:rtx-3060',302999), material=row('gpu:nvidia:rtx-3060',303000);
assert.equal((await planScopedStatsRepair({base,replacements:[small]})).action,'DEFER');
const repaired=await planScopedStatsRepair({base,replacements:[material]});
assert.equal(repaired.recalculated_scope_count,1);
assert.equal(repaired.preserved_scope_count,2);
assert.equal(repaired.publication.created_at,asOf,'unchanged history is never relabeled as newly computed');
assert.deepEqual(repaired.publication.rows.slice(1),base.rows.slice(1),'other models retain exact original data');
assert.equal((await planScopedStatsRepair({base,replacements:[small],reason:'PRODUCT_IDENTITY'})).action,'SCOPED_REPAIR');
assert.equal((await planScopedStatsRepair({base,replacements:[row('gpu:nvidia:rtx-3060',303001)]})).action,'SCOPED_REPAIR');
const makerBase=structuredClone(base);
makerBase.rows[0].stats_json.by_manufacturer=[{manufacturer:'Fixture',active:{mean:300000}}];
makerBase.checksum=await statsChecksum(makerBase.rows);
const makerNext=structuredClone(makerBase.rows[0]); makerNext.stats_json.by_manufacturer[0].active.mean=304000;
assert.equal((await planScopedStatsRepair({base:makerBase,replacements:[makerNext]})).action,'SCOPED_REPAIR');
const availability=structuredClone(base.rows[0]); availability.stats_json.active.mean=null;
assert.equal((await planScopedStatsRepair({base,replacements:[availability]})).decisions[0].availability_changed,true);
await assert.rejects(()=>planScopedStatsRepair({base,replacements:[]}),/EXPLICIT/);
await assert.rejects(()=>planScopedStatsRepair({base,replacements:[material,material]}),/DUPLICATE/);
await assert.rejects(()=>planScopedStatsRepair({base,replacements:[row('gpu:unknown',303000)]}),/MISSING/);
await assert.rejects(()=>planScopedStatsRepair({base:{...base,checksum:'wrong'},replacements:[material]}),/CHECKSUM/);
await assert.rejects(()=>planScopedStatsRepair({base,replacements:[{...material,as_of:'2026-10-04T18:00:00.000Z'}]}),/COHORT/);
await assert.rejects(()=>planScopedStatsRepair({base,replacements:[{...material,stats_json:{...material.stats_json,as_of:'2026-10-04T18:00:00.000Z'}}]}),/COHORT/);
await assert.rejects(()=>planScopedStatsRepair({base,replacements:[{...material,stats_json:{...material.stats_json,versions:{...versions,normalization:2}}}]}),/COHORT/);
const db=new DatabaseSync(':memory:');
const ledger=new PcPartsLedger({db}); ledger.migrate();
const pipeline=new PcShadowPipeline({ledger}); await pipeline.initialize();
const scope=({canonical_product_id,market_pool,condition_code,currency,days})=>({canonical_product_id,market_pool,condition_code,currency,days});
const optionsFor=s=>({canonicalProductId:s.canonical_product_id,marketPool:s.market_pool,condition:s.condition_code,currency:s.currency,days:s.days,asOf,
  normalizationVersion:1,parserVersion:versions.parser,ruleVersion:versions.rule,filterVersion:versions.filter});
for(const [i,title] of ['RTX 3060 12GB 그래픽카드 정상','GTX 1080 Ti 11GB 그래픽카드 정상'].entries()) {
  pipeline.recordItem({site:'bunjang',source_listing_id:`scope-${i}`,title,price:300000-i*100000,currency:'KRW',status:'ACTIVE'},asOf);
  ledger.rebuildDailyPriceStats(optionsFor(scope(base.rows[i])));
}
const tables=['daily_price_stats','daily_price_stat_members','daily_source_price_stats','daily_source_price_stat_members','daily_price_stat_windows','normalized_listings','listing_snapshots'];
const snapshot=()=>JSON.stringify(tables.map(t=>db.prepare(`SELECT * FROM ${t}`).all()));
const before=snapshot(), visited=[];
const eligible=ledger.eligibleRows.bind(ledger);
ledger.eligibleRows=options=>{visited.push(options.canonicalProductId);return eligible(options);};
const candidate=calculateScopedReplacements(ledger,[scope(base.rows[0])],optionsFor);
assert.equal(candidate.length,1);
assert.ok(visited.length>0 && visited.every(id=>id===base.rows[0].canonical_product_id),'never calculate unrelated models');
assert.equal(snapshot(),before,'preview restores all stored aggregates, members, windows and raw evidence');
const rebuild=ledger.rebuildAndGetPriceStats;
ledger.rebuildAndGetPriceStats=function(options){rebuild.call(this,options);throw Error('fixture failure');};
assert.throws(()=>calculateScopedReplacements(ledger,[scope(base.rows[0])],optionsFor),/fixture failure/);
assert.equal(snapshot(),before,'failed preview also restores all tables');
db.close();
console.log(JSON.stringify({status:'passed',contract:'pc-scoped-stats-repair',threshold_krw:3000,untouched_models_preserved:true,preview_rollback_verified:true}));
