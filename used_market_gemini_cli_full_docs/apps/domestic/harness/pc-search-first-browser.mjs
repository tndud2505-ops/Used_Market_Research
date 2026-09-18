// Operator-only Playwright acceptance. Production is never mocked. Synthetic
// failure/edge cases are permitted only at a loopback candidate origin.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pcCatalogResponse } from '../cloudflare/pc-directory-http.mjs';

const ids = [
  ['CPU','cpu:intel:i7-10700'], ['GPU','gpu:nvidia:rtx-3060-ti'], ['RAM','ram:g-skill:ddr4:16gb'],
  ['MOTHERBOARD','motherboard:msi:pro-b650m-p'], ['SSD','ssd:samsung:capacity-bucket:513-gb-1-tb'],
  ['HDD','hdd:western-digital:capacity-bucket:gt-2-tb-le-4-tb'], ['PSU','psu:seasonic:watts-bucket:751-850'],
  ['CASE','case:facet:mid-tower:fractal-design'], ['COOLING','cooling:facet:air-cpu:noctua'],
];
const currencyMoney=(n,currency='KRW')=>currency==='KRW'?`${Math.round(n).toLocaleString('ko-KR')}원`:new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
function independentRepresentative(metric) {
  if (!metric || metric.aggregate_incomplete === true) return null;
  const n=metric.sample_count;
  if (!Number.isInteger(n) || n<3) return null;
  const value=n<5?metric.median:metric.mean??metric.median??metric.average;
  assert.ok(typeof value==='number'&&Number.isFinite(value)&&value>0,'published representative must be numeric');
  if(metric.min!=null)assert.ok(value>=metric.min);
  if(metric.max!=null)assert.ok(value<=metric.max);
  return value;
}
function metric(value,count=5) { return {sample_count:count,min:count?value:null,max:count?value:null,mean:count>=5?value:null,median:count>=3?value:null}; }
function fixtureStats(id,url,mode) {
  const to=url.searchParams.get('as_of')||new Date().toISOString().slice(0,10), days=Number(url.searchParams.get('days')||30);
  const from=new Date(Date.parse(to)-(days-1)*86400000).toISOString().slice(0,10);
  const currency=url.searchParams.get('currency')||'KRW',overseas=currency==='USD';
  const low=id===ids[1][1]&&mode==='partial', amount=overseas?120.5:120000.5, sold=overseas?110.5:115000.5;
  const active=metric(amount,low?2:10), soldMetric=metric(sold,low?0:10);
  const daily=Array.from({length:days},(_,i)=>({date:new Date(Date.parse(from)+i*86400000).toISOString().slice(0,10),active:i<days-3?metric(0,0):metric(amount+i),sold:i<days-3?metric(0,0):metric(sold+i)}));
  const sources=overseas?['ebay']:['bunjang','joonggonara'];
  return {canonical_product_id:id,publication_id:mode==='mixed-publication'&&id===ids[1][1]?'synthetic-other-publication':'synthetic-search-first-publication',window:{from,to,days},published_window:{from,to,days},as_of:`${to}T05:00:00Z`,
    methodology:{currency:mode==='wrong-currency'?'USD':currency,market_pool:overseas?'OVERSEAS_USED':'KR_C2C_USED',condition:'USED_WORKING',days},
    active,sold:soldMetric,confirmed_transactions:metric(0,0),daily,
    by_source:sources.map((source_id,i)=>({source_id,active:metric(overseas?amount:amount+(i?-10000:10000),low?1:5),sold:metric(overseas?sold:sold+(i?-10000:10000),low?0:5),daily}))};
}
export async function runBrowserChecks({browser,origin,out,fixture=false}) {
  const u=new URL(origin);
  assert.ok(['https://used-pick.com','https://www.used-pick.com'].includes(u.origin)||u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname));
  if(fixture)assert.ok(u.hostname==='127.0.0.1'||u.hostname==='localhost','no production mocks');
  await fs.mkdir(out,{recursive:true});
  const tag=fixture?'fixture':u.protocol==='http:'?'candidate-live':u.hostname.replaceAll('.','-');
  const report={mode:fixture?'synthetic browser fixtures':'real browser and public API',origin,started_at:new Date().toISOString(),checks:[],screenshots:[],page_errors:[],console_errors:[],network_errors:[],static_errors:[],layouts:[]};
  const fixtureState={query:'',priceMode:'normal'}, pending=[],records=new Map();
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ko-KR'});
  let page;
  const catalog=pcCatalogResponse(),products=catalog.tools_catalog.products;
  const addCheck=name=>report.checks.push(name);
  const attach=target=>{
    target.on('pageerror',e=>report.page_errors.push(e.message));
    target.on('console',message=>{if(message.type()==='error')report.console_errors.push({text:message.text().slice(0,700),location:message.location()});});
    target.on('response',response=>{
      if(response.url().startsWith(origin+'/api/')&&response.status()>=400)report.network_errors.push({url:response.url(),status:response.status()});
      if(response.url().startsWith(origin+'/')&&!response.url().startsWith(origin+'/api/')&&response.status()>=400)report.static_errors.push({url:response.url(),status:response.status()});
      if(response.url().startsWith(origin+'/api/products/')&&response.url().includes('/price-stats')) {
        const work=response.json().then(json=>{const d=json.data??json;if(d.canonical_product_id)records.set(d.canonical_product_id+'|'+d.methodology?.currency,d);}).catch(()=>{});pending.push(work);
      }
    });
  };
  if(fixture) {
    await context.route('**/api/**',async route=>{
      const url=new URL(route.request().url());
      const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{status:'success',data}:data)});
      if(url.pathname==='/api/pc/catalog')return send(catalog);
      if(url.pathname==='/api/catalog/models') {
        fixtureState.query=url.searchParams.get('q')||'';
        const q=fixtureState.query,code=url.searchParams.get('category_code')||'CPU';
        const all=catalog.public_catalog.products.filter(p=>p.category_code===code);
        const chosen=products.find(p=>p.canonical_product_id===ids[0][1]);
        const list=q==='sf-no-model'?[]:q.startsWith('sf-one-model')||q==='sf-zero-listings'||q==='sf-one-listing'?[chosen]
          :q.startsWith('sf-')?[chosen,all.find(p=>p.canonical_product_id!==chosen.canonical_product_id)]:all;
        return send({items:list,total:list.length});
      }
      if(url.pathname==='/api/pc/listings') {
        const q=fixtureState.query,total=q==='sf-zero-listings'?0:q.includes('one-listing')?1:q.startsWith('sf-')?3:26;
        const start=url.searchParams.get('cursor')==='sf-page-2'?10:0;
        const selected=url.searchParams.get('sites'), source=['ebay','bunjang','joonggonara'].includes(selected)?selected:null;
        const overseas=source==='ebay';
        const items=Array.from({length:Math.min(10,Math.max(0,total-start))},(_,i)=>({
          source_id:source||(i%2?'joonggonara':'bunjang'),source_listing_id:`synthetic-${start+i}`,canonical_product_id:url.searchParams.get('canonical_product_id')||ids[0][1],
          canonical_display_name:'Synthetic CPU',category_code:'CPU',title:`Synthetic QA listing ${start+i+1}`,url:`https://example.test/qa/${start+i}`,
          price:overseas?120+i:120000+i*1000,currency:overseas?'USD':'KRW',market_pool:overseas?'OVERSEAS_USED':'KR_C2C_USED',condition:'USED_WORKING',price_scope:'TOTAL',quantity:1,price_eligible:true,lifecycle_status:'ACTIVE',observed_at:new Date().toISOString(),
        }));
        return send({items,total,source_counts:source?{[source]:total}:{bunjang:Math.ceil(total/2),joonggonara:Math.floor(total/2)},next_cursor:total>10&&start===0?'sf-page-2':''});
      }
      if(/\/price-stats$/.test(url.pathname)) {
        if(fixtureState.priceMode==='error')return send({status:'error',error:{code:'EXACT_STATS_NOT_READY'}},503);
        const id=decodeURIComponent(url.pathname.split('/')[3]);
        const data=fixtureStats(id,url,fixtureState.priceMode);
        if(fixtureState.priceMode==='wrong-window')data.published_window.to='2026-01-01';
        return send(data);
      }
      if(url.pathname.startsWith('/api/affiliate'))return send({offers:[]});
      return send({});
    });
  }
  const screenshot=async(name,target=page)=>{const filename=path.join(out,`${tag}-${name}.png`);await target.screenshot({path:filename,fullPage:true});report.screenshots.push(filename);};
  const readySearch=async()=>{
    await page.waitForFunction(()=>{
      const rows=document.querySelector('#listing-rows'),empty=document.querySelector('#listing-empty'),section=document.querySelector('#listing-section'),model=document.querySelector('#model-select');
      return model&&!model.hasAttribute('aria-busy')&&section&&!section.hasAttribute('aria-busy')&&(rows?.children.length>0||empty&&!empty.hidden);
    },null,{timeout:45000});
    assert.equal(await page.locator('#listing-message.is-error:not([hidden])').count(),0);
  };
  const readyChart=async(target=page,allowed=['ready'])=>{
    await target.waitForFunction(states=>{const n=document.querySelector('#price-chart');return n?.getAttribute('aria-busy')==='false'&&states.includes(n.dataset.priceState);},allowed,{timeout:45000});
    const value=await target.locator('#price-chart').getAttribute('data-price-state');assert.ok(allowed.includes(value),`${value}: ${await target.locator('#chart-coverage').textContent()}`);
  };
  const layout=async(name,target=page)=>{
    await target.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const value=await target.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
      boxes:Object.fromEntries(['.sf-search-tools','.workspace-heading','.up-search-row','.model-filters','.listing-section','.sf-analysis-chart','.sf-source-comparison','#build-table','#build-summary'].map(s=>{const e=document.querySelector(s),b=e?.getBoundingClientRect();return[s,b?{x:b.x,y:b.y,w:b.width,h:b.height,display:getComputedStyle(e).display}:null]}))}));
    assert.ok(value.scroll<=value.width,`${name}: page overflow ${value.scroll}/${value.width}`);
    if(value.width>=1181&&value.boxes['.sf-search-tools']){
      assert.ok(value.boxes['.sf-search-tools'].h<130,'controls must be a compact unified row');
      assert.ok(Math.abs(value.boxes['.workspace-heading'].y-value.boxes['.up-search-row'].y)<8,'model/site/search controls must align');
      assert.ok(value.boxes['.listing-section'].w>value.width*.65,'selected listings must use all available right-column width');
    }
    if(value.boxes['#build-table']) {
      const rows=await target.locator('#build-table tbody tr').evaluateAll(rows=>rows.map(row=>({height:row.getBoundingClientRect().height,inputs:[...row.querySelectorAll('input')].map(input=>{
        const b=input.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
        return {width:b.width,height:b.height,inViewport:b.y>=0&&b.bottom<=innerHeight,unobscured:hit===input};
      })})));
      if(value.width>=1181)for(const row of rows)assert.ok(row.height<=88,`${name}: a compact part row is ${row.height}px`);
      for(const row of rows)for(const input of row.inputs){assert.ok(input.width>=32&&input.height>=32);if(input.inViewport)assert.equal(input.unobscured,true,`${name}: quantity must not be covered by actions`);}
    }
    report.layouts.push({name,...value});
  };
  try {
    page=await context.newPage();attach(page);
    await page.goto(origin+'/?category_code=CPU',{waitUntil:'domcontentloaded'});await readySearch();
    assert.equal(await page.locator('#model-detail-dialog,#price-summary,#stats-section').count(),0);
    assert.equal(await page.locator('#model-detail-open:not([hidden])').count(),0);
    await layout('search-multiple');
    const page2=page.locator('#listing-page-numbers [data-page="2"]');
    if(await page2.count()) { await page2.click();await readySearch();assert.equal(await page.locator('#listing-page-numbers [aria-current="page"]').textContent(),'2');await page.locator('#listing-page-prev').click();await readySearch();addCheck('listing pagination 1 → 2 → 1'); }
    if(fixture) {
      for(const [q,rows,graph] of [['sf-one-model',3,1],['sf-zero-listings',0,1],['sf-one-listing',1,1],['sf-one-listing-many-models',1,0],['sf-no-model',0,0]]) {
        await page.fill('#catalog-query',q);
        await page.waitForTimeout(350);await readySearch();
        assert.equal(await page.locator('#listing-rows .listing-row').count(),rows,q);
        assert.equal(await page.locator('#model-detail-open:not([hidden])').count(),graph,q);
        assert.equal(await page.evaluate(()=>document.activeElement.id),'catalog-query','automatic model selection cannot steal typing focus');
      }
      addCheck('multiple models, one model with multiple/zero/one listings, one listing with multiple models, and zero models');
      await page.fill('#catalog-query','sf-one-model');await page.waitForTimeout(350);await readySearch();
    } else { await page.selectOption('#model-select',ids[0][1]);await readySearch(); }
    await page.locator('.listing-sort-tab[data-sort="price_asc"]').click();await readySearch();
    await page.fill('#price-min','1');await page.fill('#price-max','9999999');
    await page.locator('#listing-controls button[type="submit"]').click();await readySearch();
    assert.equal(await page.locator('#model-detail-open:not([hidden])').count(),1);
    await layout('search-single');await screenshot('search-desktop');
    const before={url:page.url(),rows:await page.locator('#listing-rows .listing-title').allTextContents(),min:await page.locator('#price-min').inputValue(),sort:await page.locator('#listing-sort').inputValue()};
    const opened=context.waitForEvent('page');await page.locator('#model-detail-open').click();const popup=await opened;attach(popup);await popup.waitForLoadState('domcontentloaded');await readyChart(popup);
    assert.equal(new URL(popup.url()).searchParams.get('model'),ids[0][1]);
    assert.equal(await popup.evaluate(()=>window.opener===null),true);
    assert.deepEqual({url:page.url(),rows:await page.locator('#listing-rows .listing-title').allTextContents(),min:await page.locator('#price-min').inputValue(),sort:await page.locator('#listing-sort').inputValue()},before);
    assert.equal(new URL(await popup.locator('#analysis-listing-link').getAttribute('href'),origin).searchParams.get('price_min'),'1');
    await screenshot('analysis-popup',popup);await popup.close();addCheck('one safe new-tab graph link; original URL, listings, sorting and bounds unchanged');
    await page.locator('.listing-favorite').first().click();assert.equal(await page.locator('.listing-favorite').first().getAttribute('aria-pressed'),'true');
    await page.locator('.listing-favorite').first().click();addCheck('browser-local favorite toggle and original listing links');
    assert.equal(await page.locator('.listing-title').first().getAttribute('target'),'_blank');
    await page.locator('#source-filters input[data-value="joonggonara"]').focus();
    await page.keyboard.press('Space');await readySearch();
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.value),'joonggonara');
    assert.ok((await page.locator('#listing-rows .listing-source').allTextContents()).every(v=>v==='중고나라'));
    await page.keyboard.press('ArrowLeft');await readySearch();
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.value),'ebay');
    assert.ok((await page.locator('#listing-rows .listing-source').allTextContents()).every(v=>/eBay/.test(v)));
    assert.doesNotMatch((await page.locator('#listing-rows .listing-price').allTextContents()).join(' '),/원|₩/);
    await page.keyboard.press('ArrowLeft');await readySearch();
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.value),'');
    addCheck('keyboard site radios retain focus after reload; eBay listings stay USD-only');
    for(const width of [1440,1024,768,390,360]) {
      await page.setViewportSize({width,height:1000});await layout(`search-${width}`);
      if(width===390){await screenshot('search-mobile');await page.locator('#up-filter-open').click();assert.equal(await page.locator('#up-filter-dialog').evaluate(n=>n.open),true);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'up-filter-open');}
    }
    addCheck('search desktop/tablet/390px/360px and native mobile filter dialog');
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(origin+'/price-analysis.html?model='+encodeURIComponent(ids[0][1]));await readyChart();
    assert.equal(await page.locator('#analysis-source-comparison thead th').count(),7);
    assert.equal(await page.locator('#tools-summary,.up-analysis-aside').count(),0);
    await Promise.all(pending);
    const observed=records.get(ids[0][1]+'|KRW');assert.ok(observed?.publication_id,'publication identity is present');
    assert.equal(observed.window.from,observed.published_window.from);assert.equal(observed.window.to,observed.published_window.to);
    for(const source of observed.by_source||[]) {
      const sourceId=source.source_id||source.site||source.source;
      const row=page.locator(`#analysis-source-comparison tr[data-source="${sourceId}"]`);assert.equal(await row.count(),1);
      for(const key of ['active','sold']) {
        const n=source[key]?.sample_count,expected=independentRepresentative(source[key]);
        if(Number.isInteger(n))assert.equal(await row.locator(`.source-sample[data-series="${key}"]`).textContent(),n.toLocaleString('ko-KR'));
        if(expected!=null)assert.equal(await row.locator(`.source-price[data-series="${key}"] strong`).textContent(),currencyMoney(expected));
      }
    }
    await layout('analysis-desktop');await screenshot('analysis-desktop');
    await page.locator('[data-action="chart-source"][data-source="ebay"]').click();await readyChart();
    assert.ok((await page.locator('#analysis-source-comparison').innerText()).includes('USD'));
    assert.doesNotMatch((await page.locator('#analysis-source-comparison .source-price').allTextContents()).join(' '),/\d원/);
    await page.reload();await readyChart();assert.equal(await page.locator('[data-source="ebay"][aria-pressed="true"]').count(),1);
    await page.locator('[data-action="chart-source"][data-source=""]').click();await readyChart();
    for(const width of [1440,1024,768,390,360]){await page.setViewportSize({width,height:1000});await layout(`analysis-${width}`);if(width===390)await screenshot('analysis-mobile');}
    const originalRange={from:await page.locator('#chart-from').inputValue(),to:await page.locator('#chart-to').inputValue()},beforeRangeUrl=page.url();
    await page.fill('#chart-from',originalRange.to);await page.fill('#chart-to',originalRange.from);
    await page.locator('#chart-navigation [data-action="range-apply"]').click();
    assert.match(await page.locator('#tools-status').textContent(),/종료일/);assert.equal(page.url(),beforeRangeUrl);
    await page.fill('#chart-to',originalRange.to);
    if(fixture) {
      const oneDay=page.waitForResponse(r=>r.url().includes('/price-stats?')&&new URL(r.url()).searchParams.get('days')==='1');
      await page.locator('#chart-navigation [data-action="range-apply"]').click();await oneDay;await readyChart();
      assert.equal(new URL(page.url()).searchParams.get('from'),originalRange.to);
      await page.fill('#chart-from',originalRange.from);
      await page.locator('#chart-navigation [data-action="range-apply"]').click();await readyChart();
    } else await page.fill('#chart-from',originalRange.from);
    addCheck('invalid reversed dates do not change the price scope' + (fixture?'; valid one-day request uses its exact window':''));
    await page.locator('#analysis-model-select').click();await page.locator('#analysis-model-dialog').waitFor({state:'visible'});
    await page.fill('#tool-query','no-model-exists-sf-test');await page.waitForFunction(()=>document.querySelector('#price-chart')?.dataset.priceState==='empty');
    assert.equal(await page.locator('#price-chart svg').count(),0);await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('#analysis-model-dialog').open && document.activeElement.id==='analysis-model-select');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'analysis-model-select');
    addCheck('source table agrees with captured API; site/currency reload; accessible model picker; empty selection clears prior chart');
    if(fixture) {
      for(const mode of ['error','wrong-currency','wrong-window']) {
        fixtureState.priceMode=mode;
        await page.goto(origin+'/price-analysis.html?model='+encodeURIComponent(ids[0][1]));await readyChart(page,['error']);
        assert.equal(await page.locator('#price-chart svg').count(),0);
        assert.doesNotMatch(await page.locator('#analysis-source-comparison').innerText(),/120,001원|0원/);
      }
      fixtureState.priceMode='normal';await page.locator('#chart-coverage [data-action="retry"]').click();await readyChart();
      addCheck('503 retry, wrong currency and mismatched publication window cannot display prices');
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(origin+'/computer-builder.html');await page.waitForSelector('#build-table tbody tr');
    assert.equal(await page.locator('#build-table tbody tr').count(),9);
    assert.equal(await page.locator('#build-table tfoot #tools-summary').count(),1);
    assert.equal(await page.locator('#build-table thead th').count(),6);
    for(const [code,id] of ids) {
      const product=products.find(p=>p.canonical_product_id===id);assert.ok(product,id);
      await page.locator(`#build-table tr[data-category="${code}"] button[data-action="category"]`).click();
      await page.locator('#builder-model-dialog').waitFor({state:'visible'});
      await page.locator('#builder-model-dialog [data-action="reset-filters"]').click();
      await page.fill('#tool-query',product.canonical_display_name);
      await page.locator(`#model-table [data-action="choose"][data-id="${id}"]`).click();
      if(code==='RAM')await page.locator(`[data-action="quantity-step"][data-id="${id}"][data-quantity-step="1"]`).click();
    }
    await page.waitForFunction(()=>[...document.querySelectorAll('#build-table [data-build-price]')].every(n=>n.dataset.priceState!=='loading'),null,{timeout:45000});await Promise.all(pending);
    const expected={active:{sum:0,covered:0},sold:{sum:0,covered:0}};
    for(const [code,id] of ids) {
      const data=records.get(id+'|KRW');assert.ok(data?.publication_id,`${id}: exact publication received`);
      assert.equal(data.methodology.currency,'KRW');assert.equal(data.window.to,data.published_window.to);
      for(const key of ['active','sold']) {const unit=independentRepresentative(data[key]);if(unit!=null){expected[key].sum+=unit*(code==='RAM'?2:1);expected[key].covered+=code==='RAM'?2:1;}}
    }
    assert.equal(new Set(ids.map(([,id])=>records.get(id+'|KRW').publication_id)).size,1,'one publication across quote');
    for(const key of ['active','sold']) {
      const value=await page.locator(`#tools-summary .series-${key}`).textContent();
      assert.equal(value,expected[key].covered?currencyMoney(expected[key].sum):'—');
    }
    report.quote={units:10,expected};
    const quantity=page.locator(`[data-quantity="${ids[2][1]}"]`);
    if(fixture) {
      fixtureState.priceMode='partial';await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#build-table [data-build-price]').length===18&&[...document.querySelectorAll('#build-table [data-build-price]')].every(n=>n.dataset.priceState!=='loading'));
      assert.match(await page.locator('#tools-summary').textContent(),/부분 합계/);
      for(const key of ['active','sold']) {
        assert.match(await page.locator(`#tools-summary .series-${key}`).locator('..').textContent(),/가격 확인 9\/10개/);
        assert.equal(await page.locator(`#tools-summary .series-${key}`).textContent(),currencyMoney(9*(key==='active'?120000.5:115000.5)));
      }
      fixtureState.priceMode='mixed-publication';await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#build-table [data-build-price]').length===18&&[...document.querySelectorAll('#build-table [data-build-price]')].every(n=>n.dataset.priceState==='scope-conflict'));
      for(const key of ['active','sold'])assert.equal(await page.locator(`#tools-summary .series-${key}`).textContent(),'—');
      assert.match(await page.locator('#tools-summary').textContent(),/서로 다른 게시 기준/);
      fixtureState.priceMode='normal';await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#build-table [data-build-price]').length===18&&[...document.querySelectorAll('#build-table [data-build-price]')].every(n=>n.dataset.priceState==='ready'));
      addCheck('low-sample components stay out of partial totals; mixed publications cannot form a quote');
      await page.evaluate(()=>{window.__sfPrintEvents=0;window.addEventListener('beforeprint',()=>{window.__sfPrintEvents++;});});
      await page.locator('[data-action="print-build"]').click();
      await page.waitForFunction(()=>window.__sfPrintEvents>0);
      addCheck('the real print button invokes the browser print lifecycle');
    }
    for(const invalid of ['0','-1','1.5','','17']){await quantity.fill(invalid);await quantity.press('Tab');assert.equal(await quantity.inputValue(),'2');}
    await page.locator('[data-action="save-build"]').click();assert.match(await page.locator('#build-save-status').textContent(),/저장되었습니다/);
    const share=page.url();await page.reload();await page.waitForSelector('[data-quantity]');assert.equal(await quantity.inputValue(),'2');
    assert.equal(JSON.parse(new URLSearchParams(new URL(share).hash.slice(1)).get('build')).length,9);
    await page.waitForFunction(()=>[...document.querySelectorAll('#build-table [data-build-price]')].every(n=>n.dataset.priceState!=='loading'));
    await screenshot('builder-desktop');
    for(const width of [1440,1024,768,390,360]){await page.setViewportSize({width,height:1000});await layout(`builder-${width}`);if(width===390)await screenshot('builder-mobile');}
    await page.emulateMedia({media:'print'});
    assert.equal(await page.locator('#build-table tbody tr').count(),9);
    assert.equal(await page.locator('#build-table thead').evaluate(n=>getComputedStyle(n).display),'table-header-group');
    await screenshot('builder-print-media');await page.emulateMedia({media:'screen'});
    await page.locator(`[data-action="remove"][data-id="${ids[2][1]}"]`).click();await page.reload();await page.waitForSelector('#build-table tbody tr');assert.equal(await quantity.count(),0);
    addCheck('nine component choices, exact API unit×quantity totals, invalid quantities, save/reload/hash, removal and print-media layout');
    if(fixture) {
      await page.goto(origin+'/computer-builder.html');await page.waitForSelector('#build-table tbody tr');
      await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Synthetic test quota','QuotaExceededError');};});
      await page.locator('[data-action="save-build"]').click();assert.match(await page.locator('#build-save-status').textContent(),/저장을 사용할 수 없습니다/);
      assert.doesNotMatch(await page.locator('#build-save-status').textContent(),/저장되었습니다/);
      addCheck('controlled storage denial is reported honestly and address backup is retained');
    }
    assert.deepEqual(report.page_errors,[],'no runtime page errors');
    assert.deepEqual(report.static_errors,[],'no first-party asset failures');
    const unexpected=report.network_errors.filter(e=>!fixture||!e.url.includes('/price-stats'));
    assert.deepEqual(unexpected,[],'no unexpected first-party API errors');
    report.status='passed';
  }catch(error){report.status='failed';report.error=error.stack;if(page)await screenshot('failure').catch(()=>{});}
  finally{await context.close();report.finished_at=new Date().toISOString();await fs.writeFile(path.join(out,`${tag}-report.json`),JSON.stringify(report,null,2));}
  return {status:report.status,mode:report.mode,checks:report.checks,error:report.error,page_errors:report.page_errors,console_errors:report.console_errors.length,static_errors:report.static_errors,network_errors:report.network_errors,report:path.join(out,`${tag}-report.json`)};
}
