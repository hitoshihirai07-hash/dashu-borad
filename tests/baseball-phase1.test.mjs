import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeBaseballGame,baseballTestGame2026,validBaseballDate} from '../src/baseball-model.js';
import {createBaseball} from '../src/baseball.js';
import {onRequest} from '../functions/api/baseball/games.js';

const origin='https://toki.example';
const owner='owner@example.test';
const token='v2.'+'A'.repeat(43);
const sessionKey='__toki_session_v2__:'+createHash('sha256').update(token).digest('hex');
const header={Cookie:'toki_owner_session='+token};
const fixture=baseballTestGame2026();
function makeDb(){
  const rows=new Map([[sessionKey,{owner:sessionKey,revision:0,payload:JSON.stringify({email:owner,expires:Date.now()+86_400_000})}]]);
  return {rows,prepare(sql){
    return {bind(...params){
      return {
        async first(){
          if(sql.startsWith('SELECT payload FROM'))return rows.get(params[0])||null;
          if(sql.startsWith('SELECT revision,payload FROM'))return rows.get(params[0])||null;
          throw Error('Unexpected query: '+sql);
        },
        async all(){
          if(!sql.startsWith('SELECT owner,revision,payload FROM'))throw Error(sql);
          return {results:[...rows.values()].filter(x=>x.owner.startsWith(params[1])).sort((a,b)=>a.owner.localeCompare(b.owner)).slice(0,501)};
        },
        async run(){
          if(sql.startsWith('INSERT INTO')){
            if(rows.has(params[0]))return {meta:{changes:0}};
            rows.set(params[0],{owner:params[0],revision:1,payload:params[1]});return {meta:{changes:1}};
          }
          if(sql.startsWith('UPDATE app_state')){
            const old=rows.get(params[2]);
            if(!old||old.revision!==params[3])return {meta:{changes:0}};
            rows.set(params[2],{owner:params[2],revision:old.revision+1,payload:params[0]});return {meta:{changes:1}};
          }
          throw Error(sql);
        }
      };
    }};
  }};
}
const env=()=>({DB:makeDb(),OWNER_EMAIL:owner,LOGIN_PASSWORD:'a-test-only-password'});
const get=()=>new Request(origin+'/api/baseball/games',{headers:header});
const post=body=>new Request(origin+'/api/baseball/games',{
 method:'POST',headers:{...header,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)
});
test('2026 reference game has required score, starters, and derived result',()=>{
  assert.equal(fixture.date,'2026-09-27');
  assert.equal(fixture.opponent,'ヤクルト');
  assert.equal(fixture.giantsScore,11);
  assert.equal(fixture.opponentScore,0);
  assert.equal(fixture.result,'win');
  assert.equal(fixture.giantsStarter,'小笠原慎之介');
  assert.equal(fixture.opponentStarter,'高橋奎二');
});
test('validates dates and prevents incorrect score or URL',()=>{
  assert.equal(validBaseballDate('2026-02-29'),false);
  assert.equal(validBaseballDate('2028-02-29'),true);
  assert.throws(()=>normalizeBaseballGame({...fixture,giantsScore:-1}),/得点/);
  assert.throws(()=>normalizeBaseballGame({...fixture,sourceUrl:'javascript:alert(1)'}),/http/);
  assert.equal(normalizeBaseballGame({...fixture,state:'playing'}).result,'');
  assert.equal(normalizeBaseballGame({...fixture,giantsScore:0,opponentScore:0}).result,'draw');
});
test('Japanese game screen is available without creating sample data',()=>{
 const ui=createBaseball({escapeHTML:String,render(){},toast(){},fetcher:async()=>({ok:true,json:async()=>({items:[]})})});
 assert.match(ui.page(),/試合管理/);
 assert.match(ui.page(),/試合データを読み込んでいます/);
 const button={dataset:{baseball:'example'}};
 assert.equal(ui.click(button),true);
 assert.match(ui.page(),/小笠原慎之介/);
 assert.match(ui.page(),/試合を登録/);
});
test('API requires login and rejects cross-site writes',async()=>{
  const state=env();
  assert.equal((await onRequest({request:new Request(origin+'/api/baseball/games'),env:state})).status,401);
  const bad=new Request(origin+'/api/baseball/games',{method:'POST',headers:{...header,Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});
  assert.equal((await onRequest({request:bad,env:state})).status,403);
});
test('2026 game can be created, read, updated once, and cannot be duplicated',async()=>{
  const state=env();
  const first=await onRequest({request:post({action:'create',game:fixture}),env:state});
  assert.equal(first.status,201);
  const one=(await first.json()).item;
  assert.equal(one.game.giantsScore,11);
  assert.equal(one.revision,1);
  const list=await onRequest({request:get(),env:state});
  assert.equal(list.status,200);
  const items=(await list.json()).items;
  assert.equal(items.length,1);
  assert.equal(items[0].game.opponentStarter,'高橋奎二');
  assert.equal((await onRequest({request:post({action:'create',game:fixture}),env:state})).status,409);
  const change={...fixture,stadium:'東京ドーム'};
  const update=await onRequest({request:post({action:'update',id:one.id,revision:1,game:change}),env:state});
  assert.equal(update.status,200);
  assert.equal((await update.json()).item.revision,2);
  assert.equal((await onRequest({request:post({action:'update',id:one.id,revision:1,game:change}),env:state})).status,409);
  const after=(await (await onRequest({request:get(),env:state})).json()).items;
  assert.equal(after.length,1);
  assert.equal(after[0].revision,2);
});
