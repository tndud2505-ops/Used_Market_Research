import assert from 'node:assert/strict';
import {collectApprovedDomesticQueryOnce} from '../cloudflare/live-search.mjs';
import { releaseCollectionTargets, approvedRuntime, isCollectionAccessBlock, RELEASE_PRICE_CATEGORIES } from '../aws-runner/collect-pc-release-sample.mjs';
const targets = releaseCollectionTargets();
assert.equal(targets.length, 44);
assert.equal(new Set(targets.map(t=>t.targetId)).size, 44);
assert.equal(targets.filter(t=>t.verification_role==='GSKILL_KOREAN').length, 27);
assert.deepEqual([...new Set(targets.filter(t=>t.verification_role==='BROAD_MARKET_SAMPLE').map(t=>t.categoryCode))].sort(), [...RELEASE_PRICE_CATEGORIES].sort());
assert.throws(()=>releaseCollectionTargets(targets.filter(t=>t.categoryCode!=='HDD')), /NINE_CATEGORY/);
const runtime = { policy_status: 'APPROVED', runtime_status: 'ENABLED' };
assert.equal(approvedRuntime('bunjang',runtime),true);
for(const r of [{...runtime,policy_status:'DENIED'}, {...runtime,runtime_status:'QUARANTINED'},
  {...runtime,backoff_until:'2099-01-01T00:00:00Z'}, {...runtime,quarantine_until:'2099-01-01T00:00:00Z'}]) {
  assert.equal(approvedRuntime('bunjang',r),false);
}
assert.equal(approvedRuntime('daangn',runtime),false);
for(const text of ['HTTP_403','HTTP 429','CAPTCHA challenge','blocked','HTTP_401']) assert.equal(isCollectionAccessBlock(text),true);
assert.equal(isCollectionAccessBlock('INVALID_COLLECTION_RESPONSE'),false);
const originalFetch=globalThis.fetch;
try {
  for(const source of ['bunjang','joonggonara']) {
    for(const status of [403,429]) {
      let calls=0;
      globalThis.fetch=async()=>{calls++;return new Response('blocked',{status});};
      await assert.rejects(collectApprovedDomesticQueryOnce(source,'MSI DDR4 32GB'),new RegExp(`HTTP_${status}`));
      assert.equal(calls,1,'a block must not cause a retry or another query variant');
    }
  }
  let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({list:[]}),{status:200});};
  const first=await collectApprovedDomesticQueryOnce('bunjang','지스킬 DDR4 16GB');
  const second=await collectApprovedDomesticQueryOnce('bunjang','지스킬 DDR4 16GB');
  assert.equal(first.verified_request_count,1);assert.equal(second.verified_request_count,1);assert.equal(calls,2,'repeated verification must make fresh requests');
  globalThis.fetch=async()=>new Response('<title>Just a moment</title>');
  await assert.rejects(collectApprovedDomesticQueryOnce('joonggonara','지스킬 DDR4 16GB'),/CAPTCHA_OR_ACCESS_CHALLENGE/);
  globalThis.fetch=async()=>new Response('<html>unexpected response</html>');
  await assert.rejects(collectApprovedDomesticQueryOnce('joonggonara','지스킬 DDR4 16GB'),/UNVERIFIED_JOONGNA/);
} finally {globalThis.fetch=originalFetch;}
console.log(JSON.stringify({ status:'passed', contract:'pc-release-collection', gskill:27, categories:9, distinct_targets:44, real_requests_made:0 }));
