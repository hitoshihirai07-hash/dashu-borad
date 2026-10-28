import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceFresh,workspaceValidate,workspaceChange,workspaceSetProjectVisibility,WORKSPACE_KEY} from '../src/workspace-model.js';
import {collectCloudData,validateCloudData,nonEmptyCloudData} from '../src/cloud-schema.js';
import {createWorkspace} from '../src/workspace.js';

const id=()=>`t-${Math.random().toString(36).slice(2)}`;
const uid=id;
function setupUI({initial=workspaceFresh(),records=[]}={}){
  const database=new Map([[WORKSPACE_KEY,JSON.stringify(initial)]]),listeners={},elements=new Map(),toasts=[];
  function element(){return {value:'',dataset:{},reset(){for(const x of Object.values(this.elements))x.value='';},showModal(){},close(){},querySelectorAll(){return[];},addEventListener(name,listener){this.handlers??={};this.handlers[name]=listener;}};}
  for(const key of ['#workspace-form','#workspace-dialog','#workspace-title','#workspace-form-error','#workspace-search'])elements.set(key,element());
  const form=elements.get('#workspace-form');form.elements={};
  for(const field of ['title','project','description','memo','body','detail','due','priority','status','category'])form.elements[field]=element();
  const original={document:globalThis.document,location:globalThis.location,window:globalThis.window};
  globalThis.document={querySelector:key=>elements.get(key),addEventListener:(name,listener)=>listeners[name]=listener};
  globalThis.location={hash:'#projects'};globalThis.window={innerWidth:1400};
  const storage={getItem:key=>database.get(key)??null,setItem:(key,value)=>database.set(key,value)};
  let renderCount=0;
  const ui=createWorkspace({storage,render:()=>renderCount++,toast:text=>toasts.push(text),getTimeRecords:()=>records,uid,localDate:()=> '2026-10-28',startRecord(){},icon:()=>'',escapeHTML:txt=>String(txt).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))});
  return {ui,database,toasts,renderCount:()=>renderCount,close(){Object.assign(globalThis,original);}};
}

test('legacy workspace defaults to visible and hidden names survive validation and cloud bundle',()=>{
  let w=workspaceFresh();delete w.hiddenProjects;
  const legacy=workspaceValidate(w);
  assert.deepEqual(legacy.hiddenProjects,[]);
  w=workspaceSetProjectVisibility(legacy,'以前の案件',false);
  assert.deepEqual(w.hiddenProjects,['以前の案件']);
  const stored={getItem:key=>key===WORKSPACE_KEY?JSON.stringify(w):null};
  const bundle=collectCloudData(stored);
  assert.equal(nonEmptyCloudData(bundle),true,'display preferences alone require backup care');
  assert.deepEqual(workspaceValidate(JSON.parse(validateCloudData(bundle).sections[WORKSPACE_KEY])).hiddenProjects,['以前の案件']);
  w=workspaceSetProjectVisibility(w,'以前の案件',false);
  assert.deepEqual(w.hiddenProjects,['以前の案件'],'repeated hide is idempotent');
  assert.deepEqual(workspaceSetProjectVisibility(w,'以前の案件',true).hiddenProjects,[]);
  for(const bad of [['X','X'],[''],[123],'X']) assert.throws(()=>workspaceValidate({...legacy,hiddenProjects:bad}),/不正/);
  assert.throws(()=>workspaceSetProjectVisibility(legacy,' ',false),/不正/);
});

