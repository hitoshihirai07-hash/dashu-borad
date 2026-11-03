import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {workspaceFresh,workspaceValidate,workspaceChange,workspaceDelete,quickNoteTaskTitle,WORKSPACE_KEY} from '../src/workspace-model.js';
import {collectCloudData,nonEmptyCloudData,validateCloudData} from '../src/cloud-schema.js';
import {createWorkspace} from '../src/workspace.js';

let serial=0;const uid=()=>`id-${++serial}`;
const storage=(start={})=>{const data=new Map(Object.entries(start));return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),data};};

function uiHarness(){
 const saved=storage(),handlers={},nodes=new Map(),notices=[];
 const element=(props={})=>({value:'',textContent:'',innerHTML:'',hidden:false,dataset:{},...props,showModal(){this.open=true;},close(){this.open=false;},focus(){},setSelectionRange(){},querySelectorAll(){return[];},reset(){for(const field of Object.values(this.elements))field.value='';},addEventListener(name,fn){this.handlers??={};this.handlers[name]=fn;}});
 for(const id of ['#workspace-form','#workspace-dialog','#workspace-title','#workspace-form-error','#quick-note-dialog','#quick-note-edit-form','#quick-note-form-error','#work-quick-search'])nodes.set(id,element());
 const form=nodes.get('#workspace-form');form.elements={};
 for(const name of ['title','project','description','goal','doneCriteria','stages','body','detail','memo','due','priority','status','category','steps','repeatType','monthDay','pinned','reviewDate','waitingFor','startCondition','stage','url','eventDate','allDay','eventTime','eventNote'])form.elements[name]=element();
 const edit=nodes.get('#quick-note-edit-form');edit.id='quick-note-edit-form';edit.elements={body:element()};
 const previous={document:globalThis.document,location:globalThis.location,window:globalThis.window,confirm:globalThis.confirm};
 globalThis.document={querySelector:id=>nodes.get(id)??null,addEventListener:(name,fn)=>handlers[name]=fn};
 globalThis.location={hash:'#quick-notes'};
 globalThis.window={innerWidth:900};globalThis.confirm=()=>true;
 const ui=createWorkspace({storage:saved,render(){},toast:s=>notices.push(s),escapeHTML:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),icon:()=>'',getTimeRecords:()=>[],uid,localDate:()=> '2026-11-03',startRecord(){}});
 const submitQuick=body=>handlers.submit({target:{dataset:{workspaceQuickForm:'1'},matches:s=>s==='[data-workspace-quick-form]',elements:{body:{value:body}}},preventDefault(){}});
 const submitEdit=body=>{edit.elements.body.value=body;handlers.submit({target:edit,preventDefault(){}});};
 const submitTask=()=>form.handlers.submit({preventDefault(){},currentTarget:form});
 const restore=()=>{for(const [k,v] of Object.entries(previous))globalThis[k]=v;};
 return {ui,form,edit,nodes,saved,notices,submitQuick,submitEdit,submitTask,restore};
}

test('standalone memo data is optional for older backups and preserved alongside legacy project notes',()=>{
 let old=workspaceChange(workspaceFresh(),'notes',{title:'旧メモ',project:'プロ野球観戦メモ',body:'大切な旧メモ'},'',uid);
 delete old.quickNotes;
 const upgraded=workspaceValidate(old);
 assert.deepEqual(upgraded.quickNotes,[]);
 assert.equal(upgraded.notes[0].body,'大切な旧メモ');
 const note=workspaceChange(upgraded,'quickNotes',{body:'タイトル不要\nひとことメモ'},'',uid);
 assert.equal(note.quickNotes[0].body,'タイトル不要\nひとことメモ');
 assert.equal(note.notes[0].body,'大切な旧メモ');
 assert.equal(note.quickNotes[0].taskId,'');
 assert.match(note.quickNotes[0].createdAt,/^\d{4}-/);
});

test('quick note limits, ID uniqueness and task titles reject invalid inputs',()=>{
 const base=workspaceFresh();
 assert.throws(()=>workspaceChange(base,'quickNotes',{body:'  \n '},'',uid),/メモを入力/);
 assert.throws(()=>workspaceChange(base,'quickNotes',{body:'あ'.repeat(4001)},'',uid),/不正/);
 assert.throws(()=>workspaceValidate({...base,quickNotes:[{id:'n',body:'X',createdAt:'bad',updatedAt:'bad'}]}),/不正/);
 let w=workspaceChange(base,'quickNotes',{body:'hello'},'',uid);
 assert.throws(()=>workspaceValidate({...w,quickNotes:[...w.quickNotes,w.quickNotes[0]]}),/不正/);
 assert.equal(quickNoteTaskTitle('\n  節目記録の記事を確認  \n本文'),'節目記録の記事を確認');
 assert.equal(quickNoteTaskTitle('あ'.repeat(300)).length,160);
});

