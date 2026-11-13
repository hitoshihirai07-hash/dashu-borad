import test from 'node:test';
import assert from 'node:assert/strict';
import {createBaseball} from '../src/baseball.js';
import {createBaseballData} from '../src/baseball-data.js';
import {baseballTestGame2026} from '../src/baseball-model.js';
import {EMPTY_BASEBALL_DATA,baseballGameData2026Fixture} from '../src/baseball-data-model.js';
const firstId='2026-09-27~regular~ヤクルト~1';
const secondId='2026-09-28~regular~阪神~1';
const game=baseballTestGame2026();
const fetcher=async path=>({ok:true,json:async()=>path==='/api/baseball/games'?
 {items:[{id:firstId,revision:1,game},{id:secondId,revision:1,game:{...game,date:'2026-09-28',opponent:'阪神'}}]}:
 path.includes('/notes?')?{items:[]}:{revision:1,data:baseballGameData2026Fixture()}});
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
test('試合選択は上部のドロップダウン・左側の試合一覧は撤去',async()=>{
 const ui=createBaseball({escapeHTML:esc,render(){},toast(){},fetcher});
 await ui.load();
 const page=ui.page();
 assert.match(page,/id="baseball-game-picker"/);
 assert.match(page,/class="baseball-workspace"/);
 assert.match(page,/class="baseball-main"/);
 assert.match(page,/class="baseball-summary-line"/);
 assert.doesNotMatch(page,/class="panel baseball-list"/);
 assert.ok(page.indexOf('class="baseball-summary-line"')<page.indexOf('class="panel baseball-notes"'));
 assert.ok(page.indexOf('class="baseball-notes"')<page.indexOf('class="panel baseball-data"'));
 ui.change({id:'baseball-game-picker',value:secondId});
 assert.match(ui.page(),/2026\/09\/28/);
 assert.match(ui.page(),/阪神/);
});
test('試合データはスコア・スタメン・投手の3タブ、相手の個人成績は非表示',async()=>{
 const ui=createBaseballData({escapeHTML:esc,render(){},toast(){},fetcher});
 ui.select(firstId,game);
 await new Promise(resolve=>setTimeout(resolve,0));
 let html=ui.page();
 assert.match(html,/data-stats-tab="score"/);
 assert.match(html,/data-stats-tab="lineup"/);
 assert.match(html,/data-stats-tab="pitching"/);
 assert.doesNotMatch(html,/長岡 秀樹/); // 相手打者の一覧は表示しない
 ui.click({dataset:{baseballStats:'tab',statsTab:'lineup'}});
 html=ui.page();assert.match(html,/松本 剛/);
 assert.doesNotMatch(html,/長岡 秀樹/);
 ui.click({dataset:{baseballStats:'tab',statsTab:'pitching'}});
 html=ui.page();assert.match(html,/小笠原 慎之介/);
 assert.doesNotMatch(html,/高橋 奎二/);
});
test('タブを切り替えても編集中の入力文字を保持',async()=>{
 const fetchEmpty=async()=>({ok:true,json:async()=>({revision:0,data:null})});
 const ui=createBaseballData({escapeHTML:esc,render(){},toast(){},fetcher:fetchEmpty});
 ui.select(firstId,game);
 await new Promise(resolve=>setTimeout(resolve,0));
 ui.click({dataset:{baseballStats:'edit'}});
 ui.click({dataset:{baseballStats:'tab',statsTab:'lineup'}});
 ui.input({dataset:{baseballStatsField:'giantsLineup'},value:'1,中,新しい選手'});
 ui.click({dataset:{baseballStats:'tab',statsTab:'pitching'}});
 ui.click({dataset:{baseballStats:'tab',statsTab:'lineup'}});
 assert.match(ui.page(),/新しい選手/);
});

test('野手全員・スタメン・投手の切替表示',async()=>{
  const ui=createBaseballData({escapeHTML:esc,render(){},toast(){},fetcher});
  ui.select(firstId,game);
  await new Promise(resolve=>setTimeout(resolve,0));
  ui.click({dataset:{baseballStats:'tab',statsTab:'batters'}});
  const html=ui.page();
  assert.match(html,/皆川 岳飛/);
  assert.match(html,/佐々木 俊輔/);
  assert.match(html,/増田 陸/);
  assert.match(html,/四球/);
  ui.click({dataset:{baseballStats:'tab',statsTab:'pitching'}});
  assert.match(ui.page(),/平内 龍太/);
  ui.click({dataset:{baseballStats:'tab',statsTab:'lineup'}});
  assert.match(ui.page(),/松本 剛/);
});
