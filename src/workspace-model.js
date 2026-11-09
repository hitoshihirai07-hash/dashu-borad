// Project/task notes and the independent daily habit tracker share the existing
// workspace key, so no new D1 table or Cloudflare setting is required.
export const WORKSPACE_KEY = 'toki-workspace-v1';
export const HABITS = Object.freeze([
  {id:'baseball', label:'野球確認'},
  {id:'walk', label:'散歩'},
  {id:'life', label:'生活記録'},
  {id:'daily', label:'今日の記録'},
]);
export const workspaceFresh = () => ({
  format:'toki-workspace',version:1,projects:[],tasks:[],notes:[],prompts:[],templates:[],links:[],events:[],reviews:[],quickNotes:[],focusDays:{},habits:{},hiddenProjects:[]
});
const validClock = v => !v || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const validTimestamp = v => !v || Number.isFinite(Date.parse(v));
const AI_STATES = ['not_requested','requested','review','revision','done'];
const validSpan = (start,end) => validClock(start)&&validClock(end)&&(!end||(!!start&&end>start));
const validDay = v => {
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const d = new Date(v+'T12:00:00');
  return Number.isFinite(+d)&&d.getFullYear()===+v.slice(0,4)&&d.getMonth()+1===+v.slice(5,7)&&d.getDate()===+v.slice(8,10);
};
export function workspaceValidate(value){
  if(!value||value.format!=='toki-workspace'||value.version!==1)throw Error('作業管理データの形式が正しくありません。');
  const limits={projects:500,tasks:10000,notes:10000,prompts:2000,templates:2000,links:100,events:3000,reviews:5000};
  const all=new Set(),out={format:'toki-workspace',version:1};
  const str=(v,max,required=false)=>{
    if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw Error('作業管理の文字数または入力内容が不正です。');
    return v;
  };
  for(const type of Object.keys(limits)){
    const rows=['templates','links','events','reviews'].includes(type)?(value[type]??[]):value[type];
    if(!Array.isArray(rows)||rows.length>limits[type])throw Error('作業管理の件数が上限を超えています。');
    out[type]=rows.map(item=>{
      if(!item||typeof item!=='object')throw Error('作業管理の行が不正です。');
      const id=str(item.id,160,true),title=str(item.title,160,true),project=str(item.project??'',80);
      const createdAt=str(item.createdAt,40,true),updatedAt=str(item.updatedAt,40,true);
      if(all.has(type+id)||!Number.isFinite(Date.parse(createdAt))||!Number.isFinite(Date.parse(updatedAt)))throw Error('作業管理のIDまたは日時が不正です。');
      all.add(type+id);
      const base={id,title,project,createdAt,updatedAt};
      const steps=(type==='tasks'||type==='templates')?(item.steps??[]):[];
      if(!Array.isArray(steps)||steps.length>30)throw Error('チェックリストの件数が不正です。');
      const normalizedSteps=steps.map(step=>{
        if(!step||typeof step!=='object')throw Error('チェックリストが不正です。');
        return {text:str(step.text,200,true),done:type==='tasks'?(step.done??false):false};
      });
      if(normalizedSteps.some(step=>typeof step.done!=='boolean'))throw Error('チェックリストの状態が不正です。');
      if(type==='templates'){
        const priority=str(item.priority??'normal',15);
        if(!['high','normal','low'].includes(priority))throw Error('テンプレートの優先度が不正です。');
        return {...base,detail:str(item.detail??'',4000),priority,steps:normalizedSteps};
      }
      if(type==='links'){
        const url=str(item.url??'',2048,true);
        if(!validLinkUrl(url))throw Error('リンクはhttp/httpsの有効なURLを入力してください。');
        return {...base,project:'',url};
      }
      if(type==='reviews'){
        return {...base,taskId:str(item.taskId??'',160),outcome:str(item.outcome??'',6000,true),decisions:str(item.decisions??'',4000),issues:str(item.issues??'',4000),nextAction:str(item.nextAction??'',1000),verified:(()=>{const checked=item.verified??false;if(typeof checked!=='boolean')throw Error('振り返りの確認状態が不正です。');return checked;})()};
      }
      if(type==='events'){
        const date=str(item.date??'',10,true),time=str(item.time??'',5),endTime=str(item.endTime??'',5),note=str(item.note??'',2000);
        const allDay=item.allDay??false;
        if(!validDay(date)||!validSpan(time,endTime)||typeof allDay!=='boolean'||(allDay&&(time||endTime)))throw Error('予定の日付・時刻の形式が不正です。');
        const status=str(item.status??'todo',12),completedAt=str(item.completedAt??'',40);
        if(!['todo','done'].includes(status)||(completedAt&&!Number.isFinite(Date.parse(completedAt))))throw Error('予定の完了状態が不正です。');
        return {...base,project:'',date,time,endTime,allDay,note,status,completedAt};
      }
      if(type==='tasks'){
        const due=str(item.due??'',10),status=str(item.status,15),priority=str(item.priority,15),detail=str(item.detail??'',4000);
        const startTime=str(item.startTime??'',5),endTime=str(item.endTime??'',5);
        if(!validSpan(startTime,endTime)||(startTime&&!due))throw Error('タスクの予定時刻・予定日の形式が不正です。');
        const assignee=str(item.assignee??'self',8),aiService=str(item.aiService??'',80),aiState=str(item.aiState??'not_requested',16);
        const aiRequestedAt=str(item.aiRequestedAt??'',40),aiCheckedAt=str(item.aiCheckedAt??'',40);
        if(!['self','ai'].includes(assignee)||!AI_STATES.includes(aiState)||!validTimestamp(aiRequestedAt)||!validTimestamp(aiCheckedAt)||
          (assignee==='self'&&(aiService||aiState!=='not_requested'||aiRequestedAt||aiCheckedAt))||
          (aiCheckedAt&&(!aiRequestedAt||Date.parse(aiCheckedAt)<Date.parse(aiRequestedAt))))throw Error('AIタスクの設定・日時が不正です。');
        if((due&&!validDay(due))||!['todo','doing','waiting','someday','done'].includes(status)||!['high','normal','low'].includes(priority))throw Error('タスクの日付・状態が不正です。');
        const repeat=item.repeat??null;
        let rule=null;
        if(repeat!==null){
          if(!repeat||typeof repeat!=='object'||Array.isArray(repeat)||!['daily','weekly','monthly'].includes(repeat.type))throw Error('ルーチンの周期が不正です。');
          const days=repeat.type==='weekly'?repeat.days:[];
          const monthDay=repeat.type==='monthly'?repeat.monthDay:null;
          if(!Array.isArray(days)||days.length>7||new Set(days).size!==days.length||days.some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('ルーチンの曜日設定が不正です。');
          if(repeat.type==='weekly'&&!days.length)throw Error('曜日を1つ以上選択してください。');
          if(repeat.type==='monthly'&&(!Number.isInteger(monthDay)||monthDay<1||monthDay>31))throw Error('ルーチンの日付が不正です。');
          if(!due)throw Error('ルーチンタスクには実行日が必要です。');
          rule={type:repeat.type,days,monthDay};
        }
        const reviewDate=str(item.reviewDate??'',10),waitingFor=str(item.waitingFor??'',1000),startCondition=str(item.startCondition??'',1000);
        if((reviewDate&&!validDay(reviewDate))||(rule&&['waiting','someday'].includes(status)))throw Error('確認目安またはルーチンと待機状態の組み合わせが不正です。');
        const routineId=str(item.routineId??'',160),completedAt=str(item.completedAt??'',40);
        if(completedAt&&!Number.isFinite(Date.parse(completedAt)))throw Error('タスクの完了日時が不正です。');
        if(typeof(item.skipped??false)!=='boolean')throw Error('スキップ状態が不正です。');
        // Optional on existing backups; one entry per deliberate due-date change.
        const history=item.dueHistory??[];
        if(!Array.isArray(history)||history.length>40)throw Error('期限変更の履歴が不正です。');
        const dueHistory=history.map(h=>{
          if(!h||typeof h!=='object'||!validDay(h.from)||(h.to!==''&&!validDay(h.to))||!validTimestamp(h.at)||!h.at)throw Error('期限変更の履歴が不正です。');
          return {from:h.from,to:h.to,at:h.at};
        });
        const originalDue=str(item.originalDue??(dueHistory[0]?.from||''),10);
        if(originalDue&&!validDay(originalDue))throw Error('元の期限が不正です。');
        return {...base,due,dueHistory,originalDue,startTime,endTime,assignee,aiService,aiState,aiRequestedAt,aiCheckedAt,status,priority,detail,memo:str(item.memo??'',10000),stage:str(item.stage??'',100),steps:normalizedSteps,repeat:rule,routineId,skipped:item.skipped??false,completedAt,reviewDate,waitingFor,startCondition};
      }
      if(type==='projects'){
        const stages=item.stages??[];
        if(!Array.isArray(stages)||stages.length>12)throw Error('作業段階は12件までです。');
        const checked=stages.map(stage=>str(stage,100,true).trim());
        if(new Set(checked).size!==checked.length)throw Error('同じ名前の作業段階は登録できません。');
        return {...base,description:str(item.description??'',2000),memo:str(item.memo??'',10000),goal:str(item.goal??'',1600),doneCriteria:str(item.doneCriteria??'',1600),currentState:str(item.currentState??'',4000),stages:checked};
      }
      // Keep legacy notes; they appear inside the relevant project, never as a standalone notebook.
      if(type==='notes')return {...base,body:str(item.body??'',10000)};
      return {...base,body:str(item.body??'',15000),category:str(item.category??'',80),pinned:(()=>{if(typeof(item.pinned??false)!=='boolean')throw Error('プロンプトの固定設定が不正です。');return item.pinned??false;})()};
    });
  }
  // Standalone, title-free short notes. Optional so pre-update cloud backups stay valid.
  const quickRows=value.quickNotes??[];
  if(!Array.isArray(quickRows)||quickRows.length>10000)throw Error('ひとことメモの件数が不正です。');
  const quickIds=new Set();
  out.quickNotes=quickRows.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw Error('ひとことメモの内容が不正です。');
    const id=str(item.id,160,true),body=str(item.body,4000,true),createdAt=str(item.createdAt,40,true),updatedAt=str(item.updatedAt,40,true),taskId=str(item.taskId??'',160);
    if(quickIds.has(id)||!Number.isFinite(Date.parse(createdAt))||!Number.isFinite(Date.parse(updatedAt)))throw Error('ひとことメモのIDまたは日時が不正です。');
    quickIds.add(id);
    return {id,body,createdAt,updatedAt,taskId};
  });
  const raw=value.habits??{};
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length>5000)throw Error('習慣の履歴が不正です。');
  const allowed=new Set(HABITS.map(x=>x.id)),habits={};
  for(const [day,ids] of Object.entries(raw)){
    if(!validDay(day)||!Array.isArray(ids)||ids.length>HABITS.length||ids.some(x=>typeof x!=='string'||!allowed.has(x))||new Set(ids).size!==ids.length)throw Error('習慣の記録日または内容が不正です。');
    if(ids.length)habits[day]=[...ids];
  }
  out.habits=habits;
  // Dates of deliberately selected tasks are not task due dates. Older backups omit this map.
  const rawFocus=value.focusDays??{},focusDays={};
  if(!rawFocus||typeof rawFocus!=='object'||Array.isArray(rawFocus)||Object.keys(rawFocus).length>5000)throw Error('今日やるタスクの保存形式が不正です。');
  for(const [day,ids] of Object.entries(rawFocus)){
    if(!validDay(day)||!Array.isArray(ids)||ids.length>3||ids.some(id=>typeof id!=='string'||!id||id.length>160)||new Set(ids).size!==ids.length)throw Error('今日やるタスクは1日3件までです。');
    if(ids.length)focusDays[day]=[...ids];
  }
  out.focusDays=focusDays;
  // Optional for older backups. Keep this setting within the existing synced workspace.
  const hidden=value.hiddenProjects??[];
  if(!Array.isArray(hidden)||hidden.length>2000||hidden.some(x=>typeof x!=='string'||!x.trim()||x.length>80)||new Set(hidden).size!==hidden.length)throw Error('プロジェクトの表示設定が不正です。');
  out.hiddenProjects=[...hidden];
  return out;
}
export function validLinkUrl(value){
  if(typeof value!=='string'||value.length>2048||!value.trim())return false;
  try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!!url.hostname&&!url.username&&!url.password;}catch{return false;}
}
// Task titles come from the first nonempty line; the complete note becomes task detail.
export function quickNoteTaskTitle(body){
  if(typeof body!=='string'||!body.trim())throw Error('メモを入力してください。');
  return (body.split(/\r?\n/).find(line=>line.trim())||'').trim().slice(0,160);
}
export function workspaceChange(current,type,payload,id,makeId){
  current=workspaceValidate(current);
  if(!Object.hasOwn({projects:1,tasks:1,notes:1,prompts:1,templates:1,links:1,events:1,reviews:1,quickNotes:1},type))throw Error('種類が不正です。');
  const old=id?current[type].find(x=>x.id===id):null;
  if(id&&!old)throw Error('編集対象が見つかりません。再読み込みしてください。');
  if(type==='quickNotes'&&(!old||Object.hasOwn(payload,'body'))&&(!payload.body||!payload.body.trim()))throw Error('メモを入力してください。');
  const now=new Date().toISOString();
  const item={...old,...payload,id:old?.id||makeId(),createdAt:old?.createdAt||now,updatedAt:now};
  return workspaceValidate({...current,[type]:old?current[type].map(x=>x.id===id?item:x):[...current[type],item]});
}
export function workspaceDelete(current,type,id){
  current=workspaceValidate(current);
  if(!Object.hasOwn({projects:1,tasks:1,notes:1,prompts:1,templates:1,links:1,events:1,reviews:1,quickNotes:1},type))throw Error('種類が不正です。');
  return workspaceValidate({...current,[type]:current[type].filter(x=>x.id!==id),
    ...(type==='tasks'?{focusDays:Object.fromEntries(Object.entries(current.focusDays).map(([day,ids])=>[day,ids.filter(x=>x!==id)]).filter(([,ids])=>ids.length)),quickNotes:current.quickNotes.map(n=>n.taskId===id?{...n,taskId:'',updatedAt:new Date().toISOString()}:n)}:{})});
}
// Changing a deadline is an explicit action; never silently roll tasks forward.
export function workspaceRescheduleTask(current,id,due,makeId,at=new Date().toISOString()){
  current=workspaceValidate(current);
  const task=current.tasks.find(row=>row.id===id);
  if(!task||task.status==='done'||['waiting','someday'].includes(task.status)||!task.due)throw Error('日付を変更できる未完了タスクがありません。');
  if(!validDay(due)||!validTimestamp(at)||!at)throw Error('変更先の日付が不正です。');
  if(task.due===due)return current;
  const dueHistory=[...task.dueHistory,{from:task.due,to:due,at}].slice(-40);
  return workspaceChange(current,'tasks',{due,dueHistory,originalDue:task.originalDue||task.due},id,makeId);
}
export function workspaceMoveLink(current,id,direction){
  current=workspaceValidate(current);
  if(!['up','down'].includes(direction))throw Error('移動方向が不正です。');
  const links=[...current.links],index=links.findIndex(x=>x.id===id),next=index+(direction==='up'?-1:1);
  if(index<0)throw Error('リンクが見つかりません。');
  if(next<0||next>=links.length)return current;
  [links[index],links[next]]=[links[next],links[index]];
  return workspaceValidate({...current,links});
}
export function workspaceSetProjectVisibility(current,project,visible){
  current=workspaceValidate(current);
  if(typeof project!=='string'||!project.trim()||project.length>80||typeof visible!=='boolean')throw Error('プロジェクトの表示設定が不正です。');
  const hidden=new Set(current.hiddenProjects);
  if(visible)hidden.delete(project);else hidden.add(project);
  return workspaceValidate({...current,hiddenProjects:[...hidden]});
}
export function workspaceToggleHabit(current,day,habitId){
  current=workspaceValidate(current);
  if(!validDay(day)||!HABITS.some(x=>x.id===habitId))throw Error('習慣の選択が不正です。');
  const entries=new Set(current.habits[day]||[]);
  if(entries.has(habitId))entries.delete(habitId);else entries.add(habitId);
  const habits={...current.habits};
  if(entries.size)habits[day]=[...entries];else delete habits[day];
  return workspaceValidate({...current,habits});
}
export function habitWeek(current,date){
  current=workspaceValidate(current);
  if(!validDay(date))throw Error('日付が不正です。');
  const d=new Date(date+'T12:00:00');d.setDate(d.getDate()-(d.getDay()+6)%7);
  const rows=[];
  for(let i=0;i<7;i++){
    const day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    rows.push({date:day,count:(current.habits[day]||[]).length});d.setDate(d.getDate()+1);
  }
  return rows;
}
export const taskBuckets=(tasks,today)=>({
  overdue:tasks.filter(x=>!['done','waiting','someday'].includes(x.status)&&x.due&&x.due<today),
  today:tasks.filter(x=>!['done','waiting','someday'].includes(x.status)&&x.due===today),
  upcoming:tasks.filter(x=>!['done','waiting','someday'].includes(x.status)&&x.due&&x.due>today),
  undated:tasks.filter(x=>!['done','waiting','someday'].includes(x.status)&&!x.due),
  waiting:tasks.filter(x=>x.status==='waiting'),
  someday:tasks.filter(x=>x.status==='someday'),
  review:tasks.filter(x=>['waiting','someday'].includes(x.status)&&x.reviewDate&&x.reviewDate<=today),
  done:tasks.filter(x=>x.status==='done')
});