test('save, edit, search, conversion, task project selection and unlink on deletion',()=>{
 const h=uiHarness();try{
   assert.match(h.ui.quickHome(),/ひとことメモ/);
   assert.match(h.ui.quickNotesPage(),/プロジェクト指定なし/);
   h.submitQuick('Player Lensの節目記録を確認\n候補を記事で紹介');
   assert.equal(h.ui.get().quickNotes.length,1);
   assert.match(h.ui.quickHome(),/Player Lens/);
   const note=h.ui.get().quickNotes[0];
   assert.equal(note.createdAt,note.updatedAt);
   assert.equal(note.taskId,'');
   assert.equal(h.ui.click({dataset:{workspaceQuickEdit:note.id}}),true);
   assert.equal(h.edit.elements.body.value,note.body);
   h.submitEdit('Player Lensの節目記録を確認\n2027年向けに調査');
   assert.equal(h.ui.get().quickNotes[0].body,'Player Lensの節目記録を確認\n2027年向けに調査');
   assert.equal(h.ui.get().quickNotes[0].createdAt,note.createdAt);
   assert.equal(h.ui.click({dataset:{workspaceQuickToTask:note.id}}),true);
   assert.equal(h.form.elements.title.value,'Player Lensの節目記録を確認');
   assert.equal(h.form.elements.detail.value,h.ui.get().quickNotes[0].body);
   assert.equal(h.form.elements.project.value,'');
   h.form.elements.project.value='PlayerLens';
   h.form.elements.priority.value='normal';h.form.elements.status.value='todo';
   h.submitTask();
   const task=h.ui.get().tasks[0];
   assert.equal(task.project,'PlayerLens');
   assert.equal(task.detail,'Player Lensの節目記録を確認\n2027年向けに調査');
   assert.equal(h.ui.get().quickNotes[0].taskId,task.id);
   assert.match(h.ui.quickNotesPage(),/タスク化済み/);
   assert.match(h.ui.quickHome(),/タスクを開く/);
   assert.equal(h.ui.click({dataset:{workspaceQuickToTask:note.id}}),true);
   assert.equal(h.ui.get().tasks.length,1,'linked memo must not duplicate tasks');
   assert.equal(h.ui.click({dataset:{workspaceQuickOpenTask:task.id}}),true);
   assert.equal(globalThis.location.hash,'#tasks');
   h.ui.click({dataset:{workspaceQuickEdit:note.id}});
   h.submitEdit('本文だけ更新しても元のタスクは保持');
   assert.equal(h.ui.get().tasks[0].detail,'Player Lensの節目記録を確認\n2027年向けに調査');
   const afterDelete=workspaceDelete(h.ui.get(),'tasks',task.id);
   assert.equal(afterDelete.quickNotes[0].taskId,'');
   assert.equal(afterDelete.quickNotes[0].body,'本文だけ更新しても元のタスクは保持');
 }finally{h.restore();}
});

test('quick memo search, delete without task deletion and HTML escaping',()=>{
 const h=uiHarness();try{
   h.submitQuick('<img src=x onerror=alert(1)>');
   h.submitQuick('散歩のあとに思いついたこと');
   const html=h.ui.quickNotesPage();
   assert.doesNotMatch(html,/<img src=x/);
   assert.match(html,/&lt;img/);
   const search={id:'work-quick-search',value:'散歩',selectionStart:2,focus(){},setSelectionRange(){}};
   h.nodes.set('#work-quick-search',search);
   assert.equal(h.ui.input(search),true);
   assert.match(h.ui.quickNotesPage(),/散歩/);
   assert.doesNotMatch(h.ui.quickNotesPage(),/onerror/);
   assert.equal(h.ui.click({dataset:{workspaceQuickDelete:h.ui.get().quickNotes[0].id}}),true);
   assert.equal(h.ui.get().quickNotes.length,1);
 }finally{h.restore();}
});

test('quick notes are included in existing cloud backup without an extra section',()=>{
 const note=workspaceChange(workspaceFresh(),'quickNotes',{body:'思いつきだけ'},'',uid);
 const packed=collectCloudData(storage({[WORKSPACE_KEY]:JSON.stringify(note)}));
 assert.equal(nonEmptyCloudData(packed),true);
 assert.equal(validateCloudData(packed),packed);
 assert.equal(JSON.parse(packed.sections[WORKSPACE_KEY]).quickNotes[0].body,'思いつきだけ');
 assert.equal(Object.keys(packed.sections).length,6);
 const old={...note};delete old.quickNotes;
 const oldPacked=collectCloudData(storage({[WORKSPACE_KEY]:JSON.stringify(old)}));
 assert.doesNotThrow(()=>nonEmptyCloudData(oldPacked));
});

test('navigation and dashboard expose the memo page while keeping existing routes',()=>{
 const shell=readFileSync(new URL('../src/shell.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 for(const item of ['desktop-nav','mobile-nav']){
   const start=shell.indexOf(`<nav class="${item}"`),end=shell.indexOf('</nav>',start);
   assert.match(shell.slice(start,end),/href="#quick-notes" data-nav="quick-notes"/);
 }
 assert.match(app,/workspace\.quickHome\(\)/);
 assert.match(app,/'quick-notes':workspace\.quickNotesPage/);
 assert.match(shell,/id="quick-note-edit-form"/);
});
