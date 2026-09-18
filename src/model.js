export const KEY = 'toki-records-v1';
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const uid = () => globalThis.crypto?.randomUUID?.() || `t-${Date.now().toString(36)}-${Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)),x=>x.toString(36)).join('')}`;
export const fresh = () => ({format:'toki-records',version:2,records:[]});
export function validDate(value) {
  if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value+'T12:00:00');
  return !Number.isNaN(+d) && localDate(d) === value && value >= '1900-01-01' && value <= '2200-12-31';
}
export function validate(data) {
  if(!data || data.format!=='toki-records' || ![1,2].includes(data.version) || !Array.isArray(data.records) || data.records.length>50000) throw Error('「ときの記録」の共有ファイル（バージョン1・2）を選んでください。');
  const ids=new Set();
  const records=data.records.map(r=>{
    if(!r || typeof r.id!=='string' || !r.id || r.id.length>160 || ids.has(r.id) || typeof r.rev!=='string' || !r.rev || r.rev.length>160 || !Array.isArray(r.parents) || r.parents.length>10000 || r.parents.some(x=>typeof x!=='string'||x.length>160) || !validDate(r.date) || typeof r.activity!=='string' || !r.activity.trim() || r.activity.length>80 || !Number.isInteger(r.minutes) || r.minutes<30 || r.minutes>1440 || r.minutes%30!==0 || typeof r.note!=='string' || r.note.length>2000 || typeof r.deleted!=='boolean' || typeof r.updatedAt!=='string' || !Number.isFinite(Date.parse(r.updatedAt))) throw Error('記録の形式が正しくありません。元の共有ファイルを確認してください。');
    const field=data.version===1&&r.field===undefined?'その他':r.field;
    const project=data.version===1&&r.project===undefined?'未分類':r.project;
    if([field,project].some(v=>typeof v!=='string'||!v.trim()||v.length>80)) throw Error('分野・プロジェクトは1〜80文字で指定してください。');
    ids.add(r.id);
    return {field:field.trim(),project:project.trim(),id:r.id,rev:r.rev,parents:[...new Set(r.parents)],date:r.date,activity:r.activity.trim(),minutes:r.minutes,note:r.note,deleted:r.deleted,updatedAt:r.updatedAt};
  });
  return {format:'toki-records',version:2,records};
}
export function revise(old, values) {
  return {field:old?.field||'その他',project:old?.project||'未分類',...values,id:old?.id||uid(),rev:uid(),parents:old?[...new Set([...old.parents,old.rev])]:[],updatedAt:new Date().toISOString(),deleted:values.deleted??false};
}
const samePayload=(a,b)=>a.date===b.date&&a.activity===b.activity&&a.minutes===b.minutes&&a.note===b.note&&a.deleted===b.deleted&&a.field===b.field&&a.project===b.project;
export function planMerge(local, incoming) {
  local=validate(local);incoming=validate(incoming);
  const map=new Map(local.records.map(r=>[r.id,r]));
  const conflicts=[]; let added=0,updated=0,unchanged=0;
  for(const remote of incoming.records){
    const here=map.get(remote.id);
    if(!here){map.set(remote.id,remote);added++;}
    else if(here.rev===remote.rev){if(!samePayload(here,remote))throw Error('同じ版の記録に異なる内容があります。ファイルが変更されていないか確認してください。');unchanged++;}
    else if(here.parents.includes(remote.rev)){unchanged++;}
    else if(remote.parents.includes(here.rev)){map.set(remote.id,remote);updated++;}
    else if(samePayload(here,remote)){map.set(here.id,{...here,rev:uid(),parents:[...new Set([...here.parents,here.rev,...remote.parents,remote.rev])],updatedAt:new Date().toISOString()});updated++;}
    else conflicts.push({local:here,incoming:remote});
  }
  return {records:[...map.values()],conflicts,added,updated,unchanged};
}
export function resolveMerge(plan, choices) {
  const map=new Map(plan.records.map(r=>[r.id,r]));
  for(const c of plan.conflicts){
    const choice=choices[c.local.id];
    if(!['local','incoming'].includes(choice)) throw Error('内容が異なる記録について、残す方を選んでください。');
    const selected=c[choice];
    map.set(selected.id,{...selected,rev:uid(),parents:[...new Set([...c.local.parents,c.local.rev,...c.incoming.parents,c.incoming.rev])],updatedAt:new Date().toISOString()});
  }
  return validate({format:'toki-records',version:2,records:[...map.values()]});
}
export function periodRange(mode, date) {
  const start=new Date(date+'T12:00:00'),end=new Date(start);
  if(mode==='week'){start.setDate(start.getDate()-(start.getDay()+6)%7);end.setTime(+start);end.setDate(end.getDate()+6);}
  if(mode==='month'){start.setDate(1);end.setMonth(end.getMonth()+1,0);}
  return {start:localDate(start),end:localDate(end)};
}
export function shiftDate(mode,date,dir){
  const d=new Date(date+'T12:00:00');
  if(mode==='month'){d.setDate(1);d.setMonth(d.getMonth()+dir);} else d.setDate(d.getDate()+dir*(mode==='week'?7:1));
  return localDate(d);
}
export const activeRecords = data => data.records.filter(r=>!r.deleted);
export const inRange = (records,range) => records.filter(r=>r.date>=range.start&&r.date<=range.end);
export function groups(records,key='activity'){const map=new Map();for(const r of records)map.set(r[key],(map.get(r[key])||0)+r.minutes);return [...map].sort((a,b)=>b[1]-a[1]);}

// Candidates are suggestions; saved custom project/activity names are also offered by the UI.
export const FIELD_PRESETS = {
  'プロ野球': {projects:['プロ野球観戦メモ','PlayerLens','SNS','ベンチからの一手','データ整理・分析','その他'],activities:['記事作成','サイト更新','データ更新','分析','SNS投稿','調査','不具合修正','企画']},
  'Python': {projects:['Python学習','CSV処理','データ分析','自動化','その他'],activities:['学習','実践','デバッグ','復習']},
  'その他': {projects:['未分類','その他'],activities:['ブログ更新','動画編集','SNS更新','リサーチ','学習']}
};
export const byField=(records,field)=>field==='all'?records:records.filter(r=>r.field===field);
