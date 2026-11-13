// 観戦中の入力は試合ごとに分離し、未送信の文章はタブ内に保持する。
export function createBaseballNotes({escapeHTML:esc,render,toast,fetcher=fetch,draftStorage=typeof sessionStorage==='undefined'?null:sessionStorage,uuid=()=>crypto.randomUUID()}){
  let gameId='',items=[],loaded=false,loading=false,saving=false,error='',draft={body:'',phase:'during',inning:'',clientId:''},editId='',deleteId='',loadToken=0;
  const phases={before:'試合前',during:'試合中',after:'試合後'};
  const key=id=>'toki-baseball-note-draft-v1:'+id;
  const getDraft=id=>{
    if(!id)return null;
    try{const raw=draftStorage?.getItem(key(id));if(!raw)return null;const d=JSON.parse(raw);if(typeof d?.body!=='string'||d.body.length>4000||!Object.hasOwn(phases,d.phase)||typeof d.inning!=='string'||d.inning.length>20)return null;return d;}catch{return null;}
  };
  const saveDraft=()=>{if(!gameId)return;try{draftStorage?.setItem(key(gameId),JSON.stringify({...draft,editId}));}catch{}};
  const removeDraft=id=>{try{draftStorage?.removeItem(key(id));}catch{}};
  const resetDraft=()=>{draft={body:'',phase:'during',inning:'',clientId:''};editId='';removeDraft(gameId);};
  const showTime=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}):'—';};
  const noteLabel=item=>phases[item.phase]||'試合中';
  async function load(target=gameId){
    if(!target||loading)return;
    const token=++loadToken;loading=true;error='';render();
    try{
      const response=await fetcher('/api/baseball/notes?gameId='+encodeURIComponent(target),{credentials:'same-origin',cache:'no-store'});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'観戦メモを取得できませんでした。');
      if(gameId===target&&token===loadToken){items=data.items||[];loaded=true;}
    }catch(e){if(gameId===target&&token===loadToken)error=e.message;}
    finally{if(gameId===target&&token===loadToken){loading=false;render();}}
  }
  function select(id){
    if(gameId===id)return;
    if(gameId)saveDraft();
    gameId=id||'';items=[];loaded=false;loading=false;saving=false;error='';deleteId='';editId='';
    ++loadToken;
    const previous=getDraft(gameId);
    draft=previous?{body:previous.body,phase:previous.phase,inning:previous.inning,clientId:previous.clientId||''}:{body:'',phase:'during',inning:'',clientId:''};
    editId=previous?.editId||'';
    if(gameId)load(gameId);
  }
  const options=()=>Object.entries(phases).map(([key,label])=>'<option value="'+key+'"'+(draft.phase===key?' selected':'')+'>'+label+'</option>').join('');
  function page(){
    if(!gameId)return '<section class="panel baseball-notes"><h2>観戦メモ</h2><p class="muted">先に試合を登録してください。</p></section>';
    const sorted=[...items].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    return '<section class="panel baseball-notes" aria-label="観戦メモ">'
      +'<div class="panel-heading"><div><h2>観戦メモ</h2><small>試合を見ながら、思ったことを自由に記録</small></div><button class="button secondary" type="button" data-baseball-note="refresh" '+(loading||saving?'disabled':'')+'>最新情報を取得</button></div>'
      +'<form id="baseball-note-form"><label for="baseball-note-body" class="baseball-note-label">'+(editId?'メモを編集':'新しいメモ')+'</label>'
      +'<textarea id="baseball-note-body" name="body" rows="5" maxlength="4000" required placeholder="試合中の気づきや采配への考えなどを入力">'+esc(draft.body)+'</textarea>'
      +'<div class="baseball-note-options"><label>区分（任意）<select name="phase" id="baseball-note-phase">'+options()+'</select></label>'
      +'<label>イニング（任意）<input id="baseball-note-inning" name="inning" type="text" maxlength="20" value="'+esc(draft.inning)+'" placeholder="例：7回表"></label></div>'
      +'<div class="baseball-note-actions"><small>Ctrl＋Enterで保存・時刻は自動記録</small><button type="submit" class="button primary" '+(saving?'disabled':'')+'>'+(saving?'保存中…':editId?'変更を保存':'メモを保存')+'</button>'+(editId?'<button type="button" class="button secondary" data-baseball-note="cancel-edit">編集を中止</button>':'')+'</div></form>'
      +(error?'<p class="notice" role="alert">'+esc(error)+'<span class="baseball-note-protected"> 入力した文章は保持されています。</span></p>':'')
      +'<div class="baseball-note-history"><div class="panel-heading"><h3>記録一覧</h3><small>'+sorted.length+'件</small></div>'
      +(loading?'<p class="muted">メモを読み込み中…</p>':'')
      +(!loaded&&!loading?'<p class="muted">「最新情報を取得」で記録を確認できます。</p>':'')
      +(loaded&&!sorted.length?'<p class="muted">まだ観戦メモはありません。</p>':'')
      +sorted.map(item=>'<article class="baseball-note-item"><div class="baseball-note-head"><time datetime="'+esc(item.createdAt)+'">'+esc(showTime(item.createdAt))+'</time><span>'+esc(noteLabel(item))+(item.inning?' ・ '+esc(item.inning):'')+'</span></div><p>'+esc(item.body)+'</p>'
        +(deleteId===item.id?'<div class="baseball-note-confirm"><span>このメモを削除しますか？</span><button type="button" class="button secondary" data-baseball-note="cancel-delete">キャンセル</button><button type="button" class="button danger" data-baseball-note="confirm-delete" data-note-id="'+esc(item.id)+'" '+(saving?'disabled':'')+'>削除する</button></div>':'<div class="baseball-note-controls"><button type="button" class="text-button" data-baseball-note="edit" data-note-id="'+esc(item.id)+'" '+(saving?'disabled':'')+'>編集</button><button type="button" class="text-button" data-baseball-note="delete" data-note-id="'+esc(item.id)+'" '+(saving?'disabled':'')+'>削除</button></div>')
        +'</article>').join('')+'</div></section>';
  }
  function input(el){
    if(!gameId)return false;
    if(el.id==='baseball-note-body'){draft.body=el.value;saveDraft();return true;}
    if(el.id==='baseball-note-inning'){draft.inning=el.value;saveDraft();return true;}
    return false;
  }
  function change(el){if(el.id!=='baseball-note-phase')return false;draft.phase=el.value;saveDraft();return true;}
  function keydown(event){
    if(event.target?.id!=='baseball-note-body'||event.key!=='Enter'||(!event.ctrlKey&&!event.metaKey)||event.isComposing)return false;
    event.preventDefault();event.target.closest('form')?.requestSubmit();return true;
  }
  function click(button){
    const action=button.dataset.baseballNote;if(!action)return false;
    if(action==='refresh'){if(!saving)load();return true;}
    if(saving)return true;
    if(action==='cancel-edit'){resetDraft();error='';render();return true;}
    if(action==='cancel-delete'){deleteId='';render();return true;}
    if(action==='edit'){
      const item=items.find(x=>x.id===button.dataset.noteId);
      if(item){editId=item.id;draft={body:item.body,phase:item.phase,inning:item.inning,clientId:''};deleteId='';error='';saveDraft();render();document.querySelector('#baseball-note-body')?.focus();}
      return true;
    }
    if(action==='delete'){deleteId=button.dataset.noteId;render();return true;}
    if(action==='confirm-delete'){remove(button.dataset.noteId);return true;}
    return false;
  }
  async function write(targetId,action,note=null){
    const requestGame=gameId;
    saving=true;error='';render();
    try{
      const old=items.find(x=>x.id===targetId);
      const response=await fetcher('/api/baseball/notes',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,gameId:requestGame,id:targetId,revision:old?.revision,note})});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'観戦メモを保存できませんでした。');
      if(data.item&&gameId===requestGame){
        items=items.filter(x=>x.id!==data.item.id);
        if(!data.item.deleted)items.push(data.item);
        if(action!=='delete'||editId===targetId)resetDraft();
        deleteId='';loaded=true;
      }
      if(action!=='delete')removeDraft(requestGame);
      toast(action==='delete'?'メモを削除しました。':'観戦メモを保存しました。');
    }catch(e){if(gameId===requestGame)error=e.message;}
    finally{if(gameId===requestGame){saving=false;render();if(action!=='delete'&&!error)document.querySelector('#baseball-note-body')?.focus();}}
  }
  async function remove(id){
    if(!items.some(x=>x.id===id))return;
    await write(id,'delete');
  }
  function submit(event){
    const form=event.target;
    if(form.id!=='baseball-note-form')return false;
    event.preventDefault();
    if(saving)return true;
    const fields=new FormData(form);
    draft={...draft,body:String(fields.get('body')||''),phase:String(fields.get('phase')||'during'),inning:String(fields.get('inning')||'')};
    saveDraft();
    if(!draft.body.trim()){error='メモ本文を入力してください。';render();return true;}
    if(!loaded){error='観戦メモの読込状態を確認してください。';render();return true;}
    if(!editId&&!draft.clientId){draft.clientId=uuid();saveDraft();}
    const id=editId||draft.clientId;
    const note={body:draft.body,phase:draft.phase,inning:draft.inning};
    write(id,editId?'update':'create',note);
    return true;
  }
  function clearDrafts(){
    try{for(let i=(draftStorage?.length||0)-1;i>=0;i--){const name=draftStorage.key(i);if(name?.startsWith('toki-baseball-note-draft-v1:'))draftStorage.removeItem(name);}}catch{}
    if(gameId)removeDraft(gameId);
  }
  return {page,select,load,click,input,change,keydown,submit,clearDrafts};
}
