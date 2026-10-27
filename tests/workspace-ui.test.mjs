import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace} from '../src/workspace.js';
import {WORKSPACE_KEY} from '../src/workspace-model.js';

function createUI(){
 const entries=new Map(),handlers={},root=new Map(),calls=[];
 const makeElement=()=>({value:'',textContent:'',innerHTML:'',dataset:{},hidden:false,showModal(){this.open=true;},close(){this.open=false;},focus(){},setSelectionRange(){},querySelectorAll(){return[];},reset(){for(const el of Object.values(this.elements))el.value='';},addEventListener(name,callback){this.handlers??={};this.handlers[name]=callback;}});
 for(const selector of ['#workspace-dialog','#workspace-form','#workspace-title','#workspace-form-error','#workspace-search'])root.set(selector,makeElement());
 const form=root.get('#workspace-form');form.elements={};
 for(const name of ['title','project','description','memo','body','detail','due','priority','status','category'])form.elements[name]=makeElement();
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
