import {validateCloudData} from '../../src/cloud-schema.js';
import {verifySession} from '../../src/server-auth.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function onRequest({request,env}){
  if(!['GET','POST'].includes(request.method))return json({error:'許可されていない操作です。'},405);
  if(!env.DB||!env.OWNER_EMAIL||!env.LOGIN_PASSWORD||!env.SESSION_SECRET)return json({error:'ログインまたはDB設定が未完了です。'},503);
  let owner;
  try{owner=await verifySession(request,env);}catch{return json({error:'ログイン設定を確認してください。'},503);}
  if(!owner)return json({error:'ログインが必要です。'},401);
  try{
    const row=await env.DB.prepare('SELECT revision,payload FROM app_state WHERE owner=?').bind(owner).first();
    if(request.method==='GET')return json({revision:row?.revision||0,payload:row?JSON.parse(row.payload):null});
    const origin=request.headers.get('Origin');
    if(!origin||origin!==new URL(request.url).origin)return json({error:'異なるサイトからの書き込みは受け付けません。'},403);
    if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({error:'JSONで送信してください。'},415);
    const raw=await request.text();if(new TextEncoder().encode(raw).length>1_800_000)return json({error:'同期データが1.8MBを超えています。バックアップを取り、データの整理を検討してください。'},413);
    let input;try{input=JSON.parse(raw);}catch{return json({error:'JSONが不正です。'},400);}
    if(!Number.isSafeInteger(input.baseRevision)||input.baseRevision<0)return json({error:'同期の版が不正です。'},400);
    let payload;try{payload=validateCloudData(input.payload);}catch(e){return json({error:e.message},400);}
    if(input.baseRevision!==(row?.revision||0))return json({error:'他の端末で更新されています。上書きを停止しました。'},409);
    const packed=JSON.stringify(payload);if(new TextEncoder().encode(packed).length>1_800_000)return json({error:'データの容量が上限を超えています。'},413);
    const stamp=new Date().toISOString();
    const result=row?await env.DB.prepare('UPDATE app_state SET revision=revision+1,payload=?,updated_at=? WHERE owner=? AND revision=?').bind(packed,stamp,owner,input.baseRevision).run():await env.DB.prepare('INSERT INTO app_state (owner,revision,payload,updated_at) VALUES (?,1,?,?) ON CONFLICT(owner) DO NOTHING').bind(owner,packed,stamp).run();
    if(result.meta?.changes!==1)return json({error:'同時更新を検知したため保存を停止しました。'},409);
    return json({revision:input.baseRevision+1});
  }catch(e){return json({error:'同期処理を完了できません。DB設定・通信状態を確認してください。'},503);}
}
