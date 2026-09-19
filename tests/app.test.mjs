// Application-handler tests in a minimal DOM harness. These do not validate browser layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const script=readFileSync(new URL('../src/model.js',import.meta.url),'utf8').replace(/^export /gm,'')+'\n'+readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*?;\n/,'');
const legacy={format:'toki-records',version:1,records:[{id:'legacy',rev:'r1',parents:[],date:'2026-09-18',activity:'旧記録',minutes:30,note:'旧メモ',deleted:false,updatedAt:'2026-09-18T00:00:00Z'}]};
function harness(initial, defaults){
  const storage=new Map(initial?[['toki-records-v1',JSON.stringify(initial)]]:[]),elements=new Map(),docEvents={},winEvents={},downloads=[];
  const el=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',hidden:false,dataset:{},events:{},addEventListener(k,fn){this.events[k]=fn;},showModal(){this.open=true;},close(){this.open=false;},querySelectorAll(){return [];},focus(){},reset(){for(const e of Object.values(this.elements))e.value='';},append(){},remove(){},click(){},setAttribute(){},removeAttribute(){}});return elements.get(id);};
  el('#record-form').elements=Object.fromEntries(['field','project','customProject','date','activity','minutes','note'].map(n=>[n,el(n)]));
  const document={querySelector:el,querySelectorAll:()=>[],documentElement:{outerHTML:'<html>portable shell</html>'},addEventListener:(k,fn)=>docEvents[k]=fn,body:{append(){}},head:{append(){}},createElement:()=>({click(){},remove(){}})};
  const sandbox={document,window:{innerWidth:1365,addEventListener:(k,fn)=>winEvents[k]=fn,scrollTo(){}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},location:{hash:'#dashboard',protocol:'file:'},navigator:{},crypto:webcrypto,Blob,URL:{createObjectURL:b=>{downloads.push(b);return 'blob:test';},revokeObjectURL(){}},setTimeout:()=>1,clearTimeout(){},console};
  if(defaults)storage.set('toki-input-defaults-v2',JSON.stringify(defaults));
  vm.runInNewContext(script,sandbox);
  return {el,storage,downloads,html:()=>el('#main').innerHTML,read:()=>JSON.parse(storage.get('toki-records-v1')),click:async dataset=>docEvents.click({target:{closest:()=>({dataset})}}),change:(id,value)=>docEvents.change({target:{id,value}}),add:async values=>{await docEvents.click({target:{closest:()=>({dataset:{action:'add'}})}});for(const [k,v]of Object.entries(values))el('#record-form').elements[k].value=v;el('#record-form').events.submit({preventDefault(){},currentTarget:el('#record-form')});assert.equal(el('#form-error').textContent,'');},import:async data=>{await el('#import-file').events.change({target:{files:[{size:100,text:async()=>JSON.stringify(data)}]}});assert.equal(el('#merge-dialog').open,true);el('#merge-apply').events.click();},event:docEvents};
}
const values={date:'2026-09-18',field:'プロ野球',project:'スプレッドシート・自動化',activity:'実践',minutes:'90',note:'CSVの並び替え'};
test('form saves fields; defaults and classification-only edits persist',async()=>{const h=harness();await h.add(values);assert.equal(h.read().records[0].project,'スプレッドシート・自動化');assert.equal(h.read().records[0].field,'プロ野球');await h.click({action:'add'});assert.equal(h.el('#record-form').elements.field.value,'プロ野球');assert.equal(h.el('#record-form').elements.project.value,'スプレッドシート・自動化');await h.click({edit:h.read().records[0].id});h.el('#record-form').elements.project.value='運営管理';h.el('#record-form').events.submit({preventDefault(){},currentTarget:h.el('#record-form')});assert.equal(h.read().records[0].project,'運営管理');assert.equal(h.read().records[0].parents.length,1);});
test('field/period switches render matching totals, records and project/activity breakdowns',async()=>{const h=harness();await h.add(values);await h.add({...values,field:'その他',project:'PlayerLens',activity:'機能更新',minutes:'60'});await h.add({...values,field:'その他',project:'未分類',minutes:'30'});assert.match(h.html(),/合計の時間[\s\S]*?<strong>3<\/strong>/);await h.click({field:'プロ野球'});assert.match(h.html(),/合計の時間[\s\S]*?<strong>1.5<\/strong>/);await h.click({breakdown:'activity'});assert.match(h.html(),/活動の内訳/);assert(!h.html().includes('PlayerLens'));await h.click({breakdown:'project'});assert.match(h.html(),/スプレッドシート・自動化/);for(const mode of ['day','month','week']){await h.click({mode});assert.match(h.html(),/合計の時間[\s\S]*?<strong>1.5<\/strong>/);}});
test('JSON and CSV exports include all fields and records regardless of active tab',async()=>{const h=harness();await h.add(values);await h.add({...values,field:'プロ野球',project:'SNS',note:'a,"b"\n改行'});await h.click({field:'プロ野球'});await h.click({action:'export'});const json=JSON.parse(await h.downloads.at(-1).text());assert.equal(json.version,2);assert.equal(json.records.length,2);await h.click({action:'csv'});const csv=await h.downloads.at(-1).text();assert.match(csv,/"分野","プロジェクト"/);assert.match(csv,/"プロ野球","スプレッドシート・自動化"/);assert.match(csv,/"プロ野球","SNS"/);assert.match(csv,/"a,""b""\n改行"/);});
test('legacy local storage loads without rewriting identity and imports are idempotent',async()=>{const h=harness(legacy);assert.match(h.html(),/その他 · 未分類/);assert.equal(h.read().version,1);await h.import(legacy);assert.equal(h.read().version,2);assert.equal(h.read().records[0].rev,'r1');assert.equal(h.read().records[0].project,'未分類');await h.import(legacy);assert.equal(h.read().records.length,1);});
test('delete, stale JSON import and restore preserve classified record',async()=>{const h=harness();await h.add(values);const backup=h.read(),id=backup.records[0].id;await h.click({delete:id});h.el('#delete-apply').events.click();assert.equal(h.read().records[0].deleted,true);await h.import(backup);assert.equal(h.read().records[0].deleted,true);await h.click({restore:id});assert.equal(h.read().records[0].deleted,false);assert.equal(h.read().records[0].project,'スプレッドシート・自動化');});
test('invalid imports and stale-tab writes do not overwrite stored data',async()=>{const h=harness();await h.add(values);const before=h.storage.get('toki-records-v1');await h.el('#import-file').events.change({target:{files:[{size:10,text:async()=>'broken'}]}});assert.equal(h.storage.get('toki-records-v1'),before);await h.click({edit:h.read().records[0].id});const remote=h.read();remote.records[0].note='別のタブ';h.storage.set('toki-records-v1',JSON.stringify(remote));h.el('#record-form').elements.note.value='古い画面';h.el('#record-form').events.submit({preventDefault(){},currentTarget:h.el('#record-form')});assert.equal(h.read().records[0].note,'別のタブ');assert.match(h.el('#form-error').textContent,/別のタブ/);});

