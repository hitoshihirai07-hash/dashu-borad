import {verifySession} from '../../../src/server-auth.js';
import {workspaceValidate,workspaceFresh,workspaceSetTaskStatus,workspaceChange} from '../../../src/workspace-model.js';
import {validateCloudData} from '../../../src/cloud-schema.js';

const TASK_DS='01d03e12-6072-4471-834f-05105134ac65';
const labels={todo:'未着手',doing:'進行中',waiting:'待機中',someday:'いつか',done:'完了'};
const revLabels=Object.fromEntries(Object.entries(labels).map(([a,b])=>[b,a]));
const priorities={high:'高',normal:'通常',low:'低'};
const revPriorities=Object.fromEntries(Object.entries(priorities).map(([a,b])=>[b,a]));
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const plain=s=>{const value=String(s??'');return value?Array.from({length:Math.ceil(value.length/1800)},(_,i)=>({text:{content:value.slice(i*1800,(i+1)*1800)}})):[];};
const text=p=>(p?.rich_text||p?.title||[]).map(x=>x.plain_text??x.text?.content??'').join('');
const canonical=t=>({title:t.title,status:t.status,due:t.due||'',priority:t.priority||'normal',project:t.project||'',detail:t.detail||'',completedAt:t.completedAt||''});
const fingerprint=t=>JSON.stringify(canonical(t));
const decode=p=>({
 id:text(p.properties?.['ダッシュボードID'])||'notion-'+p.id,
 title:text(p.properties?.['タスク名']),
 status:revLabels[p.properties?.['状態']?.status?.name]||'todo',
 due:p.properties?.['予定日']?.date?.start?.slice(0,10)||'',
 priority:revPriorities[p.properties?.['優先度']?.select?.name]||'normal',
 project:text(p.properties?.['プロジェクト']),
 detail:text(p.properties?.['詳細']),
 completedAt:p.properties?.['完了日時']?.date?.start||'',
 notionId:p.id,notionEdited:p.last_edited_time
});
const props=t=>({
 'タスク名':{title:plain(t.title)},
 '状態':{status:{name:labels[t.status]||labels.todo}},
 '予定日':{date:t.due?{start:t.due}:null},
 '優先度':{select:{name:priorities[t.priority]||'通常'}},
 'プロジェクト':{rich_text:plain(t.project||'')},
 '詳細':{rich_text:plain(t.detail||'')},
 '完了日時':{date:t.completedAt?{start:t.completedAt}:null},
 'ダッシュボードID':{rich_text:plain(t.id)}
});
async function notion(env,path,method='GET',body){
 let response;for(let attempt=0;attempt<3;attempt++){response=await fetch('https://api.notion.com/v1/'+path,{method,headers:{'Authorization':'Bearer '+env.NOTION_TOKEN,'Notion-Version':'2026-03-11','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(response.status!==429||attempt===2)break;
  const wait=Math.min(5,Math.max(1,Number(response.headers.get('Retry-After'))||1));
  await new Promise(resolve=>setTimeout(resolve,wait*1000));}
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error('Notion API ('+response.status+'): '+(result.message||'通信失敗'));
 return result;
}
async function list(env){
 let cursor,rows=[];do{
  const response=await notion(env,'data_sources/'+(env.NOTION_TASK_DATA_SOURCE_ID||TASK_DS)+'/query','POST',{page_size:100,...(cursor?{start_cursor:cursor}:{})});
  rows.push(...(response.results||[]));cursor=response.has_more?response.next_cursor:null;
  if(rows.length>10000)throw Error('Notion件数が上限を超えました');
 }while(cursor);return rows.filter(x=>!x.archived&&!x.in_trash).map(decode);
}
const freshTask=(r,at)=>({
 id:r.id,title:r.title,project:r.project,createdAt:at,updatedAt:at,
 status:r.status,priority:r.priority,due:r.due,detail:r.detail,completedAt:r.completedAt,
 startTime:'',endTime:'',assignee:'self',aiService:'',aiState:'not_requested',aiRequestedAt:'',aiCheckedAt:'',
 memo:'',stage:'',steps:[],repeat:null,routineId:'',skipped:false,reviewDate:'',waitingFor:'',
 startCondition:'',dueHistory:[],originalDue:''
});
export async function onRequest({request,env}){
 if(!['GET','POST'].includes(request.method))return json({error:'GET・POSTのみ対応しています。'},405);
 if(request.method==='POST'&&request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'別サイトから同期できません。'},403);
 if(!env.DB||!env.NOTION_TOKEN)return json({error:'CloudflareのD1・NOTION_TOKEN設定が必要です。'},503);
 let owner;try{owner=await verifySession(request,env);}catch{return json({error:'認証設定を確認してください。'},503);}
 if(!owner)return json({error:'ログインが必要です。'},401);
 const stateRow=await env.DB.prepare('SELECT revision,payload FROM app_state WHERE owner=?').bind(owner).first();
 if(!stateRow)return json({error:'まずダッシュボードのクラウド同期を開始してください。'},409);
 const mapKey='__notion_bridge_v1__:'+owner;
 const row=await env.DB.prepare('SELECT revision,payload FROM app_state WHERE owner=?').bind(mapKey).first();
 if(request.method==='GET')return json({configured:true,initialized:!!row});
 let state;try{state=validateCloudData(JSON.parse(stateRow.payload));}catch{return json({error:'保存データ形式を確認できません。'},409);}
 let workspace;try{workspace=workspaceValidate(JSON.parse(state.sections['toki-workspace-v1']));}catch{return json({error:'タスクデータの形式が不正です。'},409);}
 const links=row?JSON.parse(row.payload):{};
 const synced=new Set(),updates=[],conflicts=[],newLinks={...links},now=new Date().toISOString();
 let remote;try{remote=await list(env);}catch(e){return json({error:e.message},502);}
 const remoteById=new Map(remote.map(x=>[x.id,x]));
 const original=workspace.tasks;
 let tasks=[...original],changed=false;
 try{
  for(const local of original){
   if(local.status==='done'&&!links[local.id])continue; // Initial migration excludes completed tasks.
   const other=remoteById.get(local.id),previous=links[local.id];
   if(other&&previous&&previous.page!==other.notionId){conflicts.push(local.title+'：連携先のIDが変更されています');continue;}
   if(!other){
    if(previous){conflicts.push(local.title+'：Notion側で見つかりません（削除・権限変更の可能性）');continue;}
    const created=await notion(env,'pages','POST',{parent:{type:'data_source_id',data_source_id:env.NOTION_TASK_DATA_SOURCE_ID||TASK_DS},properties:props(local)});
    newLinks[local.id]={page:created.id,local:fingerprint(local),remote:fingerprint(local)};
    updates.push(local.title+'：Notionへ追加');synced.add(local.id);continue;
   }
   synced.add(other.id);
   const localHash=fingerprint(local),remoteHash=fingerprint(other);
   if(!previous){
    if(localHash!==remoteHash){conflicts.push(local.title+'：初回紐付け内容が異なります');continue;}
    newLinks[local.id]={page:other.notionId,local:localHash,remote:remoteHash};continue;
   }
   const lc=localHash!==previous.local,rc=remoteHash!==previous.remote;
   if(lc&&rc&&localHash!==remoteHash){conflicts.push(local.title+'：両方で変更されています');continue;}
   if(lc&&!rc){
    const currentPage=await notion(env,'pages/'+other.notionId);
    if(currentPage.last_edited_time!==other.notionEdited){conflicts.push(local.title+'：Notionで同期中に変更されました');continue;}
    await notion(env,'pages/'+other.notionId,'PATCH',{properties:props(local)});
    newLinks[local.id]={page:other.notionId,local:localHash,remote:localHash};
    updates.push(local.title+'：Notionへ反映');
   }else if(rc&&!lc){
    let next;
    if(local.status!==other.status){
      if(local.repeat&&['waiting','someday'].includes(other.status)){conflicts.push(local.title+'：ルーチンタスクの待機指定は手動確認してください');continue;}
      next=workspaceSetTaskStatus({...workspace,tasks},local.id,other.status,now.slice(0,10),()=>crypto.randomUUID()).tasks;
      const candidate=next.find(x=>x.id===local.id);
      if(!candidate){conflicts.push(local.title+'：ルーチンタスクを同期できません');continue;}
    }else next=tasks;
    const current=next.find(x=>x.id===local.id);
    if(!current){conflicts.push(local.title+'：タスクがありません');continue;}
    const patched={...current,...canonical(other),completedAt:other.status==='done'?(other.completedAt||current.completedAt||now):'',updatedAt:now};
    tasks=next.map(x=>x.id===local.id?patched:x);
    changed=true;
    newLinks[local.id]={page:other.notionId,local:fingerprint(patched),remote:remoteHash};
    updates.push(local.title+'：ダッシュボードへ反映');
   }else if(lc&&rc){
    newLinks[local.id]={page:other.notionId,local:localHash,remote:remoteHash};
   }
  }
  for(const other of remote){
   if(synced.has(other.id)||original.some(x=>x.id===other.id))continue;
   if(links[other.id]){conflicts.push(other.title+'：ダッシュボード側で見つかりません。削除確認が必要です');continue;}
   const adopted=freshTask(other,now);
   if(!adopted.title.trim())continue;
   tasks.push(adopted);changed=true;
   newLinks[other.id]={page:other.notionId,local:fingerprint(adopted),remote:fingerprint(other)};
   updates.push(other.title+'：Notionから追加');
  }
  if(changed){
   const revised=workspaceValidate({...workspace,tasks});
   const next=validateCloudData({...state,sections:{...state.sections,'toki-workspace-v1':JSON.stringify(revised)}});
   const packed=JSON.stringify(next);
   if(new TextEncoder().encode(packed).length>1800000)throw Error('D1同期データが容量上限です');
   const write=await env.DB.prepare('UPDATE app_state SET revision=revision+1,payload=?,updated_at=? WHERE owner=? AND revision=?').bind(packed,now,owner,stateRow.revision).run();
   if(write.meta?.changes!==1)return json({error:'別の端末で更新されたため反映を中断しました。再試行してください。'},409);
  }
  const packed=JSON.stringify(newLinks);
  const saved=row?await env.DB.prepare('UPDATE app_state SET revision=revision+1,payload=?,updated_at=? WHERE owner=? AND revision=?').bind(packed,now,mapKey,row.revision).run():await env.DB.prepare('INSERT INTO app_state (owner,revision,payload,updated_at) VALUES (?,1,?,?) ON CONFLICT(owner) DO NOTHING').bind(mapKey,packed,now).run();
  if(saved.meta?.changes!==1)return json({error:'同期履歴が同時更新されました。再試行してください。'},409);
  return json({updated:updates,conflicts,taskCount:tasks.length,changed});
 }catch(e){return json({error:'途中までNotionに反映された可能性があります。再同期で照合してください。 '+e.message},502);}
}