import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotionUI} from '../src/notion-ui.js';
import {onRequest as taskSync} from '../functions/api/notion/sync.js';
import {onRequest as memoApi} from '../functions/api/notion/memos.js';

const escapeHTML=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('Notion menu displays only local unfinished tasks and escapes titles',()=>{
 const workspace={get:()=>({tasks:[
  {id:'a',title:'確認 <script>alert(1)</script>',project:'作業',status:'todo',due:'2026-11-12'},
  {id:'b',title:'完了済み',project:'作業',status:'done',due:'2026-11-10'}
 ]})};
 const notion=createNotionUI({escapeHTML,render(){},toast(){},cloud:{status:()=> 'ready',refresh(){}},workspace});
 const html=notion.page();
 assert.match(html,/確認 &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
 assert.doesNotMatch(html,/完了済み/);
 assert.match(html,/data-workspace-status="a"/);
 assert.match(html,/Notionと同期/);
});

test('Notion task sync rejects missing Cloudflare secret instead of writing',async()=>{
 const request=new Request('https://example.test/api/notion/sync',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:'{}'});
 const response=await taskSync({request,env:{DB:{}}});
 assert.equal(response.status,503);
 assert.match((await response.json()).error,/NOTION_TOKEN/);
});

test('Notion memo API rejects missing Cloudflare secret',async()=>{
 const request=new Request('https://example.test/api/notion/memos');
 const response=await memoApi({request,env:{DB:{}}});
 assert.equal(response.status,503);
 assert.match((await response.json()).error,/NOTION_TOKEN/);
});
