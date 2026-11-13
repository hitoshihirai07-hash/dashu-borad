import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createNotionUI} from '../src/notion-ui.js';
import {onRequest as memoApi} from '../functions/api/notion/memos.js';

const escapeHTML=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const memoId='11111111-1111-4111-8111-111111111111';
const dataSource='32e161ee-c2f3-462a-9ff8-aaeccee3488e';
const originalFetch=globalThis.fetch;
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

function authRequest(url){
 const token='v2.'+'A'.repeat(43);
 const key='__toki_session_v2__:'+createHash('sha256').update(token).digest('hex');
 return {
  request:new Request(url,{headers:{Cookie:'toki_owner_session='+token}}),
  env:{NOTION_TOKEN:'test-only-secret',OWNER_EMAIL:'owner@example.com',LOGIN_PASSWORD:'unused',
   DB:{prepare(){return {bind(value){assert.equal(value,key);return {first:async()=>({payload:JSON.stringify({email:'owner@example.com',expires:Date.now()+60000})})};}};}}}
 };
}
function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}

test('memo page endpoint rejects unauthenticated requests and malformed IDs',async()=>{
 const denied=await memoApi({request:new Request('https://example.test/api/notion/memos?page_id='+memoId),env:{NOTION_TOKEN:'test',DB:{},OWNER_EMAIL:'a',LOGIN_PASSWORD:'b'}});
 assert.equal(denied.status,401);
 const {request,env}=authRequest('https://example.test/api/notion/memos?page_id=nope');
 const invalid=await memoApi({request,env});
 assert.equal(invalid.status,400);
});

test('memo page endpoint reads nested Notion blocks and rejects pages from other databases',async()=>{
 const {request,env}=authRequest('https://example.test/api/notion/memos?page_id='+memoId);
 const calls=[];
 globalThis.fetch=async (url,opts)=>{
  const u=String(url);calls.push(u);
  assert.equal(opts.headers.Authorization,'Bearer test-only-secret');
  if(u.endsWith('/pages/'+memoId))return response({id:memoId,parent:{data_source_id:dataSource},url:'https://www.notion.so/example',last_edited_time:'2026-11-13T00:00:00Z'});
  if(u.includes('/blocks/'+memoId+'/children?'))return response({results:[
   {id:'22222222-2222-4222-8222-222222222222',type:'heading_2',heading_2:{rich_text:[{plain_text:'秋季キャンプ'}]},has_children:false},
   {id:'33333333-3333-4333-8333-333333333333',type:'bulleted_list_item',bulleted_list_item:{rich_text:[{plain_text:'練習内容'}]},has_children:true}
  ],has_more:false});
  if(u.includes('/blocks/33333333-3333-4333-8333-333333333333/children?'))return response({results:[
   {id:'44444444-4444-4444-8444-444444444444',type:'to_do',to_do:{rich_text:[{plain_text:'確認'}],checked:true},has_children:false}
  ],has_more:false});
  throw Error('unexpected API URL '+u);
 };
 try{
  const res=await memoApi({request,env});assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.blocks[0].runs[0].text,'秋季キャンプ');
  assert.equal(data.blocks[1].children[0].checked,true);
  assert.equal(data.truncated,false);
  assert.equal(calls.length,3);
 }finally{globalThis.fetch=originalFetch;}
 globalThis.fetch=async()=>response({id:memoId,parent:{data_source_id:'other'},url:''});
 try{
  const blocked=await memoApi({request,env});assert.equal(blocked.status,403);
 }finally{globalThis.fetch=originalFetch;}
});

test('memo list allows viewing and closing safely escaped read-only page text',async()=>{
 const notion=createNotionUI({escapeHTML,render(){},toast(){},workspace:{get:()=>({tasks:[]})},cloud:{status:()=> 'ready',refresh(){}}});
 globalThis.fetch=async url=>{
  const u=String(url);
  if(u.includes('?page_id='))return response({blocks:[
   {id:'one',type:'heading_2',runs:[{text:'本文 <script>alert(1)</script>',bold:true}],children:[]},
   {id:'two',type:'to_do',runs:[{text:'確認済み'}],checked:true,children:[]}
  ],truncated:false});
  return response({items:[{id:memoId,title:'秋季キャンプ',body:'短い内容',category:'野球',createdAt:'2026-11-13T00:00:00Z',editedAt:'2026-11-13T00:00:00Z'}]});
 };
 try{
  notion.click({dataset:{notionTab:'memos'}});
  await flush();await flush();
  assert.match(notion.page(),/ページ本文を見る/);
  notion.click({dataset:{notionBody:memoId}});
  await flush();await flush();
  const html=notion.page();
  assert.match(html,/本文 &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
  assert.match(html,/type="checkbox" disabled checked/);
  assert.match(html,/本文を閉じる/);
  notion.click({dataset:{notionBody:memoId}});
  assert.doesNotMatch(notion.page(),/確認済み/);
 }finally{globalThis.fetch=originalFetch;}
});
