import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace} from '../src/workspace.js';
import {WORKSPACE_KEY} from '../src/workspace-model.js';

function createUI(){
 const entries=new Map(),handlers={},root=new Map(),calls=[];
 const makeElement=()=>({value:'',textContent:'',innerHTML:'',dataset:{},hidden:false,showModal(){this.open=true;},close(){this.open=false;},focus(){},setSelectionRange(){},querySelectorAll(){return[];},reset(){for(const el of Object.values(this.elements))el.value='';},addEventListener(name,callback){this.handlers??={};this.handlers[name]=callback;}});
 for(const selector of ['#workspace-dialog','#workspace-form','#workspace-title','#workspace-form-error','#workspace-search'])root.set(selector,makeElement());
 const form=root.get('#workspace-form');form.elements={};
 for(const name of ['title','project','description','memo','body','detail','due','priority','status','category','repeatType','monthDay','steps','pinned'])form.elements[name]=makeElement();
 const oldDoc=globalThis.document,oldLoc=globalThis.location,oldWindow=globalThis.window;
 globalThis.document={querySelector:selector=>root.get(selector)||null,addEventListener:(name,callback)=>handlers[name]=callback};
 globalThis.location={hash:'#projects'};
 globalThis.window={innerWidth:1400};
 const state={getItem:key=>entries.get(key)??null,setItem:(key,v)=>entries.set(key,v)};
 let updates=0;
 const ui=createWorkspace({storage:state,render:()=>{updates++;},toast:s=>calls.push(s),icon:()=>'',escapeHTML:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),getTimeRecords:()=>[],uid:()=>String(Math.random()),localDate:()=> '2026-10-27',startRecord:args=>calls.push(args)});
 const close=()=>{globalThis.document=oldDoc;globalThis.location=oldLoc;globalThis.window=oldWindow;};
 return {entries,handlers,form,ui,calls,close,updates:()=>updates,submit:()=>form.handlers.submit({preventDefault(){},currentTarget:form}),noteSave:(type,dataset,text)=>handlers.submit({preventDefault(){},target:{matches:()=>true,dataset:{workspaceSaveNote:type,...dataset},elements:{memo:{value:text}}}})};
}

test('project/task create, inline notes, detail view and record-link actions work together',()=>{
 const h=createUI();try{
 h.ui.click({dataset:{workspaceNew:'projects'}});
 h.form.elements.title.value='ベンチからの一手';h.form.elements.description.value='采配ゲーム';h.form.elements.memo.value='プロジェクトの今後';h.submit();
 assert.equal(h.ui.get().projects[0].memo,'プロジェクトの今後');
 h.ui.click({dataset:{workspaceNewTask:'ベンチからの一手'}});
 h.form.elements.title.value='守備位置変更';h.form.elements.status.value='todo';h.form.elements.priority.value='normal';h.form.elements.memo.value='タスク注意';h.submit();
 const t=h.ui.get().tasks[0];assert.equal(t.project,'ベンチからの一手');
 const html=h.ui.projects();assert.match(html,/プロジェクトメモ|タスクメモ/);assert.match(html,/守備位置変更/);
 h.ui.click({dataset:{workspaceSelectTask:t.id}});
 assert.match(h.ui.projects(),/タスクメモ/);
 h.noteSave('tasks',{id:t.id},'作業途中のメモ');
 assert.equal(h.ui.get().tasks[0].memo,'作業途中のメモ');
 h.ui.click({dataset:{workspaceRecord:t.id}});
 assert.deepEqual(h.calls.at(-1),{project:'ベンチからの一手',taskId:t.id});
 h.ui.click({dataset:{workspaceOverview:'1'}});
 h.noteSave('projects',{project:'ベンチからの一手'},'プロジェクト方針を変更');
 assert.equal(h.ui.get().projects[0].memo,'プロジェクト方針を変更');
 assert(JSON.parse(h.entries.get(WORKSPACE_KEY)).tasks.some(x=>x.memo==='作業途中のメモ'));
}finally{h.close();}
});

