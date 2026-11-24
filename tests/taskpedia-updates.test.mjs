import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceFresh,workspaceChange,workspaceValidate,workspaceTaskProgress,workspaceTemplatePayload,workspaceEstimateSummary,workspaceTaskSort,workspaceSetTaskDate,workspaceToggleTaskStep,workspaceAdvanceTask,WORKSPACE_KEY} from '../src/workspace-model.js';
import {createWorkspace} from '../src/workspace.js';
let seq=0;const uid=()=> 'taskpedia-'+(++seq),day='2026-11-24';
const add=(w,extra={})=>workspaceChange(w,'tasks',{title:'記事',project:'観戦メモ',due:day,status:'todo',priority:'normal',...extra},'',uid);
test('optional estimate is validated, persists and is inherited by routine',()=>{
 let w=add(workspaceFresh());assert.equal(w.tasks[0].estimateMinutes,null);
 for(const v of [0,-1,1.5,1441,'30'])assert.throws(()=>add(workspaceFresh(),{estimateMinutes:v}),/見積もり/);
 w=add(workspaceFresh(),{estimateMinutes:30,repeat:{type:'daily',days:[],monthDay:null}});
 w=workspaceAdvanceTask(w,w.tasks[0].id,day,uid);
 assert.equal(workspaceValidate(JSON.parse(JSON.stringify(w))).tasks[1].estimateMinutes,30);
});
test('checklist progress follows first unfinished item, without completing parent',()=>{
 let w=add(workspaceFresh(),{steps:[{text:'調査',done:false},{text:'執筆',done:false}]});const id=w.tasks[0].id;
 assert.equal(workspaceTaskProgress(w.tasks[0]).next,'調査');
 w=workspaceToggleTaskStep(w,id,0,uid);assert.deepEqual(workspaceTaskProgress(w.tasks[0]),{done:1,total:2,next:'執筆'});
 w=workspaceToggleTaskStep(w,id,1,uid);assert.equal(w.tasks[0].status,'todo');assert.equal(workspaceTaskProgress(w.tasks[0]).next,'');
});
test('template copies estimate and resets checks without changing source',()=>{
 const t={title:'記事',project:'観戦メモ',detail:'本文',priority:'high',estimateMinutes:45,steps:[{text:'調査',done:true}]};
 const p=workspaceTemplatePayload(t);assert.equal(p.estimateMinutes,45);assert.equal(p.steps[0].done,false);assert.equal(t.steps[0].done,true);
});
test('daily summary counts selected tasks and recorded minutes, not waiting or deleted records',()=>{
 let w=add(workspaceFresh(),{estimateMinutes:20});w=add(w,{title:'AI',estimateMinutes:10,assignee:'ai'});w=add(w,{title:'待機',status:'waiting',estimateMinutes:60});w=add(w,{title:'未設定'});
 const [a,b]=w.tasks;
 const records=[{date:day,taskId:a.id,minutes:12},{date:day,taskId:b.id,minutes:3},{date:day,taskId:a.id,minutes:50,deleted:true},{date:'2026-11-23',taskId:b.id,minutes:90},{date:day,taskId:'other',minutes:80}];
 assert.deepEqual(workspaceEstimateSummary(w.tasks,records,day),{count:3,estimatedCount:2,estimated:30,actual:15});
});
test('date changes preserve history; name and estimate sorting',()=>{
 let w=add(workspaceFresh(),{title:'B',estimateMinutes:30});w=add(w,{title:'A',estimateMinutes:10});w=add(w,{title:'C'});
 assert.equal([...w.tasks].sort((a,b)=>workspaceTaskSort(a,b,'name'))[0].title,'A');
 assert.equal([...w.tasks].sort((a,b)=>workspaceTaskSort(a,b,'estimate')).at(-1).title,'C');
 const id=w.tasks[0].id;w=workspaceSetTaskDate(w,id,'2026-11-25',uid);assert.equal(w.tasks[0].dueHistory[0].from,day);
});
test('task UI renders inline controls, filtering and time summary; handlers update model',()=>{
 let w=add(workspaceFresh(),{title:'記事',estimateMinutes:20,steps:[{text:'調査',done:false},{text:'執筆',done:false}]});
 const id=w.tasks[0].id,store=new Map([[WORKSPACE_KEY,JSON.stringify(w)]]),prev=[globalThis.document,globalThis.location,globalThis.window],logs=[];
 globalThis.document={querySelector:()=>({addEventListener(){}}),addEventListener(){}};globalThis.location={hash:'#tasks'};globalThis.window={innerWidth:1200};
 try{
 const ui=createWorkspace({storage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},render(){},toast:x=>logs.push(x),escapeHTML:String,icon:()=>'',getTimeRecords:()=>[],uid,localDate:()=>day,startRecord(){}});
 ui.click({dataset:{taskOptions:'1'}});let page=ui.tasks();assert.match(page,/調査/);assert.match(page,/今日の見積もり/);assert.match(page,/workspace-task-sort/);
 ui.change({dataset:{workspaceStep:id,index:'0'},closest:()=>true});assert.match(ui.tasks(),/執筆/);
 ui.click({dataset:{workspaceInlineDate:id},closest:()=>({querySelector:()=>({value:'2026-11-25'})})});assert.equal(ui.get().tasks[0].due,'2026-11-25');
 ui.change({id:'workspace-status-filter',value:'doing'});assert.doesNotMatch(ui.tasks(),/執筆/);
 ui.click({dataset:{workspaceTaskClear:'1'}});assert.match(ui.tasks(),/執筆/);
 }finally{[globalThis.document,globalThis.location,globalThis.window]=prev;}
});