// Task progress counts one current occurrence per routine; completed recurring history
// must not inflate the completion percentage. 'Done' is a task metric, not goal attainment.
export function projectTaskStats(current,project,records=[]){
  const groups=new Map();
  for(const t of current.tasks.filter(t=>t.project===project)){
    const key=t.routineId||t.id,prev=groups.get(key);
    if(!prev||prev.status==='done'&&t.status!=='done'||(prev.status===t.status&&t.updatedAt>prev.updatedAt))groups.set(key,t);
  }
  const tasks=[...groups.values()],done=tasks.filter(t=>t.status==='done'&&!t.skipped).length;
  const waiting=tasks.filter(t=>t.status==='waiting'||t.status==='someday').length;
  const minutes=records.reduce((sum,r)=>sum+(Number.isFinite(r.minutes)?r.minutes:0),0);
  const lastDay=records.map(r=>r.date).filter(v=>/^\d{4}-\d{2}-\d{2}$/.test(v)).sort().at(-1)||'';
  const projectRow=current.projects.find(p=>p.title===project);
  const stages=(projectRow?.stages||[]).map(title=>{
    const own=tasks.filter(t=>t.stage===title),complete=own.filter(t=>t.status==='done'&&!t.skipped).length;
    return {title,total:own.length,done:complete,percent:own.length?Math.round(complete/own.length*100):0};
  });
  return {total:tasks.length,done,waiting,percent:tasks.length?Math.round(done/tasks.length*100):0,minutes,lastDay,stages,unassigned:tasks.filter(t=>!t.stage||!stages.some(s=>s.title===t.stage)).length};
}

