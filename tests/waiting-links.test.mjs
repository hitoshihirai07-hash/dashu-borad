import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceFresh,workspaceValidate,workspaceChange,workspaceDelete,workspaceMoveLink,workspaceSetTaskStatus,taskBuckets,WORKSPACE_KEY} from '../src/workspace-model.js';
import {collectCloudData,nonEmptyCloudData,validateCloudData} from '../src/cloud-schema.js';
import {createWorkspace} from '../src/workspace.js';
let serial=0;
const uid=()=>`new-${++serial}`;
const task={title:'2027年のデータ更新',project:'Player Lens',due:'',status:'waiting',priority:'normal',reviewDate:'2027-03-01',waitingFor:'公式データ公開待ち',startCondition:'公開後に更新',detail:'作業内容',memo:'保存したメモ'};

test('legacy workspaces gain empty links and optional waiting fields without changing existing records',()=>{
  const legacy=workspaceFresh();delete legacy.links;
  legacy.tasks=[{id:'legacy',title:'旧作業',project:'',due:'',status:'todo',priority:'normal',createdAt:'2026-10-20T00:00:00Z',updatedAt:'2026-10-20T00:00:00Z'}];
  const result=workspaceValidate(legacy);
  assert.deepEqual(result.links,[]);
  assert.deepEqual([result.tasks[0].reviewDate,result.tasks[0].waitingFor,result.tasks[0].startCondition],['','','']);
  assert.equal(result.tasks[0].title,'旧作業');
});

test('waiting/someday tasks stay out of due/active buckets, with review reminder only when due',()=>{
  let w=workspaceChange(workspaceFresh(),'tasks',task,'',uid);
  w=workspaceChange(w,'tasks',{...task,title:'いつか着手',status:'someday',reviewDate:''},'',uid);
  w=workspaceChange(w,'tasks',{...task,title:'作業可能（期限未定）',status:'todo',reviewDate:''},'',uid);
  const b=taskBuckets(w.tasks,'2027-03-02');
  assert.deepEqual([b.waiting.length,b.someday.length,b.review.length,b.undated.length,b.today.length,b.overdue.length],[1,1,1,1,0,0]);
  assert.equal(b.upcoming.length,0);
  const waitingId=w.tasks[0].id;
  w=workspaceSetTaskStatus(w,waitingId,'todo','2027-03-02',uid);
  assert.equal(w.tasks[0].status,'todo');
  assert.equal(w.tasks[0].waitingFor,'公式データ公開待ち');
  assert.equal(taskBuckets(w.tasks,'2027-03-02').review.length,0);
});

test('recurring tasks cannot be put in a deferred status, but existing normal recurrence remains safe',()=>{
  let w=workspaceChange(workspaceFresh(),'tasks',{title:'日次点検',status:'todo',priority:'normal',due:'2026-11-01',repeat:{type:'daily',days:[],monthDay:null}},'',uid);
  assert.throws(()=>workspaceSetTaskStatus(w,w.tasks[0].id,'waiting','2026-11-01',uid),/繰り返し/);
  assert.equal(w.tasks[0].status,'todo');
  assert.throws(()=>workspaceChange(w,'tasks',{status:'someday'},w.tasks[0].id,uid),/組み合わせ/);
  assert.throws(()=>workspaceChange(workspaceFresh(),'tasks',{...task,reviewDate:'2027-02-30'},'',uid),/不正/);
});

test('daily links are validated, reordered, edited, deleted and cloud-backed',()=>{
  let w=workspaceFresh();
  w=workspaceChange(w,'links',{title:'観戦メモ',url:'https://pro-baseball-watch-guide.com/'},'',uid);
  w=workspaceChange(w,'links',{title:'Notion',url:'https://www.notion.so/'},'',uid);
  const first=w.links[0].id;
  w=workspaceMoveLink(w,first,'down');
  assert.deepEqual(w.links.map(x=>x.title),['Notion','観戦メモ']);
  w=workspaceChange(w,'links',{url:'https://pro-baseball-watch-guide.com/player-lens/'},first,uid);
  assert.equal(w.links[1].title,'観戦メモ');
  const storage={getItem:k=>k===WORKSPACE_KEY?JSON.stringify(w):null};
  const backup=collectCloudData(storage);
  assert.equal(nonEmptyCloudData(backup),true);
  assert.equal(validateCloudData(backup).sections[WORKSPACE_KEY],JSON.stringify(w));
  assert.equal(workspaceValidate(JSON.parse(backup.sections[WORKSPACE_KEY])).links.length,2);
  w=workspaceDelete(w,'links',first);
  assert.deepEqual(w.links.map(x=>x.title),['Notion']);
  for(const url of ['javascript:alert(1)','data:text/html,hi','file:///etc/passwd','https://user:secret@example.com','https://','not a url','ftp://site.test/']){
    assert.throws(()=>workspaceChange(w,'links',{title:'危険なリンク',url},'',uid),/URL/);
  }
  assert.throws(()=>workspaceChange(w,'links',{title:'長い',url:'https://'+'x'.repeat(2048)+'.com'},'',uid),/不正/);
});