test('compact tabs separate waiting and completed tasks and preserve manual dates',()=>{let w=workspaceFresh();w=add(w,{title:'今日のタスク',due:day});w=add(w,{title:'待機のタスク',status:'waiting',due:''});w=add(w,{title:'完了のタスク',status:'done',due:day});const store=new Map([[WORKSPACE_KEY,JSON.stringify(w)]]);const previous=globalThis.document;globalThis.document={querySelector:()=>({addEventListener(){},querySelectorAll(){return []}}),addEventListener(){}};try{const ui=createWorkspace({storage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},render(){},toast(){},escapeHTML:String,icon:()=>'',getTimeRecords:()=>[],uid,localDate:()=>day,startRecord(){}});ui.change({id:'workspace-status-filter',value:'waiting'});assert.match(ui.tasks(),/待機のタスク/);assert.doesNotMatch(ui.tasks(),/完了のタスク/);ui.change({id:'workspace-status-filter',value:'done'});assert.match(ui.tasks(),/完了のタスク/);assert.doesNotMatch(ui.tasks(),/待機のタスク/);assert.equal(ui.get().tasks.find(x=>x.title==='今日のタスク').due,day);}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}});

test('date range and task status intersect in either selection order',()=>{
  const statuses=['todo','doing','waiting','someday','done'];
  const days={today:day,upcoming:'2026-12-01',undated:''};
  let w=workspaceFresh();
  for(const [range,due] of Object.entries(days)){
    for(const status of statuses)w=add(w,{title:range+' '+status,status,due});
  }
  const previous=globalThis.document;
  globalThis.document={querySelector:()=>({addEventListener(){}}),addEventListener(){}};
  try{
    const ui=createWorkspace({storage:{getItem:key=>key===WORKSPACE_KEY?JSON.stringify(w):null},render(){},toast(){},escapeHTML:String,icon:()=>'',getTimeRecords:()=>[],uid,localDate:()=>day});
    for(const reverse of [true,false]){
      for(const range of Object.keys(days)){
        for(const status of ['pending','all',...statuses]){
          const edits=[{id:'workspace-range',value:range},{id:'workspace-status-filter',value:status}];
          for(const edit of reverse?edits.reverse():edits)ui.change(edit);
          const html=ui.tasks();
          const ids=[...html.matchAll(/data-workspace-select-task="([^"]+)"/g)].map(m=>m[1]).sort();
          const expected=w.tasks.filter(t=>t.due===days[range]&&(status==='all'||(status==='pending'?t.status!=='done':t.status===status))).map(t=>t.id).sort();
          assert.deepEqual(ids,expected,range+' × '+status);
        }
      }
    }
  }finally{globalThis.document=previous;}
});
