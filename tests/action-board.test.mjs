import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace} from '../src/workspace.js';
import {WORKSPACE_KEY,workspaceFresh,workspaceChange,workspaceSetTaskDate} from '../src/workspace-model.js';

let serial=0;
const uid=()=> 'action-'+(++serial);
const add=(s,title,due,status='todo')=>workspaceChange(s,'tasks',{title,project:'プロジェクト',due,status,priority:'normal'},'',uid);
function uiHarness(initial){
  const store=new Map([[WORKSPACE_KEY,JSON.stringify(initial)]]);
  const previous={document:globalThis.document,location:globalThis.location,window:globalThis.window};
  globalThis.document={querySelector:()=>({addEventListener(){}}),addEventListener(){}};
  globalThis.location={hash:'#dashboard'};
  globalThis.window={innerWidth:1100};
  const calls=[];
  const ui=createWorkspace({storage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},render(){},toast:v=>calls.push(v),icon:()=>'',escapeHTML:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),getTimeRecords:()=>[],uid,localDate:()=> '2026-11-16',startRecord(){}});
  return {ui,store,calls,close(){for(const [k,v] of Object.entries(previous)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}};
}
test('action board groups actionable tasks by day without moving old deadlines',()=>{
  let w=workspaceFresh();
  w=add(w,'今日の仕事','2026-11-16');
  w=add(w,'明日の仕事','2026-11-17');
  w=add(w,'翌週の仕事','2026-11-23');
  w=add(w,'期限超過','2026-11-01');
  w=add(w,'日付未定','');
  w=add(w,'待機中','2026-11-16','waiting');
  const h=uiHarness(w);
  try{
    assert.match(h.ui.actionBoard(),/今日の仕事/);
    assert.match(h.ui.actionBoard(),/期限を過ぎた未完了タスクが1件/);
    assert.equal(h.ui.get().tasks.find(t=>t.title==='期限超過').due,'2026-11-01');
    h.ui.click({dataset:{workspaceActionView:'tomorrow'}});
    assert.match(h.ui.actionBoard(),/明日の仕事/);
    h.ui.click({dataset:{workspaceActionView:'week'}});
    assert.match(h.ui.actionBoard(),/今週の残り|明日の仕事/);
    assert.doesNotMatch(h.ui.actionBoard(),/翌週の仕事/);
    h.ui.click({dataset:{workspaceActionView:'undated'}});
    assert.match(h.ui.actionBoard(),/日付未定/);
    assert.doesNotMatch(h.ui.actionBoard(),/待機中/);
  }finally{h.close();}
});
test('undated tasks can be scheduled; existing due history and completion still work',()=>{
  let w=workspaceFresh();
  w=add(w,'未定','');
  w=add(w,'変更','2026-11-16');
  w=add(w,'保留','2026-11-16','waiting');
  const h=uiHarness(w);
  try{
    const id=h.ui.get().tasks.find(t=>t.title==='未定').id;
    assert.equal(h.ui.click({dataset:{workspaceActionMove:id},closest:()=>({querySelector:()=>({value:'2026-11-18'})})}),true);
    assert.equal(h.ui.get().tasks.find(t=>t.id===id).due,'2026-11-18');
    assert.equal(h.ui.get().tasks.find(t=>t.id===id).dueHistory.length,0);
    const moveId=h.ui.get().tasks.find(t=>t.title==='変更').id;
    h.ui.click({dataset:{workspaceActionMove:moveId},closest:()=>({querySelector:()=>({value:'2026-11-19'})})});
    assert.deepEqual(h.ui.get().tasks.find(t=>t.id===moveId).dueHistory.map(x=>x.from),['2026-11-16']);
    h.ui.change({dataset:{workspaceStatus:id},value:'done'});
    assert.equal(h.ui.get().tasks.find(t=>t.id===id).status,'done');
    assert.throws(()=>workspaceSetTaskDate(h.ui.get(),id,'2026-11-20',uid),/未完了/);
    assert.throws(()=>workspaceSetTaskDate(h.ui.get(),h.ui.get().tasks.find(t=>t.title==='保留').id,'2026-11-20',uid),/未完了/);
    h.ui.change({id:'workspace-action-date',value:'2026-11-19'});
    assert.match(h.ui.actionBoard(),/変更/);
    assert.equal(JSON.parse(h.store.get(WORKSPACE_KEY)).tasks.find(t=>t.id===moveId).due,'2026-11-19');
  }finally{h.close();}
});