// A schedule is completed only by an explicit user action; passing its date is not proof.
export function workspaceSetEventStatus(current,id,status,makeId){
  current=workspaceValidate(current);
  if(!['todo','done'].includes(status))throw Error('予定の完了状態が不正です。');
  const event=current.events.find(e=>e.id===id);
  if(!event)throw Error('予定が見つかりません。');
  return event.status===status?current:workspaceChange(current,'events',{status,completedAt:status==='done'?new Date().toISOString():''},id,makeId);
}
// Save the retrospective, optionally complete its task and/or turn next action into a task, atomically.
export function workspaceRecordReview(current,{project,taskId='',outcome,decisions='',issues='',nextAction='',verified=false,completeTask=false,createNextTask=false},today,makeId){
  current=workspaceValidate(current);
  if(!project||typeof project!=='string'||project.length>80)throw Error('振り返りのプロジェクトを選んでください。');
  if(!current.projects.some(p=>p.title===project)&&!current.tasks.some(t=>t.project===project))throw Error('プロジェクトが見つかりません。');
  const t=taskId?current.tasks.find(t=>t.id===taskId&&t.project===project):null;
  if(taskId&&!t)throw Error('関連タスクが見つかりません。');
  if(completeTask&&(!t||t.status==='done'))throw Error('完了にできるタスクを選んでください。');
  if(createNextTask&&(!nextAction.trim()||nextAction.trim().length>160))throw Error('次のタスク名は1〜160文字で入力してください。');
  if(!outcome?.trim())throw Error('実施したこと・結果を入力してください。');
  let result=workspaceChange(current,'reviews',{project,title:`振り返り：${t?.title||project}`.slice(0,160),taskId,outcome,decisions,issues,nextAction,verified},'',makeId);
  if(completeTask)result=workspaceSetTaskStatus(result,taskId,'done',today,makeId);
  if(createNextTask)result=workspaceChange(result,'tasks',{title:nextAction.trim(),project,status:'todo',priority:'normal',detail:'振り返りから登録した次の一手'},'',makeId);
  return result;
}

