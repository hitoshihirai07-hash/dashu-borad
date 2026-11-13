import {verifySession} from '../../src/server-auth.js';
import {normalizeBaseballGame} from '../../src/baseball-model.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
});
const prefix=owner=>'__baseball_game_v1__:'+owner+':';
const identity=game=>[game.date,game.gameType,game.opponent,game.gameNumber].join('~');
const readRows=async(DB,start)=>{
  const rows=await DB.prepare('SELECT owner,revision,payload FROM app_state WHERE substr(owner,1,?)=? ORDER BY owner LIMIT 501')
    .bind(start.length,start).all();
  if((rows.results||[]).length>500)throw Error('登録件数が上限に達しました。');
  return (rows.results||[]).map(row=>({id:row.owner.slice(start.length),revision:row.revision,...JSON.parse(row.payload)}));
};
export async function onRequest({request,env}){
  if(!['GET','POST'].includes(request.method))return json({error:'GETとPOSTのみ対応しています。'},405);
  if(!env.DB)return json({error:'D1データベースが設定されていません。'},503);
  if(request.method==='POST'){
    if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'別サイトからは登録できません。'},403);
    if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({error:'JSONで送信してください。'},415);
  }
  let owner;
  try{owner=await verifySession(request,env);}catch{return json({error:'ログイン設定を確認してください。'},503);}
  if(!owner)return json({error:'ログインが必要です。'},401);
  const start=prefix(owner);
  try{
    if(request.method==='GET')return json({items:await readRows(env.DB,start)});
    const raw=await request.text();
    if(new TextEncoder().encode(raw).length>16_000)return json({error:'試合データが大きすぎます。'},413);
    let input;
    try{input=JSON.parse(raw);}catch{return json({error:'JSONが不正です。'},400);}
    if(!['create','update'].includes(input?.action))return json({error:'操作が不正です。'},400);
    let game;
    try{game=normalizeBaseballGame(input.game);}catch(e){return json({error:e.message},400);}
    const id=identity(game),key=start+id,now=new Date().toISOString();
    if(input.action==='create'){
      const item={game,createdAt:now,updatedAt:now};
      const result=await env.DB.prepare(
        'INSERT INTO app_state (owner,revision,payload,updated_at) VALUES (?,1,?,?) ON CONFLICT(owner) DO NOTHING'
      ).bind(key,JSON.stringify(item),now).run();
      if(result.meta?.changes!==1)return json({error:'同じ試合が既に登録されています。再読み込みしてください。'},409);
      return json({item:{id,revision:1,...item}},201);
    }
    if(typeof input.id!=='string'||input.id!==id)return json({error:'試合日・対戦相手・試合区分を変更する場合は別の試合として登録してください。'},400);
    if(!Number.isSafeInteger(input.revision)||input.revision<1)return json({error:'更新版が不正です。'},400);
    const old=await env.DB.prepare('SELECT revision,payload FROM app_state WHERE owner=?').bind(key).first();
    if(!old)return json({error:'対象試合がありません。'},404);
    if(old.revision!==input.revision)return json({error:'別の画面で変更されています。再読み込みしてください。'},409);
    const item={game,createdAt:JSON.parse(old.payload).createdAt,updatedAt:now};
    const result=await env.DB.prepare('UPDATE app_state SET revision=revision+1,payload=?,updated_at=? WHERE owner=? AND revision=?')
      .bind(JSON.stringify(item),now,key,input.revision).run();
    if(result.meta?.changes!==1)return json({error:'他の端末の更新と競合しました。'},409);
    return json({item:{id,revision:input.revision+1,...item}});
  }catch(e){return json({error:'試合管理の保存に失敗しました。'+e.message},503);}
}
