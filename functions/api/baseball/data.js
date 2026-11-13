import {verifySession} from '../../../src/server-auth.js';
import {normalizeBaseballData} from '../../../src/baseball-data-model.js';
const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const validGameId = id => typeof id === 'string' && id.length <= 110 && /^\d{4}-\d{2}-\d{2}~[a-z]+~[^~:]{1,40}~[1-3]$/.test(id);
const key = (owner, id) => '__baseball_data_v1__:' + owner + ':' + id;
export async function onRequest({request,env}) {
  if (!['GET','POST'].includes(request.method)) return json({error:'GETまたはPOSTのみ対応しています。'},405);
  if (!env.DB) return json({error:'D1データベースが設定されていません。'},503);
  if (request.method === 'POST') {
    if (request.headers.get('Origin') !== new URL(request.url).origin) return json({error:'別サイトからの保存はできません。'},403);
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({error:'JSONで送信してください。'},415);
  }
  let owner;
  try { owner = await verifySession(request,env); } catch {return json({error:'ログイン設定を確認してください。'},503);}
  if (!owner) return json({error:'ログインが必要です。'},401);
  let input;
  try {
    if(request.method === 'GET') input={gameId:new URL(request.url).searchParams.get('gameId')};
    else {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 64000) return json({error:'登録データが大きすぎます。'},413);
      input=JSON.parse(raw);
    }
  } catch {return json({error:'データの形式が正しくありません。'},400);}
  const gameId=input?.gameId;
  if (!validGameId(gameId)) return json({error:'試合IDが不正です。'},400);
  try {
    const game=await env.DB.prepare('SELECT revision,payload FROM app_state WHERE owner=?').bind('__baseball_game_v1__:'+owner+':'+gameId).first();
    if (!game) return json({error:'先に試合を登録してください。'},404);
    const dataKey=key(owner,gameId);
    const row=await env.DB.prepare('SELECT revision,payload FROM app_state WHERE owner=?').bind(dataKey).first();
    if (request.method==='GET') return json({revision:row?.revision||0,data:row?JSON.parse(row.payload):null});
    if (!Number.isSafeInteger(input.revision)||input.revision<0) return json({error:'更新番号が不正です。'},400);
    if (input.revision!==(row?.revision||0)) return json({error:'別の画面で試合データが更新されています。再取得して確認してください。'},409);
    let parsed;
    try {parsed=normalizeBaseballData(input.data);} catch(e) {return json({error:e.message},400);}
    const packed=JSON.stringify(parsed),now=new Date().toISOString();
    let result;
    if (!row) result=await env.DB.prepare('INSERT INTO app_state (owner,revision,payload,updated_at) VALUES (?,1,?,?) ON CONFLICT(owner) DO NOTHING').bind(dataKey,packed,now).run();
    else result=await env.DB.prepare('UPDATE app_state SET revision=revision+1,payload=?,updated_at=? WHERE owner=? AND revision=?').bind(packed,now,dataKey,input.revision).run();
    if (result.meta?.changes!==1) return json({error:'保存時に別の更新がありました。上書きを中止しました。'},409);
    return json({revision:input.revision+1,data:parsed});
  } catch(e) {return json({error:'試合データを保存できませんでした。'+e.message},503);}
}
