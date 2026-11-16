import {verifySession} from '../../../src/server-auth.js';

const DS='40bee5b7-9890-8027-8056-000be6a73854';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const plain=a=>(Array.isArray(a)?a:[]).map(x=>x.plain_text??x.text?.content??'').join('');
const validId=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const safeUrl=x=>typeof x==='string'&&/^https:\/\/[^\s]+$/i.test(x)?x:'';
async function notionQuery(env,id,cursor){
 let res;
 for(let attempt=0;attempt<3;attempt++){
  res=await fetch('https://api.notion.com/v1/data_sources/'+id+'/query',{
   method:'POST',headers:{Authorization:'Bearer '+env.NOTION_TOKEN,'Notion-Version':'2026-03-11','Content-Type':'application/json'},
   body:JSON.stringify({page_size:100,filter:{property:'状態',select:{equals:'対応可能'}},...(cursor?{start_cursor:cursor}:{})})
  });
  if(res.status!==429||attempt===2)break;
  await new Promise(resolve=>setTimeout(resolve,Math.min(5,Math.max(1,Number(res.headers.get('Retry-After'))||1))*1000));
 }
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(res.status===404?'次回タスク確認管理をNotion連携へ共有してください。':'Notion API ('+res.status+'): '+(data.message||'候補を取得できません。'));
 return data;
}
export async function onRequest({request,env}){
 if(request.method!=='GET')return json({error:'候補は参照のみ対応しています。'},405);
 if(!env.NOTION_TOKEN||!env.DB)return json({error:'Notion連携の設定がありません。'},503);
 let owner;try{owner=await verifySession(request,env);}catch{return json({error:'認証設定を確認してください。'},503);}
 if(!owner)return json({error:'ログインが必要です。'},401);
 const id=env.NOTION_BACKLOG_DATA_SOURCE_ID||DS;
 if(!validId(id))return json({error:'次回候補のデータソースIDが不正です。'},503);
 try{
  const items=[];let cursor=null;
  do{
   const data=await notionQuery(env,id,cursor);
   for(const p of data.results||[]){
    if(p.in_trash||p.archived||!validId(p.id))continue;
    const title=plain(p.properties?.['名前']?.title).trim();
    const status=p.properties?.['状態']?.select?.name||'';
    const url=safeUrl(p.url);
    if(status==='対応可能'&&title&&url)items.push({id:p.id,title,status,url});
   }
   cursor=data.has_more?data.next_cursor:null;
   if(cursor&&items.length>=1000)throw Error('候補が多いため取得を中断しました。Notion側で整理してください。');
  }while(cursor);
  return json({items});
 }catch(e){return json({error:e.message||'次回候補を取得できません。'},502);}
}
