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
  format:'toki-workspace',version:1,projects:[],tasks:[],notes:[],prompts:[],templates:[],habits:{},hiddenProjects:[]
});
const validDay = v => {
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const d = new Date(v+'T12:00:00');
  return Number.isFinite(+d)&&d.getFullYear()===+v.slice(0,4)&&d.getMonth()+1===+v.slice(5,7)&&d.getDate()===+v.slice(8,10);
};
export function workspaceValidate(value){
  if(!value||value.format!=='toki-workspace'||value.version!==1)throw Error('作業管理データの形式が正しくありません。');
  const limits={projects:500,tasks:10000,notes:10000,prompts:2000,templates:2000};
  const all=new Set(),out={format:'toki-workspace',version:1};
  const str=(v,max,required=false)=>{
    if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw Error('作業管理の文字数または入力内容が不正です。');
    return v;
  };
  for(const type of Object.keys(limits)){
    const rows=type==='templates'?(value.templates??[]):value[type];
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
      if(type==='tasks'){
        const due=str(item.due??'',10),status=str(item.status,15),priority=str(item.priority,15),detail=str(item.detail??'',4000);
        if((due&&!validDay(due))||!['todo','doing','done'].includes(status)||!['high','normal','low'].includes(priority))throw Error('タスクの日付・状態が不正です。');
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
        const routineId=str(item.routineId??'',160),completedAt=str(item.completedAt??'',40);
        if(completedAt&&!Number.isFinite(Date.parse(completedAt)))throw Error('タスクの完了日時が不正です。');
        if(typeof(item.skipped??false)!=='boolean')throw Error('スキップ状態が不正です。');
        return {...base,due,status,priority,detail,memo:str(item.memo??'',10000),steps:normalizedSteps,repeat:rule,routineId,skipped:item.skipped??false,completedAt};
      }
      if(type==='projects')return {...base,description:str(item.description??'',2000),memo:str(item.memo??'',10000)};
      // Keep legacy notes; they appear inside the relevant project, never as a standalone notebook.
      if(type==='notes')return {...base,body:str(item.body??'',10000)};
      return {...base,body:str(item.body??'',15000),category:str(item.category??'',80),pinned:(()=>{if(typeof(item.pinned??false)!=='boolean')throw Error('プロンプトの固定設定が不正です。');return item.pinned??false;})()};
    });
  }
  const raw=value.habits??{};
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length>5000)throw Error('習慣の履歴が不正です。');
  const allowed=new Set(HABITS.map(x=>x.id)),habits={};
  for(const [day,ids] of Object.entries(raw)){
    if(!validDay(day)||!Array.isArray(ids)||ids.length>HABITS.length||ids.some(x=>typeof x!=='string'||!allowed.has(x))||new Set(ids).size!==ids.length)throw Error('習慣の記録日または内容が不正です。');
    if(ids.length)habits[day]=[...ids];
  }
  out.habits=habits;
  // Optional for older backups. Keep this setting within the existing synced workspace.
  const hidden=value.hiddenProjects??[];
  if(!Array.isArray(hidden)||hidden.length>2000||hidden.some(x=>typeof x!=='string'||!x.trim()||x.length>80)||new Set(hidden).size!==hidden.length)throw Error('プロジェクトの表示設定が不正です。');
  out.hiddenProjects=[...hidden];
  return out;
}
export function workspaceChange(current,type,payload,id,makeId){
  current=workspaceValidate(current);
  if(!Object.hasOwn({projects:1,tasks:1,notes:1,prompts:1,templates:1},type))throw Error('種類が不正です。');
  const old=id?current[type].find(x=>x.id===id):null;
  if(id&&!old)throw Error('編集対象が見つかりません。再読み込みしてください。');
  const now=new Date().toISOString();
  const item={...old,...payload,id:old?.id||makeId(),createdAt:old?.createdAt||now,updatedAt:now};
  return workspaceValidate({...current,[type]:old?current[type].map(x=>x.id===id?item:x):[...current[type],item]});
}
export function workspaceDelete(current,type,id){
  current=workspaceValidate(current);
  if(!Object.hasOwn({projects:1,tasks:1,notes:1,prompts:1,templates:1},type))throw Error('種類が不正です。');
  return workspaceValidate({...current,[type]:current[type].filter(x=>x.id!==id)});
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
  overdue:tasks.filter(x=>x.status!=='done'&&x.due&&x.due<today),
  today:tasks.filter(x=>x.status!=='done'&&x.due===today),
  upcoming:tasks.filter(x=>x.status!=='done'&&(!x.due||x.due>today)),
  done:tasks.filter(x=>x.status==='done')
});

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
    tasks.push({...old,id:makeId(),due,status:'todo',memo:'',steps:old.steps.map(s=>({...s,done:false})),routineId:group,skipped:false,completedAt:'',createdAt:now,updatedAt:now});
  }
  return workspaceValidate({...current,tasks});
}
export function workspaceSetTaskStatus(current,id,status,today,makeId){
  if(!['todo','doing','done'].includes(status))throw Error('タスクの状態が不正です。');
  const t=workspaceValidate(current).tasks.find(t=>t.id===id);
  if(!t)throw Error('タスクがありません。');
  if(t.status===status)return workspaceValidate(current);
  return status==='done'?workspaceAdvanceTask(current,id,today,makeId):workspaceChange(current,'tasks',{status,skipped:false,completedAt:''},id,makeId);
}
export function workspaceToggleTaskStep(current,id,index,makeId){
  const t=workspaceValidate(current).tasks.find(t=>t.id===id);
  if(!t||t.status==='done'||!Number.isInteger(index)||index<0||index>=t.steps.length)throw Error('チェック項目が見つかりません。');
  return workspaceChange(current,'tasks',{steps:t.steps.map((s,i)=>i===index?{...s,done:!s.done}:s)},id,makeId);
}
