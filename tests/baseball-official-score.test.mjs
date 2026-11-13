import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseOfficialSchedule,parseGiantsResults,onRequest} from '../functions/api/baseball/official-score.js';

const game={date:'2026-09-27',opponent:'ヤクルト',location:'home',gameNumber:1,gameType:'regular'};
const scheduleUrl='https://npb.jp/games/2026/schedule_09_detail.html';
const teamUrl='https://npb.jp/bis/teams/results_g_09.html';
const schedule='<table><tr><th>月日</th><th>対戦カード</th></tr>'
  +'<tr><td>9/26（土）</td><td>DeNA 3 - 2 阪神</td></tr>'
  +'<tr><td>9/27（日）</td><td>巨人 <a href="/bis/2026/games/s2026092701960.html">11 - 0</a> ヤクルト</td></tr>'
  +'<tr><td></td><td>DeNA 3 - 5 広島</td></tr>'
  +'<tr><td>9/28（月）</td><td>巨人 2 - 3 広島</td></tr></table>';
const giants='<html><h2>2026年度 試合結果 【9月】</h2><table>'
  +'<tr><td>9/25</td><td>広島</td><td>24</td><td>マツダ</td><td>25000</td><td>2:30</td><td>3-2</td><td>○</td></tr>'
  +'<tr><td>27</td><td>ヤクルト</td><td>24</td><td>東京ドーム</td><td>42000</td><td>3:14</td><td>11-0</td><td>○</td></tr></table></html>';

test('2026/9/27 日本語版NPB日程から巨人11-0ヤクルトを解析',()=>{
  const result=parseOfficialSchedule(schedule,game,scheduleUrl);
  assert.equal(result.giantsScore,11);assert.equal(result.opponentScore,0);
  assert.match(result.sourceUrl,/s2026092701960/);
});
test('試合日と対戦相手・ホーム区分の一致を必須にする',()=>{
  assert.equal(parseOfficialSchedule(schedule,{...game,date:'2026-09-26'},scheduleUrl),null);
  assert.equal(parseOfficialSchedule(schedule,{...game,location:'away'},scheduleUrl),null);
  assert.equal(parseOfficialSchedule(schedule,{...game,opponent:'阪神'},scheduleUrl),null);
});
test('全角数字のビジター引き分けを正しく解析',()=>{
  const away='<table><tr><td>9/27（日）</td><td>広 島 ２ － ２ 巨人</td></tr></table>';
  assert.deepEqual(parseOfficialSchedule(away,{...game,opponent:'広島',location:'away'},scheduleUrl),
    {giantsScore:2,opponentScore:2,sourceUrl:scheduleUrl});
});
test('巨人球団別結果を代替参照し、年度違いを拒否する',()=>{
  assert.deepEqual(parseGiantsResults(giants,game,teamUrl),{giantsScore:11,opponentScore:0,sourceUrl:teamUrl});
  assert.equal(parseGiantsResults(giants.replace('2026年度','2025年度'),game,teamUrl),null);
});
const owner='owner@example.test',token='v2.'+'A'.repeat(43);
const key='__toki_session_v2__:'+createHash('sha256').update(token).digest('hex');
const gameId='2026-09-27~regular~ヤクルト~1';
const request=()=>new Request('https://toki.test/api/baseball/official-score?gameId='+encodeURIComponent(gameId),{
  headers:{Cookie:'toki_owner_session='+token}
});
const env=()=>({OWNER_EMAIL:owner,LOGIN_PASSWORD:'test password',DB:{prepare(){return {bind(k){return {async first(){
  if(k===key)return {payload:JSON.stringify({email:owner,expires:Date.now()+600000})};
  if(k==='__baseball_game_v1__:'+owner+':'+gameId)return {payload:JSON.stringify({game})};
  return null;
}};}};}}});
test('認証済みAPIは公式日程で見つからなければ別のNPBページを検索する',async()=>{
  const old=globalThis.fetch,targets=[];
  globalThis.fetch=async url=>{
    targets.push(url);
    return {ok:true,headers:{get:()=>null},text:async()=>url.includes('/bis/teams/')?giants:'<table><tr><td>9/27</td><td>巨人 - ヤクルト</td></tr></table>'};
  };
  try{
    const response=await onRequest({request:request(),env:env()});
    const data=await response.json();
    assert.equal(response.status,200);assert.equal(data.giantsScore,11);assert.equal(data.opponentScore,0);
    assert.equal(data.scope,'最終スコアのみ');assert.equal(targets.length,3);
  }finally{globalThis.fetch=old;}
});
test('確認できないスコアを成功と偽らずDBにも書き込まない',async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,headers:{get:()=>null},text:async()=>'<p>開催予定の試合</p>'});
  try{
    const response=await onRequest({request:request(),env:env()});
    assert.equal(response.status,502);
    assert.match((await response.json()).error,/確定スコア/);
  }finally{globalThis.fetch=old;}
});
