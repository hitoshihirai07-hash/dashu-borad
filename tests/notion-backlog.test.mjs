import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {onRequest} from '../functions/api/notion/backlog.js';
import {workspaceFresh,workspaceValidate} from '../src/workspace-model.js';
import {createNotionUI} from '../src/notion-ui.js';

const itemId='11111111-1111-4111-8111-111111111111';
const originalFetch=globalThis.fetch;
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function authorized(){
 const token='v2.'+'A'.repeat(43),key='__toki_session_v2__:'+createHash('sha256').update(token).digest('hex');
 return {request:new Request('https://example.test/api/notion/backlog',{headers:{Cookie:'toki_owner_session='+token}}),
  env:{NOTION_TOKEN:'test-only-secret',OWNER_EMAIL:'owner@example.com',LOGIN_PASSWORD:'unused',
    DB:{prepare(){return {bind(value){assert.equal(value,key);return {first:async()=>({payload:JSON.stringify({email:'owner@example.com',expires:Date.now()+60000})})};}};}}}};
}
test('candidate API requires authentication and exposes only actionable titles, without log dates',async()=>{
 const denied=await onRequest({request:new Request('https://example.test/api/notion/backlog'),env:{NOTION_TOKEN:'test',DB:{},OWNER_EMAIL:'a',LOGIN_PASSWORD:'b'}});
 assert.equal(denied.status,401);
 const {request,env}=authorized();
 assert.equal((await onRequest({request:new Request(request.url,{method:'POST',headers:request.headers}),env})).status,405);
 let requests=0;
 globalThis.fetch=async(url,options)=>{
  requests++;
  const body=JSON.parse(options.body);
  assert.equal(body.filter.select.equals,'対応可能');assert.equal(options.method,'POST');
  return reply({results:[
   {id:itemId,url:'https://www.notion.so/example',properties:{'名前':{title:[{plain_text:'対象A'}]},'状態':{select:{name:'対応可能'}},'日付':{date:{start:'2026-10-01'}}}},
   {id:'22222222-2222-4222-8222-222222222222',url:'https://www.notion.so/hidden',properties:{'名前':{title:[{plain_text:'保留B'}]},'状態':{select:{name:'保留'}}}}
  ],has_more:false});
 };
 try{
  const res=await onRequest({request,env});
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(requests,1);assert.deepEqual(data.items.map(x=>x.title),['対象A']);
  assert.equal(data.items[0].due,undefined);assert.equal(data.items[0].originalDate,undefined);
 }finally{globalThis.fetch=originalFetch;}
});
test('candidate tab fetches only on button; adoption requires date; adopted row becomes linked',async()=>{
 let tasks=[],calls=[],promoted=0,fetchCount=0;
 const workspace={get:()=>({tasks}),visibleProjects:()=>['サイト'],promoteNotionCandidate:record=>{
  if(!record.day)throw Error('実行日が必要です');
  if(tasks.some(t=>t.sourceNotionPage===record.id))throw Error('二重登録');
  promoted++;tasks=[...tasks,{id:'task-one',title:record.title,due:record.day,sourceNotionPage:record.id}];
 }};
 const notion=createNotionUI({escapeHTML:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),render(){},toast:v=>calls.push(v),workspace,cloud:{status:()=> 'ready',refresh(){}}});
 globalThis.fetch=async()=>{fetchCount++;return reply({items:[{id:itemId,title:'対象A',status:'対応可能',url:'https://www.notion.so/example'}]});};
 try{
  notion.click({dataset:{notionTab:'backlog'}});assert.equal(fetchCount,0);
  assert.match(notion.page(),/候補を取得・更新/);
  notion.click({dataset:{notionAction:'load-backlog'}});await flush();await flush();
  assert.equal(fetchCount,1);assert.match(notion.page(),/対象A/);
  const button=day=>({dataset:{notionPromote:itemId},closest:()=>({querySelector:selector=>({value:selector.includes('date')?day:'サイト'})})});
  notion.click(button(''));assert.equal(promoted,0);
  notion.click(button('2026-11-22'));assert.equal(promoted,1);
  notion.click(button('2026-11-22'));assert.equal(promoted,1);
  assert.equal(tasks[0].due,'2026-11-22');assert.match(notion.page(),/登録済み/);
 }finally{globalThis.fetch=originalFetch;}
});
test('older saved tasks remain valid without a Notion origin',()=>{
 assert.deepEqual(workspaceValidate(workspaceFresh()).tasks,[]);
});
