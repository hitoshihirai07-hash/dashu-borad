import {verifySession} from '../../../src/server-auth.js';
import {normalizeBaseballGame} from '../../../src/baseball-model.js';
import {normalizeBaseballData,EMPTY_BASEBALL_DATA,displayPitchingInnings} from '../../../src/baseball-data-model.js';

export const BASEBALL_NOTION_TARGETS={
  2026:{id:'3e4ee5b7-9890-80d7-83e3-000baaba8f46',opponents:['広島','ヤクルト','阪神','DeNA'],starters:['戸郷','西舘','竹丸','井上','山﨑伊','小笠原']},
  2027:{id:'492ee5b7-9890-8384-b184-0773a2a579bc',opponents:['阪神','DeNA','ヤクルト','広島','中日','ソフトバンク','日本ハム','オリックス','西武','楽天'],starters:['戸郷','西舘','竹丸','井上','山﨑伊']}
};
const stadiums=new Set(['東京ドーム','神宮','甲子園','マツダスタジアム']);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const simple=s=>String(s??'').normalize('NFKC').replace(/[\s\u3000]+/g,'');
const rich=value=>{
  const chunks=[];let text='';
  for(const char of String(value??'')){
    if(text.length+char.length>1600){chunks.push({type:'text',text:{content:text}});text='';}
    text+=char;
  }
  if(text)chunks.push({type:'text',text:{content:text}});
  if(chunks.length>95)throw Error('Notionへ送る記録が長すぎます。');
  return chunks;
};
const readText=field=>(field?.rich_text||field?.title||[]).map(x=>x.plain_text??x.text?.content??'').join('');
const propertyValue=p=>p?.title?readText(p):p?.rich_text?readText(p):p?.select?p.select.name:p?.status?p.status.name:p?.date?p.date.start:p?.number!==undefined?p.number:p?.url!==undefined?p.url:null;
const identical=(a,b)=>String(a??'')===String(b??'');
const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const value=v=>v===null||v===undefined?'—':String(v);
const results={win:'勝ち',loss:'負け',draw:'引き分け'};
const statuses={scheduled:'未着手',playing:'進行中',finished:'完了',postponed:'未着手',canceled:'未着手'};
const gameTitle=g=>Number(g.date.slice(5,7))+'/'+Number(g.date.slice(8,10))+'　巨人対'+g.opponent+(g.gameNumber>1?'（第'+g.gameNumber+'試合）':'')+(g.gameType==='regular'?'':'（'+g.gameType+'）');
const dest=g=>{const d=BASEBALL_NOTION_TARGETS[g.season];if(!d)throw Error('Notionへのインポートは2026年と2027年の試合のみ対応です。');return d;};
export function baseballNotionProperties(game,link){
  const target=dest(game),p={'名前':{title:rich(gameTitle(game))},'試合日':{date:{start:game.date}}};
  if(target.opponents.includes(game.opponent))p['対戦相手']={select:{name:game.opponent}};
  if(game.opponentStarter)p['相手先発投手']={rich_text:rich(game.opponentStarter)};
  const starter=target.starters.find(name=>simple(game.giantsStarter)===simple(name)||simple(game.giantsStarter).startsWith(simple(name)));
  if(starter&&game.giantsStarter)p['巨人先発投手']={select:{name:starter}};
  if(stadiums.has(game.stadium))p['球場']={select:{name:game.stadium}};
  if(results[game.result])p['結果']={select:{name:results[game.result]}};
  if(link)p['参考URL']={url:link};
  if(game.season===2026)p['ステータス']={status:{name:statuses[game.state]||'未着手'}};
  if(game.season===2027){
    if(game.giantsScore!==null)p['巨人点数']={number:game.giantsScore};
    if(game.opponentScore!==null)p['相手点数 ']={number:game.opponentScore};
  }
  return p;
}
export function baseballNotionBody(game,data,notes){
  const lines=['【試合情報】',game.date+'　巨人 対 '+game.opponent+'　'+(game.stadium||'球場未入力'),
    'スコア：巨人 '+value(game.giantsScore)+' - '+value(game.opponentScore)+' '+game.opponent+'　'+(results[game.result]||'未確定'),
    '先発：巨人 '+(game.giantsStarter||'未入力')+'／'+game.opponent+' '+(game.opponentStarter||'未入力'),
    '試合区分：'+game.gameType+'／開催区分：'+game.location,'','【イニング別得点】'];
  for(const row of data.innings)lines.push(row.number+'回　巨人 '+value(row.giants)+'／'+game.opponent+' '+value(row.opponent));
  if(!data.innings.length)lines.push('未登録');
  lines.push('','【巨人スタメン】');
  for(const p of data.lineups.giants)lines.push(p.order+'番 '+p.position+' '+p.name);
  if(!data.lineups.giants.length)lines.push('未登録');
  lines.push('','【巨人・全打撃成績】','打順／守備／選手／打数／安打／打点／四球／死球／三振');
  for(const p of data.batters.giants)lines.push([p.order,p.position,p.name,p.atBats,p.hits,p.rbi,p.walks,p.hitByPitch,p.strikeouts].map(value).join('／'));
  if(!data.batters.giants.length)lines.push('未登録');
  lines.push('','【巨人・全投手成績】','登板／投手／回／球数／被安打／四球／奪三振／失点／自責');
  for(const [i,p] of data.pitchers.giants.entries())lines.push([i+1,p.name,displayPitchingInnings(p.outs)||'—',p.pitches,p.hits,p.walks,p.strikeouts,p.runs,p.earnedRuns].map(value).join('／'));
  if(!data.pitchers.giants.length)lines.push('未登録');
  lines.push('','【責任投手】','勝：'+(data.decisions.win||'—')+'　敗：'+(data.decisions.loss||'—')+'　セーブ：'+(data.decisions.save||'—'),'','【観戦メモ】');
  for(const n of notes){
    const when=Number.isFinite(Date.parse(n.createdAt))?new Date(n.createdAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'時刻不明';
    lines.push(when+'［'+(n.phase==='before'?'試合前':n.phase==='after'?'試合後':'試合中')+(n.inning?' '+n.inning:'')+'］'+n.body);
  }
  if(!notes.length)lines.push('未登録');
  if(game.sourceUrl||data.sourceUrl)lines.push('','参照元：'+(data.sourceUrl||game.sourceUrl));
  return lines.join('\n');
}
const marker=id=>'ときの記録からインポート｜'+id;
const paragraph=body=>({object:'block',type:'paragraph',paragraph:{rich_text:rich(body)}});
const toggle=(id,body)=>({object:'block',type:'toggle',toggle:{rich_text:rich(marker(id)),children:[paragraph(body)]}});
const blockText=b=>(b?.[b.type]?.rich_text||[]).map(p=>p.plain_text??p.text?.content??'').join('');
const gameKey=(owner,id)=>'__baseball_game_v1__:'+owner+':'+id;
const dataKey=(owner,id)=>'__baseball_data_v1__:'+owner+':'+id;
const noteKey=(owner,id)=>'__baseball_note_v1__:'+owner+':'+encodeURIComponent(id)+':';
const linkKey=(owner,id)=>'__baseball_notion_v1__:'+owner+':'+id;
const validId=id=>typeof id==='string'&&/^(2026|2027)-\d{2}-\d{2}~[a-z]+~[^~:]{1,40}~[1-3]$/.test(id)&&id.length<=110;
async function notion(env,path,method='GET',body){
  let response;
  for(let attempt=0;attempt<3;attempt++){
    response=await fetch('https://api.notion.com/v1/'+path,{
      method,headers:{Authorization:'Bearer '+env.NOTION_TOKEN,'Notion-Version':'2026-03-11','Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    if(response.status!==429||attempt===2)break;
    const retry=Math.min(5,Math.max(1,Number(response.headers.get('Retry-After'))||1));
    await new Promise(resolve=>setTimeout(resolve,retry*1000));
  }
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(response.status===404?'NOTION_TOKENの連携設定で2026年／2027年試合管理DBへのアクセスを許可してください。':'Notion API ('+response.status+')：'+(result.message||'通信に失敗しました。'));
  return result;
}
async function blocks(env,id){
  const all=[];let cursor;
  do{
    const q=new URLSearchParams({page_size:'100',...(cursor?{start_cursor:cursor}:{})});
    const page=await notion(env,'blocks/'+id+'/children?'+q);
    all.push(...(page.results||[]));cursor=page.has_more?page.next_cursor:null;
    if(all.length>1000)throw Error('Notionのページが大きすぎるため同期を止めました。');
  }while(cursor);
  return all.filter(x=>!x.archived&&!x.in_trash);
}
export function matchingNotionPage(page,game){
  const p=page.properties||{};
  if(p['試合日']?.date?.start?.slice(0,10)!==game.date)return false;
  const t=simple(readText(p['名前'])),opp=simple(p['対戦相手']?.select?.name);
  if(opp&&opp!==simple(game.opponent))return false;
  if(!opp&&!t.includes('巨人対'+simple(game.opponent)))return false;
  const number=/第(\d)試合/.exec(t);
  if((number?Number(number[1]):1)!==game.gameNumber)return false;
  if(game.gameType!=='regular'&&!t.includes(game.gameType))return false;
  if(game.gameType==='regular'&&/(climax|japan|exhibition|farm|other)/i.test(t))return false;
  return true;
}
async function lookup(env,game,target){
  let cursor,match=null;
  do{
    const query={filter:{property:'試合日',date:{equals:game.date}},page_size:100,...(cursor?{start_cursor:cursor}:{})};
    const res=await notion(env,'data_sources/'+target.id+'/query','POST',query);
    for(const p of res.results||[])if(!p.archived&&!p.in_trash&&matchingNotionPage(p,game)){
      if(match)throw Error('Notionに同一試合が複数あります。重複防止のため中断しました。');
      match=p;
    }
    cursor=res.has_more?res.next_cursor:null;
  }while(cursor);
  return match;
}
const snapshot=(page,desired)=>Object.fromEntries(Object.keys(desired).map(k=>[k,propertyValue(page.properties?.[k])]));
export function propertyChanges(page,desired,previous,adopting,protectedFields={}){
  const patch={},warnings=[],nextProtected={...protectedFields};
  for(const [key,prop] of Object.entries(desired)){
    if(adopting&&key==='名前'){
      const titleNow=propertyValue(page.properties?.[key]),titleWanted=propertyValue(prop);
      if(!identical(titleNow,titleWanted))nextProtected[key]={local:titleWanted,remote:titleNow};
      continue;
    }
    const old=propertyValue(page.properties?.[key]),wanted=propertyValue(prop);
    if(identical(old,wanted)){delete nextProtected[key];continue;}
    if(protectedFields[key]){
      const held=protectedFields[key];
      if(identical(wanted,held.local)){
        warnings.push(key+'：既存のNotion値を保持');
        continue;
      }
      if(!identical(old,held.remote)){
        warnings.push(key+'：Notion側の手動変更を保持');
        continue;
      }
      delete nextProtected[key]; // The app user explicitly changed the local field.
    }
    if(adopting&&!identical(old,'')){
      nextProtected[key]={local:wanted,remote:old};
      warnings.push(key+'：既存のNotion値を保持');
      continue;
    }
    if(previous&&Object.hasOwn(previous,key)&&!identical(old,previous[key])){warnings.push(key+'：Notion側の手動変更を保持');continue;}
    patch[key]=prop;
  }
  return {patch,warnings,protectedFields:nextProtected};
}
async function localData(env,owner,id){
  const DB=env.DB;
  const gameRow=await DB.prepare('SELECT revision,payload FROM app_state WHERE owner=?').bind(gameKey(owner,id)).first();
  if(!gameRow)throw Error('試合が未登録です。先にときの記録に登録してください。');
  const game=normalizeBaseballGame(JSON.parse(gameRow.payload).game);
  if(id!==[game.date,game.gameType,game.opponent,game.gameNumber].join('~'))throw Error('試合IDが登録内容と一致しません。');
  const details=await DB.prepare('SELECT revision,payload FROM app_state WHERE owner=?').bind(dataKey(owner,id)).first();
  const data=normalizeBaseballData(details?JSON.parse(details.payload):EMPTY_BASEBALL_DATA());
  const prefix=noteKey(owner,id);
  const rows=await DB.prepare('SELECT owner,payload FROM app_state WHERE substr(owner,1,?)=? ORDER BY owner LIMIT 501').bind(prefix.length,prefix).all();
  if((rows.results||[]).length>500)throw Error('メモが500件を超えています。');
  const notes=(rows.results||[]).map(r=>({...JSON.parse(r.payload),id:r.owner.slice(prefix.length)}))
    .filter(x=>!x.deleted).sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||'')||a.id.localeCompare(b.id));
  return {game,data,notes};
}
async function storeLink(env,key,row,newValue){
  const stamp=new Date().toISOString(),value=JSON.stringify(newValue);
  const result=row?await env.DB.prepare('UPDATE app_state SET revision=revision+1,payload=?,updated_at=? WHERE owner=? AND revision=?').bind(value,stamp,key,row.revision).run()
    :await env.DB.prepare('INSERT INTO app_state (owner,revision,payload,updated_at) VALUES (?,1,?,?) ON CONFLICT(owner) DO NOTHING').bind(key,value,stamp).run();
  if(result.meta?.changes!==1)throw Error('同期履歴が競合しました。もう一度ボタンを押して照合してください。');
}
export async function onRequest({request,env}){
  if(request.method!=='POST')return json({error:'Notionへインポートはボタンを押したときだけ実行できます。'},405);
  if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'別サイトからのインポートはできません。'},403);
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({error:'JSONで送信してください。'},415);
  if(!env.DB||!env.NOTION_TOKEN)return json({error:'CloudflareにD1とNOTION_TOKENが必要です。'},503);
  let owner;try{owner=await verifySession(request,env);}catch{return json({error:'ログイン設定を確認してください。'},503);}
  if(!owner)return json({error:'ログインが必要です。'},401);
  let payload;try{const raw=await request.text();if(raw.length>512)return json({error:'要求が大きすぎます。'},413);payload=JSON.parse(raw);}catch{return json({error:'試合IDが不正です。'},400);}
  const id=payload?.gameId;if(!validId(id))return json({error:'2026年または2027年の登録済み試合を選択してください。'},400);
  try{
    const {game,data,notes}=await localData(env,owner,id),target=dest(game);
    const text=baseballNotionBody(game,data,notes),bodyHash=await hash(text);
    const localHash=await hash(JSON.stringify({game,data,notes:notes.map(n=>({id:n.id,body:n.body,phase:n.phase,inning:n.inning,createdAt:n.createdAt}))}));
    rich(text); // fail before writing if rich_text would exceed the Notion limit
    const desired=baseballNotionProperties(game,data.sourceUrl||game.sourceUrl);
    const key=linkKey(owner,id),linkRow=await env.DB.prepare('SELECT revision,payload FROM app_state WHERE owner=?').bind(key).first();
    const link=linkRow?JSON.parse(linkRow.payload):null;
    let page=link?await notion(env,'pages/'+link.page):await lookup(env,game,target);
    let created=false,changed=false,warnings=[],protectedFields={...link?.protectedFields};
    if(link&&(!page||page.archived||page.in_trash||page.parent?.data_source_id!==target.id||!matchingNotionPage(page,game)))
      return json({error:'Notionで連携済みの試合が移動・変更されています。重複防止のため中断しました。'},409);
    if(!page){
      page=await notion(env,'pages','POST',{parent:{type:'data_source_id',data_source_id:target.id},
        properties:desired,icon:{type:'emoji',emoji:'⚾'},children:[toggle(id,text)]});
      created=true;changed=true;
    }else{
      const found=(await blocks(env,page.id)).filter(b=>b.type==='toggle'&&blockText(b)===marker(id));
      if(found.length>1)return json({error:'同じ試合のインポート部分が複数あります。重複防止のため中断しました。'},409);
      if(link&&!found.length)return json({error:'Notionのインポート部分が削除・変更されています。上書きを中止しました。'},409);
      if(found.length){
        const paragraphs=(await blocks(env,found[0].id)).filter(b=>b.type==='paragraph');
        if(paragraphs.length!==1)return json({error:'インポート部分の構造が変更されています。上書きせず中断しました。'},409);
        const currentText=blockText(paragraphs[0]);
        if(link?.bodyHash&&await hash(currentText)!==link.bodyHash)return json({error:'Notionのインポート部分が手動編集されています。上書きせず中断しました。'},409);
        if(!link&&currentText!==text)return json({error:'既存のインポート部分に異なる内容があります。上書きせず中断しました。'},409);
        if(currentText!==text){await notion(env,'blocks/'+paragraphs[0].id,'PATCH',{paragraph:{rich_text:rich(text)}});changed=true;}
      }else{
        await notion(env,'blocks/'+page.id+'/children','PATCH',{children:[toggle(id,text)]});
        changed=true;
      }
      const diff=propertyChanges(page,desired,link?.properties||null,!link,protectedFields);warnings=diff.warnings;protectedFields=diff.protectedFields;
      if(Object.keys(diff.patch).length){await notion(env,'pages/'+page.id,'PATCH',{properties:diff.patch});changed=true;}
    }
    const refreshed=await notion(env,'pages/'+page.id);
    if(!link||created||changed||localHash!==link.localHash)await storeLink(env,key,linkRow,{page:page.id,bodyHash,localHash,properties:snapshot(refreshed,desired),protectedFields,target:target.id});
    return json({status:created?'created':changed?'updated':'unchanged',pageUrl:refreshed.url||'https://www.notion.so/'+page.id.replaceAll('-',''),warnings,season:game.season});
  }catch(e){
    const message=String(e.message||'Notionへのインポートに失敗しました。');
    return json({error:message},/重複|上書き|変更されて|競合|複数|異なる内容|移動・変更|削除・変更|手動編集/.test(message)?409:502);
  }
}