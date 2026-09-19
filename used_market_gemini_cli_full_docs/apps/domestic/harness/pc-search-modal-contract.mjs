// Deterministic preview behavior: no browser, network, credentials or live data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as core from '../web-backend/public/pc-tools-core.mjs';

const source = readFileSync(new URL('../web-backend/public/listing-price-preview.mjs',import.meta.url),'utf8');
const product = { canonical_product_id:'cpu:test:preview',canonical_display_name:'Synthetic CPU' };
const metric = value => ({sample_count:5,min:value,max:value,mean:value,median:value});
const priceData = () => ({window:{from:'2026-08-21',to:'2026-09-19'},active:metric(100),sold:metric(90),
  daily:[{date:'2026-09-19',active:metric(100),sold:metric(90)}],
  by_source:[{source_id:'joonggonara',active:metric(120),sold:metric(110),daily:[{date:'2026-09-19',active:metric(120),sold:metric(110)}]}]});
function setup() {
  const bodyClasses = new Set(), frames = new Map(), stores = [], draws = [];
  let frameId = 0;
  const document = {body:{classList:{add:n=>bodyClasses.add(n),remove:n=>bodyClasses.delete(n)}},activeElement:null};
  const node = () => ({listeners:new Map(),dataset:{},attributes:{},children:[],hidden:false,isConnected:true,textContent:'',
    addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);},
    dispatch(type,event={}){for(const fn of this.listeners.get(type)||[])fn({target:this,...event});},
    setAttribute(key,value){this.attributes[key]=String(value);}, replaceChildren(...items){this.children=items;},
    focus(){document.activeElement=this;},
  });
  const nodes = new Map(['chart','status','retry','model','scope','close'].map(id=>[id,node()]));
  const dialog = Object.assign(node(),{open:false,
    querySelector(selector){return nodes.get(selector.replace('#listing-price-',''));},
    showModal(){this.open=true;nodes.get('close').focus();},
    close(){this.open=false;this.dispatch('close');},
    getBoundingClientRect(){return{left:100,right:740,top:100,bottom:600};},
  });
  const opener = node();
  const context = vm.createContext({...core,document,
    requestAnimationFrame(fn){const id=++frameId;frames.set(id,fn);return id;},
    cancelAnimationFrame(id){frames.delete(id);},
    ResizeObserver:class{observe(){}},
    drawChart(chart,series,options){draws.push({series,options});chart.replaceChildren(...(series.some(s=>s.points.some(p=>p.value!=null))?['svg']:[]));},
    createPriceStore(notify,options={}){
      const store={record:null,loads:[],clears:0,options,
        get(){return this.record;},
        load(products,days){this.loads.push({products,days});this.record={state:'loading'};notify();return Promise.resolve();},
        clear(){this.record=null;this.clears++;},
        respond(record){this.record=record;notify();},
      };stores.push(store);return store;
    },
  });
  vm.runInContext(source.replace(/^import .*;\r?$/gm,'').replace('export function createListingPricePreview','function createListingPricePreview'),context);
  const preview = context.createListingPricePreview(dialog,opener);
  const flush = () => { for(const [id,fn] of [...frames]){frames.delete(id);fn();} };
  return{preview,dialog,opener,nodes,stores,draws,flush,document,bodyClasses,frames};
}
test('preview imports the existing verified price store/chart and has no navigation',()=>{
  assert.match(source,/createPriceStore/);assert.match(source,/sourceStats/);assert.match(source,/dailySeries/);
  assert.doesNotMatch(source,/window\.open|location\.|iframe|price-analysis\.html/);
  const css=readFileSync(new URL('../web-backend/public/search-controls.css',import.meta.url),'utf8');
  assert.match(css,/\.price-preview-chart \.tools-chart-plot\s*\{[^}]*min-width:0/,
    'the modal must override the shared chart minimum width on mobile');
});
test('no eager requests; opening loads just the chosen model and shows loading honestly',()=>{
  const t=setup();assert.equal(t.stores.flatMap(s=>s.loads).length,0);
  t.preview.open(product);t.flush();
  assert.equal(t.dialog.open,true);assert.equal(t.stores[0].loads.length,1);assert.equal(t.stores[1].loads.length,0);
  assert.equal(t.stores[0].loads[0].products[0].canonical_product_id,product.canonical_product_id);
  assert.equal(t.nodes.get('chart').dataset.priceState,'loading');assert.equal(t.nodes.get('chart').attributes['aria-busy'],'true');
  assert.equal(t.nodes.get('chart').children.length,0);assert.match(t.nodes.get('status').textContent,/확인 중/);
  t.preview.open(product);assert.equal(t.stores[0].loads.length,1,'double open cannot duplicate requests');
});
test('source-specific daily values, currency and compact chart are retained',()=>{
  const t=setup();t.preview.open(product,'joonggonara');t.stores[0].respond({state:'ready',data:priceData()});t.flush();
  assert.equal(t.nodes.get('chart').dataset.priceState,'ready');assert.equal(t.nodes.get('status').hidden,true);
  assert.match(t.nodes.get('scope').textContent,/중고나라 · KRW · 2026-08-21 ~ 2026-09-19/);
  const draw=t.draws.at(-1);assert.equal(draw.options.compact,true);
  assert.equal(draw.series[0].points.find(p=>p.date==='2026-09-19').value,120,'source cannot use aggregate 100');
  assert.ok(draw.series[0].points.some(p=>p.value==null),'missing dates remain gaps');
});
test('X closes, cancels both stores, clears stale chart and restores focus',()=>{
  const t=setup();t.preview.open(product);t.nodes.get('close').dispatch('click');
  assert.equal(t.dialog.open,false);assert.equal(t.document.activeElement,t.opener);assert.equal(t.bodyClasses.size,0);
  assert.deepEqual(t.stores.map(s=>s.clears),[1,1]);assert.equal(t.frames.size,0);
  t.stores[0].respond({state:'ready',data:priceData()});t.flush();assert.equal(t.nodes.get('chart').children.length,0);
});
test('reopening on eBay uses a separate USD store, never old KRW observations',()=>{
  const t=setup();t.preview.open(product);t.stores[0].respond({state:'ready',data:priceData()});t.flush();t.dialog.close();
  t.preview.open(product,'ebay');t.flush();
  assert.equal(t.stores[1].options.currency,'USD');assert.equal(t.stores[1].options.marketPool,'OVERSEAS_USED');
  assert.equal(t.stores[1].loads.length,1);assert.equal(t.nodes.get('chart').dataset.priceState,'loading');
  assert.equal(t.nodes.get('chart').children.length,0);assert.match(t.nodes.get('scope').textContent,/eBay · USD/);
});
test('error and retry are explicit and failed data cannot produce a chart',()=>{
  const t=setup();t.preview.open(product);t.stores[0].respond({state:'error',error:'자료 요청 실패 (503)'});t.flush();
  assert.equal(t.nodes.get('chart').dataset.priceState,'error');assert.equal(t.nodes.get('retry').hidden,false);
  assert.equal(t.nodes.get('chart').children.length,0);assert.match(t.nodes.get('status').textContent,/503/);
  t.nodes.get('retry').dispatch('click');t.flush();assert.equal(t.stores[0].loads.length,2);
  t.stores[0].respond({state:'ready',data:priceData()});t.flush();assert.equal(t.nodes.get('chart').dataset.priceState,'ready');
});
test('missing source or publication never falls back to aggregate or zero price',()=>{
  for(const data of [priceData(),{...priceData(),availability:{status:'UNAVAILABLE'}}]){
    const t=setup();t.preview.open(product,'bunjang');t.stores[0].respond({state:'ready',data});t.flush();
    assert.equal(t.nodes.get('chart').dataset.priceState,'unavailable');assert.equal(t.nodes.get('chart').children.length,0);
    assert.ok(t.nodes.get('status').textContent.length>0);assert.doesNotMatch(t.nodes.get('status').textContent,/0원/);
  }
});
test('an empty daily window displays an honest message, not a flat zero line',()=>{
  const t=setup();t.preview.open(product);t.stores[0].respond({state:'ready',data:{...priceData(),daily:[]}});t.flush();
  assert.equal(t.nodes.get('chart').dataset.priceState,'empty');assert.equal(t.nodes.get('chart').children.length,0);
  assert.match(t.nodes.get('status').textContent,/일별 대표가격 자료가 없습니다/);
});
test('backdrop click closes, but inside clicks and dragging out do not',()=>{
  const t=setup();t.preview.open(product);
  t.dialog.dispatch('pointerdown',{clientX:200,clientY:200});t.dialog.dispatch('click',{clientX:200,clientY:200});assert.equal(t.dialog.open,true);
  t.dialog.dispatch('pointerdown',{clientX:200,clientY:200});t.dialog.dispatch('click',{clientX:4,clientY:4});assert.equal(t.dialog.open,true);
  t.dialog.dispatch('pointerdown',{clientX:4,clientY:4});t.dialog.dispatch('click',{clientX:4,clientY:4});assert.equal(t.dialog.open,false);
});