// Build plain text locally for pasting into ChatGPT or Codex. Nothing is sent to AI.
export function buildWorkspaceRequest({workspace,project,taskId='',promptId='',linkId='',instruction=''}){
  workspace=workspaceValidate(workspace);
  const p=workspace.projects.find(row=>row.title===project),t=taskId?workspace.tasks.find(row=>row.id===taskId&&row.project===project):null;
  if((!project&&!taskId)||(taskId&&!t))throw Error('依頼文の対象が見つかりません。');
  const prompt=promptId?workspace.prompts.find(row=>row.id===promptId&&row.project===project):null;
  const link=linkId?workspace.links.find(row=>row.id===linkId):null;
  const related=workspace.tasks.filter(row=>row.project===project),pending=related.filter(row=>row.status!=='done');
  const stats=projectTaskStats(workspace,project);
  const history=workspace.reviews.filter(r=>r.project===project&&(r.taskId===''||!taskId||r.taskId===taskId))
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,3);
  const labels={todo:'未着手',doing:'進行中',waiting:'待機中',someday:'いつかやる',done:'完了'};
  const suggested=t?.title||history.find(r=>r.nextAction.trim())?.nextAction||pending.find(x=>x.status==='doing')?.title||pending[0]?.title||'目標・完了条件を確認し、次に着手する具体的な作業を提案する';
  const lines=['【プロジェクト】',project||'未分類','', '【ゴール】',p?.goal||'未設定','【完了条件】',p?.doneCriteria||'未設定',
    '','【現在地（記録に基づく）】',`タスク進捗：${stats.done}/${stats.total}件完了（${stats.percent}%）。待機：${stats.waiting}件`,
    `進行中：${pending.filter(x=>x.status==='doing').map(x=>x.title).join('、')||'なし'}`,`未着手：${pending.filter(x=>x.status==='todo').slice(0,8).map(x=>x.title).join('、')||'なし'}`,
    `待機中：${pending.filter(x=>['waiting','someday'].includes(x.status)).slice(0,5).map(x=>x.title).join('、')||'なし'}`];
  if(p?.currentState)lines.push('【現在の課題・状況（入力済み）】',p.currentState);
  if(p?.description)lines.push('【プロジェクト概要】',p.description);
  if(p?.memo)lines.push('【継続して守る方針・メモ】',p.memo);
  if(t){
    lines.push('','【対象タスク】',t.title,'【状態】',labels[t.status]||t.status);
    if(t.stage)lines.push('【作業段階】',t.stage);
    if(t.due)lines.push('【予定日】',t.due);
    if(t.detail)lines.push('【作業内容】',t.detail);
    if(t.steps?.length)lines.push('【チェック項目】',...t.steps.map(s=>(s.done?'[完了] ':'[未完了] ')+s.text));
    if(t.memo)lines.push('【作業メモ】',t.memo);
    if(t.waitingFor)lines.push('【待機理由】',t.waitingFor);
    if(t.startCondition)lines.push('【開始条件】',t.startCondition);
  }else if(p?.stages?.length)lines.push('','【作業段階】',...p.stages.map(s=>`・${s}`));
  if(history.length)lines.push('','【最近の作業結果・判断・引き継ぎ】',...history.flatMap(r=>[
    `■ ${r.createdAt.slice(0,10)}：${r.title}${r.verified?'（確認済み）':'（未確認を含む）'}`,
    `結果：${r.outcome}`,...(r.decisions?[`決定事項：${r.decisions}`]:[]),...(r.issues?[`問題・未解決：${r.issues}`]:[]),...(r.nextAction?[`次の一手：${r.nextAction}`]:[])
  ]));
  if(prompt)lines.push('','【保存済みプロンプト：'+prompt.title+'】',prompt.body);
  if(link)lines.push('','【関連リンク：'+link.title+'】',link.url);
  lines.push('','【今回AIに依頼すること】',(typeof instruction==='string'&&instruction.trim())?instruction.trim():suggested,
    '','【進め方】','上記の目標・現在地・過去の判断に基づいて作業してください。未確認事項は事実と区別し、頼んでいない機能追加はしないでください。','終わったら「実施したこと・確認した結果・未完了・次の一手」を簡潔に報告してください。');
  return lines.join('\n').trim();
}

