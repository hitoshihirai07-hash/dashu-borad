import {verifySession} from '../../../src/server-auth.js';
import {normalizeBaseballGame} from '../../../src/baseball-model.js';
import {normalizeBaseballData} from '../../../src/baseball-data-model.js';

const VERSION=1,FORMAT='toki-baseball-archive-v1',MAX_ROWS=10000;
const types={
  game:'__baseball_game_v1__:',
  data:'__baseball_data_v1__:',
  note:'__baseball_note_v1__:',
  notion:'__baseball_notion_v1__:',
  schedule:'__baseball_schedule_seed_v1__:'
};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const idRe=/^20\d{2}-\d{2}-\d{2}~[a-z]+~[^~:]{1,40}~[1-3]$/;
const uuidRe=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const gameId=(id)=>typeof id==='string'&&id.length<=110&&idRe.test(id);
const token=(type,owner)=>types[type]+owner+':';
const key=(row,owner)=>token(row.type,owner)+row.id;
const relatedNote=(id)=>{
  const index=id.lastIndexOf(':');
  if(index<1)return false;
  const suffix=id.slice(index+1),encoded=id.slice(0,index);
  let decoded;
  try{decoded=decodeURIComponent(encoded);}catch{return false;}
  return gameId(decoded)&&encoded===encodeURIComponent(decoded)&&uuidRe.test(suffix);
};
export function validateBaseballArchive(input){
  if(!input||input.format!==FORMAT||input.version!==VERSION||!Array.isArray(input.rows)||input.rows.length>MAX_ROWS)
    throw Error('試合管理バックアップの形式・件数が不正です。');
  const seen=new Set(),rows=[];
  for(const row of input.rows){
    if(!row||typeof row!=='object'||!Object.hasOwn(types,row.type)||typeof row.id!=='string'||row.id.length>200
      ||typeof row.payload!=='string'||row.payload.length>32000)
      throw Error('バックアップ内のレコード形式が不正です。');
    const identity=row.type+':'+row.id;
    if(seen.has(identity))throw Error('バックアップに同じ試合・メモが重複しています。');
    seen.add(identity);
    const allowed=row.type==='note'?relatedNote(row.id):
      row.type==='schedule'?row.id==='2027':gameId(row.id);
    if(!allowed)throw Error('バックアップに不正なレコードIDがあります。');
    let data;try{data=JSON.parse(row.payload);}catch{throw Error('バックアップのJSONが不正です。');}
    if(row.type==='game'){
      const game=normalizeBaseballGame(data?.game);
      if([game.date,game.gameType,game.opponent,game.gameNumber].join('~')!==row.id)
        throw Error('バックアップの試合IDが実際の試合と一致しません。');
      if(typeof data?.createdAt!=='string'||typeof data?.updatedAt!=='string')
        throw Error('試合の作成・更新日時が不正です。');
    }else if(row.type==='data'){
      normalizeBaseballData(data);
    }else if(row.type==='note'){
      if(!data||typeof data.body!=='string'||data.body.length>4000
        ||!['before','during','after'].includes(data.phase)||typeof data.inning!=='string'||data.inning.length>20)
        throw Error('観戦メモの形式が不正です。');
    }else if(row.type==='notion'){
      if(!data||typeof data.page!=='string'||!(/^[0-9a-f-]{32,36}$/i.test(data.page))||typeof data.target!=='string')
        throw Error('Notion連携履歴の形式が不正です。');
    }else if(row.type==='schedule'){
      if(!data||typeof data!=='object'||data.snapshot===undefined)throw Error('日程管理履歴の形式が不正です。');
    }
    rows.push({type:row.type,id:row.id,payload:row.payload});
  }
  return rows;
}
async function databaseRows(DB,owner){
  const output=[];
  for(const type of Object.keys(types)){
    const prefix=token(type,owner);
    const result=await DB.prepare('SELECT owner,revision,payload FROM app_state WHERE substr(owner,1,?)=? ORDER BY owner LIMIT 10001')
      .bind(prefix.length,prefix).all();
    if((result.results||[]).length>MAX_ROWS)throw Error('試合の記録が多すぎるため、バックアップを停止しました。');
    for(const record of result.results||[]){
      output.push({type,id:record.owner.slice(prefix.length),payload:record.payload});
      if(output.length>MAX_ROWS)throw Error('試合の記録が多すぎるため、バックアップを停止しました。');
    }
  }
  return output;
}
const equal=(a,b)=>{try{return JSON.stringify(JSON.parse(a))===JSON.stringify(JSON.parse(b));}catch{return a===b;}};
export function compareBaseballArchives(incoming,current){
  const known=new Map(current.map(row=>[row.type+':'+row.id,row]));
  const summary={total:incoming.length,missing:0,identical:0,conflicts:0,types:{}};
  for(const type of Object.keys(types))summary.types[type]={missing:0,identical:0,conflicts:0};
  for(const row of incoming){
    const existing=known.get(row.type+':'+row.id);
    const status=!existing?'missing':equal(existing.payload,row.payload)?'identical':'conflicts';
    summary[status]++;summary.types[row.type][status]++;
  }
  return summary;
}
export async function onRequest({request,env}){
  if(!['GET','POST'].includes(request.method))return json({error:'GETとPOSTのみ対応しています。'},405);
  if(!env.DB)return json({error:'D1データベースが設定されていません。'},503);
  if(request.method==='POST'){
    if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'別サイトから復元できません。'},403);
    if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({error:'JSONで送信してください。'},415);
  }
  let owner;try{owner=await verifySession(request,env);}catch{return json({error:'ログイン設定を確認してください。'},503);}
  if(!owner)return json({error:'ログインが必要です。'},401);
  try{
    if(request.method==='GET'){
      const rows=await databaseRows(env.DB,owner);
      return json({format:FORMAT,version:VERSION,exportedAt:new Date().toISOString(),rows});
    }
    const raw=await request.text();
    if(new TextEncoder().encode(raw).length>16_000_000)return json({error:'バックアップは16MB以下にしてください。'},413);
    let input;try{input=JSON.parse(raw);}catch{return json({error:'JSONの形式が不正です。'},400);}
    if(!['preview','restore'].includes(input?.action))return json({error:'復元操作が不正です。'},400);
    const rows=validateBaseballArchive(input.archive);
    const current=await databaseRows(env.DB,owner);
    const knownGames=new Set([...current,...rows].filter(row=>row.type==='game').map(row=>row.id));
    for(const row of rows){
      if(!['data','note','notion'].includes(row.type))continue;
      const parent=row.type==='note'?decodeURIComponent(row.id.slice(0,row.id.lastIndexOf(':'))):row.id;
      if(!knownGames.has(parent))throw Error('親となる試合がないデータ・メモが含まれています。');
    }
    const summary=compareBaseballArchives(rows,current);
    if(input.action==='preview')return json({summary});
    if(!rows.length)return json({summary,created:0});
    const exists=new Set(current.map(row=>row.type+':'+row.id));
    const rank={game:0,data:1,note:2,notion:3,schedule:4};
    const missing=rows.filter(row=>!exists.has(row.type+':'+row.id)).sort((a,b)=>rank[a.type]-rank[b.type]);
    let created=0;
    const now=new Date().toISOString();
    for(let i=0;i<missing.length;i+=35){
      const statements=missing.slice(i,i+35).map(row=>env.DB.prepare('INSERT INTO app_state (owner,revision,payload,updated_at) VALUES (?,1,?,?) ON CONFLICT(owner) DO NOTHING')
        .bind(key(row,owner),row.payload,now));
      // D1 batch is transactional; existing records are never updated.
      const results=typeof env.DB.batch==='function'?await env.DB.batch(statements):await Promise.all(statements.map(statement=>statement.run()));
      created+=results.reduce((sum,row)=>sum+(row?.meta?.changes===1?1:0),0);
    }
    return json({summary,created,skipped:summary.identical+summary.conflicts+(summary.missing-created)});
  }catch(e){
    return json({error:'試合バックアップの処理を中止しました。'+e.message},400);
  }
}