test('habit UI updates only habits and keeps projects untouched',()=>{
 const h=createUI();try{
 assert.match(h.ui.habits(),/野球確認/);assert.match(h.ui.habits(),/今日の記録/);
 assert.equal(h.ui.change({dataset:{workspaceHabit:'walk',date:'2026-10-27'}}),true);
 assert.deepEqual(h.ui.get().habits['2026-10-27'],['walk']);
 assert.equal(h.ui.get().projects.length,0);
 assert.match(h.ui.habitHome(),/1\/4/);
 h.ui.change({dataset:{workspaceHabit:'walk',date:'2026-10-27'}});
 assert.equal(h.ui.get().habits['2026-10-27'],undefined);
}finally{h.close();}
});

test('project-scoped prompt can be created, pinned, filtered and copied without AI service',()=>{
 const h=createUI();try{
  h.ui.click({dataset:{workspaceNewPrompt:'PlayerLens'}});
  h.form.elements.title.value='調査用';h.form.elements.body.value='記事の根拠を確認';h.form.elements.pinned.checked=true;
  h.submit();
  const p=h.ui.get().prompts[0];
  assert.equal(p.project,'PlayerLens');assert.equal(p.pinned,true);
  assert.match(h.ui.prompts(),/記事の根拠を確認/);
  h.ui.change({id:'workspace-prompt-filter',value:'プロ野球観戦メモ'});
  assert.doesNotMatch(h.ui.prompts(),/記事の根拠を確認/);
  h.ui.change({id:'workspace-prompt-filter',value:'PlayerLens'});
  assert.match(h.ui.prompts(),/記事の根拠を確認/);
  h.ui.click({dataset:{workspacePin:p.id}});
  assert.equal(h.ui.get().prompts[0].pinned,false);
 }finally{h.close();}
});

test('save a task template and reuse it without modifying the original',()=>{
 const h=createUI();try{
  h.ui.click({dataset:{workspaceNew:'templates'}});
  h.form.elements.title.value='毎週振り返り';h.form.elements.project.value='プロ野球観戦メモ';h.form.elements.detail.value='一週間をまとめる';
  h.form.elements.priority.value='high';h.form.elements.steps.value='完了項目を確認\n来週の作業を決定';h.submit();
  const source=h.ui.get().templates[0];
  assert.deepEqual(source.steps.map(x=>x.text),['完了項目を確認','来週の作業を決定']);
  assert.match(h.ui.templates(),/この内容でタスク作成/);
  h.ui.click({dataset:{workspaceUseTemplate:source.id}});
  assert.equal(h.form.elements.title.value,'毎週振り返り');
  assert.equal(h.form.elements.steps.value,'完了項目を確認\n来週の作業を決定');
  h.form.elements.status.value='todo';h.submit();
  assert.equal(h.ui.get().tasks[0].title,'毎週振り返り');
  assert.equal(h.ui.get().tasks[0].steps.length,2);
  assert.equal(h.ui.get().templates.length,1);
  const id=h.ui.get().tasks[0].id;
  h.ui.change({dataset:{workspaceStep:id,index:'0'}});
  assert.equal(h.ui.get().tasks[0].steps[0].done,true);
  assert.equal(h.ui.get().templates[0].steps[0].done,false);
 }finally{h.close();}
});

test('task form creates weekly routine and completion creates next task through status dropdown',()=>{
 const h=createUI();try{
  h.form.querySelectorAll=selector=>selector==='[name="repeatDay"]:checked'?[{value:'0'},{value:'3'}]:[];
  h.ui.click({dataset:{workspaceNew:'tasks'}});
  h.form.elements.title.value='定例更新';h.form.elements.project.value='PlayerLens';h.form.elements.status.value='todo';h.form.elements.priority.value='normal';
  h.form.elements.repeatType.value='weekly';h.form.elements.steps.value='記事を見る';
  h.submit();
  const first=h.ui.get().tasks[0];
  assert.equal(first.due,'2026-10-28'); // Tuesday Oct 27 -> Wednesday Oct 28
  assert.deepEqual(first.repeat.days,[0,3]);
  h.ui.change({dataset:{workspaceStatus:first.id},value:'done'});
  const next=h.ui.get().tasks.find(t=>t.status!=='done');
  assert.equal(next.due,'2026-11-01');
  assert.equal(h.ui.get().tasks.length,2);
  assert.match(h.ui.tasks(),/ルーチン/);
 }finally{h.close();}
});
