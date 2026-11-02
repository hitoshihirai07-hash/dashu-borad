import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceFresh,workspaceValidate,workspaceChange,workspaceDelete,workspaceToggleFocus,calendarPeriod,calendarItems,workspaceSetTaskStatus,workspaceToggleHabit} from '../src/workspace-model.js';
import {collectCloudData,validateCloudData,nonEmptyCloudData} from '../src/cloud-schema.js';
import {createWorkspace} from '../src/workspace.js';
let nextId=0;const uid=()=>`new-${++nextId}`;
const task=(name,date='2026-11-02',status='todo',repeat=null)=>({title:name,project:'制作',due:date,status,priority:'normal',detail:'',steps:[],repeat});
test('backward compatible workspace and cloud schema preserve personal events and selected daily tasks',()=>{
 const legacy=workspaceFresh();delete legacy.events;delete legacy.focusDays;
 assert.deepEqual(workspaceValidate(legacy).events,[]);assert.deepEqual(workspaceValidate(legacy).focusDays,{});
 let w=workspaceChange(legacy,'events',{title:'東京ドームへ',date:'2026-11-15',time:'18:00',allDay:false,note:'応援グッズを持参'},'',uid);
 w=workspaceChange(w,'tasks',task('データ更新'),'',uid);
 w=workspaceToggleFocus(w,'2026-11-02',w.tasks[0].id);
 const storage={getItem:k=>k==='toki-workspace-v1'?JSON.stringify(w):null};
 const payload=collectCloudData(storage);assert.equal(nonEmptyCloudData(payload),true);validateCloudData(payload);
 const restored=workspaceValidate(JSON.parse(payload.sections['toki-workspace-v1']));
 assert.equal(restored.events[0].note,'応援グッズを持参');assert.deepEqual(restored.focusDays['2026-11-02'],[w.tasks[0].id]);
});
test('independent events can be edited and removed without changing tasks',()=>{
 let w=workspaceChange(workspaceFresh(),'tasks',task('記事更新'),'',uid);
 w=workspaceChange(w,'events',{title:'映画館へ行く',date:'2026-11-04',time:'',allDay:true,note:''},'',uid);
 const id=w.events[0].id;w=workspaceChange(w,'events',{title:'買い物',allDay:false,time:'13:30'},id,uid);
 assert.equal(w.events[0].title,'買い物');assert.equal(w.events[0].date,'2026-11-04');assert.equal(w.events[0].time,'13:30');
 w=workspaceDelete(w,'events',id);assert.equal(w.events.length,0);assert.equal(w.tasks.length,1);
});
test('invalid dates, invalid times and oversized notes are rejected for events',()=>{
 const base={title:'外出',date:'2026-11-05',allDay:false,time:''};
 for(const p of [{date:'2026-02-30'},{date:''},{time:'25:00'},{time:'10:99'},{allDay:true,time:'10:00'},{note:'a'.repeat(2001)}])
   assert.throws(()=>workspaceChange(workspaceFresh(),'events',{...base,...p},'',uid),/不正|文字数|入力/);
});
test('three daily focus tasks are independent from due dates, limit at three and can be unselected',()=>{
 let w=workspaceFresh();for(let i=0;i<4;i++)w=workspaceChange(w,'tasks',task(`タスク${i}`,'2027-03-15'),'',uid);
 const ids=w.tasks.map(t=>t.id);
 for(let i=0;i<3;i++)w=workspaceToggleFocus(w,'2026-11-02',ids[i]);
 assert.deepEqual(w.focusDays['2026-11-02'],ids.slice(0,3));
 assert.throws(()=>workspaceToggleFocus(w,'2026-11-02',ids[3]),/3件/);
 w=workspaceToggleFocus(w,'2026-11-02',ids[0]);w=workspaceToggleFocus(w,'2026-11-02',ids[3]);
 assert.deepEqual(w.focusDays['2026-11-02'],ids.slice(1));
 assert(w.tasks.every(t=>t.due==='2027-03-15'));
 w=workspaceDelete(w,'tasks',ids[2]);assert.deepEqual(w.focusDays['2026-11-02'],[ids[1],ids[3]]);
});
test('completed/stale selected tasks do not block a replacement, waiting tasks cannot be selected',()=>{
 let w=workspaceFresh();for(let i=0;i<4;i++)w=workspaceChange(w,'tasks',task(`仕事${i}`), '',uid);
 for(let i=0;i<3;i++)w=workspaceToggleFocus(w,'2026-11-02',w.tasks[i].id);
 w=workspaceSetTaskStatus(w,w.tasks[0].id,'done','2026-11-02',uid);
 w=workspaceToggleFocus(w,'2026-11-02',w.tasks[3].id);
 assert.equal(w.focusDays['2026-11-02'].length,3);assert(!w.focusDays['2026-11-02'].includes(w.tasks[0].id));
 w=workspaceSetTaskStatus(w,w.tasks[3].id,'waiting','2026-11-02',uid);
 assert.throws(()=>workspaceToggleFocus(w,'2026-11-02',w.tasks[3].id),/着手/);
});
test('calendar month/week boundaries are correct and tasks, events, habit checks co-exist',()=>{
 const month=calendarPeriod('month','2026-11-15');assert.deepEqual(month,{start:'2026-11-01',end:'2026-12-12'});
 assert.deepEqual(calendarPeriod('week','2026-11-02'),{start:'2026-11-01',end:'2026-11-07'});
 let w=workspaceChange(workspaceFresh(),'tasks',task('記事を書く'),'',uid);
 w=workspaceChange(w,'events',{title:'友人と会う',date:'2026-11-02',time:'19:00'},'',uid);
 w=workspaceToggleHabit(w,'2026-11-02','walk');
 const events=calendarItems(w,'2026-11-02','2026-11-02');
 assert(events['2026-11-02'].some(x=>x.kind==='task'));
 assert(events['2026-11-02'].some(x=>x.kind==='event'&&x.time==='19:00'));
 assert(events['2026-11-02'].some(x=>x.kind==='habit'&&x.count===1));
 assert(!calendarItems(w,'2026-11-02','2026-11-02',{events:false})['2026-11-02'].some(x=>x.kind==='event'));
});
test('waiting review date is not a due date and recurring projections are not persisted',()=>{
 let w=workspaceChange(workspaceFresh(),'tasks',{...task('公開待ち',''),'status':'waiting',reviewDate:'2026-11-03'},'',uid);
 w=workspaceChange(w,'tasks',task('週次','2026-11-01','todo',{type:'weekly',days:[0,3]}),'',uid);
 w=workspaceChange(w,'tasks',task('月末','2026-11-30','todo',{type:'monthly',monthDay:31}),'',uid);
 const count=w.tasks.length;
 const items=calendarItems(w,'2026-11-01','2026-12-31',{habits:false});
 assert(items['2026-11-03'].some(x=>x.kind==='review'));
 assert(!items['2026-11-03'].some(x=>x.kind==='task'&&x.title==='公開待ち'));
 assert(items['2026-11-04'].some(x=>x.kind==='task'&&x.title==='週次'&&x.virtual));
 assert(items['2026-12-31'].some(x=>x.kind==='task'&&x.title==='月末'&&x.virtual));
 assert.equal(w.tasks.length,count);
});

