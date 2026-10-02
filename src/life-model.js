import {validDate, localDate, periodRange} from './model.js';

export const LIFE_KEY = 'toki-life-log-v1';
// Column definitions only. Personal records are loaded exclusively from user-selected files.
export const LIFE_FIELDS = [
  {key:'sleep',label:'睡眠時間',type:'number',unit:'時間',min:0,max:24,step:0.1,group:0},
  {key:'condition',label:'体調',type:'number',min:1,max:5,step:1,group:0,hint:'1 悪い → 5 良い'},
  {key:'fatigue',label:'疲労感',type:'number',min:1,max:5,step:1,group:0,hint:'1 疲れていない → 5 疲れている'},
  {key:'mood',label:'気分',type:'number',min:1,max:5,step:1,group:0,hint:'1 悪い → 5 良い'},
  {key:'water',label:'水分',type:'number',min:1,max:5,step:1,group:0,hint:'1 飲んでいない → 5 よく飲む'},
  {key:'walk',label:'歩いた時間',type:'number',unit:'分',min:0,max:1440,step:1,group:0},
  {key:'exercise',label:'運動時間',type:'number',unit:'分',min:0,max:1440,step:1,group:0},
  {key:'wake',label:'起床時間',type:'time',group:0},
  {key:'bed',label:'前日の就寝時間',type:'time',group:0},
  {key:'temperature',label:'体温',type:'number',unit:'℃',min:0,max:100,step:0.1,group:0},
  {key:'temperatureTime',label:'体温計測時刻',type:'time',group:0},
  {key:'breakfast',label:'朝食',type:'text',group:1},
  {key:'lunch',label:'昼食',type:'text',group:1},
  {key:'dinner',label:'夕食',type:'text',group:1},
  {key:'lateMeal',label:'遅い時間の食事',type:'choice',options:['なし','あり'],group:1},
  {key:'out',label:'外出',type:'choice',options:['なし','あり'],group:1},
  {key:'bath',label:'入浴',type:'choice',options:['なし','あり'],group:1},
  {key:'screen',label:'PC・スマホみすぎ（仕事除く）',type:'choice',options:['いいえ','はい'],group:1},
  {key:'rest',label:'休憩できた',type:'choice',options:['いいえ','はい'],group:1},
  {key:'reflection',label:'今日の振り返り',type:'text',group:2},
  {key:'good',label:'よかったこと',type:'text',group:2},
  {key:'concern',label:'気になったこと',type:'text',group:2},
  {key:'tomorrow',label:'明日にひとつだけ意識すること',type:'text',group:2},
  {key:'oneLine',label:'今日のひとこと',type:'text',group:2},
  {key:'plannedBed',label:'就寝予定',type:'time',group:2}
];
export const lifeFresh = () => ({format:'toki-life-log',version:1,records:[]});
export const lifeWeekday = date => ['日','月','火','水','木','金','土'][new Date(date+'T12:00:00').getDay()];

function lifeValue(field,value){
  if(field.type==='number'){
    if(value===''||value===null||value===undefined)return null;
    if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value.trim())))throw Error(`${field.label}は数値で入力してください。`);
    const n=Number(value);
    if(!Number.isFinite(n)||n<field.min||n>field.max||(field.step===1&&!Number.isInteger(n)))throw Error(`${field.label}は${field.min}〜${field.max}${field.unit||''}で入力してください。`);
    return n;
  }
  if(value===undefined||value===null)return '';
  if(typeof value!=='string'||value.length>4000)throw Error(`${field.label}は4000文字以内で入力してください。`);
  if(field.type==='choice'&&value!==''&&!field.options.includes(value))throw Error(`${field.label}の選択肢が正しくありません。`);
  if(field.type==='time'&&value!==''){
    const match=value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if(!match||+match[1]>23||+match[2]>59||+(match[3]||0)>59)throw Error(`${field.label}の時刻が正しくありません。`);
    return `${match[1].padStart(2,'0')}:${match[2]}:${match[3]||'00'}`;
  }
  return value;
}
export function lifeRecord(date,values={}){
  if(!validDate(date))throw Error('生活ログの日付が正しくありません。');
  return {date,timestamp:values.timestamp??new Date().toLocaleString('sv-SE').replaceAll('-','/'),weekday:values.weekday??lifeWeekday(date),...Object.fromEntries(LIFE_FIELDS.map(f=>[f.key,lifeValue(f,values[f.key])])),deleted:values.deleted??false,updatedAt:values.updatedAt??new Date().toISOString()};
}
export function lifeValidate(data){
  if(!data||data.format!=='toki-life-log'||data.version!==1||!Array.isArray(data.records)||data.records.length>50000)throw Error('生活ログのJSONバックアップを選んでください。時間記録のファイルは使えません。');
  const dates=new Set();
  const records=data.records.map(r=>{
    if(!r||!validDate(r.date)||dates.has(r.date)||typeof r.timestamp!=='string'||r.timestamp.length>80||typeof r.weekday!=='string'||!['日','月','火','水','木','金','土'].includes(r.weekday)||typeof r.deleted!=='boolean'||typeof r.updatedAt!=='string'||!Number.isFinite(Date.parse(r.updatedAt)))throw Error('生活ログの形式が正しくありません（日付重複や無効な項目）。');
    for(const f of LIFE_FIELDS){if(!Object.hasOwn(r,f.key)||(f.type==='number'?r[f.key]!==null&&typeof r[f.key]!=='number':typeof r[f.key]!=='string'))throw Error(`${f.label}の保存形式が正しくありません。`);}
    dates.add(r.date);return lifeRecord(r.date,r);
  });
  return {...lifeFresh(),records};
}

