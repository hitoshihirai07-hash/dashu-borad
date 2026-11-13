import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {onRequest} from '../functions/api/baseball/notes.js';
import {createBaseballNotes} from '../src/baseball-notes.js';

const origin='https://toki.example',owner='owner@example.test',token='v2.'+'A'.repeat(43);
const sessionKey='__toki_session_v2__:'+createHash('sha256').update(token).digest('hex');
const gameId='2026-09-27~regular~ヤクルト~1',otherGame='2026-09-28~regular~阪神~1';
const uuid='a1234567-aaaa-4bbb-8ccc-123456789abc',cookie='toki_owner_session='+token;
const post=payload=>new Request(origin+'/api/baseball/notes',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(payload)});
const get=game=>new Request(origin+'/api/baseball/notes?gameId='+encodeURIComponent(game),{headers:{Cookie:cookie}});
function env(){
 const rows=new Map([[sessionKey,{owner:sessionKey,revision:0,payload:JSON.stringify({email:owner,expires:Date.now()+3600000})}]]);
 for(const id of [gameId,otherGame])rows.set('__baseball_game_v1__:'+owner+':'+id,{revision:1,payload:'{}'});
 const DB={prepare(sql){return {bind(...p){return {
   async first(){return rows.get(p[0])||null;},
   async all(){return {results:[...rows.entries()].filter(([key])=>key.startsWith(p[1])).map(([key,item])=>({owner:key,...item})).slice(0,501)};},
   async run(){
     if(sql.startsWith('INSERT INTO')){
       if(rows.has(p[0]))return {meta:{changes:0}};
       rows.set(p[0],{revision:1,payload:p[1]});return {meta:{changes:1}};
     }
     if(sql.startsWith('UPDATE app_state')){
       const item=rows.get(p[2]);
       if(!item||item.revision!==p[3])return {meta:{changes:0}};
       rows.set(p[2],{revision:item.revision+1,payload:p[0]});return {meta:{changes:1}};
     }
     throw Error(sql);
   }
 };}};}};
 return {DB,OWNER_EMAIL:owner,LOGIN_PASSWORD:'test-only-password'};
}
test('観戦メモ: 認証、別サイト、未登録試合を拒否',async()=>{
 const state=env();
 assert.equal((await onRequest({request:new Request(origin+'/api/baseball/notes'),env:state})).status,401);
 assert.equal((await onRequest({request:get('2026-10-01~regular~中日~1'),env:state})).status,404);
 assert.equal((await onRequest({request:new Request(origin+'/api/baseball/notes',{method:'POST',headers:{Cookie:cookie,Origin:'https://wrong.example','Content-Type':'application/json'},body:'{}'}),env:state})).status,403);
});
test('観戦メモ: 作成、再読込、重複再送、編集、競合、削除、試合ごとの分離',async()=>{
 const state=env(),note={body:'７回の継投に注目',phase:'during',inning:'7回表'};
 const payload={action:'create',gameId,id:uuid,note};
 const first=await onRequest({request:post(payload),env:state});
 assert.equal(first.status,201);assert.equal((await first.json()).item.revision,1);
 const retry=await onRequest({request:post(payload),env:state});
 assert.equal(retry.status,200);assert.equal((await retry.json()).reused,true);
 const notes=(await (await onRequest({request:get(gameId),env:state})).json()).items;
 assert.equal(notes.length,1);assert.match(notes[0].createdAt,/^\d{4}-/);
 assert.equal((await (await onRequest({request:get(otherGame),env:state})).json()).items.length,0);
 const edited=await onRequest({request:post({action:'update',gameId,id:uuid,revision:1,note:{body:'代打起用に期待',phase:'after',inning:''}}),env:state});
 assert.equal(edited.status,200);assert.equal((await edited.json()).item.revision,2);
 assert.equal((await onRequest({request:post({action:'update',gameId,id:uuid,revision:1,note}),env:state})).status,409);
 assert.equal((await onRequest({request:post({action:'delete',gameId,id:uuid,revision:2}),env:state})).status,200);
 assert.equal((await (await onRequest({request:get(gameId),env:state})).json()).items.length,0);
 assert.equal((await onRequest({request:post(payload),env:state})).status,409);
});
test('観戦メモ: 下書きとHTMLエスケープ、Ctrl+Enter',async()=>{
 const drafts=new Map();
 const storage={getItem:k=>drafts.get(k)||null,setItem:(k,v)=>drafts.set(k,v),removeItem:k=>drafts.delete(k)};
 const esc=x=>String(x).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const fetcher=async()=>({ok:true,json:async()=>({items:[]})});
 const ui=createBaseballNotes({escapeHTML:esc,render(){},toast(){},fetcher,draftStorage:storage});
 ui.select(gameId);
 await new Promise(resolve=>setTimeout(resolve,0));
 ui.input({id:'baseball-note-body',value:'<script>alert(1)</script>'});
 assert.match(ui.page(),/&lt;script&gt;/);
 const second=createBaseballNotes({escapeHTML:esc,render(){},toast(){},fetcher,draftStorage:storage});
 second.select(gameId);
 assert.match(second.page(),/&lt;script&gt;/);
 let submits=0,prevented=false;
 assert.equal(ui.keydown({target:{id:'baseball-note-body',closest:()=>({requestSubmit(){submits++;}})},key:'Enter',ctrlKey:true,isComposing:false,preventDefault(){prevented=true;}}),true);
 assert.equal(submits,1);assert.equal(prevented,true);
});
