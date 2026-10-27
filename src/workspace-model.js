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
  format:'toki-workspace',version:1,projects:[],tasks:[],notes:[],prompts:[],habits:{}
});
const validDay = v => {
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const d = new Date(v+'T12:00:00');
  return Number.isFinite(+d)&&d.getFullYear()===+v.slice(0,4)&&d.getMonth()+1===+v.slice(5,7)&&d.getDate()===+v.slice(8,10);
};
export function workspaceValidate(value){
  if(!value||value.format!=='toki-workspace'||value.version!==1)throw Error('作業管理データの形式が正しくありません。');
  const limits={projects:500,tasks:10000,notes:10000,prompts:2000};
  const all=new Set(),out={format:'toki-workspace',version:1};
  const str=(v,max,required=false)=>{
    if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw Error('作業管理の文字数または入力内容が不正です。');
    return v;
  };
  for(const type of Object.keys(limits)){
    const rows=value[type];
    if(!Array.isArray(rows)||rows.length>limits[type])throw Error('作業管理の件数が上限を超えています。');
    out[type]=rows.map(item=>{
      if(!item||typeof item!=='object')throw Error('作業管理の行が不正です。');
      const id=str(item.id,160,true),title=str(item.title,160,true),project=str(item.project??'',80);
      const createdAt=str(item.createdAt,40,true),updatedAt=str(item.updatedAt,40,true);
      if(all.has(type+id)||!Number.isFinite(Date.parse(createdAt))||!Number.isFinite(Date.parse(updatedAt)))throw Error('作業管理のIDまたは日時が不正です。');
      all.add(type+id);
      const base={id,title,project,createdAt,updatedAt};
      if(type==='tasks'){
        const due=str(item.due??'',10),status=str(item.status,15),priority=str(item.priority,15),detail=str(item.detail??'',4000);
        if((due&&!validDay(due))||!['todo','doing','done'].includes(status)||!['high','normal','low'].includes(priority))throw Error('タスクの日付・状態が不正です。');
        return {...base,due,status,priority,detail,memo:str(item.memo??'',10000)};
      }
      if(type==='projects')return {...base,description:str(item.description??'',2000),memo:str(item.memo??'',10000)};
      // Keep legacy notes; they appear inside the relevant project, never as a standalone notebook.
      if(type==='notes')return {...base,body:str(item.body??'',10000)};
      return {...base,body:str(item.body??'',15000),category:str(item.category??'',80)};
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
  return out;
}
export function workspaceChange(current,type,payload,id,makeId){
  current=workspaceValidate(current);
  if(!Object.hasOwn({projects:1,tasks:1,notes:1,prompts:1},type))throw Error('種類が不正です。');
  const old=id?current[type].find(x=>x.id===id):null;
  if(id&&!old)throw Error('編集対象が見つかりません。再読み込みしてください。');
  const now=new Date().toISOString();
  const item={...old,...payload,id:old?.id||makeId(),createdAt:old?.createdAt||now,updatedAt:now};
  return workspaceValidate({...current,[type]:old?current[type].map(x=>x.id===id?item:x):[...current[type],item]});
}
export function workspaceDelete(current,type,id){
  current=workspaceValidate(current);
  if(!Object.hasOwn({projects:1,tasks:1,notes:1,prompts:1},type))throw Error('種類が不正です。');
  return workspaceValidate({...current,[type]:current[type].filter(x=>x.id!==id)});
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
