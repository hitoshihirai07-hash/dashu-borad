import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {onRequest} from '../functions/api/notion/backlog.js';
import {workspaceFresh,workspaceValidate,WORKSPACE_KEY} from '../src/workspace-model.js';
import {createWorkspace} from '../src/workspace.js';
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
   {id:itemId,url:'https://www.notion.so/example',properties:{'名前':{title:[{plain_text:'対象A'}]},'状態':{select:{name:'対応可能'}},'日付':{date:{start:'2026-10-01'}},'AIプロンプト':{rich_text:[{plain_text:'指示A'},{plain_text:'\n確認する'}]}}},
   {id:'22222222-2222-4222-8222-222222222222',url:'https://www.notion.so/hidden',properties:{'名前':{title:[{plain_text:'保留B'}]},'状態':{select:{name:'保留'}}}}
  ],has_more:false});
 };
 try{
  const res=await onRequest({request,env});
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(requests,1);assert.deepEqual(data.items.map(x=>x.title),['対象A']);
  assert.equal(data.items[0].due,undefined);assert.equal(data.items[0].originalDate,undefined);assert.equal(data.items[0].prompt,'指示A\n確認する');
 }finally{globalThis.fetch=originalFetch;}
});
test('candidate tab fetches only on button; adoption requires date; adopted row becomes linked',async()=>{
 let tasks=[],calls=[],promoted=0,fetchCount=0;
 const workspace={get:()=>({tasks}),visibleProjects:()=>['サイト'],promoteNotionCandidate:record=>{
  if(!record.day)throw Error('実行日が必要です');
  if(tasks.some(t=>t.sourceNotionPage===record.id))throw Error('二重登録');
  promoted++;tasks=[...tasks,{id:'task-one',title:record.title,due:record.day,sourceNotionPage:record.id}];
 }};
 const notion=createNotionUI({escapeHTML:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),render(){},toast:v=>calls.push(v),workspace,cloud:{status:()=> 'ready',refresh(){}}});
 globalThis.fetch=async()=>{fetchCount++;return reply({items:[{id:itemId,title:'対象A',status:'対応可能',url:'https://www.notion.so/example',prompt:'AI指示 <script>危険</script>'}]});};
 try{
  notion.click({dataset:{notionTab:'backlog'}});assert.equal(fetchCount,0);
  assert.match(notion.page(),/候補を取得・更新/);
  notion.click({dataset:{notionAction:'load-backlog'}});await flush();await flush();
  assert.equal(fetchCount,1);assert.match(notion.page(),/対象A/);
  assert.match(notion.page(),/AIプロンプトを見る/);
  assert.match(notion.page(),/AI指示 &lt;script&gt;危険&lt;\/script&gt;/);
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

test('Notion prompt transfers to an adopted task and refresh updates only the prompt',()=>{
 let saved=0,seq=0,state=JSON.stringify(workspaceFresh());
 const previous={document:globalThis.document,location:globalThis.location,window:globalThis.window};
 globalThis.document={querySelector:()=>({addEventListener(){}}),addEventListener(){}};
 globalThis.location={hash:'#notion'};globalThis.window={innerWidth:1100};
 try{
  const workspace=createWorkspace({
   storage:{getItem:key=>key===WORKSPACE_KEY?state:null,setItem(key,v){if(key===WORKSPACE_KEY){state=v;saved++;}}},
   render(){},toast(){},icon:()=>'',escapeHTML:x=>String(x),getTimeRecords:()=>[],
   uid:()=> 'prompt-task-'+(++seq),localDate:()=> '2026-11-17',startRecord(){}
  });
  workspace.promoteNotionCandidate({id:itemId,title:'機動力型CPU',url:'https://www.notion.so/example',status:'対応可能',day:'2026-11-20',project:'ベンチからの一手',prompt:'最初の指示'});
  assert.equal(workspace.get().tasks[0].aiRequest,'最初の指示');
  assert.equal(workspace.refreshNotionCandidatePrompts([{id:itemId,prompt:'更新した指示'}]),1);
  assert.equal(workspace.get().tasks[0].aiRequest,'更新した指示');
  assert.equal(workspace.get().tasks[0].due,'2026-11-20');
  assert.equal(workspace.get().tasks[0].status,'todo');
  assert.equal(workspace.refreshNotionCandidatePrompts([{id:itemId,prompt:'更新した指示'}]),0);
  assert.equal(saved,2);
  assert.equal(workspace.refreshNotionCandidatePrompts([{id:itemId,prompt:''}]),1);
  assert.equal(workspace.get().tasks[0].aiRequest,'');
  assert.equal(workspace.get().tasks.length,1);
  assert.throws(()=>workspace.refreshNotionCandidatePrompts([{id:itemId,prompt:'あ'.repeat(4001)}]),/プロンプト/);
 }finally{
  for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
 }
});
