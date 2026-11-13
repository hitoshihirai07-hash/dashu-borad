import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EMPTY_BASEBALL_DATA,normalizeBaseballData,parsePitchingInnings,displayPitchingInnings,baseballGameData2026Fixture,scoreMismatch} from '../src/baseball-data-model.js';
import {parseBaseballEntry,baseballEntryFields,createBaseballData} from '../src/baseball-data.js';
import {onRequest} from '../functions/api/baseball/data.js';
const id='2026-09-27~regular~ヤクルト~1';
const owner='owner@example.test',origin='https://toki.example',token='v2.'+'A'.repeat(43);
const sessionKey='__toki_session_v2__:'+createHash('sha256').update(token).digest('hex');
const cookie='toki_owner_session='+token;
function env(){
 const rows=new Map([[sessionKey,{revision:0,payload:JSON.stringify({email:owner,expires:Date.now()+3600000})}]]);
 for (const gameId of [id,'2026-09-28~regular~阪神~1']) rows.set('__baseball_game_v1__:'+owner+':'+gameId,{revision:1,payload:'{}'});
 const DB={prepare(sql){return {bind(...params){return {
  async first(){return rows.get(params[0])||null;},
  async run(){
   if(sql.startsWith('INSERT INTO')){
    if(rows.has(params[0]))return {meta:{changes:0}};
    rows.set(params[0],{revision:1,payload:params[1]});return {meta:{changes:1}};
   }
   if(sql.startsWith('UPDATE app_state')){
    const old=rows.get(params[2]);if(!old||old.revision!==params[3])return {meta:{changes:0}};
    rows.set(params[2],{revision:old.revision+1,payload:params[0]});return {meta:{changes:1}};
   }
   throw Error('unexpected sql');
  }
 };}};}};
 return {DB,OWNER_EMAIL:owner,LOGIN_PASSWORD:'test-only'};
}
const get=gameId=>new Request(origin+'/api/baseball/data?gameId='+encodeURIComponent(gameId),{headers:{Cookie:cookie}});
const post=payload=>new Request(origin+'/api/baseball/data',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(payload)});
test('2026年9月27日: 公式記録のスタメン9名・継投5名・イニング得点11対0が一致する',()=>{
 const fixture=baseballGameData2026Fixture();
 assert.equal(fixture.lineups.giants.length,9);assert.equal(fixture.lineups.opponent.length,9);
 assert.equal(fixture.pitchers.giants.length,5);assert.equal(fixture.pitchers.opponent.length,7);
 assert.equal(fixture.pitchers.giants[0].name,'小笠原 慎之介');
 assert.equal(fixture.pitchers.giants[0].outs,15);
 assert.equal(fixture.pitchers.opponent[0].outs,8);
 assert.deepEqual(fixture.innings.map(r=>r.giants),[0,3,5,0,2,1,0,0,null]);
 assert.equal(fixture.innings.reduce((n,r)=>n+(r.giants||0),0),11);
 assert.equal(fixture.innings.reduce((n,r)=>n+(r.opponent||0),0),0);
 assert.equal(scoreMismatch({giantsScore:11,opponentScore:0},fixture),false);
 assert.equal(scoreMismatch({giantsScore:10,opponentScore:0},fixture),true);
});
test('入力フォームから検証データを往復して一致',()=>{
 const f=baseballGameData2026Fixture();
 assert.deepEqual(parseBaseballEntry(baseballEntryFields(f)),f);
});
test('投球回の端数、成績の範囲、打順重複をチェック',()=>{
 assert.equal(parsePitchingInnings('0.2'),2);
 assert.equal(parsePitchingInnings('2.2'),8);
 assert.equal(displayPitchingInnings(8),'2.2');
 assert.throws(()=>parsePitchingInnings('3.3'),/投球回/);
 assert.throws(()=>normalizeBaseballData({...EMPTY_BASEBALL_DATA(),lineups:{giants:[{order:1,position:'中',name:'A'},{order:1,position:'左',name:'B'}],opponent:[]}}),/打順/);
 const bad=baseballEntryFields(EMPTY_BASEBALL_DATA());bad.giantsInnings='1 2 xyz';
 assert.throws(()=>parseBaseballEntry(bad),/得点/);
});
test('API: 未認証・未登録試合・CSRF拒否',async()=>{
 const state=env();
 assert.equal((await onRequest({request:new Request(origin+'/api/baseball/data'),env:state})).status,401);
 assert.equal((await onRequest({request:get('2026-10-03~regular~中日~1'),env:state})).status,404);
 const wrong=new Request(origin+'/api/baseball/data',{method:'POST',headers:{Cookie:cookie,Origin:'https://wrong.example','Content-Type':'application/json'},body:'{}'});
 assert.equal((await onRequest({request:wrong,env:state})).status,403);
});
test('API: 登録・読み戻し・更新・競合防止・別試合の分離',async()=>{
 const state=env(),fixture=baseballGameData2026Fixture();
 const empty=(await (await onRequest({request:get(id),env:state})).json());
 assert.equal(empty.revision,0);assert.equal(empty.data,null);
 const first=await onRequest({request:post({gameId:id,revision:0,data:fixture}),env:state});
 assert.equal(first.status,200);assert.equal((await first.json()).revision,1);
 const data=(await (await onRequest({request:get(id),env:state})).json());
 assert.equal(data.data.lineups.giants.length,9);
 assert.equal(data.data.pitchers.opponent.length,7);
 assert.equal((await onRequest({request:post({gameId:id,revision:0,data:fixture}),env:state})).status,409);
 assert.equal((await onRequest({request:post({gameId:id,revision:1,data:fixture}),env:state})).status,200);
 assert.equal((await (await onRequest({request:get(id),env:state})).json()).revision,2);
 assert.equal((await (await onRequest({request:get('2026-09-28~regular~阪神~1'),env:state})).json()).data,null);
});
test('画面: 記録の表示・編集・入力例',async()=>{
 const store=new Map(),storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let submits=0;
 const fetcher=async(url,init={})=>{
  if(init.method==='POST'){submits++;return {ok:true,json:async()=>({revision:1,data:JSON.parse(init.body).data})};}
  return {ok:true,json:async()=>({revision:0,data:null})};
 };
 const ui=createBaseballData({escapeHTML:escape,render(){},toast(){},fetcher,draftStorage:storage});
 ui.select(id,{date:'2026-09-27',opponent:'ヤクルト',gameType:'regular',giantsScore:11,opponentScore:0});
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.match(ui.page(),/検証用入力例を開く/);
 ui.click({dataset:{baseballStats:'fixture'}});
 assert.match(ui.page(),/スタメン/);assert.match(ui.page(),/松本 剛/);
 assert.equal(submits,0);
});