test('calendar, monthly habit grid, focus and event editor are connected in workspace UI',()=>{
 const map=new Map(),handlers={};
 const el=()=>({value:'',checked:false,hidden:false,textContent:'',innerHTML:'',dataset:{},showModal(){this.open=true;},close(){this.open=false;},querySelectorAll(){return[];},reset(){for(const x of Object.values(this.elements))x.value='';},addEventListener(k,v){this.handlers??={};this.handlers[k]=v;}});
 const nodes=new Map();for(const key of ['#workspace-dialog','#workspace-form','#workspace-title','#workspace-form-error','#work-event-time'])nodes.set(key,el());
 const form=nodes.get('#workspace-form');form.elements={};
 for(const name of ['title','project','description','body','detail','memo','due','priority','status','category','repeatType','monthDay','steps','pinned','eventDate','allDay','eventTime','eventNote','reviewDate','waitingFor','startCondition','url'])form.elements[name]=el();
 const oldDoc=globalThis.document,oldLoc=globalThis.location,oldWin=globalThis.window;
 globalThis.document={querySelector:k=>nodes.get(k)||null,addEventListener:(k,v)=>handlers[k]=v};globalThis.location={hash:'#calendar'};globalThis.window={innerWidth:1400};
 try{
  const ui=createWorkspace({storage:{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)},render(){},toast(){},escapeHTML:x=>String(x),icon:()=>'',getTimeRecords:()=>[],uid,localDate:()=> '2026-11-02',startRecord(){}});
  assert.match(ui.calendar(),/カレンダー/);assert.match(ui.habits(),/月間の習慣/);
  assert.equal(ui.click({dataset:{workspaceNewEvent:'2026-11-02'}}),true);
  form.elements.title.value='東京ドーム';form.elements.eventDate.value='2026-11-02';form.elements.eventTime.value='18:00';
  form.handlers.submit({preventDefault(){},currentTarget:form});
  assert.equal(ui.get().events[0].title,'東京ドーム');assert.match(ui.calendar(),/東京ドーム/);assert.match(ui.home(),/東京ドーム/);
  assert.equal(ui.click({dataset:{workspaceNewDatedTask:'2026-11-02'}}),true);
  form.elements.title.value='確認作業';form.elements.status.value='todo';form.elements.priority.value='normal';
  form.handlers.submit({preventDefault(){},currentTarget:form});
  assert.equal(ui.get().tasks.length,1);assert.equal(ui.get().tasks[0].due,'2026-11-02');
  ui.click({dataset:{workspaceFocus:ui.get().tasks[0].id}});assert.match(ui.home(),/今日やる3件/);assert.equal(ui.get().focusDays['2026-11-02'].length,1);
 }finally{globalThis.document=oldDoc;globalThis.location=oldLoc;globalThis.window=oldWin;}
});
