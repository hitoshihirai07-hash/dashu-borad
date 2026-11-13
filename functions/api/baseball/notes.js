import {verifySession} from '../../../src/server-auth.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
});
const keyFor=(owner,gameId,id)=>'__baseball_note_v1__:'+owner+':'+encodeURIComponent(gameId)+':'+id;
const gameKey=(owner,gameId)=>'__baseball_game_v1__:'+owner+':'+gameId;
const validGameId=id=>typeof id==='string'&&id.length<=110&&/^\d{4}-\d{2}-\d{2}~[a-z]+~[^~:]{1,40}~[1-3]$/.test(id);
const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const cleanNote=input=>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('メモの形式が正しくありません。');
  if(typeof input.body!=='string'||!input.body.trim()||input.body.length>4000)throw Error('メモ本文は1～4000文字で入力してください。');
  const phase=input.phase||'during';
  if(!['before','during','after'].includes(phase))throw Error('メモの分類が不正です。');
  if(typeof input.inning!=='string'||input.inning.length>20)throw Error('イニングは20文字以内です。');
  return {body:input.body,phase,inning:input.inning.trim()};
};
export async function onRequest({request,env}){
  if(!['GET','POST'].includes(request.method))return json({error:'GETとPOSTのみ対応しています。'},405);
  if(!env.DB)return json({error:'D1データベースが設定されていません。'},503);
  if(request.method==='POST'){
    if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'別サイトから登録できません。'},403);
    if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({error:'JSONで送信してください。'},415);
  }
  let owner;
  try{owner=await verifySession(request,env);}catch{return json({error:'ログイン設定を確認してください。'},503);}
  if(!owner)return json({error:'ログインが必要です。'},401);
  try{
    let input;
    if(request.method==='GET')input={gameId:new URL(request.url).searchParams.get('gameId')};
    else{
      const raw=await request.text();
      if(new TextEncoder().encode(raw).length>12000)return json({error:'メモが大きすぎます。'},413);
      try{input=JSON.parse(raw);}catch{return json({error:'JSONが正しくありません。'},400);}
    }
    const gameId=input?.gameId;
    if(!validGameId(gameId))return json({error:'試合IDが不正です。'},400);
    const exists=await env.DB.prepare('SELECT revision FROM app_state WHERE owner=?').bind(gameKey(owner,gameId)).first();
    if(!exists)return json({error:'試合が見つかりません。最初に試合を登録してください。'},404);
    const prefix=keyFor(owner,gameId,'');
    if(request.method==='GET'){
      const query=await env.DB.prepare('SELECT owner,revision,payload FROM app_state WHERE substr(owner,1,?)=? ORDER BY owner LIMIT 501').bind(prefix.length,prefix).all();
      if((query.results||[]).length>500)return json({error:'この試合のメモが500件を超えています。'},413);
      const items=(query.results||[]).map(row=>({id:row.owner.slice(prefix.length),revision:row.revision,...JSON.parse(row.payload)}))
        .filter(x=>!x.deleted).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
      return json({items});
    }
    if(!['create','update','delete'].includes(input.action))return json({error:'操作が正しくありません。'},400);
    if(!validId(input.id))return json({error:'メモIDが不正です。'},400);
    const key=keyFor(owner,gameId,input.id),now=new Date().toISOString();
    if(input.action==='create'){
      let fields;
      try{fields=cleanNote(input.note);}catch(e){return json({error:e.message},400);}
      const saved={...fields,createdAt:now,updatedAt:now,deleted:false};
      const result=await env.DB.prepare('INSERT INTO app_state (owner,revision,payload,updated_at) VALUES (?,1,?,?) ON CONFLICT(owner) DO NOTHING')
        .bind(key,JSON.stringify(saved),now).run();
      if(result.meta?.changes===1)return json({item:{id:input.id,revision:1,...saved}},201);
      const previous=await env.DB.prepare('SELECT revision,payload FROM app_state WHERE owner=?').bind(key).first();
      const old=previous&&JSON.parse(previous.payload);
      if(old&&!old.deleted&&old.body===saved.body&&old.phase===saved.phase&&old.inning===saved.inning)
        return json({item:{id:input.id,revision:previous.revision,...old},reused:true});
      return json({error:'同じIDのメモがあります。読み込み直してください。'},409);
    }
    if(!Number.isSafeInteger(input.revision)||input.revision<1)return json({error:'メモの更新番号が不正です。'},400);
    const previous=await env.DB.prepare('SELECT revision,payload FROM app_state WHERE owner=?').bind(key).first();
    if(!previous)return json({error:'対象メモがありません。'},404);
    if(previous.revision!==input.revision)return json({error:'別の画面でメモが更新されています。上書きしていません。'},409);
    const old=JSON.parse(previous.payload);
    if(old.deleted)return json({error:'削除済みのメモです。'},409);
    let fields={};
    if(input.action==='update'){
      try{fields=cleanNote(input.note);}catch(e){return json({error:e.message},400);}
    }
    const saved={...old,...fields,updatedAt:now,deleted:input.action==='delete'};
    const result=await env.DB.prepare('UPDATE app_state SET revision=revision+1,payload=?,updated_at=? WHERE owner=? AND revision=?')
      .bind(JSON.stringify(saved),now,key,input.revision).run();
    if(result.meta?.changes!==1)return json({error:'メモが別の画面で更新されました。'},409);
    return json({item:{id:input.id,revision:input.revision+1,...saved}});
  }catch(e){return json({error:'観戦メモを保存できませんでした。'+e.message},503);}
}
