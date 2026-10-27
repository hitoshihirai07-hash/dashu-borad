// Single-owner session authentication for Cloudflare Pages Functions.
// Credentials and signing secret are configured ONLY in Cloudflare encrypted secrets.
const encoder=new TextEncoder();
const cookieName='toki_owner_session';
const sessionSeconds=60*60*12;
const json=(data,status=200,extras={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extras}});
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const decode=text=>{const bytes=atob(text.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(bytes,c=>c.charCodeAt(0));};
function config(env){
 if(!env.OWNER_EMAIL||!env.LOGIN_PASSWORD||!env.SESSION_SECRET||String(env.LOGIN_PASSWORD).length<12||String(env.SESSION_SECRET).length<32)throw Error('ログイン設定が未完了です。');
 return {email:String(env.OWNER_EMAIL).trim().toLowerCase(),password:String(env.LOGIN_PASSWORD),secret:String(env.SESSION_SECRET)};
}
function sameOrigin(request){return request.headers.get('Origin')===new URL(request.url).origin;}
async function hmacKey(secret){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function passwordMatches(supplied,expected){
 // Equal-length digests avoid leaking the first mismatching character.
 const [actual,wanted]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(supplied)),crypto.subtle.digest('SHA-256',encoder.encode(expected))]);
 const a=new Uint8Array(actual),b=new Uint8Array(wanted);let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a[i]^b[i];return mismatch===0;
}
function cookie(token,maxAge){return `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;}
async function issueSession(env){const {email,secret}=config(env);const expiry=Math.floor(Date.now()/1000)+sessionSeconds,nonce=encode(crypto.getRandomValues(new Uint8Array(16)));
 const message=`v1.${expiry}.${nonce}.${email}`,signature=encode(new Uint8Array(await crypto.subtle.sign('HMAC',await hmacKey(secret),encoder.encode(message))));
 return cookie(`v1.${expiry}.${nonce}.${signature}`,sessionSeconds);
}
export async function verifySession(request,env){const {email,secret}=config(env);const token=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 if(!token)return null;const chunks=token.split('.');if(chunks.length!==4||chunks[0]!=='v1'||!/^\d{10,12}$/.test(chunks[1])||! /^[\w-]{20,40}$/.test(chunks[2])||! /^[\w-]{40,60}$/.test(chunks[3]))return null;
 const expiry=Number(chunks[1]);if(expiry<=Math.floor(Date.now()/1000)||expiry>Math.floor(Date.now()/1000)+sessionSeconds)return null;
 try{const message=`v1.${expiry}.${chunks[2]}.${email}`;const valid=await crypto.subtle.verify('HMAC',await hmacKey(secret),decode(chunks[3]),encoder.encode(message));return valid?email:null;}catch{return null;}
}
async function rateKey(request){const ip=request.headers.get('CF-Connecting-IP')||'unknown';const hash=await crypto.subtle.digest('SHA-256',encoder.encode(ip));return '__login_attempts__:'+encode(new Uint8Array(hash)).slice(0,43);}
async function getThrottle(env,key){const row=await env.DB.prepare('SELECT payload FROM app_state WHERE owner=?').bind(key).first();try{return row?JSON.parse(row.payload):{count:0,until:0};}catch{return {count:0,until:0};}}
async function updateThrottle(env,key,data){await env.DB.prepare('INSERT INTO app_state (owner, revision, payload, updated_at) VALUES (?,0,?,?) ON CONFLICT(owner) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind(key,JSON.stringify(data),new Date().toISOString()).run();}
export async function loginRequest(request,env){
 if(request.method!=='POST')return json({error:'許可されていない操作です。'},405);
 if(!sameOrigin(request))return json({error:'別のサイトからログインできません。'},403);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({error:'入力形式が不正です。'},415);
 let settings;try{settings=config(env);}catch{return json({error:'ログイン設定が未完了です。'},503);}
 if(!env.DB)return json({error:'データベースに接続できません。'},503);
 try{
  const raw=await request.text();if(raw.length>4096)return json({error:'入力が長すぎます。'},413);
  let data;try{data=JSON.parse(raw);}catch{return json({error:'入力形式が不正です。'},400);}
  const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
  const password=typeof data.password==='string'?data.password:'';
  if(email.length>254||password.length>2000)return json({error:'入力が長すぎます。'},400);
  const key=await rateKey(request);const throttle=await getThrottle(env,key),now=Date.now();
  if(throttle.until>now)return json({error:'失敗が続いたため、しばらくログインできません。'},429);
  const validPassword=await passwordMatches(password,settings.password);
  if(email!==settings.email||!validPassword){
   const count=(throttle.until&&throttle.until<now?0:throttle.count||0)+1;
   await updateThrottle(env,key,{count,until:count>=5?now+15*60*1000:0});
   return json({error:'メールアドレスまたはパスワードが違います。'},401);
  }
  await env.DB.prepare('DELETE FROM app_state WHERE owner=?').bind(key).run();
  return json({authenticated:true,email:settings.email},200,{'Set-Cookie':await issueSession(env)});
 }catch{return json({error:'ログインを完了できませんでした。'},503);}
}
export async function sessionRequest(request,env){if(request.method!=='GET')return json({error:'許可されていない操作です。'},405);
 try{const owner=await verifySession(request,env);return owner?json({authenticated:true,email:owner}):json({authenticated:false},401);}catch{return json({error:'ログイン設定が未完了です。'},503);}}
export async function logoutRequest(request,env){if(request.method!=='POST')return json({error:'許可されていない操作です。'},405);
 if(!sameOrigin(request))return json({error:'別のサイトからログアウトできません。'},403);
 return json({authenticated:false},200,{'Set-Cookie':cookie('',0)});
}
