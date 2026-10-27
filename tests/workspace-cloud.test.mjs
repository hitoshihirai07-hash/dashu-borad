import test from 'node:test';import assert from 'node:assert/strict';
import {webcrypto,generateKeyPairSync,createSign} from 'node:crypto';
import {workspaceFresh,workspaceChange,workspaceValidate,workspaceDelete,taskBuckets} from '../src/workspace-model.js';
import {collectCloudData,validateCloudData,nonEmptyCloudData} from '../src/cloud-schema.js';
import {createCloudSync} from '../src/cloud-sync.js';
import {onRequest,verifyAccess} from '../functions/api/state.js';
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
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk=publicKey.export({format:'jwk'});Object.assign(jwk,{kid:'unit-test-key',alg:'RS256'});
const envBase={TEAM_DOMAIN:'https://demo.cloudflareaccess.com',POLICY_AUD:'test-audience',OWNER_EMAIL:'owner@example.com'};
const jwt=(overrides={})=>{
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const now=Math.floor(Date.now()/1000);
 const a=enc({alg:'RS256',typ:'JWT',kid:jwk.kid}),b=enc({iss:envBase.TEAM_DOMAIN,aud:[envBase.POLICY_AUD],email:envBase.OWNER_EMAIL,iat:now,exp:now+600,...overrides});
 const sign=createSign('RSA-SHA256');sign.update(`${a}.${b}`);return `${a}.${b}.${sign.sign(privateKey).toString('base64url')}`;
};
function fakeDb(){let row=null;return {prepare(sql){let args=[];return {bind(...v){args=v;return this;},async first(){return row?{revision:row.revision,payload:row.payload}:null;},async run(){if(sql.startsWith('INSERT')){if(row)return {meta:{changes:0}};row={revision:1,payload:args[1]};return {meta:{changes:1}};}if(sql.startsWith('UPDATE')){if(!row||args[3]!==row.revision)return {meta:{changes:0}};row={revision:row.revision+1,payload:args[0]};return {meta:{changes:1}};}throw Error('bad query');}};}};}
test('API requires valid signed Cloudflare JWT and owner email; atomic CAS rejects stale writes',async()=>{
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({keys:[jwk]});
 try{
 const env={...envBase,DB:fakeDb()};const base='https://example.pages.dev/api/state';
 const request=(method='GET',token='',body,origin='https://example.pages.dev')=>new Request(base,{method,headers:{...(token?{'cf-access-jwt-assertion':token}:{}),...(method==='POST'?{'Content-Type':'application/json','Origin':origin}:{})},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await onRequest({request:request(),env})).status,403);
 assert.equal((await onRequest({request:request('GET',jwt({email:'other@example.com'})),env})).status,403);
 assert.equal((await onRequest({request:request('GET',jwt({aud:['wrong']})),env})).status,403);
 const ok=jwt();const get=await onRequest({request:request('GET',ok),env});assert.deepEqual(await get.json(),{revision:0,payload:null});
 const body={baseRevision:0,payload:collectCloudData(store())};
 assert.equal((await onRequest({request:request('POST',ok,body,'https://attacker.invalid'),env})).status,403);
 const init=await onRequest({request:request('POST',ok,body),env});assert.equal(init.status,200);assert.equal((await init.json()).revision,1);
 assert.equal((await onRequest({request:request('POST',ok,body),env})).status,409);
 assert.equal((await (await onRequest({request:request('GET',ok),env})).json()).revision,1);
 }finally{globalThis.fetch=oldFetch;}
});
