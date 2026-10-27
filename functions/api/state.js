import {validateCloudData} from '../../src/cloud-schema.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const b64=(value)=>{const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));};
const str=value=>new TextDecoder().decode(b64(value));
// The header is untrusted until RS256 signature, audience, issuer, time and owner email are verified.
export async function verifyAccess(request,env){
  const domain=env.TEAM_DOMAIN?.replace(/\/$/,'');
  if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(domain||'')||!env.POLICY_AUD||!env.OWNER_EMAIL)throw Error('認証設定が不足しています。');
  const token=request.headers.get('cf-access-jwt-assertion');
  if(!token||token.length>12000)throw Error('ログイン認証が必要です。');
  const parts=token.split('.');if(parts.length!==3)throw Error('認証形式が不正です。');
  const header=JSON.parse(str(parts[0]));const payload=JSON.parse(str(parts[1]));
  if(header.alg!=='RS256'||typeof header.kid!=='string')throw Error('認証方式が不正です。');
  const now=Math.floor(Date.now()/1000);
  if(payload.iss!==domain||!(Array.isArray(payload.aud)?payload.aud:[payload.aud]).includes(env.POLICY_AUD)||typeof payload.exp!=='number'||payload.exp<=now||typeof payload.iat!=='number'||payload.iat>now+60||(payload.nbf!==undefined&&payload.nbf>now+60)||String(payload.email||'').toLowerCase()!==env.OWNER_EMAIL.trim().toLowerCase())throw Error('許可されていない利用者です。');
  const keyResponse=await fetch(domain+'/cdn-cgi/access/certs');
  if(!keyResponse.ok)throw Error('署名の確認に失敗しました。');
  const keys=await keyResponse.json();const jwk=keys.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA');
  if(!jwk)throw Error('認証署名が見つかりません。');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw Error('署名が正しくありません。');
  return env.OWNER_EMAIL.trim().toLowerCase();
}
export async function onRequest({request,env}){
  if(!['GET','POST'].includes(request.method))return json({error:'許可されていない操作です。'},405);
  if(!env.DB||!env.TEAM_DOMAIN||!env.POLICY_AUD||!env.OWNER_EMAIL)return json({error:'Cloudflareの接続設定が未完了です。'},503);
  let owner;
  try{owner=await verifyAccess(request,env);}catch(e){return json({error:'本人認証を確認できません。Accessのログイン・設定をご確認ください。'},403);}
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
