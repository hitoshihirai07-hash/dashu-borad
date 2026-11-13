import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOfficialCalendar} from '../functions/api/baseball/official-score.js';
const game={date:'2026-09-27',opponent:'ヤクルト',location:'home',gameNumber:1};
test('2026/9/27 NPB calendar score is Giants 11 vs Swallows 0',()=>{
 const html='<table><tr><td><div class="teschedate"><a href="/bis/eng/2026/games/gm20260927.html">27</a></div><div><a href="/bis/eng/2026/games/s2026092701960.html">S 0 - 11 G</a></div></td></tr></table>';
 const result=parseOfficialCalendar(html,game);
 assert.equal(result.giantsScore,11);assert.equal(result.opponentScore,0);assert.equal(result.scope,'最終スコアのみ');
});
test('other games and wrong team direction are not mistakenly selected',()=>{
 const html='<td><a href="/bis/eng/2026/games/gm20260927.html">27</a><a href="/bis/eng/2026/games/s2026092701111.html">T 5 - 0 D</a><a href="/bis/eng/2026/games/s2026092701960.html">S 0 - 11 G</a></td>';
 assert.equal(parseOfficialCalendar(html,game).giantsScore,11);
 assert.throws(()=>parseOfficialCalendar(html,{...game,location:'away'}),/一致/);
});