function lifeCSVRows(text){
  if(typeof text!=='string'||text.length>10*1024*1024)throw Error('CSVは10MB以下にしてください。');
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  text=text.replace(/^\uFEFF/,'');
  const finishRow=()=>{row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';closed=false;};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c===','){row.push(cell);cell='';closed=false;}
    else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;finishRow();}
    else if(c==='"'&&cell===''&&!closed)quoted=true;
    else{if(closed||c==='"')throw Error('CSVの引用符・列区切りが正しくありません。');cell+=c;}
  }
  if(quoted)throw Error('CSVの引用符が閉じられていません。');
  if(cell!==''||row.length||closed)finishRow();
  return rows;
}
// Prefix formula-like strings for spreadsheet safety; the matching importer reverses it.
const lifeCSVSafe=v=>/^[=+\-@\t\r\n']/.test(v)?"'"+v:v;
const lifeCSVUnsafe=v=>/^'[=+\-@\t\r\n']/.test(v)?v.slice(1):v;
export function lifeParseCSV(text,{decodeEscapes=false}={}){
  const rows=lifeCSVRows(text);if(rows.length<2)throw Error('見出しと記録が入った生活ログCSVを選んでください。');
  const headers=rows.shift().map(v=>v.trim()),expected=['タイムスタンプ','日付','曜日',...LIFE_FIELDS.map(f=>f.label)];
  if(headers.length!==expected.length||new Set(headers).size!==headers.length||expected.some(h=>!headers.includes(h)))throw Error('CSVの28列の見出しが一致しません。元の生活ログと同じ列名を使ってください。');
  const read=(row,label)=>decodeEscapes?lifeCSVUnsafe(row[headers.indexOf(label)]):row[headers.indexOf(label)];
  const records=rows.map((row,i)=>{
    try{
      if(row.length!==headers.length)throw Error('列数が28列ではありません。');
      const rawDate=read(row,'日付').trim(),match=rawDate.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
      const date=match?`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`:rawDate;
      return lifeRecord(date,{timestamp:read(row,'タイムスタンプ'),weekday:read(row,'曜日'),...Object.fromEntries(LIFE_FIELDS.map(f=>[f.key,read(row,f.label)]))});
    }catch(error){throw Error(`CSVの${i+2}行目：${error.message}`);}
  });
  return lifeValidate({...lifeFresh(),records});
}
export function lifeExportCSV(data){
  const checked=lifeValidate(data),quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const rows=[['タイムスタンプ','日付','曜日',...LIFE_FIELDS.map(f=>f.label)],...checked.records.filter(r=>!r.deleted).sort((a,b)=>a.date.localeCompare(b.date)).map(r=>[lifeCSVSafe(r.timestamp),r.date.replaceAll('-','/'),r.weekday,...LIFE_FIELDS.map(f=>f.type==='number'?r[f.key]:lifeCSVSafe(r[f.key]))])];
  return '\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n');
}
const lifePayload=r=>JSON.stringify([r.date,r.timestamp,r.weekday,r.deleted,...LIFE_FIELDS.map(f=>r[f.key])]);
export function lifeMerge(local,incoming,policy='keep'){
  local=lifeValidate(local);incoming=lifeValidate(incoming);
  if(!['keep','replace'].includes(policy))throw Error('重複時の処理を選んでください。');
  const map=new Map(local.records.map(r=>[r.date,r]));let added=0,conflicts=0,unchanged=0;
  for(const r of incoming.records){const here=map.get(r.date);if(!here){map.set(r.date,r);added++;}else if(lifePayload(here)===lifePayload(r))unchanged++;else{conflicts++;if(policy==='replace')map.set(r.date,r);}}
  return {data:lifeValidate({...lifeFresh(),records:[...map.values()]}),added,conflicts,unchanged};
}
export const lifeRange=(mode,date)=>periodRange(mode==='today'?'day':mode,date);
export function lifeSummary(records){
  records=records.filter(r=>!r.deleted);
  const metrics=Object.fromEntries(LIFE_FIELDS.filter(f=>f.type==='number').map(f=>{const values=records.map(r=>r[f.key]).filter(v=>typeof v==='number'&&Number.isFinite(v)),total=values.reduce((s,n)=>s+n,0);return [f.key,{average:values.length?total/values.length:null,total,count:values.length}];}));
  const habits=Object.fromEntries(LIFE_FIELDS.filter(f=>f.type==='choice').map(f=>{const values=records.map(r=>r[f.key]).filter(Boolean);return [f.key,{count:values.length,yes:values.filter(v=>v===f.options[1]).length}];}));
  return {days:new Set(records.map(r=>r.date)).size,metrics,habits};
}
