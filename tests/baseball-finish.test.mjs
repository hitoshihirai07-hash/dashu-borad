import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {renderGiantsMonth} from '../src/baseball-calendar.js';
import {createBaseball} from '../src/baseball.js';
import {baseballTestGame2026,normalizeBaseballGame} from '../src/baseball-model.js';
import {baseballGameData2026Fixture} from '../src/baseball-data-model.js';
import {createCloudSync} from '../src/cloud-sync.js';
import {onRequest,validateBaseballArchive,compareBaseballArchives} from '../functions/api/baseball/archive.js';
const owner='tester@example.test';
const id='2026-09-27~regular~ヤクルト~1';
const noteId='a1234567-aaaa-4bbb-8ccc-123456789abc';
const token='v2.'+'A'.repeat(43);
const session='__toki_session_v2__:'+createHash('sha256').update(token).digest('hex');
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const item={
  id,revision:1,
  game:baseballTestGame2026()
};
const note={body:'８回の守備交代に注目',phase:'during',inning:'8回表',createdAt:'2026-09-27T08:00:00Z',updatedAt:'2026-09-27T08:00:00Z',deleted:false};
const payload={game:item.game,createdAt:'2026-09-27T04:00:00Z',updatedAt:'2026-09-27T11:00:00Z'};
function makeD1(){
  const rows=new Map([[session,{revision:0,payload:JSON.stringify({email:owner,expires:Date.now()+600000})}]]);
  const db={prepare(sql){return {bind(...args){return {
    async first(){return rows.get(args[0])||null;},
    async all(){
      if(!sql.startsWith('SELECT owner,revision,payload FROM'))throw Error('Unexpected query '+sql);
      return {results:[...rows.entries()].filter(([key])=>key.startsWith(args[1])).map(([owner,value])=>({owner,...value})).slice(0,10001)};
    },
    async run(){
      if(!sql.startsWith('INSERT INTO'))throw Error('Unexpected insert '+sql);
      const [key,payload]=args;
      if(rows.has(key))return {meta:{changes:0}};
      rows.set(key,{revision:1,payload});return {meta:{changes:1}};
    }
  };}};}};
  db.batch=async list=>Promise.all(list.map(statement=>statement.run()));
  return {rows,db};
}
const env=state=>({DB:state.db,OWNER_EMAIL:owner,LOGIN_PASSWORD:'test-only'});
const req=(method='GET',value,origin='https://toki.example')=>new Request('https://toki.example/api/baseball/archive',{
  method,headers:{Cookie:'toki_owner_session='+token,...(method==='POST'?{'Content-Type':'application/json',Origin:origin}:{})},
  ...(method==='POST'?{body:JSON.stringify(value)}:{})
});
test('月間カレンダーは日付・対戦相手・得点・先発と勝敗を表示',()=>{
  const result=renderGiantsMonth([item],2026,9,esc);
  assert.match(result,/2026年9月/);
  assert.match(result,/11－0 ○/);
  assert.match(result,/小笠原慎之介/);
  assert.match(result,/data-baseball="calendar-pick"/);
  assert.match(result,/data-game-id="2026-09-27~regular~ヤクルト~1"/);
  const march=renderGiantsMonth([item],2027,3,esc);
  assert.doesNotMatch(march,/小笠原慎之介/);
  assert.match(march,/この月は登録済みの試合がありません/);
});
test('カレンダーと試合詳細を切り替え、選択した試合の記録を開く',async()=>{
  const fetcher=async path=>({ok:true,json:async()=>path==='/api/baseball/games'?{items:[item]}:path.includes('notes?')?{items:[]}:{revision:0,data:null}});
  const ui=createBaseball({escapeHTML:esc,render(){},toast(){},fetcher});
  await ui.load();
  assert.match(ui.page(),/baseball-summary-line/);
  ui.click({dataset:{baseball:'view-calendar'}});
  assert.match(ui.page(),/baseball-calendar-grid/);
  ui.click({dataset:{baseball:'calendar-pick',gameId:id}});
  assert.match(ui.page(),/baseball-summary-line/);
  assert.match(ui.page(),/baseball-notes/);
});
test('バックアップ形式は誤データ・重複・存在しない親試合を拒否',()=>{
  assert.throws(()=>validateBaseballArchive({rows:[]}),/形式/);
  const row={type:'game',id,payload:JSON.stringify(payload)};
  assert.equal(validateBaseballArchive({format:'toki-baseball-archive-v1',version:1,rows:[row]}).length,1);
  assert.throws(()=>validateBaseballArchive({format:'toki-baseball-archive-v1',version:1,rows:[row,row]}),/重複/);
  assert.deepEqual(compareBaseballArchives([row],[row]),{
    total:1,missing:0,identical:1,conflicts:0,
    types:{game:{missing:0,identical:1,conflicts:0},data:{missing:0,identical:0,conflicts:0},
      note:{missing:0,identical:0,conflicts:0},notion:{missing:0,identical:0,conflicts:0},schedule:{missing:0,identical:0,conflicts:0}}
  });
});
test('試合・メモをバックアップし、確認後に追加復元する。再実行は0件',async()=>{
  const original=makeD1(),destination=makeD1();
  const gameKey='__baseball_game_v1__:'+owner+':'+id;
  const noteKey='__baseball_note_v1__:'+owner+':'+encodeURIComponent(id)+':'+noteId;
  original.rows.set(gameKey,{revision:3,payload:JSON.stringify(payload)});
  original.rows.set(noteKey,{revision:2,payload:JSON.stringify(note)});
  const exported=await onRequest({request:req(),env:env(original)});
  assert.equal(exported.status,200);
  const archive=await exported.json();
  assert.equal(archive.rows.length,2);
  const preview=await onRequest({request:req('POST',{action:'preview',archive}),env:env(destination)});
  assert.equal((await preview.json()).summary.missing,2);
  assert.equal(destination.rows.size,1); // Preview is read-only, session only.
  const first=await onRequest({request:req('POST',{action:'restore',archive}),env:env(destination)});
  assert.equal(first.status,200);
  assert.equal((await first.json()).created,2);
  const again=await onRequest({request:req('POST',{action:'restore',archive}),env:env(destination)});
  assert.equal((await again.json()).created,0);
  assert.equal(destination.rows.size,3);
  destination.rows.set(noteKey,{revision:9,payload:JSON.stringify({...note,body:'現在のメモを保持'})});
  const conflict=await onRequest({request:req('POST',{action:'restore',archive}),env:env(destination)});
  assert.equal((await conflict.json()).summary.conflicts,1);
  assert.equal(JSON.parse(destination.rows.get(noteKey).payload).body,'現在のメモを保持');
});
test('バックアップ復元は他サイト・未認証の書き込みを拒否',async()=>{
  const state=makeD1();
  const archive={format:'toki-baseball-archive-v1',version:1,rows:[]};
  assert.equal((await onRequest({request:req('POST',{action:'restore',archive},'https://evil.test'),env:env(state)})).status,403);
  assert.equal((await onRequest({request:new Request('https://toki.example/api/baseball/archive'),env:env(state)})).status,401);
});
test('親試合がない観戦メモは安全のため復元を止める',async()=>{
  const state=makeD1(),archive={
    format:'toki-baseball-archive-v1',version:1,
    rows:[{type:'note',id:encodeURIComponent(id)+':'+noteId,payload:JSON.stringify(note)}]
  };
  const res=await onRequest({request:req('POST',{action:'preview',archive}),env:env(state)});
  assert.equal(res.status,400);
  assert.match((await res.json()).error,/親となる試合/);
});

