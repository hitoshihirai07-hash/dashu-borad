import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceFresh,workspaceChange,workspaceValidate,nextRoutineDate,firstRoutineDate,workspaceAdvanceTask,workspaceSetTaskStatus,workspaceToggleTaskStep} from '../src/workspace-model.js';
import {collectCloudData,validateCloudData,nonEmptyCloudData} from '../src/cloud-schema.js';
let num=0;const uid=()=>`id-${++num}`;
const baseTask={title:'週次レビュー',project:'ときの記録',due:'2026-11-01',status:'todo',priority:'normal',detail:'内容を確認',memo:'作業中の気付き',steps:[{text:'タスク整理',done:true},{text:'振り返り',done:false}],repeat:{type:'weekly',days:[0,3],monthDay:null}};
test('multiple weekdays and month-end recurrence use calendar dates (not 24-hour offsets)',()=>{
 assert.equal(firstRoutineDate({type:'weekly',days:[0,3]},'2026-10-29'),'2026-11-01');
 assert.equal(nextRoutineDate({type:'weekly',days:[0,3]},'2026-10-29'),'2026-11-01');
 assert.equal(nextRoutineDate({type:'weekly',days:[0,3]},'2026-11-01'),'2026-11-04');
 assert.equal(firstRoutineDate({type:'daily'},'2026-10-29'),'2026-10-29');
 assert.equal(nextRoutineDate({type:'daily'},'2026-12-31'),'2027-01-01');
 assert.equal(firstRoutineDate({type:'monthly',monthDay:31},'2026-02-01'),'2026-02-28');
 assert.equal(nextRoutineDate({type:'monthly',monthDay:31},'2028-01-31'),'2028-02-29');
 assert.equal(nextRoutineDate({type:'monthly',monthDay:31},'2026-02-28'),'2026-03-31');
});
test('complete a recurring task once: archive original + next uncompleted, clear working notes and checkboxes',()=>{
 let w=workspaceChange(workspaceFresh(),'tasks',baseTask,'',uid);const original=w.tasks[0].id;
 w=workspaceSetTaskStatus(w,original,'done','2026-10-29',uid);
 assert.equal(w.tasks.length,2);
 const history=w.tasks.find(t=>t.id===original),next=w.tasks.find(t=>t.status!=='done');
 assert.equal(history.status,'done');assert.equal(history.steps[0].done,true);assert.equal(history.memo,'作業中の気付き');
 assert.equal(history.repeat,null);assert.equal(next.repeat.type,'weekly');assert.equal(next.due,'2026-11-04');
 assert.equal(next.memo,'');assert.deepEqual(next.steps.map(s=>s.done),[false,false]);
 assert.equal(next.routineId,original);assert.equal(history.routineId,original);
 w=workspaceSetTaskStatus(w,original,'done','2026-10-29',uid);assert.equal(w.tasks.length,2);
 w=workspaceSetTaskStatus(w,next.id,'doing','2026-11-04',uid);
 w=workspaceSetTaskStatus(w,next.id,'done','2026-11-04',uid);
 assert.equal(w.tasks.filter(t=>t.status!=='done').length,1);
 assert.equal(w.tasks.find(t=>t.status!=='done').due,'2026-11-08');
});
test('skipping runs creates next date; previous incomplete occurrences never multiply',()=>{
 let w=workspaceChange(workspaceFresh(),'tasks',{...baseTask,due:'2026-10-25'},'',uid);
 assert.equal(w.tasks.length,1); // No background creation of missed tasks
 w=workspaceAdvanceTask(w,w.tasks[0].id,'2026-11-14',uid,true);
 assert.equal(w.tasks.length,2);
 assert.equal(w.tasks[0].skipped,true);
 assert.equal(w.tasks[1].due,'2026-11-15');
 assert.equal(w.tasks[1].status,'todo');
});
test('task steps persist checks; template edits and cloud roundtrip preserve prompts and templates',()=>{
 let w=workspaceFresh();
 w=workspaceChange(w,'templates',{title:'週報テンプレート',project:'PlayerLens',priority:'high',detail:'まとめ',steps:[{text:'確認',done:false},{text:'投稿',done:false}]},'',uid);
 w=workspaceChange(w,'prompts',{title:'記事用',project:'PlayerLens',body:'要点をまとめる',category:'記事',pinned:true},'',uid);
 w=workspaceChange(w,'tasks',{title:'定型',project:'PlayerLens',due:'',priority:'high',status:'todo',detail:'',steps:w.templates[0].steps},'',uid);
 w=workspaceToggleTaskStep(w,w.tasks[0].id,0,uid);
 assert.deepEqual(w.tasks[0].steps.map(s=>s.done),[true,false]);
 assert.equal(w.templates[0].steps[0].done,false);
 const storage={getItem:k=>k==='toki-workspace-v1'?JSON.stringify(w):null};
 const data=collectCloudData(storage);
 assert.equal(nonEmptyCloudData(data),true);validateCloudData(data);
 const restored=workspaceValidate(JSON.parse(data.sections['toki-workspace-v1']));
 assert.equal(restored.prompts[0].pinned,true);assert.equal(restored.templates[0].steps.length,2);
});
test('legacy workspace (no templates/checklist/repeat/pin) can still be read and edited',()=>{
 let legacy=workspaceFresh();
 delete legacy.templates;
 legacy.tasks=[{id:'old-task',title:'旧タスク',project:'',due:'',status:'todo',priority:'normal',detail:'',memo:'',createdAt:'2026-10-20T00:00:00.000Z',updatedAt:'2026-10-20T00:00:00.000Z'}];
 legacy.prompts=[{id:'old-prompt',title:'旧プロンプト',project:'',body:'文章',category:'',createdAt:'2026-10-20T00:00:00.000Z',updatedAt:'2026-10-20T00:00:00.000Z'}];
 const normalized=workspaceValidate(legacy);
 assert.deepEqual(normalized.templates,[]);
 assert.deepEqual(normalized.tasks[0].steps,[]);
 assert.equal(normalized.tasks[0].repeat,null);
 assert.equal(normalized.prompts[0].pinned,false);
});
test('invalid recurrence, duplicate weekdays and oversized steps are rejected',()=>{
 for(const repeat of [{type:'weekly',days:[]},{type:'weekly',days:[1,1]},{type:'monthly',monthDay:32},{type:'nonsense'}]){
  assert.throws(()=>workspaceChange(workspaceFresh(),'tasks',{...baseTask,repeat},'',uid),/不正|曜日/);
 }
 assert.throws(()=>workspaceChange(workspaceFresh(),'templates',{title:'長い',steps:Array.from({length:31},()=>({text:'a',done:false}))},'',uid),/件数/);
});
