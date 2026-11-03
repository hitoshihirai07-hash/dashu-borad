import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceFresh,workspaceChange,workspaceValidate,workspaceRecordReview,workspaceSetEventStatus,buildWorkspaceRequest,calendarItems} from '../src/workspace-model.js';
import {collectCloudData,nonEmptyCloudData,validateCloudData} from '../src/cloud-schema.js';
import {createWorkspace} from '../src/workspace.js';
let num=0;const uid=()=>`workflow-${++num}`;
const add=(state,type,fields)=>workspaceChange(state,type,fields,'',uid);
const base=()=>{
  let s=add(workspaceFresh(),'projects',{title:'サイト制作',project:'',goal:'公開する',doneCriteria:'スマホとPCで動作確認',currentState:'画面を試作中'});
  s=add(s,'tasks',{title:'トップ画面',project:'サイト制作',status:'doing',priority:'high',detail:'UIを仕上げる'});
  return s;
};
test('goal, current state, reviewed result and next action create a full handoff',()=>{
  let s=base(),taskId=s.tasks[0].id;
  const before=buildWorkspaceRequest({workspace:s,project:'サイト制作',taskId});
  assert.match(before,/【ゴール】\n公開する/);
  assert.match(before,/画面を試作中/);
  assert.match(before,/タスク進捗：0\/1件/);
  s=workspaceRecordReview(s,{project:'サイト制作',taskId,outcome:'トップ画面の修正が終わった',decisions:'追加機能は不要',issues:'スマホは未確認',nextAction:'スマホで最終確認',verified:false,completeTask:true,createNextTask:true},'2026-11-03',uid);
  assert.equal(s.reviews.length,1);
  assert.equal(s.tasks.length,2);
  assert.equal(s.tasks[0].status,'done');
  assert.equal(s.tasks[1].title,'スマホで最終確認');
  const after=buildWorkspaceRequest({workspace:s,project:'サイト制作',instruction:'未完了分だけ対応する'});
  for(const phrase of ['1/2件完了','スマホは未確認','追加機能は不要','スマホで最終確認','未完了分だけ対応する','トップ画面の修正が終わった'])assert(after.includes(phrase),phrase);
  assert(!after.includes('（確認済み）'));
  assert.deepEqual(workspaceValidate(JSON.parse(JSON.stringify(s))),s);
  const storage={getItem:key=>key==='toki-workspace-v1'?JSON.stringify(s):null};
  const cloud=collectCloudData(storage);validateCloudData(cloud);
  assert.equal(JSON.parse(cloud.sections['toki-workspace-v1']).reviews.length,1);
});
test('review refuses invalid links and never completes tasks if validation fails',()=>{
  const s=base(),tid=s.tasks[0].id;
  assert.throws(()=>workspaceRecordReview(s,{project:'別名',outcome:'完了'},'2026-11-03',uid),/見つかりません/);
  assert.throws(()=>workspaceRecordReview(s,{project:'サイト制作',taskId:'missing',outcome:'完了'},'2026-11-03',uid),/見つかりません/);
  assert.throws(()=>workspaceRecordReview(s,{project:'サイト制作',taskId:tid,outcome:'完了',createNextTask:true,nextAction:''},'2026-11-03',uid),/次のタスク名/);
  assert.equal(s.tasks[0].status,'doing');assert.equal(s.reviews.length,0);
});
test('past events remain planned until explicitly completed, then restore to pending',()=>{
  let s=add(workspaceFresh(),'events',{title:'会場に行く',date:'2026-10-30',time:'12:00',allDay:false,note:'持ち物確認'});
  const eventId=s.events[0].id;
  assert.equal(s.events[0].status,'todo');
  assert.equal(calendarItems(s,'2026-10-30','2026-10-30',{tasks:false,habits:false})['2026-10-30'][0].done,false);
  s=workspaceSetEventStatus(s,eventId,'done',uid);
  assert.equal(s.events[0].status,'done');assert.match(s.events[0].completedAt,/T/);
  assert.equal(calendarItems(s,'2026-10-30','2026-10-30',{tasks:false,habits:false})['2026-10-30'][0].done,true);
  s=workspaceSetEventStatus(s,eventId,'todo',uid);
  assert.equal(s.events[0].completedAt,'');
  assert.equal(s.events[0].status,'todo');
  assert.throws(()=>workspaceSetEventStatus(s,'missing','done',uid),/見つかりません/);
  assert.throws(()=>workspaceSetEventStatus(s,eventId,'skip',uid),/不正/);
});
test('backward compatibility: missing reviews, event status and current state are normalized',()=>{
  const old=base();delete old.reviews;delete old.projects[0].currentState;
  old.events=[{id:'e1',title:'旧予定',project:'',date:'2026-11-03',time:'',allDay:true,note:'',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'}];
  const restored=workspaceValidate(old);
  assert.deepEqual(restored.reviews,[]);assert.equal(restored.events[0].status,'todo');assert.equal(restored.projects[0].currentState,'');
  let r=workspaceFresh();r=add(r,'reviews',{title:'振り返り',project:'旧',outcome:'一件追加'});
  assert.equal(nonEmptyCloudData(collectCloudData({getItem:key=>key==='toki-workspace-v1'?JSON.stringify(r):null})),true);
});
test('UI renders project handoff and compact calendar event actions',()=>{
  const stored=base();const eventState=add(stored,'events',{title:'買い物',date:'2026-11-04',time:'10:30',allDay:false});
  const listeners={},dom=new Map();
  const el=()=>({value:'',checked:false,showModal(){},close(){},reset(){},querySelectorAll(){return[];},addEventListener(){},setAttribute(){}});
  for(const key of ['#workspace-form','#work-review-form','#workspace-dialog','#workspace-title','#work-review-error','#work-review-dialog','#workspace-form-error','#work-task-stage-field'])dom.set(key,el());
  const form=dom.get('#workspace-form');form.elements={};for(const n of ['title','project','stage','description','goal','doneCriteria','currentState','stages','memo','body','detail','due','priority','status','category','steps','repeatType','monthDay','pinned','reviewDate','waitingFor','startCondition','eventDate','allDay','eventTime','eventNote','eventStatus'])form.elements[n]=el();
  const previous={document:globalThis.document,window:globalThis.window,location:globalThis.location};
  globalThis.document={querySelector:sel=>dom.get(sel)||null,addEventListener:(name,fn)=>listeners[name]=fn};
  globalThis.window={innerWidth:1200};globalThis.location={hash:'#projects'};
  try{
    const memory=new Map([['toki-workspace-v1',JSON.stringify(eventState)]]);
    const ui=createWorkspace({storage:{getItem:key=>memory.get(key)||null,setItem:(key,v)=>memory.set(key,v)},render(){},toast(){},escapeHTML:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),icon:()=>'',getTimeRecords:()=>[],uid,localDate:()=> '2026-11-03',startRecord(){}});
    assert.match(ui.projects(),/現在地・課題/);
    assert.match(ui.projects(),/作業結果と次への引き継ぎ/);
    const home=ui.homeEvents();assert.match(home,/買い物/);assert.match(home,/data-workspace-event-status/);
    ui.click({dataset:{workspaceEventStatus:ui.get().events[0].id,status:'done'}});
    assert.equal(ui.get().events[0].status,'done');
  }finally{Object.assign(globalThis,previous);}
});
