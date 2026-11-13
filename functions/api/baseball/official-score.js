import { verifySession } from '../../../src/server-auth.js';

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

const teams = new Set(['阪神', 'DeNA', 'ヤクルト', '中日', '広島', 'ソフトバンク', '日本ハム', 'オリックス', '楽天', '西武', 'ロッテ']);
const normalize = value => String(value ?? '').normalize('NFKC').replace(/[\s\u3000]+/g, '').replace(/[−－―‐‑–—]/g, '-').toLowerCase();
const decode = value => value.replace(/&(?:nbsp|ensp|emsp|thinsp);/gi, ' ')
  .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, num) => {
    const code = num[0].toLowerCase() === 'x' ? parseInt(num.slice(1), 16) : Number(num);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
  });
const textOnly = html => decode(html.replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tableRows = html => {
  const safe = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(?:script|style|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript)>/gi, '');
  return [...safe.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => ({
    raw: match[1],
    cells: [...match[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(cell => textOnly(cell[1])),
  }));
};

function requireGame(game) {
  if (!game || !/^20\d\d-\d\d-\d\d$/.test(game.date ?? '') || !teams.has(game.opponent)) throw Error('対象試合の日時・対戦相手が正しくありません。');
  const [year, month, day] = game.date.split('-').map(Number);
  const gameNumber = Number(game.gameNumber ?? 1);
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > 3) throw Error('試合番号が不正です。');
  return { year, month, day, gameNumber, opponent: normalize(game.opponent), location: game.location };
}

// NPBの日本語版「試合日程・結果」: 9/27（日） | 巨人 11 - 0 ヤクルト | 東京ドーム
// 日付欄が空欄の次行にも同じ試合日が適用されるため、直前の日付を保持する。
export function parseOfficialSchedule(html, game, sourceUrl) {
  const expected = requireGame(game);
  let date = null;
  const results = [];
  for (const row of tableRows(html)) {
    const head = row.cells[0] ?? '';
    const matchDate = head.match(/(?:^|\s)(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/);
    if (matchDate) date = Number(matchDate[1]) + '/' + Number(matchDate[2]);
    if (date !== expected.month + '/' + expected.day) continue;
    for (const cell of row.cells) {
      const card = normalize(cell);
      const left = /^巨人(\d{1,2})-(\d{1,2})(.+)$/.exec(card);
      const right = /^(.*?)((?:\d{1,2}))-(\d{1,2})巨人$/.exec(card);
      let giantsScore, opponentScore, home;
      if (left && left[3] === expected.opponent) {
        giantsScore = Number(left[1]); opponentScore = Number(left[2]); home = true;
      } else if (right && right[1] === expected.opponent) {
        giantsScore = Number(right[3]); opponentScore = Number(right[2]); home = false;
      } else continue;
      if (expected.location === 'home' && !home || expected.location === 'away' && home) continue;
      const boxLink = row.raw.match(/href=["']([^"']*\/bis\/(?:eng\/)?\d{4}\/games\/s\d+\.html)["']/i);
      results.push({ giantsScore, opponentScore, sourceUrl: boxLink ? new URL(boxLink[1], sourceUrl).href : sourceUrl });
    }
  }
  return results[expected.gameNumber - 1] ?? null;
}

// NPB巨人球団別結果: 9/27 ヤクルト 24 東京ドーム ... 11-0 ○
// 最新年度向けのURLなので、必ず見出しの年度を検証する。
export function parseGiantsResults(html, game, sourceUrl) {
  const expected = requireGame(game);
  const heading = textOnly(html.replace(/<(?:script|style|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript)>/gi, ''));
  if (!new RegExp(expected.year + '\\s*年度\\s*試合結果').test(heading)) return null;
  let currentMonth = null;
  const results = [];
  for (const row of tableRows(html)) {
    const cols = row.cells;
    if (cols.length < 6) continue;
    const dateCell = normalize(cols[0]);
    let day = null;
    const fullDate = /^(\d{1,2})\/(\d{1,2})$/.exec(dateCell);
    if (fullDate) { currentMonth = Number(fullDate[1]); day = Number(fullDate[2]); }
    else if (/^\d{1,2}$/.test(dateCell)) day = Number(dateCell);
    if (currentMonth !== expected.month || day !== expected.day) continue;
    if (normalize(cols[1]) !== expected.opponent) continue;
    const scores = cols.map(value => normalize(value)).map(v => /^(\d{1,2})-(\d{1,2})$/.exec(v)).filter(Boolean);
    if (scores.length !== 1) continue;
    const boxLink = row.raw.match(/href=["']([^"']*\/bis\/(?:eng\/)?\d{4}\/games\/s\d+\.html)["']/i);
    results.push({ giantsScore: Number(scores[0][1]), opponentScore: Number(scores[0][2]), sourceUrl: boxLink ? new URL(boxLink[1], sourceUrl).href : sourceUrl });
  }
  return results[expected.gameNumber - 1] ?? null;
}

// 取得結果はプレビューのみ。登録はアプリ側の確認操作で行う。
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json({ error: 'GETのみ対応しています。' }, 405);
  if (!env.DB) return json({ error: '試合DBが設定されていません。' }, 503);
  let owner;
  try { owner = await verifySession(request, env); } catch { return json({ error: 'ログイン設定を確認してください。' }, 503); }
  if (!owner) return json({ error: 'ログインが必要です。' }, 401);
  const id = new URL(request.url).searchParams.get('gameId') ?? '';
  if (!/^20\d\d-\d\d-\d\d~regular~[^~:]{1,40}~[1-3]$/.test(id)) return json({ error: '公式戦の登録済み試合のみ対応しています。' }, 400);
  try {
    const row = await env.DB.prepare('SELECT payload FROM app_state WHERE owner=?').bind('__baseball_game_v1__:' + owner + ':' + id).first();
    if (!row) return json({ error: '先に対象試合を登録してください。' }, 404);
    const game = JSON.parse(row.payload).game;
    if (!game || game.gameType !== 'regular' || game.date !== id.split('~')[0] || game.opponent !== id.split('~')[2]) return json({ error: '試合情報が一致しません。' }, 400);
    requireGame(game);
    const [year, month] = game.date.split('-');
    const urls = [
      'https://npb.jp/games/' + year + '/schedule_' + month + '_detail.html',
      'https://www.npb.or.jp/games/' + year + '/schedule_' + month + '_detail.html',
      'https://npb.jp/bis/teams/results_g_' + month + '.html',
    ];
    let found = null, fetched = 0;
    for (let i = 0; i < urls.length; i++) {
      try {
        const response = await fetch(urls[i], { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(9000) });
        if (!response.ok || Number(response.headers.get('content-length') || 0) > 1_000_000) continue;
        const html = await response.text();
        if (html.length > 1_000_000) continue;
        fetched++;
        found = i < 2 ? parseOfficialSchedule(html, game, urls[i]) : parseGiantsResults(html, game, urls[i]);
        if (found) break;
      } catch { /* 一部のNPBページに問題があっても別の公式ページを確認する */ }
    }
    if (!found) return json({ error: fetched ? 'NPB公式の日程詳細と巨人球団別結果に、対象試合の確定スコアを確認できませんでした。試合日と対戦相手、公式ページの更新状況を確認してください。' : 'NPB公式ページへの接続に失敗しました。しばらくして再取得してください。' }, 502);
    return json({ ...found, state: 'finished', scope: '最終スコアのみ', source: 'NPB公式', gameId: id });
  } catch (error) {
    return json({ error: error.message || 'NPB公式結果を取得できませんでした。' }, 502);
  }
}