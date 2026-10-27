// Separate, validated workspace data. All timestamps in UTC; dates in local YYYY-MM-DD.
export const WORKSPACE_KEY='toki-workspace-v1';
export const workspaceFresh=()=>({format:'toki-workspace',version:1,projects:[],tasks:[],notes:[],prompts:[]});
export function workspaceValidate(value){
  if(!value||value.format!=='toki-workspace'||value.version!==1)throw Error('作業管理データの形式が正しくありません。');
  const limits={projects:500,tasks:10000,notes:10000,prompts:2000};
  const all=new Set(),out={format:'toki-workspace',version:1};
  const string=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw Error('作業管理の文字数または入力内容が不正です。');return v;};
  const date=v=>v===''||(/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T12:00:00'))&&new Date(v+'T12:00:00').toISOString().slice(0,10)===v);
  for(const type of Object.keys(limits)){
    const rows=value[type];if(!Array.isArray(rows)||rows.length>limits[type])throw Error('作業管理の件数が上限を超えています。');
    out[type]=rows.map(item=>{
      if(!item||typeof item!=='object')throw Error('作業管理の行が不正です。');
      const id=string(item.id,160,true),title=string(item.title,160,true),project=string(item.project??'',80),createdAt=string(item.createdAt,40,true),updatedAt=string(item.updatedAt,40,true);
      if(all.has(type+id)||!Number.isFinite(Date.parse(createdAt))||!Number.isFinite(Date.parse(updatedAt)))throw Error('作業管理のIDまたは日時が不正です。');
      all.add(type+id);
      const base={id,title,project,createdAt,updatedAt};
      if(type==='tasks'){
        const due=string(item.due??'',10),status=string(item.status,15),priority=string(item.priority,15),detail=string(item.detail??'',4000);
        if(!date(due)||!['todo','doing','done'].includes(status)||!['high','normal','low'].includes(priority))throw Error('タスクの日付・状態が不正です。');
        return {...base,due,status,priority,detail};
      }
      if(type==='notes')return {...base,body:string(item.body??'',10000)};
      if(type==='prompts')return {...base,body:string(item.body??'',15000),category:string(item.category??'',80)};
      return {...base,description:string(item.description??'',2000)};
    });
  }
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
export const taskBuckets=(tasks,today)=>({overdue:tasks.filter(x=>x.status!=='done'&&x.due&&x.due<today),today:tasks.filter(x=>x.status!=='done'&&x.due===today),upcoming:tasks.filter(x=>x.status!=='done'&&(!x.due||x.due>today)),done:tasks.filter(x=>x.status==='done')});
