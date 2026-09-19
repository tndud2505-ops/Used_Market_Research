// Operator-run browser acceptance. Synthetic API responses are loopback-only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { pcCatalogResponse } from '../cloudflare/pc-directory-http.mjs';

if (!process.argv.includes('--run')) throw new Error('Explicit --run is required. Read external-ai-orchestrator/SKILL.md first.');
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? '' : process.argv[i + 1] || ''; };
const root = fileURLToPath(new URL('../web-backend/public/', import.meta.url));
const out = path.resolve(arg('--out') || 'tmp/search-modal-v4');
const live = arg('--origin');
if (live) assert.ok(['https://used-pick.com','https://www.used-pick.com'].includes(live));
await fs.mkdir(out, { recursive:true });
const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' };
const server = live ? null : http.createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(root)) { res.writeHead(403); return res.end(); }
    const body = await fs.readFile(filename); res.writeHead(200, { 'content-type':types[path.extname(filename)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
if (server) await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = live || `http://127.0.0.1:${server.address().port}`;
const tag = live ? 'production' : 'fixture';
const report = { mode:live ? 'unmodified production API' : 'synthetic loopback API', origin, checks:[], layouts:[], pageErrors:[], screenshots:[] };
const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
let browser, context, page;
const id = 'cpu:intel:i7-10700';
const fixture = { mode:'normal', delayed:null };
const metric = (amount,n=5) => ({ sample_count:n,min:n?amount:null,max:n?amount:null,mean:n>=5?amount:null,median:n>=3?amount:null });
function stats(url) {
  const to = new Date().toISOString().slice(0,10), from = new Date(Date.parse(to)-29*86400000).toISOString().slice(0,10);
  const currency = url.searchParams.get('currency'), usd = currency === 'USD';
  const daily = amount => Array.from({length:30},(_,i) => ({ date:new Date(Date.parse(from)+i*86400000).toISOString().slice(0,10),
    active:metric(amount+i,fixture.mode==='empty'||i<26?0:5), sold:metric(amount-10+i,fixture.mode==='empty'||i<26?0:5) }));
  const value = usd?120:120000;
  const data = { canonical_product_id:decodeURIComponent(url.pathname.split('/')[3]), publication_id:'synthetic-preview',
    methodology:{currency,market_pool:usd?'OVERSEAS_USED':'KR_C2C_USED',condition:'USED_WORKING',days:30},
    window:{from,to,days:30},published_window:{from,to,days:30},
    active:metric(value),sold:metric(value-10),daily:daily(value),
    by_source:(usd?['ebay']:['joonggonara','bunjang']).map((source_id,i)=>({source_id,active:metric(value+i*1000),sold:metric(value-10+i*1000),daily:daily(value+i*1000)})) };
  if (fixture.mode==='wrong-model') data.canonical_product_id='cpu:wrong:model';
  if (fixture.mode==='wrong-currency') data.methodology.currency='JPY';
  if (fixture.mode==='wrong-window') data.published_window.to='2020-01-01';
  if (fixture.mode==='missing-source') data.by_source=[];
  return data;
}
const shot = async name => { const filename = path.join(out,`${tag}-${name}.png`); await page.screenshot({path:filename,fullPage:true}); report.screenshots.push(filename); };
try {
  browser = await chromium.launch({headless:true,...(browserPath?{executablePath:browserPath}:{})});
  context = await browser.newContext({viewport:{width:1440,height:1000},locale:'ko-KR'});
  const requests = [];
  if (!live) {
    const catalog = pcCatalogResponse();
    await context.route('**/api/**',async route => {
      const url = new URL(route.request().url());
      const send = (data,status=200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{status:'success',data}:data)});
      if (url.pathname==='/api/pc/catalog') return send(catalog);
      if (url.pathname==='/api/catalog/models') {
        const all = catalog.public_catalog.products.filter(p=>p.category_code===(url.searchParams.get('category_code')||'CPU'));
        return send({items:all,total:all.length});
      }
      if (url.pathname==='/api/pc/listings') {
        const source = url.searchParams.get('sites'), selected = ['ebay','joonggonara','bunjang'].includes(source) ? source : 'bunjang';
        const usd = selected==='ebay', second = url.searchParams.get('cursor')==='page2';
        return send({total:26,next_cursor:second?'':'page2',source_counts:{[selected]:26},items:Array.from({length:10},(_,i)=>({
          source_id:selected,source_listing_id:`qa-${second?10+i:i}`,canonical_product_id:url.searchParams.get('canonical_product_id')||id,
          canonical_display_name:'Intel Core i7-10700',category_code:'CPU',title:`Synthetic QA listing ${second?10+i:i}`,
          url:`https://example.test/listing/${i}`,price:usd?120+i:120000+i*1000,currency:usd?'USD':'KRW',market_pool:usd?'OVERSEAS_USED':'KR_C2C_USED',
          condition:'USED_WORKING',price_scope:'TOTAL',quantity:1,price_eligible:true,lifecycle_status:'ACTIVE',observed_at:new Date().toISOString(),
        }))});
      }
      if (url.pathname.endsWith('/price-stats')) {
        if (fixture.mode==='delayed') await new Promise(resolve=>{fixture.delayed=resolve;});
        if (fixture.mode==='error') return send({status:'error',error:{code:'EXACT_STATS_NOT_READY'}},503);
        return send(stats(url)).catch(()=>{});
      }
      return send({offers:[]});
    });
  }
  page = await context.newPage();
  page.on('pageerror',error=>report.pageErrors.push(error.message));
  page.on('request',request=>{if(request.url().includes('/api/')) requests.push(new URL(request.url()));});
  const ready = () => page.waitForFunction(()=>{
    const s=document.querySelector('#listing-section'),m=document.querySelector('#model-select');
    return m&&!m.hasAttribute('aria-busy')&&s&&!s.hasAttribute('aria-busy')&&(document.querySelector('#listing-rows')?.children.length||!document.querySelector('#listing-empty')?.hidden);
  },null,{timeout:45000});
  const readyChart = (states=['ready','empty','unavailable']) => page.waitForFunction(states=>{
    const chart=document.querySelector('#listing-price-chart'); return chart?.getAttribute('aria-busy')==='false'&&states.includes(chart.dataset.priceState);
  },states,{timeout:45000});
  const chooseSource = async source => { await page.locator(`#source-filters input[data-value="${source}"]`).check({force:true}); await ready(); };
  const close = async key => {
    if(key==='Escape') await page.keyboard.press('Escape');
    else if(key==='backdrop') await page.mouse.click(4,4);
    else await page.locator('#listing-price-close').click();
    await page.waitForFunction(()=>!document.querySelector('#listing-price-dialog').open&&!document.body.classList.contains('has-price-preview'));
    assert.equal(await page.evaluate(()=>document.activeElement.id),'model-detail-open');
  };
  const inspectLayout = async width => {
    await page.setViewportSize({width,height:1000});
    const boxes=await page.evaluate(()=>{
      const box=s=>{const b=document.querySelector(s).getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height,bottom:b.bottom};};
      return {width:innerWidth,scroll:document.documentElement.scrollWidth,model:box('#model-select'),source:box('#source-facet-row'),back:box('#back-to-models'),graph:box('#model-detail-open'),
        sites:[...document.querySelectorAll('.source-choice span')].map(n=>{const b=n.getBoundingClientRect();return{y:b.y,h:b.height};}),
        sorts:[...document.querySelectorAll('.listing-sort-tab')].map(n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n);return{y:b.y,h:b.height,line:s.lineHeight,padding:s.padding,border:s.borderWidth};})};
    });
    assert.ok(boxes.scroll<=width,`overflow at ${width}: ${boxes.scroll}`);
    if(width>=1181) assert.ok(Math.abs(boxes.source.bottom-boxes.model.bottom)<=4,'model selection and sites share one desktop row');
    else assert.ok(boxes.source.y>=boxes.model.bottom,'sites move below the model selector at constrained widths');
    assert.equal(new Set(boxes.sites.map(b=>b.y)).size,1,'sites stay in one row');
    assert.equal(boxes.back.h,40,'return button matches control height');
    if(width>=1181) assert.ok(Math.abs(boxes.back.y-boxes.graph.y)<=4,'return and price-graph controls share a baseline');
    assert.equal(new Set(boxes.sorts.map(b=>b.h)).size,1,'sort heights match');
    assert.equal(new Set(boxes.sorts.map(b=>b.y)).size,1,'sort vertical positions match');
    for(const k of ['line','padding','border']) assert.equal(new Set(boxes.sorts.map(b=>b[k])).size,1,`sort ${k} matches`);
    report.layouts.push(boxes);
  };
  await page.goto(origin+'/?category_code=CPU&price_min=100&price_max=9999999',{waitUntil:'domcontentloaded'}); await ready();
  assert.equal(await page.locator('#catalog-query,#up-catalog-search,#price-min,#price-max,#price-reset').count(),0);
  assert.equal(await page.locator('#model-detail-open:not([hidden])').count(),0);
  assert.equal(requests.filter(u=>u.pathname.endsWith('/price-stats')).length,0,'no price requests on initial search');
  assert.ok(requests.filter(u=>u.pathname==='/api/pc/listings').every(u=>!u.searchParams.has('price_min')&&!u.searchParams.has('price_max')));
  assert.equal(new URL(page.url()).searchParams.has('price_min'),false);
  assert.deepEqual(await page.locator('#source-filters input').evaluateAll(nodes=>nodes.map(n=>n.dataset.value)),['','joonggonara','bunjang','ebay']);
  report.checks.push('removed controls and legacy invisible price filters; exact site-toggle order; no eager price queries');
  await page.selectOption('#model-select',id); await ready();
  for(const sort of ['price_asc','price_desc','recent']){
    await page.locator(`.listing-sort-tab[data-sort="${sort}"]`).click(); await ready();
    assert.equal(await page.locator('.listing-sort-tab[aria-pressed="true"]').getAttribute('data-sort'),sort);
  }
  const before = {url:page.url(),rows:await page.locator('.listing-title').allTextContents(),sort:await page.locator('#listing-sort').inputValue(),pages:context.pages().length};
  await page.locator('#model-detail-open').click(); await readyChart();
  assert.equal(await page.locator('#listing-price-chart').getAttribute('data-model-id'),id);
  assert.match(await page.locator('#listing-price-scope').innerText(),/국내 전체 · KRW/);
  assert.equal(context.pages().length,before.pages);
  await shot('modal-desktop');
  await close('X');
  assert.deepEqual({url:page.url(),rows:await page.locator('.listing-title').allTextContents(),sort:await page.locator('#listing-sort').inputValue(),pages:context.pages().length},before);
  for(const key of ['Escape','backdrop']) { await page.locator('#model-detail-open').click(); await readyChart(); await close(key); }
  report.checks.push('small in-page graph; no tab or navigation; X/Escape/backdrop close and focus return; listings and sort unchanged');
  for(const source of ['joonggonara','bunjang','ebay','']){
    await chooseSource(source);
    await page.locator('#model-detail-open').click(); await readyChart();
    assert.equal(await page.locator('#listing-price-chart').getAttribute('data-source'),source);
    assert.match(await page.locator('#listing-price-scope').innerText(),source==='ebay'?/USD/:/KRW/);
    const requested=requests.filter(u=>u.pathname.endsWith('/price-stats')).at(-1);
    assert.equal(requested.searchParams.get('currency'),source==='ebay'?'USD':'KRW');
    await close('X');
  }
  report.checks.push('all site toggles and preview scope; eBay USD remains separate from domestic KRW');
  for(const width of [1440,1024,768,390,360]){
    await inspectLayout(width);
    if([1440,390].includes(width)) await shot(`search-${width}`);
    await page.locator('#model-detail-open').click(); await readyChart();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const dialogBox=await page.locator('#listing-price-dialog').boundingBox(); assert.ok(dialogBox.width<=width&&dialogBox.x>=0);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.querySelector('#listing-price-dialog').contains(document.activeElement)),true);
    if(width===390) await shot('modal-mobile');
    await close('Escape');
  }
  await page.locator('#up-filter-open').click();
  assert.equal(await page.locator('#up-filter-dialog').evaluate(n=>n.open),true); await page.keyboard.press('Escape');
  report.checks.push('1440/1024/768/390/360px layouts, matching sort heights/styles, one-row site buttons, focus trap, mobile filters');
  if(!live){
    for(const mode of ['error','wrong-model','wrong-currency','wrong-window','empty']){
      fixture.mode=mode; await page.locator('#model-detail-open').click(); await readyChart([mode==='empty'?'empty':'error']);
      assert.equal(await page.locator('#listing-price-chart svg').count(),0);
      assert.ok((await page.locator('#listing-price-status').innerText()).length>0);
      if(mode==='error'){fixture.mode='normal';await page.locator('#listing-price-retry').click();await readyChart(['ready']);}
      await close('X');
    }
    await chooseSource('joonggonara');fixture.mode='missing-source';
    await page.locator('#model-detail-open').click();await readyChart(['unavailable']);
    assert.equal(await page.locator('#listing-price-chart svg').count(),0);await close('X');
    fixture.mode='delayed';await page.locator('#model-detail-open').click();
    await page.waitForFunction(()=>document.querySelector('#listing-price-chart').dataset.priceState==='loading');
    await close('Escape'); fixture.mode='normal'; fixture.delayed?.();
    await page.locator('#model-detail-open').click();await readyChart(['ready']);await close('X');
    report.checks.push('loading/cancel/reopen; 503 retry; empty days; wrong model/currency/window; missing-source never falls back to aggregate');
  }
  assert.deepEqual(report.pageErrors,[]); report.status='passed';
} catch(error){report.status='failed';report.error=error.stack;if(page)await shot('failure').catch(()=>{});process.exitCode=1;}
finally {
  fixture.delayed?.();
  await context?.close(); await browser?.close(); if(server)await new Promise(resolve=>server.close(resolve));
  await fs.writeFile(path.join(out,`${tag}-report.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