test('全データバックアップには試合、成績、観戦メモ、Notion履歴、日程の保存履歴が入る',async()=>{
  const state=makeD1();
  state.rows.set('__baseball_game_v1__:'+owner+':'+id,{revision:1,payload:JSON.stringify(payload)});
  state.rows.set('__baseball_data_v1__:'+owner+':'+id,{revision:1,payload:JSON.stringify(baseballGameData2026Fixture())});
  state.rows.set('__baseball_note_v1__:'+owner+':'+encodeURIComponent(id)+':'+noteId,{revision:1,payload:JSON.stringify(note)});
  state.rows.set('__baseball_notion_v1__:'+owner+':'+id,{revision:1,payload:JSON.stringify({
    page:'3e8ee5b7-9890-80ab-b2af-c7ba10c1fb62',target:'3e4ee5b7-9890-80d7-83e3-000baaba8f46',
    bodyHash:'abc',properties:{}
  })});
  state.rows.set('__baseball_schedule_seed_v1__:'+owner+':2027',{revision:1,payload:JSON.stringify({snapshot:'2026-11-13',dated:140,pending:3})});
  const result=await onRequest({request:req(),env:env(state)});
  assert.equal(result.status,200);
  const archived=await result.json();
  assert.deepEqual(archived.rows.map(r=>r.type),['game','data','note','notion','schedule']);
  assert.equal(validateBaseballArchive(archived).length,5);
});
test('全データバックアップは同一JSONにクラウド記録と試合記録を保持し、取得失敗時には出力しない',async()=>{
  const downloaded=[];
  const storage={getItem(){return null;},setItem(){},removeItem(){}};
  const merged=createCloudSync({storage,loc:{protocol:'file:'},download:(raw)=>downloaded.push(raw),
    backupDecorator:async cloud=>({format:'toki-complete-backup-v2',version:2,
      cloud,baseball:{format:'toki-baseball-archive-v1',version:1,rows:[]}})});
  await merged.backup();
  assert.equal(downloaded.length,1);
  const combined=JSON.parse(downloaded[0]);
  assert.equal(combined.format,'toki-complete-backup-v2');
  assert.equal(combined.cloud.format,'toki-cloud-state-v1');
  assert.equal(combined.baseball.format,'toki-baseball-archive-v1');
  const failed=createCloudSync({storage,loc:{protocol:'file:'},download:(raw)=>downloaded.push(raw),
    backupDecorator:async()=>{throw Error('remote failure');}});
  await assert.rejects(failed.backup(),/remote failure/);
  assert.equal(downloaded.length,1);
});
