import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceFresh,workspaceChange,workspaceValidate,workspaceAdvanceTask,projectTaskStats,buildWorkspaceRequest,WORKSPACE_KEY} from '../src/workspace-model.js';
import {createWorkspace} from '../src/workspace.js';
let counter=0;
const id=()=>`id-${++counter}`;
const add=(data,type,extra)=>workspaceChange(data,type,{title:extra.title,project:extra.project||'',...extra},'',id);

test('goals and ordered stages roundtrip through validation and existing workspace key',()=>{
 let s=workspaceFresh();
 s=add(s,'projects',{title:'Player Lens',goal:'通算記録の表示',doneCriteria:'表示を検証',stages:['調査','実装','公開']});
 s=add(s,'tasks',{title:'成績取得',project:'Player Lens',stage:'調査',status:'doing',priority:'normal'});
 let restored=workspaceValidate(JSON.parse(JSON.stringify(s)));
 assert.equal(restored.projects[0].goal,'通算記録の表示');
 assert.deepEqual(restored.projects[0].stages,['調査','実装','公開']);
 assert.equal(restored.tasks[0].stage,'調査');
 assert.equal(WORKSPACE_KEY,'toki-workspace-v1');
 assert.throws(()=>add(s,'projects',{title:'重複',stages:['調査','調査']}),/同じ名前/);
 assert.throws(()=>add(s,'projects',{title:'件数',stages:Array(13).fill('テスト')}),/12件/);
 assert.throws(()=>add(s,'tasks',{title:'長すぎる段階',stage:'x'.repeat(101),status:'todo',priority:'normal'}),/文字数/);
 const old=workspaceValidate({...workspaceFresh(),projects:[{id:'legacy',title:'旧プロジェクト',project:'',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'}]});
 assert.deepEqual(old.projects[0].stages,[]);
 assert.equal(old.projects[0].goal,'');
});

test('progress groups recurring history, ignores deleted records, and shows last recorded work date',()=>{
 let s=add(workspaceFresh(),'projects',{title:'制作',stages:['調査','実装']});
 s=add(s,'tasks',{title:'通常完了',project:'制作',stage:'調査',status:'done',priority:'normal'});
 s=add(s,'tasks',{title:'確認中',project:'制作',stage:'調査',status:'waiting',priority:'normal'});
 s=add(s,'tasks',{title:'ルーチン',project:'制作',stage:'実装',status:'todo',due:'2026-11-01',priority:'normal',repeat:{type:'daily',days:[],monthDay:null}});
 const routine=s.tasks.at(-1);
 s=workspaceAdvanceTask(s,routine.id,'2026-11-01',id);
 s=workspaceAdvanceTask(s,s.tasks.at(-1).id,'2026-11-02',id);
 const stats=projectTaskStats(s,'制作',[{date:'2026-10-31',minutes:30},{date:'2026-11-03',minutes:60}]);
 assert.deepEqual({total:stats.total,done:stats.done,waiting:stats.waiting,percent:stats.percent},{total:3,done:1,waiting:1,percent:33});
 assert.equal(stats.minutes,90);
 assert.equal(stats.lastDay,'2026-11-03');
 assert.deepEqual(stats.stages.map(x=>[x.title,x.done,x.total]),[['調査',1,2],['実装',0,1]]);
});

test('copy request includes chosen prompt and only explicitly selected daily link',()=>{
 let s=add(workspaceFresh(),'projects',{title:'Player Lens',goal:'通算の見える化',doneCriteria:'公開確認',stages:['下準備','実装']});
 s=add(s,'tasks',{title:'節目計算',project:'Player Lens',stage:'実装',status:'doing',priority:'normal',detail:'2000安打までの残り',memo:'最初に野手',steps:[{text:'確認',done:false}]});
 s=add(s,'prompts',{title:'実装用',project:'Player Lens',body:'動作確認も実施',category:'更新'});
 s=add(s,'links',{title:'公式記録',url:'https://example.com/official'});
 s=add(s,'links',{title:'個人リンク',url:'https://example.com/private'});
 const copied=buildWorkspaceRequest({workspace:s,project:'Player Lens',taskId:s.tasks[0].id,promptId:s.prompts[0].id,linkId:s.links[0].id});
 for(const word of ['通算の見える化','公開確認','節目計算','2000安打までの残り','動作確認も実施','https://example.com/official'])assert(copied.includes(word));
 assert(!copied.includes('https://example.com/private'));
 assert(!copied.includes('個人リンク'));
 assert(!buildWorkspaceRequest({workspace:s,project:'Player Lens'}).includes('2000安打'));
 assert.throws(()=>buildWorkspaceRequest({workspace:s,project:'別プロジェクト',taskId:s.tasks[0].id}),/見つかりません/);
});

test('workspace project form saves goal and stage linkage, displays progress and copy action; stage rename preserves link',()=>{
 const memory=new Map(),doc=new Map(),callbacks={},messages=[];
 const element=()=>({value:'',textContent:'',innerHTML:'',hidden:false,checked:false,showModal(){},close(){},querySelectorAll(){return[];},reset(){},addEventListener(n,fn){this.handlers??={};this.handlers[n]=fn;}});
 for(const id of ['#workspace-form','#workspace-dialog','#workspace-title','#workspace-form-error','#work-task-stage-field'])doc.set(id,element());
 const form=doc.get('#workspace-form');form.elements={};
 for(const name of ['title','project','stage','description','goal','doneCriteria','stages','memo','body','detail','due','priority','status','category','steps','repeatType','monthDay','pinned','reviewDate','waitingFor','startCondition'])form.elements[name]=element();
 const previous={document:globalThis.document,window:globalThis.window,location:globalThis.location};
 globalThis.document={querySelector:s=>doc.get(s)||null,addEventListener:(event,cb)=>callbacks[event]=cb};
 globalThis.location={hash:'#projects'};globalThis.window={innerWidth:1400};
 try{
  const ui=createWorkspace({storage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},render(){},toast:m=>messages.push(m),escapeHTML:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),icon:()=>'',getTimeRecords:()=>[{project:'制作',minutes:30,date:'2026-11-03',deleted:false}],uid:id,localDate:()=> '2026-11-03',startRecord(){}});
  ui.click({dataset:{workspaceNew:'projects'}});
  Object.assign(form.elements.title,{value:'制作'});
  form.elements.goal.value='改善';form.elements.doneCriteria.value='動作確認';form.elements.stages.value='準備\n実装';
  form.handlers.submit({preventDefault(){},currentTarget:form});
  assert.deepEqual(ui.get().projects[0].stages,['準備','実装']);
  ui.click({dataset:{workspaceAddStageTask:'準備',project:'制作'}});
  assert.equal(form.elements.project.value,'制作');assert.match(form.elements.stage.innerHTML,/準備/);form.elements.stage.value='準備';
  form.elements.title.value='新しい画面';form.elements.status.value='todo';form.elements.priority.value='normal';
  form.handlers.submit({preventDefault(){},currentTarget:form});
  assert.equal(ui.get().tasks[0].stage,'準備');
  ui.click({dataset:{workspaceOverview:'1'}});
  const html=ui.projects();
  assert.match(html,/改善/);assert.match(html,/進捗サマリー/);assert.match(html,/最終作業日/);assert.match(html,/AI作業依頼文の一括コピー/);assert.match(html,/新しい画面/);
  ui.click({dataset:{workspaceEdit:`projects:${ui.get().projects[0].id}`}});
  form.elements.stages.value='調査\n実装';form.handlers.submit({preventDefault(){},currentTarget:form});
  assert.equal(ui.get().tasks[0].stage,'調査');
  assert.deepEqual(ui.get().projects[0].stages,['調査','実装']);
  assert.equal(messages.at(-1),'保存しました。');
 }finally{Object.assign(globalThis,previous);}
});
