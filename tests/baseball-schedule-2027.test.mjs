import test from 'node:test';
import assert from 'node:assert/strict';
import {GIANTS_2027_SCHEDULE,GIANTS_2027_UNDATED,GIANTS_2027_SNAPSHOT} from '../src/baseball-schedule-2027.js';
import {normalizeBaseballGame} from '../src/baseball-model.js';
import {seedGiantsSchedule2027,onRequest} from '../functions/api/baseball/games.js';
import {createBaseball} from '../src/baseball.js';
import {createHash} from 'node:crypto';

const fixtureOwner='giants2027@example.test';
const prefix='__baseball_game_v1__:'+fixtureOwner+':';
const sessionToken='v2.'+'A'.repeat(43);
const sessionKey='__toki_session_v2__:'+createHash('sha256').update(sessionToken).digest('hex');
const origin='https://toki.example';
const sampleGame=(date='2027-03-26')=>normalizeBaseballGame({
  date,opponent:'中日',gameNumber:1,gameType:'regular',state:'finished',
  location:'home',stadium:'東京ドーム',giantsScore:7,opponentScore:2
});
function makeD1({batch=true}={}){
  const rows=new Map();
  const effects={batches:0};
  const db={
    prepare(sql){return {
      bind(...args){return {
        async first(){return rows.get(args[0])||null;},
        async run(){
          if(!sql.startsWith('INSERT INTO app_state'))throw Error('Unexpected SQL: '+sql);
          const [key,payload]=args;
          if(rows.has(key))return {meta:{changes:0}};
          rows.set(key,{revision:1,payload});
          return {meta:{changes:1}};
        }
      };}
    };}
  };
  if(batch)db.batch=async statements=>{
    effects.batches++;
    return Promise.all(statements.map(stmt=>stmt.run()));
  };
  return {db,rows,effects};
}
test('Google Sheets: 2027年は確定140試合＋日程未定3試合',()=>{
  assert.equal(GIANTS_2027_SCHEDULE.length,140);
  assert.equal(GIANTS_2027_UNDATED.length,3);
  assert.equal(GIANTS_2027_SNAPSHOT,'2026-11-13');
  assert.deepEqual(GIANTS_2027_SCHEDULE[0],['2027-03-26','中日','home','']);
  assert.deepEqual(GIANTS_2027_SCHEDULE.at(-1),['2027-10-03','広島','home','']);
  assert.deepEqual(GIANTS_2027_UNDATED,[['ヤクルト','home'],['広島','home'],['DeNA','away']]);
  const set=new Set();
  for(const [date,opponent,location,stadium] of GIANTS_2027_SCHEDULE){
    const game=normalizeBaseballGame({date,opponent,location,stadium,gameNumber:1,gameType:'regular',state:'scheduled'});
    assert.equal(game.season,2027);
    assert.equal(game.state,'scheduled');
    assert.equal(game.giantsScore,null);
    assert.equal(game.opponentScore,null);
    assert.equal(game.giantsStarter,'');
    assert.equal(game.opponentStarter,'');
    assert.ok(!set.has(date+'~'+opponent));
    set.add(date+'~'+opponent);
  }
  assert.equal(set.size,140);
});
test('一括初期登録は140件、再実行しても0件で二重登録しない',async()=>{
  const {db,rows,effects}=makeD1();
  const first=await seedGiantsSchedule2027(db,fixtureOwner);
  assert.deepEqual(first,{created:140,alreadySeeded:false,pending:3});
  assert.equal(rows.size,141); // 日程140試合＋登録済みマーカー
  assert.equal(effects.batches,6); // 25試合ずつ一括書き込み
  const again=await seedGiantsSchedule2027(db,fixtureOwner);
  assert.deepEqual(again,{created:0,alreadySeeded:true,pending:3});
  assert.equal(rows.size,141);
  assert.equal(effects.batches,6);
});
test('既存の試合・勝敗・メモ・編集日時は初期登録で上書きしない',async()=>{
  const {db,rows}=makeD1();
  const existing={
    game:sampleGame(),createdAt:'2027-01-01T00:00:00.000Z',updatedAt:'2027-01-02T00:00:00.000Z'
  };
  const key=prefix+'2027-03-26~regular~中日~1';
  rows.set(key,{revision:18,payload:JSON.stringify(existing)});
  const userNoteKey='__baseball_note_v1__:'+fixtureOwner+':'+encodeURIComponent('2027-03-26~regular~中日~1')+':test';
  rows.set(userNoteKey,{revision:3,payload:JSON.stringify({body:'既存メモ',createdAt:'2027-03-26T09:00:00Z'})});
  const result=await seedGiantsSchedule2027(db,fixtureOwner);
  assert.equal(result.created,139);
  assert.deepEqual(JSON.parse(rows.get(key).payload),existing);
  assert.equal(rows.get(key).revision,18);
  assert.equal(JSON.parse(rows.get(userNoteKey).payload).body,'既存メモ');
  assert.equal(rows.size,142);
});
test('途中失敗しても再実行で不足分だけ登録し、完了マーカーは最後に保存',async()=>{
  const {db,rows}=makeD1({batch:false});
  let count=0;
  const orig=db.prepare.bind(db);
  db.prepare=sql=>{
    const handle=orig(sql);
    return {bind(...args){
      const bound=handle.bind(...args);
      if(args[0]?.startsWith(prefix)){
        const run=bound.run;
        bound.run=async()=>{count++;if(count===14)throw Error('模擬DB中断');return run();};
      }
      return bound;
    }};
  };
  await assert.rejects(seedGiantsSchedule2027(db,fixtureOwner),/模擬DB中断/);
  assert.ok(rows.size>=13);
  assert.ok(!rows.has('__baseball_schedule_seed_v1__:'+fixtureOwner+':2027'));
  const normal=makeD1({batch:false});
  for(const [k,v] of rows)normal.rows.set(k,v);
  const completed=await seedGiantsSchedule2027(normal.db,fixtureOwner);
  assert.equal(completed.created,140-rows.size);
  assert.equal(normal.rows.size,141);
});
test('初期登録APIは認証された画面からのPOSTのみ対応',async()=>{
  const {db,rows}=makeD1();
  rows.set(sessionKey,{revision:0,payload:JSON.stringify({email:fixtureOwner,expires:Date.now()+3600000})});
  const env={DB:db,OWNER_EMAIL:fixtureOwner,LOGIN_PASSWORD:'test-only-password'};
  const body=JSON.stringify({action:'seed-2027'});
  const make=(method='POST',headers={})=>new Request(origin+'/api/baseball/games',{
    method,headers:{Cookie:'toki_owner_session='+sessionToken,...headers},
    ...(method==='POST'?{body}: {})
  });
  assert.equal((await onRequest({request:make('POST',{'Content-Type':'application/json',Origin:'https://wrong.example'}),env})).status,403);
  const request=make('POST',{'Content-Type':'application/json',Origin:origin});
  const res=await onRequest({request,env});
  assert.equal(res.status,200);
  assert.equal((await res.json()).created,140);
  const second=await onRequest({request:make('POST',{'Content-Type':'application/json',Origin:origin}),env});
  assert.equal((await second.json()).created,0);
  assert.equal(rows.size,142); // session, 140試合, marker
});
test('2027年を選択したときだけ登録し、未定試合に仮の日付は付けない',async()=>{
  const stored=[],target='2027-03-26~regular~中日~1';
  const data={items:[{id:target,revision:1,game:normalizeBaseballGame({date:'2027-03-26',opponent:'中日'})}]};
  const fetcher=async(path,options={})=>{
    if(path==='/api/baseball/games'&&options.method==='POST'){
      stored.push(JSON.parse(options.body).action);
      return {ok:true,json:async()=>({created:140,alreadySeeded:false,pending:3})};
    }
    if(path==='/api/baseball/games')return {ok:true,json:async()=>data};
    if(path.includes('/notes?'))return {ok:true,json:async()=>({items:[]})};
    return {ok:true,json:async()=>({revision:0,data:null})};
  };
  const ui=createBaseball({escapeHTML:String,render(){},toast(){},fetcher});
  await ui.load();
  assert.equal(stored.length,0);
  ui.change({id:'baseball-season',value:'2027'});
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual(stored,['seed-2027']);
  const page=ui.page();
  assert.match(page,/2027\/03\/26/);
  assert.match(page,/日程未定の試合（3試合）/);
  ui.click({dataset:{baseball:'pending-2027',pendingIndex:'0'}});
  const draft=ui.page();
  assert.match(draft,/value=""/); // 未定日のdateフィールドは空
  assert.match(draft,/ヤクルト/);
});