// All dates are local calendar dates represented as YYYY-MM-DD (UTC arithmetic prevents DST drift).
const toUTC=day=>new Date(day+'T00:00:00Z');
const fromUTC=d=>d.toISOString().slice(0,10);
export function nextRoutineDate(rule,after){
  if(!validDay(after))throw Error('ルーチンの基準日が不正です。');
  if(!rule||!['daily','weekly','monthly'].includes(rule.type))throw Error('ルーチンの設定が不正です。');
  const d=toUTC(after);
  for(let i=0;i<370;i++){
    d.setUTCDate(d.getUTCDate()+1);
    if(rule.type==='daily')return fromUTC(d);
    if(rule.type==='weekly'&&rule.days.includes(d.getUTCDay()))return fromUTC(d);
    if(rule.type==='monthly'){
      const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
      if(d.getUTCDate()===Math.min(last,rule.monthDay))return fromUTC(d);
    }
  }
  throw Error('次回の予定日を計算できません。');
}
export function firstRoutineDate(rule,onOrAfter){
  if(!validDay(onOrAfter))throw Error('ルーチンの基準日が不正です。');
  const d=toUTC(onOrAfter);d.setUTCDate(d.getUTCDate()-1);
  return nextRoutineDate(rule,fromUTC(d));
}
export function workspaceAdvanceTask(current,id,today,makeId,skip=false){
  current=workspaceValidate(current);
  if(!validDay(today))throw Error('日付が不正です。');
  const old=current.tasks.find(t=>t.id===id);
  if(!old||old.status==='done')throw Error('未完了のタスクが見つかりません。');
  const now=new Date().toISOString(),group=old.routineId||old.id;
  const past={...old,status:'done',skipped:skip,completedAt:now,updatedAt:now,repeat:null,routineId:old.repeat?group:old.routineId};
  let tasks=current.tasks.map(t=>t.id===id?past:t);
  // Never create duplicates for a series, including when undoing historical completions.
  if(old.repeat&&!tasks.some(t=>t.id!==id&&t.routineId===group&&t.status!=='done')){
    const due=nextRoutineDate(old.repeat,old.due>today?old.due:today);
    tasks.push({...old,id:makeId(),due,dueHistory:[],originalDue:'',status:'todo',memo:'',steps:old.steps.map(s=>({...s,done:false})),aiState:'not_requested',aiRequestedAt:'',aiCheckedAt:'',routineId:group,skipped:false,completedAt:'',createdAt:now,updatedAt:now});
  }
  return workspaceValidate({...current,tasks});
}
// AI依頼の経過は作業時間と別のメタデータ。AIの実稼働時間は計測しません。
export function workspaceAiPatch(task,nextState,at=new Date().toISOString()){
  if(task.assignee!=='ai'||!AI_STATES.includes(nextState)||!validTimestamp(at))throw Error('AIタスクの状態が不正です。');
  if(nextState===task.aiState)return {};
  if(nextState==='not_requested')return {aiState:nextState,aiRequestedAt:'',aiCheckedAt:''};
  if(nextState==='requested'||nextState==='revision')return {aiState:nextState,aiRequestedAt:at,aiCheckedAt:''};
  if(nextState==='review')return {aiState:nextState,aiRequestedAt:task.aiRequestedAt||at,aiCheckedAt:''};
  return {aiState:nextState,aiRequestedAt:task.aiRequestedAt||at,aiCheckedAt:at};
}
export function workspaceSetAiState(current,id,nextState,makeId,at=new Date().toISOString()){
  const t=workspaceValidate(current).tasks.find(row=>row.id===id);
  if(!t)throw Error('AIタスクが見つかりません。');
  return workspaceChange(current,'tasks',workspaceAiPatch(t,nextState,at),id,makeId);
}
export function workspaceSetTaskStatus(current,id,status,today,makeId){
  if(!['todo','doing','waiting','someday','done'].includes(status))throw Error('タスクの状態が不正です。');
  const t=workspaceValidate(current).tasks.find(t=>t.id===id);
  if(!t)throw Error('タスクがありません。');
  if(t.status===status)return workspaceValidate(current);
  if(t.repeat&&['waiting','someday'].includes(status))throw Error('繰り返しタスクを待機にするには、先に繰り返しを解除してください。');
  return status==='done'?workspaceAdvanceTask(current,id,today,makeId):workspaceChange(current,'tasks',{status,skipped:false,completedAt:''},id,makeId);
}
export function workspaceToggleTaskStep(current,id,index,makeId){
  const t=workspaceValidate(current).tasks.find(t=>t.id===id);
  if(!t||t.status==='done'||!Number.isInteger(index)||index<0||index>=t.steps.length)throw Error('チェック項目が見つかりません。');
  return workspaceChange(current,'tasks',{steps:t.steps.map((s,i)=>i===index?{...s,done:!s.done}:s)},id,makeId);
}

