import test from 'node:test';import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {workspaceFresh,workspaceChange,workspaceValidate,workspaceDelete,taskBuckets} from '../src/workspace-model.js';
import {collectCloudData,validateCloudData,nonEmptyCloudData} from '../src/cloud-schema.js';
import {createCloudSync} from '../src/cloud-sync.js';
import {onRequest as stateRequest} from '../functions/api/state.js';
import {onRequest as loginRequest} from '../functions/api/login.js';
import {onRequest as sessionRequest} from '../functions/api/session.js';
import {onRequest as logoutRequest} from '../functions/api/logout.js';
import {verifySession} from '../src/server-auth.js';
import {fresh,revise,uid} from '../src/model.js';
const store=(starting={})=>{const m=new Map(Object.entries(starting));return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),map:m};};
const day='2026-10-27';
const savedRecord=()=>revise(null,{date:day,field:'プロ野球',project:'SNS',activity:'記事',minutes:30,note:'',deleted:false});
const withRecord=()=>store({'toki-records-v1':JSON.stringify({...fresh(),records:[savedRecord()]})});
test('workspace CRUD, deadline buckets, optional classification and validation',()=>{
 let w=workspaceFresh();w=workspaceChange(w,'projects',{title:'PlayerLens',project:'',description:'分析'},'',uid);
 w=workspaceChange(w,'tasks',{title:'修正',project:'PlayerLens',status:'doing',priority:'high',due:'2026-10-26',detail:'表示'},'',uid);
 w=workspaceChange(w,'notes',{title:'アイデア',body:'一言',project:''},'',uid);
 w=workspaceChange(w,'prompts',{title:'調査',body:'内容',category:'SNS',project:'PlayerLens'},'',uid);
 assert.equal(taskBuckets(w.tasks,day).overdue.length,1);assert.equal(workspaceValidate(w).prompts[0].category,'SNS');
 w=workspaceChange(w,'tasks',{status:'done'},w.tasks[0].id,uid);assert.equal(taskBuckets(w.tasks,day).done.length,1);
 w=workspaceDelete(w,'notes',w.notes[0].id);assert.equal(w.notes.length,0);
 assert.throws(()=>workspaceChange(w,'tasks',{status:'unknown'},w.tasks[0].id,uid),/不正/);
});
test('cloud schema protects time, life, steps, presets and workspace; default bundle valid',()=>{
 const data=collectCloudData(store());assert.equal(data.format,'toki-cloud-state-v1');assert.equal(nonEmptyCloudData(data),false);
 assert.equal(nonEmptyCloudData(collectCloudData(withRecord())),true);
 const changed=structuredClone(data);changed.sections['toki-workspace-v1']='{}';assert.throws(()=>validateCloudData(changed));
});
test('cloud client preserves local data until explicit initial upload, then safely synchronizes',async()=>{
 const local=withRecord();let server=null,revision=0;
 const fetcher=async(_url,opt)=>{
  if(opt.method==='GET')return Response.json({revision,payload:server});
  const body=JSON.parse(opt.body);if(body.baseRevision!==revision)return Response.json({error:'競合'}, {status:409});
  server=body.payload;revision++;return Response.json({revision});
 };
 const backups=[],updates=[];
 const c=createCloudSync({storage:local,fetcher,api:'/api/state',loc:{protocol:'https:'},download:(str)=>backups.push(str),onApply(){},onStatus:(s)=>updates.push(s)});
 await c.init();assert.equal(c.status(),'setup');assert.equal(server,null);
 c.backup();await c.act('start');assert.equal(c.status(),'ready');assert.equal(revision,1);assert.equal(backups.length,1);
 const old=local.getItem('toki-records-v1');c.setItem('toki-records-v1',old.replace('記事','記事改定'));
 assert.equal(c.status(),'dirty');await new Promise(resolve=>setTimeout(resolve,350));assert.equal(c.status(),'ready');assert.match(server.sections['toki-records-v1'],/記事改定/);
});
test('concurrent cloud clients CAS detects conflict and keeps local unsent data',async()=>{
 const initial=collectCloudData(store());let server=initial,revision=1;
 const fetcher=async(_url,opt)=>{if(opt.method==='GET')return Response.json({revision,payload:server});const req=JSON.parse(opt.body);if(req.baseRevision!==revision)return Response.json({error:'競合'}, {status:409});server=req.payload;revision++;return Response.json({revision});};
 const local=store(),c=createCloudSync({storage:local,fetcher,loc:{protocol:'https:'},download(){},onApply(){},onStatus(){}});
 await c.init();assert.equal(c.status(),'ready');revision++;
 const before=local.getItem('toki-records-v1')||JSON.stringify(fresh());c.setItem('toki-records-v1',before.replace('"records":[]','"records":[ ]'));
 await new Promise(r=>setTimeout(r,350));assert.equal(c.status(),'conflict');assert.equal(local.getItem('toki-records-v1').includes('[ ]'),true);
});
const envBase={OWNER_EMAIL:'owner@example.com',LOGIN_PASSWORD:'correct horse battery staple',SESSION_SECRET:'an-extremely-long-random-session-secret-for-tests'};
function fakeDb(){const rows=new Map();return {prepare(sql){let args=[];return {bind(...v){args=v;return this;},async first(){const row=rows.get(args[0]);return row?{revision:row.revision,payload:row.payload}:null;},async run(){
   if(sql.startsWith('DELETE')){const existed=rows.delete(args[0]);return {meta:{changes:Number(existed)}};}
   if(sql.startsWith('INSERT')&&sql.includes('ON CONFLICT(owner) DO UPDATE')){rows.set(args[0],{revision:0,payload:args[1]});return {meta:{changes:1}};}
   if(sql.startsWith('INSERT')){if(rows.has(args[0]))return {meta:{changes:0}};rows.set(args[0],{revision:1,payload:args[1]});return {meta:{changes:1}};}
   if(sql.startsWith('UPDATE')){const row=rows.get(args[2]);if(!row||args[3]!==row.revision)return {meta:{changes:0}};rows.set(args[2],{revision:row.revision+1,payload:args[0]});return {meta:{changes:1}};}
   throw Error(`unexpected SQL: ${sql}`);
  }};},rows};}