test('hiding projects from time history does not remove tasks, notes, prompts or historical records',()=>{
  let w=workspaceFresh();
  w=workspaceChange(w,'tasks',{title:'動作確認',project:'過去の活動',status:'todo',priority:'normal'},'',id);
  w=workspaceChange(w,'notes',{title:'メモ',project:'過去の活動',body:'注意'},'',id);
  w=workspaceChange(w,'prompts',{title:'確認手順',project:'過去の活動',body:'確認'},'',id);
  const oldRecord={id:'rec1',project:'過去の活動',minutes:30,deleted:false,date:'2026-10-28',activity:'確認'};
  const h=setupUI({initial:w,records:[oldRecord]});
  try{
    assert(h.ui.projects().includes('data-workspace-select-project="過去の活動"'));
    h.ui.click({dataset:{workspaceManageProjects:'1'}});
    assert(h.ui.projects().includes('data-workspace-project-visibility="過去の活動"'));
    h.ui.click({dataset:{workspaceProjectVisibility:'過去の活動',visible:'false'}});
    assert(!h.ui.projects().includes('data-workspace-select-project="過去の活動"'));
    assert(!h.ui.visibleProjects().includes('過去の活動'));
    assert(h.ui.tasks().includes('動作確認'),'hidden project tasks remain accessible');
    assert.equal(h.ui.get().notes[0].body,'注意');
    assert.equal(h.ui.get().prompts[0].body,'確認');
    assert.deepEqual(h.ui.get().hiddenProjects,['過去の活動']);
    const saved=JSON.parse(h.database.get(WORKSPACE_KEY));
    assert.equal(saved.tasks[0].project,'過去の活動');
    assert.equal(oldRecord.minutes,30);
    h.ui.reload();assert(!h.ui.projects().includes('data-workspace-select-project="過去の活動"'));
    h.ui.click({dataset:{workspaceProjectVisibility:'過去の活動',visible:'true'}});
    assert(h.ui.projects().includes('data-workspace-select-project="過去の活動"'));
    assert.deepEqual(h.ui.get().hiddenProjects,[]);
  }finally{h.close();}
});

test('status changes directly from task rows and persists across reload without deleting task details',()=>{
  let w=workspaceChange(workspaceFresh(),'tasks',{title:'記事の確認',project:'観戦',status:'todo',priority:'high',detail:'記事をレビュー',memo:'確認箇所'},'',id);
  const h=setupUI({initial:w});
  try{
    const t=w.tasks[0];
    for(const label of [h.ui.tasks(),h.ui.home(),h.ui.projects()]){
      assert(label.includes(`data-workspace-status="${t.id}"`));
      assert(label.includes('<option value="doing"'));
    }
    assert.equal(h.ui.change({dataset:{workspaceStatus:t.id},value:'doing'}),true);
    assert.equal(h.ui.get().tasks[0].status,'doing');
    assert(h.ui.tasks().includes('option value="doing" selected'));
    h.ui.change({dataset:{workspaceStatus:t.id},value:'done'});
    assert.equal(h.ui.get().tasks[0].status,'done');
    assert(h.ui.tasks().includes('完了済み'));
    h.ui.reload();
    assert.equal(h.ui.get().tasks[0].status,'done');
    h.ui.change({dataset:{workspaceStatus:t.id},value:'todo'});
    assert.equal(h.ui.get().tasks[0].status,'todo');
    assert.equal(h.ui.get().tasks[0].memo,'確認箇所');
    assert.equal(h.ui.get().tasks[0].detail,'記事をレビュー');
    h.ui.change({dataset:{workspaceStatus:t.id},value:'invalid'});
    assert.equal(h.ui.get().tasks[0].status,'todo');
    assert.match(h.toasts.at(-1),/不正/);
  }finally{h.close();}
});

test('stale-tab changes to hidden projects or tasks block saving and reload latest data',()=>{
  let w=workspaceChange(workspaceFresh(),'tasks',{title:'確認',project:'案件',status:'todo',priority:'normal'},'',id);
  const h=setupUI({initial:w});
  try{
    const remote=workspaceSetProjectVisibility(w,'案件',false);
    h.database.set(WORKSPACE_KEY,JSON.stringify(remote));
    h.ui.change({dataset:{workspaceStatus:w.tasks[0].id},value:'done'});
    assert.deepEqual(JSON.parse(h.database.get(WORKSPACE_KEY)).hiddenProjects,['案件']);
    assert.equal(h.ui.get().tasks[0].status,'todo');
    assert.match(h.toasts.at(-1),/別のタブ/);
  }finally{h.close();}
});