// Choose up to three EXISTING, actionable tasks for a day. This does not change their due dates.
export function workspaceToggleFocus(current,day,taskId){
  current=workspaceValidate(current);
  if(!validDay(day))throw Error('日付が不正です。');
  const task=current.tasks.find(t=>t.id===taskId);
  if(!task||['done','waiting','someday'].includes(task.status))throw Error('着手できるタスクを選んでください。');
  const ids=(current.focusDays[day]||[]).filter(id=>current.tasks.some(t=>t.id===id&&!['done','waiting','someday'].includes(t.status))),index=ids.indexOf(taskId);
  if(index>=0)ids.splice(index,1);else{if(ids.length>=3)throw Error('今日やるタスクは最大3件です。');ids.push(taskId);}
  const focusDays={...current.focusDays};if(ids.length)focusDays[day]=ids;else delete focusDays[day];
  return workspaceValidate({...current,focusDays});
}
export function calendarPeriod(view,day){
  if(!validDay(day))throw Error('カレンダーの日付が不正です。');
  const d=toUTC(day);
  if(view==='month'){d.setUTCDate(1);d.setUTCDate(d.getUTCDate()-d.getUTCDay());const start=fromUTC(d);d.setUTCDate(d.getUTCDate()+41);return {start,end:fromUTC(d)};}
  if(view==='week'){d.setUTCDate(d.getUTCDate()-d.getUTCDay());const start=fromUTC(d);d.setUTCDate(d.getUTCDate()+6);return {start,end:fromUTC(d)};}
  throw Error('表示範囲が不正です。');
}
export function calendarItems(current,start,end,{tasks=true,events=true,habits=true,today=null}={}){
  current=workspaceValidate(current);if(!validDay(start)||!validDay(end)||start>end)throw Error('表示範囲が不正です。');
  const days={},insert=(day,item)=>{if(day>=start&&day<=end)(days[day]??=[]).push(item);};
  if(tasks)for(const t of current.tasks){
    if(['waiting','someday'].includes(t.status)){if(t.reviewDate)insert(t.reviewDate,{kind:'review',id:t.id,title:t.title});continue;}
    if(t.due)insert(t.due,{kind:'task',id:t.id,title:t.title,done:t.status==='done',virtual:false});
    // Future recurrences are previews only. No additional tasks are saved to storage.
    if(t.repeat&&t.due&&t.status!=='done'){
      const first=toUTC(t.due>start?t.due:start);
      for(let d=first;fromUTC(d)<=end;d.setUTCDate(d.getUTCDate()+1)){
        const date=fromUTC(d);if(date===t.due)continue;
        const rule=t.repeat,monthLast=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
        const matches=rule.type==='daily'||rule.type==='weekly'&&rule.days.includes(d.getUTCDay())||rule.type==='monthly'&&d.getUTCDate()===Math.min(rule.monthDay,monthLast);
        if(matches)insert(date,{kind:'task',id:t.id,title:t.title,done:false,virtual:true});
      }
    }
  }
  if(events)for(const e of current.events)insert(e.date,{kind:'event',id:e.id,title:e.title,time:e.allDay?'':e.time,allDay:e.allDay,done:e.status==='done'});
  if(habits){
    const now=new Date(),currentDay=today||`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;for(let d=toUTC(start);fromUTC(d)<=end;d.setUTCDate(d.getUTCDate()+1)){
      const day=fromUTC(d);if(day<=currentDay)insert(day,{kind:'habit',count:(current.habits[day]||[]).length,total:HABITS.length});
    }
  }
  return days;
}

// Builds the 3 lanes without treating AI waiting time as logged work.
export function dailyPlanner(current,day,records=[],{today=day,showTasks=true,showEvents=true}={}){
  current=workspaceValidate(current);
  if(!validDay(day))throw Error('手帳の日付が不正です。');
  const lanes={events:[],self:[],ai:[]};
  const localTime=timestamp=>{const d=new Date(timestamp);return Number.isFinite(+d)?{day:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,time:`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}:null;};
  if(showEvents)for(const e of current.events){
    if(e.date!==day)continue;
    lanes.events.push({kind:'event',id:e.id,title:e.title,time:e.allDay?'':e.time,endTime:e.endTime,allDay:e.allDay,done:e.status==='done'});
  }
  const virtuals=showTasks?new Set((calendarItems(current,day,day,{events:false,habits:false,today})[day]||[]).filter(x=>x.virtual).map(x=>x.id)):new Set();
  if(showTasks)for(const t of current.tasks){
    const requested=t.aiRequestedAt?localTime(t.aiRequestedAt):null;
    const due=t.due===day;
    const requestedToday=t.assignee==='ai'&&requested?.day===day;
    const focus=(current.focusDays[day]||[]).includes(t.id);
    const pendingToday=day===today&&t.assignee==='ai'&&['requested','review','revision'].includes(t.aiState)&&t.status!=='done'&&!due;
    const predicted=virtuals.has(t.id);
    if(!due&&!requestedToday&&!focus&&!pendingToday&&!predicted)continue;
    const time=(due||predicted)&&t.startTime?t.startTime:(requestedToday?requested.time:'');
    const timeType=(due||predicted)&&t.startTime?'予定':requestedToday?'依頼':'未設定';
    lanes[t.assignee].push({kind:'task',id:t.id,title:t.title,time,endTime:(due||predicted)?t.endTime:'',timeType,done:t.status==='done',virtual:predicted&&!due,assignee:t.assignee,aiState:predicted&&!due?'not_requested':t.aiState,aiService:t.aiService,aiRequestedAt:predicted&&!due?'':t.aiRequestedAt,aiCheckedAt:predicted&&!due?'':t.aiCheckedAt});
  }
  for(const lane of Object.values(lanes))lane.sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99')||a.title.localeCompare(b.title,'ja'));
  const selfMinutes=records.filter(r=>!r.deleted&&r.date===day).reduce((sum,r)=>sum+(Number.isFinite(r.minutes)&&r.minutes>0?r.minutes:0),0);
  return {day,lanes,selfMinutes};
}
