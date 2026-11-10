import {verifySession} from '../../../src/server-auth.js';
const DS='32e161ee-c2f3-462a-9ff8-aaeccee3488e';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const plain=a=>(a||[]).map(x=>x.plain_text??x.text?.content??'').join('');
const rich=s=>[{type:'text',text:{content:s}}];
const properties=x=>({'タイトル':{title:rich(x.title)},'内容':{rich_text:rich(x.body)},'分類':{select:{name:x.category}}});
const decode=p=>({id:p.id,title:plain(p.properties?.['タイトル']?.title),body:plain(p.properties?.['内容']?.rich_text),category:p.properties?.['分類']?.select?.name||'その他',createdAt:p.created_time,editedAt:p.last_edited_time,url:p.url});
async function notion(env,path,method='GET',data){
 const r=await fetch('https://api.notion.com/v1/'+path,{method,headers:{Authorization:'Bearer '+env.NOTION_TOKEN,'Notion-Version':'2025-09-03','Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 const result=await r.json().catch(()=>({}));if(!r.ok)throw Error('Notion API '+r.status+': '+(result.message||'接続に失敗しました'));
 return result;
}
const categoryNames=['アイデア','サイト運営','野球','日常','その他'];
export async function onRequest({request,env}){
 if(!['GET','POST'].includes(request.method))return json({error:'この操作は許可されていません。'},405);
 if(!env.NOTION_TOKEN||!env.DB)return json({error:'CloudflareのNOTION_TOKENまたはD1設定がありません。'},503);
 let user;try{user=await verifySession(request,env);}catch{return json({error:'ログイン設定を確認してください。'},503);}
 if(!user)return json({error:'ログインが必要です。'},401);
 if(request.method==='POST'){
  if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'別サイトからの書き込みは許可されません。'},403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSONを送信してください。'},415);
 }
 try{
  const id=env.NOTION_MEMO_DATA_SOURCE_ID||DS;
  if(request.method==='GET'){
   let cursor,rows=[];do{
    const r=await notion(env,'data_sources/'+id+'/query','POST',{page_size:100,...(cursor?{start_cursor:cursor}:{})});
    rows.push(...r.results);cursor=r.has_more?r.next_cursor:null;
    if(rows.length>5000)throw Error('メモが多すぎるため取得を停止しました。');
   }while(cursor);
   return json({items:rows.filter(p=>!p.archived&&!p.in_trash).map(decode).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))});
  }
  const raw=await request.text();if(raw.length>12000)return json({error:'入力が長すぎます。'},413);
  const payload=JSON.parse(raw);
  const title=payload.title,body=payload.body,category=payload.category||'その他';
  if(typeof title!=='string'||!title.trim()||title.length>160||typeof body!=='string'||body.length>1900||!categoryNames.includes(category))return json({error:'タイトル・内容・分類を確認してください。'},400);
  let page;
  if(payload.id){
   if(!/^[a-f0-9-]{36}$/i.test(payload.id)||typeof payload.editedAt!=='string')return json({error:'編集対象が不正です。'},400);
   const previous=await notion(env,'pages/'+payload.id);
   if(previous.parent?.data_source_id!==id)return json({error:'別のデータベースのメモは変更できません。'},403);
   if(previous.last_edited_time!==payload.editedAt)return json({error:'Notionで先に更新されています。再読み込みして確認してください。'},409);
   page=await notion(env,'pages/'+payload.id,'PATCH',{properties:properties({title,body,category})});
  }else page=await notion(env,'pages','POST',{parent:{type:'data_source_id',data_source_id:id},properties:properties({title,body,category})});
  return json({item:decode(page)});
 }catch(e){return json({error:e instanceof SyntaxError?'入力データが不正です。':e.message},502);}
}