const base='https://example.pages.dev';
function loginReq(email,password,origin=base){return new Request(base+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.1'},body:JSON.stringify({email,password})});}
function req(path,method='GET',cookie='',body=null,origin=base){return new Request(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(method==='POST'?{Origin:origin,'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
test('site login: email/password authenticate; secure HttpOnly cookie grants session and logout clears it',async()=>{
 const env={...envBase,DB:fakeDb()};
 assert.equal((await loginRequest({request:loginReq(env.OWNER_EMAIL,'wrong'),env})).status,401);
 assert.equal((await loginRequest({request:loginReq(env.OWNER_EMAIL,env.LOGIN_PASSWORD,'https://evil.invalid'),env})).status,403);
 const response=await loginRequest({request:loginReq(env.OWNER_EMAIL,env.LOGIN_PASSWORD),env});assert.equal(response.status,200);
 const setCookie=response.headers.get('Set-Cookie');assert.match(setCookie,/HttpOnly; Secure; SameSite=Lax/);
 const cookie=setCookie.split(';')[0];const authenticated=await sessionRequest({request:req('/api/session','GET',cookie),env});assert.deepEqual(await authenticated.json(),{authenticated:true,email:env.OWNER_EMAIL});
 const failed=await sessionRequest({request:req('/api/session'),env});assert.equal(failed.status,401);
 const logout=await logoutRequest({request:req('/api/logout','POST',cookie),env});assert.equal(logout.status,200);assert.match(logout.headers.get('Set-Cookie'),/Max-Age=0/);
});
test('server refuses forged/expired sessions and blocks unauthorized state; CAS blocks stale writes',async()=>{
 const env={...envBase,DB:fakeDb()};
 const denied=await stateRequest({request:req('/api/state'),env});assert.equal(denied.status,401);
 const logged=await loginRequest({request:loginReq(env.OWNER_EMAIL,env.LOGIN_PASSWORD),env});const cookie=logged.headers.get('Set-Cookie').split(';')[0];
 assert.equal(await verifySession(req('/api/state','GET',cookie),env),env.OWNER_EMAIL);
 const forged=cookie.slice(0,-1)+(cookie.endsWith('a')?'b':'a');assert.equal((await stateRequest({request:req('/api/state','GET',forged),env})).status,401);
 const ok=await stateRequest({request:req('/api/state','GET',cookie),env});assert.deepEqual(await ok.json(),{revision:0,payload:null});
 const body={baseRevision:0,payload:collectCloudData(store())};
 assert.equal((await stateRequest({request:req('/api/state','POST',cookie,body,'https://evil.invalid'),env})).status,403);
 const init=await stateRequest({request:req('/api/state','POST',cookie,body),env});assert.equal(init.status,200);assert.equal((await init.json()).revision,1);
 assert.equal((await stateRequest({request:req('/api/state','POST',cookie,body),env})).status,409);
 assert.equal((await (await stateRequest({request:req('/api/state','GET',cookie),env})).json()).revision,1);
});
test('login rate limit after five incorrect attempts (15 minute block)',async()=>{
 const env={...envBase,DB:fakeDb()};
 for(let i=0;i<5;i++)assert.equal((await loginRequest({request:loginReq(env.OWNER_EMAIL,'incorrect'),env})).status,401);
 assert.equal((await loginRequest({request:loginReq(env.OWNER_EMAIL,env.LOGIN_PASSWORD),env})).status,429);
});
