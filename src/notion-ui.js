// This component is intentionally independent of the existing task and quick-note stores.
export function createNotionUI({escapeHTML:esc,render,toast,cloud,workspace}){
 let tab='tasks',memos=[],loaded=false,busy=false,message='',conflicts=[],changes=[],editing='__closed__',search='',category='all',formDraft=null,pageBodies=new Map(),openBodies=new Set();
 let backlog=[],backlogLoaded=false,backlogBusy=false,backlogMessage='',backlogDates=new Map(),backlogProjects=new Map();
 const categories=['アイデア','サイト運営','野球','日常','その他'];
 const taskDB='https://app.notion.com/p/d311824e38d04162b2e92ae588bfa894';
 const memoDB='https://app.notion.com/p/4803a7f9e4e549ea809fce5495b3964d';
 const backlogDB='https://app.notion.com/p/40bee5b798908067b80ed27f3d45cd89';
 const select=(options,current)=>options.map(x=>`<option value="${esc(x)}" ${x===current?'selected':''}>${esc(x)}</option>`).join('');
 async function api(url,options={}){
  const res=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
  const data=await res.json().catch(()=>({error:'サーバーの応答を読み込めません。'}));
  if(!res.ok)throw Error(data.error||'Notion連携に失敗しました。');return data;
 }
 async function load(){
  if(busy)return;busy=true;message='Notionのメモを読み込み中';render();
  try{const data=await api('/api/notion/memos');memos=data.items||[];pageBodies.clear();loaded=true;message='Notionから最新のメモを取得しました。';for(const openId of openBodies)if(memos.some(m=>m.id===openId))loadBody(openId,true);}
  catch(e){message=e.message;}
  finally{busy=false;render();}
 }
 async function sync(resolutions={}){
  if(busy)return;
  if(cloud.status()!=='ready'){toast('先に「データ共有・同期」でクラウド保存を完了してください。');return;}
  busy=true;message='タスクを照合しています。';render();
  try{
   const result=await api('/api/notion/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resolutions})});
   let verified={updated:[],conflicts:[],changed:false};
   if(Object.keys(resolutions).length&&!(result.conflicts||[]).length)verified=await api('/api/notion/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   changes=[...(result.updated||[]),...(verified.updated||[])];conflicts=[...(result.conflicts||[]),...(verified.conflicts||[])];
   message=`同期確認完了：反映 ${changes.length}件、要確認 ${conflicts.length}件`;
   await cloud.refresh();
   toast(message);
  }catch(e){message=e.message;toast(message);}
  finally{busy=false;render();}
 }

 const safeLink=url=>typeof url==='string'&&/^https?:\/\//i.test(url)?url:'';
 function runs(items=[]){
  return (Array.isArray(items)?items:[]).map(x=>{
   let s=esc(x.text||'');
   if(x.code)s='<code>'+s+'</code>';
   if(x.bold)s='<strong>'+s+'</strong>';
   if(x.italic)s='<em>'+s+'</em>';
   if(x.underline)s='<u>'+s+'</u>';
   if(x.strikethrough)s='<s>'+s+'</s>';
   const link=safeLink(x.href);
   return link?'<a href="'+esc(link)+'" target="_blank" rel="noopener noreferrer">'+s+'</a>':s;
  }).join('');
 }
 function blockHTML(block){
  const type=block.type||'',inner=runs(block.runs),children=(block.children||[]).map(blockHTML).join('');
  let html='';
  if(/^heading_[123]$/.test(type))html='<'+({heading_1:'h3',heading_2:'h4',heading_3:'h5'}[type])+'>'+inner+'</'+({heading_1:'h3',heading_2:'h4',heading_3:'h5'}[type])+'>';
  else if(type==='bulleted_list_item')html='<div class="notion-block-list">• <span>'+inner+'</span></div>';
  else if(type==='numbered_list_item')html='<div class="notion-block-list">– <span>'+inner+'</span></div>';
  else if(type==='to_do')html='<div class="notion-block-list"><input type="checkbox" disabled '+(block.checked?'checked':'')+' aria-label="Notionのチェック項目"> <span>'+inner+'</span></div>';
  else if(type==='toggle')html='<div class="notion-block-toggle">▸ '+inner+'</div>';
  else if(type==='quote')html='<blockquote>'+inner+'</blockquote>';
  else if(type==='callout')html='<aside>'+esc(block.icon||'💡')+' '+inner+'</aside>';
  else if(type==='code')html='<pre><code>'+inner+'</code></pre>';
  else if(type==='divider')html='<hr>';
  else if(type==='table')html='<div class="notion-block-table"><table><tbody>'+children+'</tbody></table></div>';
  else if(type==='table_row')html='<tr>'+(block.cells||[]).map(cell=>'<td>'+runs(cell)+'</td>').join('')+'</tr>';
  else if(type==='image'||type==='file'||type==='pdf'||type==='video'){
   const link=safeLink(block.url);
   html=link?'<a href="'+esc(link)+'" target="_blank" rel="noopener noreferrer">'+(type==='image'?'画像を開く':type==='pdf'?'PDFを開く':type==='video'?'動画を開く':'ファイルを開く')+'</a>':'<span class="muted">添付ファイル</span>';
   if(block.caption?.length)html+='<div class="muted">'+runs(block.caption)+'</div>';
  }
  else if(type==='bookmark'||type==='embed'||type==='link_preview'){
   const link=safeLink(block.url);
   html=link?'<a href="'+esc(link)+'" target="_blank" rel="noopener noreferrer">'+(inner||esc(link))+'</a>':inner;
  }
  else if(type==='child_page'||type==='child_database')html='<p class="muted">Notionの子ページ（Notionで開いて確認してください）</p>';
  else if(type==='column_list'||type==='column'||type==='synced_block'||type==='unsupported')html='';
  else html=inner?'<p>'+inner+'</p>':'';
  if(type==='table'||type==='table_row')return html;
  return '<div class="notion-page-block">'+html+(children?'<div class="notion-page-children">'+children+'</div>':'')+'</div>';
 }
 function bodyHTML(id){
  if(!openBodies.has(id))return '';
  const state=pageBodies.get(id);
  if(!state||state.loading)return '<div class="notion-page-body"><p role="status">Notionのページ本文を取得中…</p></div>';
  if(state.error)return '<div class="notion-page-body"><p role="alert">'+esc(state.error)+'</p><button type="button" class="button secondary" data-notion-body-retry="'+esc(id)+'">再取得</button></div>';
  return '<div class="notion-page-body"><h4>Notionページ本文（閲覧のみ）</h4>'+(state.blocks.length?state.blocks.map(blockHTML).join(''):'<p class="muted">ページ本文はありません。</p>')+(state.truncated?'<p class="muted">本文が長いため一部省略しています。残りはNotionで確認してください。</p>':'')+'</div>';
 }
 async function loadBody(id,force=false){
  if(!force&&pageBodies.has(id))return;
  pageBodies.set(id,{loading:true});render();
  try{
   const data=await api('/api/notion/memos?page_id='+encodeURIComponent(id));
   pageBodies.set(id,{blocks:data.blocks||[],truncated:!!data.truncated,loading:false});
  }catch(e){pageBodies.set(id,{loading:false,error:e.message});}
  render();
 }

 async function loadBacklog(){
  if(backlogBusy)return;
  backlogBusy=true;backlogMessage='候補を取得しています。';render();
  try{
   const data=await api('/api/notion/backlog');
   backlog=(Array.isArray(data.items)?data.items:[]).filter(x=>x.status==='対応可能');
   backlogLoaded=true;
   backlogMessage='候補を取得しました。Notionの記録日を実行日に流用しません。';
  }catch(e){backlog=[];backlogLoaded=false;backlogMessage=e.message;toast(e.message);}
  finally{backlogBusy=false;render();}
 }
 function backlogPage(){
  const registered=new Map(workspace.get().tasks.filter(t=>t.sourceNotionPage).map(t=>[t.sourceNotionPage,t]));
  const projects=workspace.visibleProjects();
  const items=backlog.map(c=>{
   const existing=registered.get(c.id),selected=backlogProjects.get(c.id)||'';
   return `<article class="notion-backlog-item">
     <div class="notion-backlog-info"><strong>${esc(c.title)}</strong><span>対応可能</span><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">元のNotionページを見る</a></div>
     ${existing?`<p class="notion-backlog-added">登録済み（実行日：${esc(existing.due||'日付未定')}） <button type="button" class="text-button" data-workspace-select-task="${esc(existing.id)}">タスクを開く</button></p>`:
       `<div class="notion-backlog-controls">
         <label>実行日（必須）<input type="date" data-notion-backlog-date="${esc(c.id)}" value="${esc(backlogDates.get(c.id)||'')}"></label>
         <label>プロジェクト<select data-notion-backlog-project="${esc(c.id)}"><option value="">未分類</option>${[...new Set([...projects,...(selected?[selected]:[])])].map(name=>`<option value="${esc(name)}" ${name===selected?'selected':''}>${esc(name)}</option>`).join('')}</select></label>
         <button type="button" class="button primary" data-notion-promote="${esc(c.id)}">この日でToDoに登録</button>
       </div>`}
    </article>`;
  }).join('');
  return `<section class="panel notion-panel notion-backlog-panel">
   <div class="panel-heading"><h2>次回タスクの候補</h2><a href="${backlogDB}" target="_blank" rel="noopener noreferrer" class="text-button">Notionで確認</a></div>
   <p class="muted">Notion「次回タスク確認管理」の「対応可能」の候補だけを手動で取得します。元の日付は記録日です。作業日は必ずここで別に指定してください。</p>
   <div class="workspace-actions"><button type="button" class="button primary" data-notion-action="load-backlog" ${backlogBusy?'disabled':''}>候補を取得・更新</button><span class="muted">Notion側の状態や記録は変更しません。</span></div>
   <p class="notion-backlog-message" role="status">${esc(backlogMessage)}</p>
   ${!backlogLoaded?'<p class="muted">「候補を取得・更新」を押してください。自動取得はありません。</p>':
     backlog.length?`<div class="notion-backlog-list">${items}</div>`:'<p class="muted">対応可能な候補はありません。</p>'}
  </section>`;
 }

 function page(){
  const list=memos.filter(x=>(category==='all'||x.category===category)&&(!search||(`${x.title} ${x.body}`).toLocaleLowerCase().includes(search.toLocaleLowerCase())));
  const note=editing?memos.find(x=>x.id===editing):null;
  const draftDisplay=formDraft||note;
  return `<header class="page-heading"><div><h1>Notion連携</h1><p>タスク・メモの同期と、次回候補の手動確認ができます。</p></div></header>
   <div class="notion-tabs"><button type="button" class="button ${tab==='tasks'?'primary':'secondary'}" data-notion-tab="tasks">タスク</button><button type="button" class="button ${tab==='memos'?'primary':'secondary'}" data-notion-tab="memos">メモ</button><button type="button" class="button ${tab==='backlog'?'primary':'secondary'}" data-notion-tab="backlog">次回候補</button></div>
   ${tab==='tasks'?`<section class="panel notion-panel"><h2>タスクの双方向同期</h2>
    <p class="muted">初回は未完了のタスクだけ登録します。以降は「Notionと同期」を押したときだけ変更・完了を相互反映します。削除は必要に応じて確認します。</p>
    <p>現在の未完了タスク：<strong>${workspace.get().tasks.filter(t=>t.status!=='done').length}件</strong></p>
    <div class="workspace-actions"><button type="button" class="button primary" data-notion-action="sync" ${busy?'disabled':''}>Notionと同期</button><a class="button secondary" target="_blank" rel="noopener noreferrer" href="${taskDB}">Notionで開く</a></div>
    <p class="muted">同期の前にデータ共有画面からバックアップを保存してください。通信・更新競合時は上書きしません。</p>
    <h3>未完了タスク</h3><div class="notion-task-list">
     ${workspace.get().tasks.filter(t=>t.status!=='done').sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')).slice(0,100).map(t=>`<div class="notion-task-row"><div><strong>${esc(t.title)}</strong><small>${esc(t.project||'未分類')} ・ ${esc(t.due||'日付未定')}</small></div>
     <select data-workspace-status="${esc(t.id)}" aria-label="${esc(t.title)}の状態">${[['todo','未着手'],['doing','進行中'],['waiting','待機中'],['someday','いつかやる'],['done','完了']].map(([key,label])=>`<option value="${key}" ${key===t.status?'selected':''}>${label}</option>`).join('')}</select></div>`).join('')||'<p class="muted">未完了タスクはありません。</p>'}</div>
    </section>
    ${changes.length?`<section class="panel notion-panel"><h2>反映した内容</h2><ul>${changes.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>`:''}
     ${conflictPanel()}
    `:tab==='backlog'?backlogPage():`<section class="panel notion-panel"><div class="panel-heading"><h2>Notionのメモ</h2><a href="${memoDB}" target="_blank" rel="noopener noreferrer">Notionで開く</a></div>
    <div class="workspace-actions"><button type="button" class="button secondary" data-notion-action="load" ${busy?'disabled':''}>最新情報を取得</button><button type="button" class="button primary" data-notion-action="new" ${busy?'disabled':''}>新しいメモ</button></div>
    ${editing!==null&&editing!=='__closed__'?`<form id="notion-memo-form" class="notion-form"><h3>${note?'メモを編集':'新しいメモ'}</h3><label>タイトル<input name="title" maxlength="160" required value="${esc(draftDisplay?.title||'')}"></label>
     <label>内容<textarea name="body" maxlength="1900" rows="6">${esc(draftDisplay?.body||'')}</textarea></label>
     <label>分類<select name="category">${select(categories,draftDisplay?.category||'その他')}</select></label>
     ${note?bodyHTML(note.id):''}
     ${note&&!openBodies.has(note.id)?'<p class="muted">ページ本文は読み取り専用です。Notion側で編集してください。</p>':''}
     <div class="workspace-actions"><button class="button primary" type="submit" ${busy?'disabled':''}>保存する</button><button type="button" class="button secondary" data-notion-action="cancel">キャンセル</button></div></form>`:''}
    <div class="notion-filters"><label>検索<input id="notion-search" value="${esc(search)}" placeholder="タイトル・内容"></label><label>分類<select id="notion-category">${select(['all',...categories],category)}</select></label></div>
    ${!loaded?'<p>「最新情報を取得」でNotionのメモを表示できます。</p>':list.length?list.map(x=>`<article class="notion-memo"><div><strong>${esc(x.title)}</strong><span class="muted"> ${esc(x.category)} ・ ${esc(x.createdAt.slice(0,10))}</span></div><p>${esc(x.body)}</p><div class="workspace-actions"><button type="button" class="button secondary" data-notion-body="${esc(x.id)}">${openBodies.has(x.id)?'本文を閉じる':'ページ本文を見る'}</button><button type="button" class="button secondary" data-notion-edit="${esc(x.id)}">編集</button></div>${bodyHTML(x.id)}</article>`).join(''):'<p class="muted">対象メモはありません。</p>'}
    </section>`}
   <p class="notion-message" role="status">${esc(message)}</p>`;
 }
 function conflictDetails(task){
  if(!task)return '<p class="muted">該当するタスクはありません（削除済み・見つからない状態）。</p>';
  const states={todo:'未着手',doing:'進行中',waiting:'待機中',someday:'いつか',done:'完了'};
  return '<dl>'+[['タスク名',task.title],['状態',states[task.status]||task.status],['予定日',task.due||'日付未定'],['優先度',task.priority],['プロジェクト',task.project||'未分類'],['詳細',task.detail||'なし'],['完了日時',task.completedAt||'なし']].map(([name,value])=>'<dt>'+esc(name)+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl>';
 }
 function conflictPanel(){
  if(!conflicts.length)return '';
  const fieldNames={title:'タスク名',status:'状態',due:'予定日',priority:'優先度',project:'プロジェクト',detail:'詳細',completedAt:'完了日時'};
  return '<section class="panel notion-panel"><h2>要確認：競合 '+conflicts.length+'件</h2><p class="muted">残す内容を選択してください。未選択の場合は上書きしません。</p>'+conflicts.map(c=>{
   if(typeof c==='string')return '<p>'+esc(c)+'</p>';
   return '<article class="notion-conflict-row"><h3>'+esc(c.title)+'</h3><p class="muted">'+esc(c.reason)+(c.fields?.length?'（'+c.fields.map(f=>esc(fieldNames[f]||f)).join('・')+'）':'')+'</p><div class="notion-conflict-compare"><div><strong>ときの記録</strong>'+conflictDetails(c.local)+'</div><div><strong>Notion</strong>'+conflictDetails(c.notion)+'</div></div><label>残す内容<select data-notion-resolution="'+esc(c.id)+'"><option value="">選択してください</option><option value="local">ときの記録を採用'+(c.local?'':'（Notionをアーカイブ）')+'</option><option value="notion">Notionを採用'+(c.notion?'':'（ときの記録から削除）')+'</option></select></label></article>';
  }).join('')+'<div class="workspace-actions"><button type="button" class="button primary" data-notion-action="resolve" '+(busy?'disabled':'')+'>選択した内容で解決する</button></div></section>';
 }
 function click(button){
  if(button.dataset.notionPromote!==undefined){
   const candidate=backlog.find(c=>c.id===button.dataset.notionPromote);
   if(!candidate){toast('候補が見つかりません。再取得してください。');return true;}
   const card=button.closest?.('.notion-backlog-item');
   const day=card?.querySelector?.('[data-notion-backlog-date]')?.value||backlogDates.get(candidate.id)||'';
   const project=card?.querySelector?.('[data-notion-backlog-project]')?.value??backlogProjects.get(candidate.id)??'';
   try{
    if(!day)throw Error('実行日を指定してください。Notionの記録日は使いません。');
    workspace.promoteNotionCandidate({...candidate,day,project});
    toast('実行日を指定してタスクに登録しました。');
   }catch(e){toast(e.message);}
   return true;
  }
  if(button.dataset.notionTab){tab=button.dataset.notionTab;editing='__closed__';formDraft=null;render();return true;}
  if(button.dataset.notionEdit){editing=button.dataset.notionEdit;formDraft=null;openBodies.add(editing);render();loadBody(editing);return true;}
  if(button.dataset.notionBodyRetry){loadBody(button.dataset.notionBodyRetry,true);return true;}
  if(button.dataset.notionBody){const id=button.dataset.notionBody;if(openBodies.has(id))openBodies.delete(id);else{openBodies.add(id);loadBody(id);}render();return true;}
  const action=button.dataset.notionAction;if(!action)return false;
  if(action==='sync')sync();else if(action==='resolve'){
    const fields=[...document.querySelectorAll('[data-notion-resolution]')];
    const selected=Object.fromEntries(fields.filter(el=>el.value).map(el=>[el.dataset.notionResolution,el.value]));
    if(!fields.length||Object.keys(selected).length!==fields.length){toast('すべての要確認タスクで解決方法を選択してください。');return true;}
    if(!confirm('選択した内容を両方へ反映します。よろしいですか？'))return true;
    sync(selected);
  }else if(action==='load-backlog')loadBacklog();else if(action==='load')load();else if(action==='new'){editing='';formDraft=null;render();}
  else if(action==='cancel'){editing='__closed__';formDraft=null;render();}
  return true;
 }
 function change(node){
  if(node.dataset?.notionBacklogDate!==undefined){backlogDates.set(node.dataset.notionBacklogDate,node.value);return true;}
  if(node.dataset?.notionBacklogProject!==undefined){backlogProjects.set(node.dataset.notionBacklogProject,node.value);return true;}
  if(node.id==='notion-category'){category=node.value;render();return true;}
  return false;
 }
 function input(node){
  if(node.id==='notion-search'){search=node.value;const selection=node.selectionStart;render();const field=document.querySelector('#notion-search');field?.focus();field?.setSelectionRange(selection,selection);return true;}
  return false;
 }
 function submit(event){
  if(event.target.id!=='notion-memo-form')return false;
  event.preventDefault();if(busy)return true;
  const form=event.target,fd=new FormData(form),item=editing?memos.find(x=>x.id===editing):null;
  const draft={title:String(fd.get('title')||'').trim(),body:String(fd.get('body')||''),category:String(fd.get('category')||'その他'),...(item?{id:item.id,editedAt:item.editedAt}:{})};
  if(!draft.title){toast('タイトルを入力してください。');return true;}
  formDraft=draft;busy=true;message='メモを保存中';
  (async()=>{try{
   await api('/api/notion/memos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});
   editing='__closed__';formDraft=null;busy=false;await load();toast('Notionにメモを保存しました。');
  }catch(e){message=e.message;toast(e.message);}finally{busy=false;render();}})();
  return true;
 }

 return {page,click,change,input,submit,load,sync};
}
