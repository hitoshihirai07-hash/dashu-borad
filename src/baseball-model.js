// Phase 1: a single Giants game, independent of tasks and quick notes.
// Later phases can attach batting, pitching and observation records by game ID.
export const BASEBALL_OPPONENTS = ['阪神','DeNA','ヤクルト','中日','広島','ソフトバンク','日本ハム','オリックス','楽天','西武','ロッテ','その他'];
export const BASEBALL_TYPES = {regular:'公式戦',climax:'クライマックスシリーズ',japan:'日本シリーズ',exhibition:'オープン戦・練習試合',farm:'ファーム',other:'その他'};
export const BASEBALL_STATES = {scheduled:'試合前',playing:'試合中',finished:'試合終了',postponed:'延期',canceled:'中止'};
export const BASEBALL_LOCATIONS = {home:'ホーム',away:'ビジター',neutral:'その他'};
export function validBaseballDate(date){
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
  const year=Number(date.slice(0,4));
  if(year<2000||year>2100)return false;
  return new Date(Date.UTC(year,Number(date.slice(5,7))-1,Number(date.slice(8,10)))).toISOString().slice(0,10)===date;
}
const textField=(value,length=100)=>{
  if(value===undefined||value===null)return '';
  if(typeof value!=='string')throw Error('文字列の項目が不正です。');
  const valueTrimmed=value.trim();
  if(valueTrimmed.length>length)throw Error('入力した文字数が上限を超えています。');
  return valueTrimmed;
};
const scoreField=value=>{
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='number'&&typeof value!=='string')throw Error('得点は数字で入力してください。');
  if(String(value).trim()==='')return null;
  const number=Number(value);
  if(!Number.isInteger(number)||number<0||number>99)throw Error('得点は0～99の整数で入力してください。');
  return number;
};
export function normalizeBaseballGame(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('試合データが不正です。');
  const date=textField(input.date,10);
  if(!validBaseballDate(date))throw Error('正しい試合日を選んでください。');
  const opponent=textField(input.opponent,40);
  if(!BASEBALL_OPPONENTS.includes(opponent))throw Error('対戦相手を選んでください。');
  const gameNumber=Number(input.gameNumber===undefined?1:input.gameNumber);
  if(!Number.isInteger(gameNumber)||gameNumber<1||gameNumber>3)throw Error('同日の試合番号は1～3にしてください。');
  const gameType=textField(input.gameType||'regular',30);
  const state=textField(input.state||'scheduled',30);
  const location=textField(input.location||'home',30);
  if(!Object.hasOwn(BASEBALL_TYPES,gameType)||!Object.hasOwn(BASEBALL_STATES,state)||!Object.hasOwn(BASEBALL_LOCATIONS,location))throw Error('試合区分が不正です。');
  const giantsScore=scoreField(input.giantsScore),opponentScore=scoreField(input.opponentScore);
  const result=giantsScore!==null&&opponentScore!==null&&state==='finished'
    ?(giantsScore>opponentScore?'win':giantsScore<opponentScore?'loss':'draw'):'';
  const sourceUrl=textField(input.sourceUrl,500);
  if(sourceUrl){
    let parsed;
    try{parsed=new URL(sourceUrl);}catch{throw Error('参考URLの形式が正しくありません。');}
    if(!['https:','http:'].includes(parsed.protocol))throw Error('参考URLはhttp(s)のみ対応です。');
  }
  return {
    date,season:Number(date.slice(0,4)),opponent,gameNumber,gameType,state,location,
    stadium:textField(input.stadium,100),
    giantsStarter:textField(input.giantsStarter,100),
    opponentStarter:textField(input.opponentStarter,100),
    giantsScore,opponentScore,result,sourceUrl
  };
}
export function baseballTestGame2026(){
  return normalizeBaseballGame({
    date:'2026-09-27',opponent:'ヤクルト',gameNumber:1,gameType:'regular',state:'finished',
    location:'home',stadium:'東京ドーム',giantsStarter:'小笠原慎之介',opponentStarter:'高橋奎二',
    giantsScore:11,opponentScore:0,
    sourceUrl:'https://npb.jp/scores/2026/0927/g-s-24/'
  });
}
