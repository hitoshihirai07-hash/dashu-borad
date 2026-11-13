import {verifySession} from '../../../src/server-auth.js';
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const codes={阪神:'T',DeNA:'DB',ヤクルト:'S',中日:'D',広島:'C',ソフトバンク:'H',日本ハム:'F',オリックス:'B',楽天:'E',西武:'L',ロッテ:'M'};
export function parseOfficialCalendar(html,game){
  const date=game.date.replaceAll('-',''),opponent=codes[game.opponent],found=[];
  if(!opponent)throw Error('対象球団は公式記録の取得に対応していません。');
  const cells=html.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi)||[];
  for(const cell of cells){
    if(!cell.includes('gm'+date+'.html'))continue;
    const re=/<a\b[^>]*href=["'][^"']*\/games\/s(\d+)\.html["'][^>]*>([\s\S]*?)<\/a>/gi;
    for(const match of cell.matchAll(re)){
      if(!match[1].startsWith(date))continue;
      const text=match[2].replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim();
      const score=text.match(/^([A-Za-z]{1,3})\s+(\d+|\*)\s*-\s*(\d+|\*)\s+([A-Za-z]{1,3})$/);
      if(!score)continue;
      const [,away,awayScore,homeScore,home]=score, a=away.toUpperCase(),h=home.toUpperCase();
      if(!((a==='G'&&h===opponent)||(h==='G'&&a===opponent)))continue;
      if(game.location==='home'&&h!=='G'||game.location==='away'&&a!=='G')continue;
      found.push({number:match[1],a,h,awayScore,homeScore});
    }
  }
  const selected=found[Number(game.gameNumber||1)-1];
  if(!selected)throw Error('NPB公式日程で一致する試合を確認できませんでした。');
  if(selected.awayScore==='*'||selected.homeScore==='*')throw Error('中止・延期のため確定スコアがありません。');
  return {giantsScore:Number(selected.h==='G'?selected.homeScore:selected.awayScore),
    opponentScore:Number(selected.h==='G'?selected.awayScore:selected.homeScore),
    state:'finished',scope:'最終スコアのみ',source:'NPB公式試合日程',
    sourceUrl:'https://npb.jp/bis/eng/'+game.date.slice(0,4)+'/games/s'+selected.number+'.html'};
}
export async function onRequest({request,env}){
  if(request.method!=='GET')return json({error:'GETのみ対応しています。'},405);
  if(!env.DB)return json({error:'試合DBが設定されていません。'},503);
  let owner;try{owner=await verifySession(request,env);}catch{return json({error:'ログイン設定を確認してください。'},503);}
  if(!owner)return json({error:'ログインが必要です。'},401);
  const id=new URL(request.url).searchParams.get('gameId')||'';
  if(!/^20\d{2}-\d{2}-\d{2}~regular~[^~:]{1,40}~[1-3]$/.test(id))return json({error:'公式戦の登録済み試合のみ対応しています。'},400);
  try{
    const row=await env.DB.prepare('SELECT payload FROM app_state WHERE owner=?').bind('__baseball_game_v1__:'+owner+':'+id).first();
    if(!row)return json({error:'先に対象試合を登録してください。'},404);
    const game=JSON.parse(row.payload).game;
    if(!game||game.gameType!=='regular'||!codes[game.opponent]||game.date!==id.split('~')[0]||game.opponent!==id.split('~')[2])return json({error:'試合情報が一致しません。'},400);
    const [year,month]=game.date.split('-');
    const url='https://npb.jp/bis/eng/'+year+'/calendar/index_'+month+'.html';
    const response=await fetch(url,{headers:{Accept:'text/html'},signal:AbortSignal.timeout(9000)});
    if(!response.ok)return json({error:'NPB公式日程を取得できませんでした（'+response.status+'）。'},502);
    if(Number(response.headers.get('content-length')||0)>1000000)return json({error:'公式記録の容量が大きすぎます。'},502);
    const html=await response.text();
    if(html.length>1000000)return json({error:'公式記録の容量が大きすぎます。'},502);
    return json({...parseOfficialCalendar(html,game),gameId:id});
  }catch(e){return json({error:e.message||'NPB公式結果を取得できませんでした。'},502);}
}
