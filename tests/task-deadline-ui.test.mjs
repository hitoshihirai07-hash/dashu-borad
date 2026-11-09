import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace} from '../src/workspace.js';
import {workspaceFresh,workspaceChange,workspaceValidate,workspaceRescheduleTask,workspaceSetTaskStatus,WORKSPACE_KEY} from '../src/workspace-model.js';

let idCounter=0;
const uid=()=>`deadline-${++idCounter}`;
const add=(w,title,due,status='todo',repeat=null)=>workspaceChange(w,'tasks',{title,project:'観戦メモ',due,status,priority:'normal',repeat},'',uid);

function makeUI(initial){
  const store=new Map([[WORKSPACE_KEY,JSON.stringify(initial)]]),logs=[];
  const originalDoc=globalThis.document,originalLocation=globalThis.location,originalWindow=globalThis.window;
  globalThis.document={querySelector:()=>({addEventListener(){}}),addEventListener(){}};
  globalThis.location={hash:'#tasks'};
  globalThis.window={innerWidth:1200};
  const ui=createWorkspace({storage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},render(){},toast:t=>logs.push(t),escapeHTML:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),icon:()=>'',getTimeRecords:()=>[],uid,localDate:()=> '2026-11-09',startRecord(){}});
  const close=()=>{globalThis.document=originalDoc;globalThis.location=originalLocation;globalThis.window=originalWindow;};
  return {ui,store,logs,close};
}

test('deadline only changes on explicit action, records original date and validates custom target',()=>{
 let w=add(workspaceFresh(),'更新遅れ','2026-11-01');
 const taskId=w.tasks[0].id;
 assert.equal(w.tasks[0].due,'2026-11-01');
 assert.deepEqual(workspaceValidate(w).tasks[0].dueHistory,[]);
 w=workspaceRescheduleTask(w,taskId,'2026-11-09',uid,'2026-11-09T01:00:00.000Z');
 assert.equal(w.tasks[0].due,'2026-11-09');
 assert.deepEqual(w.tasks[0].dueHistory,[{from:'2026-11-01',to:'2026-11-09',at:'2026-11-09T01:00:00.000Z'}]);
 w=workspaceRescheduleTask(w,taskId,'2026-11-10',uid,'2026-11-09T02:00:00.000Z');
 assert.equal(w.tasks[0].dueHistory[0].from,'2026-11-01');
 assert.equal(w.tasks[0].dueHistory.length,2);
 assert.throws(()=>workspaceRescheduleTask(w,taskId,'2026-11-31',uid),/日付/);
 assert.equal(workspaceRescheduleTask(w,taskId,'2026-11-10',uid).tasks[0].dueHistory.length,2);
 w=workspaceSetTaskStatus(w,taskId,'done','2026-11-09',uid);
 assert.throws(()=>workspaceRescheduleTask(w,taskId,'2026-11-12',uid),/未完了/);
});

test('recurring deadlines do not leak history to the next instance',()=>{
 let w=add(workspaceFresh(),'毎週確認','2026-11-02','todo',{type:'weekly',days:[1],monthDay:null});
 const taskId=w.tasks[0].id;
 w=workspaceRescheduleTask(w,taskId,'2026-11-09',uid);
 w=workspaceSetTaskStatus(w,taskId,'done','2026-11-09',uid);
 assert.equal(w.tasks.filter(t=>t.status==='done')[0].dueHistory.length,1);
 const pending=w.tasks.find(t=>t.status!=='done');
 assert.equal(pending.due,'2026-11-16');
 assert.deepEqual(pending.dueHistory,[]);
});