test('only registered link records count as meaningful local data for cloud setup',()=>{
  const base=workspaceFresh();
  assert.equal(nonEmptyCloudData(collectCloudData({getItem:k=>k===WORKSPACE_KEY?JSON.stringify(base):null})),false);
  const withLink=workspaceChange(base,'links',{title:'リンク',url:'https://example.org/'},'',uid);
  assert.equal(nonEmptyCloudData(collectCloudData({getItem:k=>k===WORKSPACE_KEY?JSON.stringify(withLink):null})),true);
});

test('task UI reminds about review dates and link UI can add and reorder from suggestions',()=>{
  const state=new Map(),toasts=[],elements=new Map();
  const el=()=>({value:'',dataset:{},hidden:false,reset(){for(const n of Object.values(this.elements))n.value='';},showModal(){},close(){},querySelectorAll(){return[];},addEventListener(name,fn){this.handlers??={};this.handlers[name]=fn;}});
  for(const selector of ['#workspace-dialog','#workspace-form','#workspace-title','#workspace-form-error','#workspace-search','#workspace-wait-fields'])elements.set(selector,el());
  const form=elements.get('#workspace-form');form.elements={};
  for(const name of ['title','project','description','body','detail','memo','due','priority','status','category','repeatType','monthDay','steps','pinned','url','reviewDate','waitingFor','startCondition'])form.elements[name]=el();
  const prev={document:globalThis.document,window:globalThis.window,location:globalThis.location};
  globalThis.document={querySelector:k=>elements.get(k)||null,addEventListener(){}};
  globalThis.window={innerWidth:1200};globalThis.location={hash:'#links'};
  const storage={getItem:k=>state.get(k)??null,setItem:(k,v)=>state.set(k,v)};
  const ui=createWorkspace({storage,render(){},toast:t=>toasts.push(t),escapeHTML:s=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])),icon(){return'';},getTimeRecords:()=>[],uid,localDate:()=> '2027-03-02',startRecord(){}});
  try{
    assert.match(ui.links(),/data-workspace-suggest-link="0"/);
    ui.click({dataset:{workspaceSuggestLink:'0'}});
    ui.click({dataset:{workspaceSuggestLink:'1'}});
    assert.equal(ui.get().links.length,2);
    assert.match(ui.linksHome(),/pro-baseball-watch-guide.com/);
    const id=ui.get().links[1].id;
    ui.click({dataset:{workspaceMoveLink:id,direction:'up'}});
    assert.equal(ui.get().links[0].title,'Notion');
    ui.click({dataset:{workspaceNew:'links'}});
    form.elements.title.value='新規サイト';form.elements.url.value='https://example.org/';
    form.handlers.submit({preventDefault(){},currentTarget:form});
    assert.equal(ui.get().links.length,3);
    ui.click({dataset:{workspaceNew:'tasks'}});
    form.elements.title.value='2027公式情報待ち';form.elements.status.value='waiting';form.elements.priority.value='normal';form.elements.reviewDate.value='2027-03-01';form.elements.waitingFor.value='公式発表待ち';
    form.handlers.submit({preventDefault(){},currentTarget:form});
    assert.equal(ui.get().tasks.length,1);
    assert.match(ui.home(),/確認目安が来た待機タスク 1件/);
    assert.match(ui.tasks(),/待機中/);
    assert.match(ui.tasks(),/公式発表待ち/);
    assert.doesNotMatch(ui.home(),/今後・期限なし/);
    ui.click({dataset:{workspaceResume:ui.get().tasks[0].id}});
    assert.equal(ui.get().tasks[0].status,'todo');
  }finally{Object.assign(globalThis,prev);}
});
