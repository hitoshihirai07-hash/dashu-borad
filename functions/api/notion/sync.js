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
 }while(cursor);return rows.filter(x=>!x.in_trash).map(decode);
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
 const resolutions=(await request.json().catch(()=>({}))).resolutions||{};
 if(!resolutions||typeof resolutions!=='object'||Array.isArray(resolutions)||Object.entries(resolutions).some(([id,c])=>!id||id.length>160||!['local','notion'].includes(c)))return json({error:'解決方法が不正です。'},400);
 const updates=[],conflicts=[],newLinks={...links},now=new Date().toISOString();
 let remote;try{remote=await list(env);}catch(e){return json({error:e.message},502);}
 const remoteById=new Map(remote.map(x=>[x.id,x]));
 const original=workspace.tasks;let tasks=[...original],changed=false;
 const deleted=new Set(workspace.deletedTaskIds);
 const keys=Object.keys(canonical({title:'',status:'',due:'',priority:'',project:'',detail:'',completedAt:''}));
 const conflict=(id,title,reason,local,notion,fields=[])=>conflicts.push({id,title,reason,local:local?canonical(local):null,notion:notion?canonical(notion):null,fields});
 const adopt=(local,other)=>{
  if(local.status!==other.status)tasks=workspaceSetTaskStatus({...workspace,tasks},local.id,other.status,now.slice(0,10),()=>crypto.randomUUID()).tasks;
  const current=tasks.find(t=>t.id===local.id);if(!current)throw Error('タスクが見つかりません');
  const patched={...current,...canonical(other),completedAt:other.status==='done'?(other.completedAt||current.completedAt||now):'',updatedAt:now};
  tasks=tasks.map(t=>t.id===local.id?patched:t);changed=true;return patched;
 };
 const remove=id=>{tasks=tasks.filter(t=>t.id!==id);deleted.add(id);changed=true;};
 const patch=async(other,properties)=>{
  const fresh=await notion(env,'pages/'+other.notionId);
  if(fresh.in_trash||fresh.last_edited_time!==other.notionEdited)throw Error('Notionが同期中に変更されました。再同期してください。');
  await notion(env,'pages/'+other.notionId,'PATCH',properties);
 };
 const create=async(local)=>{
  const page=await notion(env,'pages','POST',{parent:{type:'data_source_id',data_source_id:env.NOTION_TASK_DATA_SOURCE_ID||TASK_DS},properties:props(local)});
  newLinks[local.id]={page:page.id,local:fingerprint(local),remote:fingerprint(local)};
  updates.push(local.title+'：Notionへ追加');
 };
 try{
  for(const id of deleted){
   const other=remoteById.get(id),previous=links[id],choice=resolutions[id];
   if(!other){delete newLinks[id];continue;}
   if(previous&&previous.page!==other.notionId){conflict(id,other.title,'NotionページIDの不一致',null,other);continue;}
   if((!previous||previous.remote!==fingerprint(other))&&!choice){conflict(id,other.title,'削除済みタスクがNotion側で変更・存在しています',null,other);continue;}
   if(choice==='notion'){
    const restored=freshTask(other,now);tasks.push(restored);deleted.delete(id);changed=true;
    newLinks[id]={page:other.notionId,local:fingerprint(restored),remote:fingerprint(other)};updates.push(other.title+'：Notionから復元');
   }else{await patch(other,{in_trash:true});delete newLinks[id];updates.push(other.title+'：Notion側もアーカイブ');}
  }
  for(const local of original){
   if(deleted.has(local.id))continue;
   if(local.status==='done'&&!links[local.id]&&!remoteById.has(local.id))continue;
   const other=remoteById.get(local.id),previous=links[local.id],choice=resolutions[local.id],lh=fingerprint(local);
   if(other&&previous&&previous.page!==other.notionId){conflict(local.id,local.title,'NotionページIDの不一致',local,other);continue;}
   if(!other){
    if(previous&&!choice){conflict(local.id,local.title,'Notion側に見つかりません',local,null);continue;}
    if(previous&&choice==='notion'){remove(local.id);delete newLinks[local.id];updates.push(local.title+'：Notion側の削除を採用');continue;}
    await create(local);continue;
   }
   const rh=fingerprint(other);
   if(!previous){
    if(lh!==rh&&!choice){conflict(local.id,local.title,'初回の内容が異なります',local,other);continue;}
    if(choice==='local'){await patch(other,{properties:props(local)});newLinks[local.id]={page:other.notionId,local:lh,remote:lh};updates.push(local.title+'：ときの記録を採用');continue;}
    if(choice==='notion'){const next=adopt(local,other);newLinks[local.id]={page:other.notionId,local:fingerprint(next),remote:rh};updates.push(local.title+'：Notionを採用');continue;}
    newLinks[local.id]={page:other.notionId,local:lh,remote:rh};continue;
   }
   if(lh===rh){newLinks[local.id]={page:other.notionId,local:lh,remote:rh};continue;}
   if(choice==='local'){await patch(other,{properties:props(local)});newLinks[local.id]={page:other.notionId,local:lh,remote:lh};updates.push(local.title+'：ときの記録を採用');continue;}
   if(choice==='notion'){const next=adopt(local,other);newLinks[local.id]={page:other.notionId,local:fingerprint(next),remote:rh};updates.push(local.title+'：Notionを採用');continue;}
   const lc=lh!==previous.local,rc=rh!==previous.remote;
   if(!lc&&!rc)continue;
   if(lc&&!rc){await patch(other,{properties:props(local)});newLinks[local.id]={page:other.notionId,local:lh,remote:lh};updates.push(local.title+'：Notionへ反映');continue;}
   if(rc&&!lc){
    if(local.repeat&&['waiting','someday'].includes(other.status)){conflict(local.id,local.title,'ルーチンの待機状態は手動確認',local,other);continue;}
    const next=adopt(local,other);newLinks[local.id]={page:other.notionId,local:fingerprint(next),remote:rh};updates.push(local.title+'：ときの記録へ反映');continue;
   }
   let baseLocal,baseRemote;
   try{baseLocal=JSON.parse(previous.local);baseRemote=JSON.parse(previous.remote);}catch{conflict(local.id,local.title,'同期履歴が不正です',local,other);continue;}
   const left=canonical(local),right=canonical(other);
   const fields=keys.filter(k=>left[k]!==baseLocal[k]&&right[k]!==baseRemote[k]&&left[k]!==right[k]);
   if(fields.length){conflict(local.id,local.title,'両方で同じ項目が変更されています',local,other,fields);continue;}
   const merged={...right};for(const key of keys)if(left[key]!==baseLocal[key])merged[key]=left[key];
   if(local.repeat&&['waiting','someday'].includes(merged.status)){conflict(local.id,local.title,'ルーチンの待機状態は手動確認',local,other);continue;}
   if(fingerprint(merged)!==rh)await patch(other,{properties:props(merged)});
   const next=adopt(local,merged);newLinks[local.id]={page:other.notionId,local:fingerprint(next),remote:fingerprint(next)};
   updates.push(local.title+'：別項目の変更を自動統合');
  }
  for(const other of remote){
   if(deleted.has(other.id)||tasks.some(t=>t.id===other.id)||original.some(t=>t.id===other.id))continue;
   if(links[other.id]){
    if(!resolutions[other.id]){conflict(other.id,other.title,'ときの記録側で見つかりません',null,other);continue;}
    if(resolutions[other.id]==='local'){await patch(other,{in_trash:true});delete newLinks[other.id];deleted.add(other.id);changed=true;updates.push(other.title+'：Notion側をアーカイブ');continue;}
   }
   const added=freshTask(other,now);if(!added.title.trim())continue;
   tasks.push(added);changed=true;newLinks[other.id]={page:other.notionId,local:fingerprint(added),remote:fingerprint(other)};
   updates.push(other.title+'：Notionから追加');
  }
  if(changed||deleted.size!==workspace.deletedTaskIds.length){
   const revised=workspaceValidate({...workspace,tasks,deletedTaskIds:[...deleted]});
   const next=validateCloudData({...state,sections:{...state.sections,'toki-workspace-v1':JSON.stringify(revised)}});
   const packed=JSON.stringify(next);
   if(new TextEncoder().encode(packed).length>1800000)throw Error('保存容量の上限です');
   const write=await env.DB.prepare('UPDATE app_state SET revision=revision+1,payload=?,updated_at=? WHERE owner=? AND revision=?').bind(packed,now,owner,stateRow.revision).run();
   if(write.meta?.changes!==1)return json({error:'他端末で更新されました。再同期してください。'},409);
  }
  const packed=JSON.stringify(newLinks);
  const saved=row?await env.DB.prepare('UPDATE app_state SET revision=revision+1,payload=?,updated_at=? WHERE owner=? AND revision=?').bind(packed,now,mapKey,row.revision).run():await env.DB.prepare('INSERT INTO app_state (owner,revision,payload,updated_at) VALUES (?,1,?,?) ON CONFLICT(owner) DO NOTHING').bind(mapKey,packed,now).run();
  if(saved.meta?.changes!==1)return json({error:'同期履歴を更新できませんでした。再同期してください。'},409);
  return json({updated:updates,conflicts,taskCount:tasks.length,changed:changed||deleted.size!==workspace.deletedTaskIds.length});
 }catch(e){return json({error:'同期を中断しました。途中までNotionに反映された可能性があります。再同期してください。 '+e.message},502);}
}
