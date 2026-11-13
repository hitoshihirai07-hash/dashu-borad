import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {onRequest,BASEBALL_NOTION_TARGETS,baseballNotionProperties,baseballNotionBody,matchingNotionPage,propertyChanges} from '../functions/api/baseball/notion-import.js';
import {baseballTestGame2026,normalizeBaseballGame} from '../src/baseball-model.js';
import {baseballGameData2026Fixture} from '../src/baseball-data-model.js';
import {createBaseball} from '../src/baseball.js';

const owner='owner@example.test',token='v2.'+'A'.repeat(43);
const sessionKey='__toki_session_v2__:'+createHash('sha256').update(token).digest('hex');
const id='2026-09-27~regular~ヤクルト~1',origin='https://toki.example';
const pageId='3e8ee5b7-9890-80ab-b2af-c7ba10c1fb62';
const game=baseballTestGame2026();
const data=baseballGameData2026Fixture();
const rich=text=>[{type:'text',plain_text:text,text:{content:text}}];
const fromProps=(p)=>Object.fromEntries(Object.entries(p).map(([k,v])=>[k,JSON.parse(JSON.stringify(v))]));
const page={
 id:pageId,url:'https://www.notion.so/'+pageId,archived:false,
 parent:{type:'data_source_id',data_source_id:BASEBALL_NOTION_TARGETS[2026].id},
 properties:{
  '名前':{type:'title',title:rich('9/27　巨人対ヤクルト')},
  '試合日':{type:'date',date:{start:'2026-09-27'}},
  '対戦相手':{type:'select',select:{name:'ヤクルト'}},
  '巨人先発投手':{type:'select',select:{name:'小笠原'}},
  '球場':{type:'select',select:{name:'東京ドーム'}},
  '相手先発投手':{type:'rich_text',rich_text:rich('髙橋')},
  '結果':{type:'select',select:{name:'勝ち'}},
  '参考URL':{type:'url',url:'https://npb.jp/scores/2026/0927/g-s-24/'},
  'ステータス':{type:'status',status:{name:'完了'}}
 }
};
const post=()=>new Request(origin+'/api/baseball/notion-import',{
 method:'POST',headers:{Cookie:'toki_owner_session='+token,Origin:origin,'Content-Type':'application/json'},
 body:JSON.stringify({gameId:id})
});
const db=()=>{
 const rows=new Map([
  [sessionKey,{revision:0,payload:JSON.stringify({email:owner,expires:Date.now()+3600000})}],
  ['__baseball_game_v1__:'+owner+':'+id,{revision:1,payload:JSON.stringify({game})}],
  ['__baseball_data_v1__:'+owner+':'+id,{revision:1,payload:JSON.stringify(data)}]
 ]);
 const DB={prepare(sql){return {bind(...args){return {
  async first(){return rows.get(args[0])||null;},
  async all(){return {results:[]};},
  async run(){
   if(sql.startsWith('INSERT INTO')){
    if(rows.has(args[0]))return {meta:{changes:0}};
    rows.set(args[0],{revision:1,payload:args[1]});return {meta:{changes:1}};
   }
   if(sql.startsWith('UPDATE app_state')){
    const old=rows.get(args[2]);
    if(!old||old.revision!==args[3])return {meta:{changes:0}};
    rows.set(args[2],{revision:old.revision+1,payload:args[0]});return {meta:{changes:1}};
   }
   throw Error('unexpected SQL: '+sql);
  }
 };}};}};
 return {rows,DB};
};
test('2026と2027の正式データソースだけを使用する',()=>{
 assert.equal(BASEBALL_NOTION_TARGETS[2026].id,'3e4ee5b7-9890-80d7-83e3-000baaba8f46');
 assert.equal(BASEBALL_NOTION_TARGETS[2027].id,'492ee5b7-9890-8384-b184-0773a2a579bc');
 const props=baseballNotionProperties(game,game.sourceUrl);
 assert.equal(props['試合日'].date.start,'2026-09-27');
 assert.ok(props['巨人先発投手']);
 const g27=normalizeBaseballGame({...game,date:'2027-03-26',opponent:'中日',giantsScore:0,opponentScore:1});
 const future=baseballNotionProperties(g27,'');
 assert.equal(future['巨人点数'].number,0);
 assert.equal(future['相手点数 '].number,1);
 assert.equal(future['対戦相手'].select.name,'中日');
});
test('既存ページの試合日・対戦相手照合と手入力の保護',()=>{
 assert.equal(matchingNotionPage(page,game),true);
 assert.equal(matchingNotionPage(page,normalizeBaseballGame({...game,opponent:'阪神'})),false);
 const prop=baseballNotionProperties(game,game.sourceUrl);
 const diff=propertyChanges(page,prop,null,true);
 assert.equal(diff.patch['名前'],undefined);
 assert.equal(diff.patch['相手先発投手'],undefined);
 assert.ok(diff.warnings.some(w=>w.includes('相手先発投手')));
 const again=propertyChanges(page,prop,diff.protectedFields?{'相手先発投手':'髙橋'}:null,false,diff.protectedFields);
 assert.deepEqual(again.patch,{});
 const localChange={...game,opponentStarter:'変更後の相手先発'};
 const renamed=baseballNotionProperties(localChange,game.sourceUrl);
 const changed=propertyChanges(page,renamed,{'相手先発投手':'髙橋'},false,diff.protectedFields);
 assert.equal(changed.patch['相手先発投手'].rich_text[0].text.content,'変更後の相手先発');

});
test('Notionに追加される内容は打撃・投手・観戦メモを含む',()=>{
 const text=baseballNotionBody(game,data,[{id:'a',body:'７回の継投判断に注目',phase:'during',inning:'7回表',createdAt:'2026-09-27T09:25:00.000Z'}]);
 assert.match(text,/松本 剛/);
 assert.match(text,/皆川 岳飛/);
 assert.match(text,/平内 龍太/);
 assert.match(text,/７回の継投判断に注目/);
});
test('自動同期は一切せず、ログイン・POST・同一サイトだけ許可',async()=>{
 const state=db(),env={DB:state.DB,OWNER_EMAIL:owner,LOGIN_PASSWORD:'password',NOTION_TOKEN:'test-token'};
 const get=await onRequest({request:new Request(origin+'/api/baseball/notion-import',{headers:{Cookie:'toki_owner_session='+token}}),env});
 assert.equal(get.status,405);
 const noLogin=await onRequest({request:new Request(origin+'/api/baseball/notion-import',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'}),env});
 assert.equal(noLogin.status,401);
 const other=await onRequest({request:new Request(origin+'/api/baseball/notion-import',{method:'POST',headers:{Cookie:'toki_owner_session='+token,Origin:'https://elsewhere.invalid','Content-Type':'application/json'},body:'{}'}),env});
 assert.equal(other.status,403);
});
test('既存2026ページを再利用、再実行は変更なし、本文だけ更新、手編集時は409',async()=>{
 const state=db(),writes=[],notionPage=structuredClone(page),blockList=new Map([[pageId,[]]]);
 let nextBlock=1;
 const makeBlock=(type,rich,hasChildren=false)=>({id:'block-'+nextBlock++,type,[type]:{rich_text:rich},has_children:hasChildren});
 const response=(value)=>({ok:true,status:200,headers:{get:()=>null},json:async()=>value});
 const prev=globalThis.fetch;
 globalThis.fetch=async(url,init={})=>{
  const path=new URL(url).pathname.replace(/^\/v1\//,'');
  const method=init.method||'GET';
  const payload=init.body?JSON.parse(init.body):null;
  if(method==='POST'&&path.includes('/query'))return response({results:[notionPage],has_more:false});
  if(method==='GET'&&path==='pages/'+pageId)return response(notionPage);
  if(method==='GET'&&path.startsWith('blocks/')&&path.includes('/children')){
   const parent=path.split('/')[1];return response({results:blockList.get(parent)||[],has_more:false});
  }
  if(method==='PATCH'&&path==='blocks/'+pageId+'/children'){
   writes.push('append');
   const entry=payload.children[0];
   const toggle=makeBlock('toggle',entry.toggle.rich_text,true);
   const child=makeBlock('paragraph',entry.toggle.children[0].paragraph.rich_text);
   blockList.set(pageId,[...(blockList.get(pageId)||[]),toggle]);
   blockList.set(toggle.id,[child]);
   return response({results:[toggle]});
  }
  if(method==='PATCH'&&path.startsWith('blocks/')){
   writes.push('body');
   const entryId=path.split('/')[1];
   for(const list of blockList.values()){
    const block=list.find(b=>b.id===entryId);
    if(block){block.paragraph.rich_text=payload.paragraph.rich_text;return response(block);}
   }
  }
  if(method==='PATCH'&&path==='pages/'+pageId){
   writes.push('props');
   Object.assign(notionPage.properties,fromProps(payload.properties));
   return response(notionPage);
  }
  throw Error('unexpected Notion request '+method+' '+path);
 };
 const env={DB:state.DB,OWNER_EMAIL:owner,LOGIN_PASSWORD:'password',NOTION_TOKEN:'test-token'};
 try{
  const first=await onRequest({request:post(),env});
  assert.equal(first.status,200,JSON.stringify(await first.clone().json()));
  assert.equal((await first.json()).status,'updated');
  assert.equal(writes.filter(v=>v==='append').length,1);
  assert.ok(!writes.includes('props')); // Preserve existing handwritten props.
  const before=writes.length;
  const second=await onRequest({request:post(),env});
  assert.equal(second.status,200,JSON.stringify(await second.clone().json()));
  assert.equal((await second.json()).status,'unchanged');
  assert.equal(writes.length,before);
  state.rows.set('__baseball_data_v1__:'+owner+':'+id,{revision:2,payload:JSON.stringify({...data,decisions:{win:'変更後の勝利投手',loss:'高橋 奎二',save:''}})});
  const changed=await onRequest({request:post(),env});
  assert.equal(changed.status,200,JSON.stringify(await changed.clone().json()));
  assert.equal((await changed.json()).status,'updated');
  assert.equal(writes.filter(v=>v==='body').length,1);
  const toggler=blockList.get(pageId)[0],para=blockList.get(toggler.id)[0];
  para.paragraph.rich_text=[{type:'text',text:{content:'Notion側の手編集'},plain_text:'Notion側の手編集'}];
  const conflict=await onRequest({request:post(),env});
  assert.equal(conflict.status,409);
 }finally{globalThis.fetch=prev;}
});
test('表示画面に手動インポートボタンがありボタン押下までPOSTしない',async()=>{
 const requests=[],ui=createBaseball({escapeHTML:String,render(){},toast(){},fetcher:async(path,opts)=>{
  requests.push({path,method:opts?.method||'GET'});
  if(path==='/api/baseball/games')return {ok:true,json:async()=>({items:[{id,game,revision:1}]})};
  if(path.includes('/notes?'))return {ok:true,json:async()=>({items:[]})};
  if(path.includes('/data?'))return {ok:true,json:async()=>({revision:1,data})};
  if(path==='/api/baseball/notion-import')return {ok:true,json:async()=>({status:'updated',pageUrl:'https://www.notion.so/test',warnings:[]})};
  return {ok:true,json:async()=>({})};
 }});
 await ui.load();
 assert.match(ui.page(),/Notionへインポート/);
 assert.equal(requests.filter(x=>x.path.includes('/notion-import')).length,0);
 ui.click({dataset:{baseball:'notion-import'}});
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(requests.filter(x=>x.path.includes('/notion-import')&&x.method==='POST').length,1);
});