test('task and compact home show overdue warnings; reschedule buttons update without moving unrelated tasks',()=>{
 let w=workspaceFresh();
 w=add(w,'古い作業','2026-10-01');w=add(w,'昨日の作業','2026-11-08');w=add(w,'今日の作業','2026-11-09');
 w=add(w,'来週の作業','2026-11-17');w=add(w,'確認待ち','2026-11-01','waiting');
 const h=makeUI(w);
 try{
   const first=h.ui.tasks();
   assert.match(first,/期限を過ぎた未完了タスクが2件/);
   assert.match(first,/古い期限切れ/);
   assert.match(first,/今日・11月9日（月）/);
   assert.match(first,/明日・11月10日（火）/);
   assert.match(first,/来週以降/);
   assert.match(first,/data-workspace-reschedule=/);
   assert.match(h.ui.home(true),/期限を過ぎた未完了タスクが2件/);
   const id=w.tasks.find(t=>t.title==='昨日の作業').id;
   assert.equal(h.ui.click({dataset:{workspaceReschedule:id,targetDay:'2026-11-09'}}),true);
   assert.equal(h.ui.get().tasks.find(t=>t.id===id).due,'2026-11-09');
   assert.match(h.ui.tasks(),/期限を過ぎた未完了タスクが1件/);
   assert.equal(h.ui.get().tasks.find(t=>t.title==='確認待ち').due,'2026-11-01');
   const oldId=w.tasks.find(t=>t.title==='古い作業').id;
   assert.equal(h.ui.click({dataset:{workspaceRescheduleCustom:oldId},closest:()=>({querySelector:()=>({value:'2026-11-12'})})}),true);
   assert.equal(h.ui.get().tasks.find(t=>t.id===oldId).due,'2026-11-12');
   assert.doesNotMatch(h.ui.home(true),/期限を過ぎた未完了タスクが/);
   const persisted=JSON.parse(h.store.get(WORKSPACE_KEY));
   assert.equal(persisted.tasks.find(t=>t.id===oldId).dueHistory[0].from,'2026-10-01');
   h.ui.change({id:'workspace-status-filter',value:'done'});
   assert.match(h.ui.tasks(),/完了済み/);
 }finally{h.close();}
});

test('project task list uses the same date grouping, warns for overdue items and allows manual rescheduling',()=>{
 let w=workspaceFresh();
 w=add(w,'遅れているタスク','2026-11-08');
 w=add(w,'古い期限','2026-10-01');
 w=add(w,'明日のタスク','2026-11-10');
 w=add(w,'来週のタスク','2026-11-17');
 const h=makeUI(w);
 try{
   const html=h.ui.projects();
   assert.match(html,/期限を過ぎた未完了タスクが2件あります/);
   assert.match(html,/期限切れ・直近7日間/);
   assert.match(html,/古い期限切れ/);
   assert.match(html,/明日・11月10日（火）/);
   assert.match(html,/来週以降/);
   assert.match(html,/data-workspace-reschedule=/);
   const id=w.tasks.find(t=>t.title==='遅れているタスク').id;
   h.ui.click({dataset:{workspaceSelectTask:id}});
   assert.match(h.ui.projects(),/このタスクは期限を1日過ぎています/);
   assert.equal(h.ui.click({dataset:{workspaceReschedule:id,targetDay:'2026-11-09'}}),true);
   assert.equal(h.ui.get().tasks.find(t=>t.id===id).due,'2026-11-09');
   assert.match(h.ui.projects(),/期限を過ぎた未完了タスクが1件あります/);
   assert.doesNotMatch(h.ui.projects(),/このタスクは期限を1日過ぎています/);
 }finally{h.close();}
});

test('AI checked status has a readable detail layout and is not mistaken for task completion',()=>{
 let w=workspaceFresh();
 w=workspaceChange(w,'tasks',{title:'AIルーチン',project:'観戦メモ',due:'2026-11-08',status:'todo',priority:'normal',assignee:'ai',aiService:'ChatGPT',aiState:'done',aiRequestedAt:'2026-11-09T12:59:00.000Z',aiCheckedAt:'2026-11-09T12:59:10.000Z',repeat:{type:'daily',days:[],monthDay:null}},'',uid);
 const h=makeUI(w);
 try{
   const html=h.ui.tasks();
   assert.match(html,/class="work-ai-detail-layout"/);
   assert.match(html,/class="work-ai-detail-times"/);
   assert.match(html,/AIの確認は済んでいますが、このタスクはまだ未完了です/);
   assert.equal(h.ui.get().tasks[0].status,'todo');
 }finally{h.close();}
});