const oldPython={format:'toki-records',version:2,records:[{...legacy.records[0],field:'Python',project:'CSV処理'}]};
const options=element=>[...element.innerHTML.matchAll(/<option value="([^"]*)">/g)].map(m=>m[1]);
const projectCount=h=>Number(h.html().match(/プロジェクト数[\s\S]*?<strong>(\d+)<\/strong>/)?.[1]);
test('new entry excludes Python even after loading defaults or editing an old Python record',async()=>{
  const h=harness(oldPython,{field:'Python',projects:{Python:'CSV処理'}});
  assert(!h.html().includes('data-field="Python"'));
  await h.click({action:'add'});
  assert.deepEqual(options(h.el('field')),['プロ野球','その他']);
  assert.equal(h.el('field').value,'プロ野球');
  assert.deepEqual(options(h.el('project')),['プロ野球観戦メモ','PlayerLens','SNS','ベンチからの一手','スプレッドシート・自動化','データ分析','運営管理','その他','__custom__']);
  await h.click({edit:'legacy'});
  assert.equal(h.el('field').value,'Python');
  h.el('note').value='過去記録を編集';
  h.el('#record-form').events.submit({preventDefault(){},currentTarget:h.el('#record-form')});
  assert.equal(h.read().records[0].field,'Python');
  assert.equal(h.read().records[0].project,'CSV処理');
  await h.click({action:'add'});
  assert(!options(h.el('field')).includes('Python'));
  assert.equal(h.el('field').value,'プロ野球');
});
test('historical Python and old project records survive import, export, edit, delete and device merge',async()=>{
  const h=harness();await h.import(oldPython);
  await h.add({...values,project:'データ整理・分析'});
  assert.match(h.html(),/Python · CSV処理/);
  assert.match(h.html(),/データ整理・分析/);
  await h.click({action:'export'});
  const backup=JSON.parse(await h.downloads.at(-1).text());
  const other=harness();await other.import(backup);await other.import(backup);
  assert.equal(other.read().records.length,2);
  await other.click({action:'csv'});
  const csv=await other.downloads.at(-1).text();
  assert.match(csv,/"Python","CSV処理"/);assert.match(csv,/"プロ野球","データ整理・分析"/);
  await other.click({delete:'legacy'});other.el('#delete-apply').events.click();
  await h.import(other.read());await h.import(backup);
  assert.equal(h.read().records.find(r=>r.id==='legacy').deleted,true);
  assert.equal(h.read().records.find(r=>r.project==='データ整理・分析').project,'データ整理・分析');
});
test('project summary counts unique projects and follows day/week/month, shifts and field filters',async()=>{
  const h=harness();
  for(const [date,project] of [['2026-09-18','プロ野球観戦メモ'],['2026-09-18','SNS'],['2026-09-18','SNS'],['2026-09-18','PlayerLens'],['2026-09-18','スプレッドシート・自動化'],['2026-09-19','データ分析'],['2026-09-01','運営管理'],['2026-08-01','その他']])await h.add({...values,date,project});
  h.change('anchor-date','2026-09-18');
  for(const [mode,want] of [['day',4],['week',5],['month',6]]){await h.click({mode});assert.equal(projectCount(h),want);}
  await h.click({shift:'-1'});assert.equal(projectCount(h),1);
  await h.click({shift:'-1'});assert.equal(projectCount(h),0);
  h.change('anchor-date','2026-09-18');await h.import(oldPython);
  assert.equal(projectCount(h),7);
  await h.click({field:'プロ野球'});assert.equal(projectCount(h),6);
});
