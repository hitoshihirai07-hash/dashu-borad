import {createBaseballNotes} from './baseball-notes.js';
import {createBaseballData} from './baseball-data.js';
import {BASEBALL_OPPONENTS,BASEBALL_TYPES,BASEBALL_STATES,BASEBALL_LOCATIONS,normalizeBaseballGame,baseballTestGame2026} from './baseball-model.js';
export function createBaseball({escapeHTML:esc,render,toast,fetcher=fetch}){
  let items=[],loaded=false,busy=false,error='',season=2026,selected='',editing=false,draft=null,officialPreview=null,officialBusy=false;
  const notes=createBaseballNotes({escapeHTML:esc,render,toast,fetcher});
  const stats=createBaseballData({escapeHTML:esc,render,toast,fetcher});
  const pick=(options,value)=>Object.entries(options).map(([key,label])=>'<option value="'+esc(key)+'"'+(value===key?' selected':'')+'>'+esc(label)+'</option>').join('');
  const opps=value=>BASEBALL_OPPONENTS.map(label=>'<option value="'+esc(label)+'"'+(label===value?' selected':'')+'>'+esc(label)+'</option>').join('');
  const showDate=v=>v?.replaceAll('-','/')||'';
  const label=x=>x===null||x===undefined||x===''?'—':esc(x);
  const result=g=>g.result==='win'?'勝ち':g.result==='loss'?'負け':g.result==='draw'?'引き分け':'未確定';
  const status=g=>BASEBALL_STATES[g.state]||g.state;
  const title=g=>showDate(g.date)+'　巨人 対 '+g.opponent;
  const record=()=>items.find(x=>x.id===selected);
  const formInput=(name,title,value='',type='text',extra='')=>'<label>'+title+'<input name="'+name+'" type="'+type+'" value="'+esc(value??'')+'" '+extra+'></label>';
  const formSelect=(name,title,options,value)=>'<label>'+title+'<select name="'+name+'">'+options(value)+'</select></label>';
  function form(){
    const g=draft||{date:'2026-09-27',opponent:'ヤクルト',gameNumber:1,gameType:'regular',location:'home',state:'scheduled',stadium:'',giantsStarter:'',opponentStarter:'',giantsScore:null,opponentScore:null,sourceUrl:''};
    const persisted=record();
    return '<section class="panel baseball-edit"><div class="panel-heading"><h2>'+(editing?'試合情報を修正':'試合を新規登録')+'</h2><button type="button" class="button secondary" data-baseball="cancel">試合画面に戻る</button></div>'
    +'<form id="baseball-game-form"><div class="baseball-fields">'
    +formInput('date','試合日',g.date,'date','required min="2000-01-01" max="2100-12-31" '+(editing?'readonly':''))
    +formSelect('opponent','対戦相手',opps,g.opponent).replace('<select name="opponent">','<select name="opponent" '+(editing?'disabled':'')+'>')
    +formInput('gameNumber','同日の試合番号',g.gameNumber,'number','min="1" max="3" required '+(editing?'readonly':''))
    +formSelect('gameType','試合区分',v=>pick(BASEBALL_TYPES,v),g.gameType).replace('<select name="gameType">','<select name="gameType" '+(editing?'disabled':'')+'>')
    +formSelect('location','開催区分',v=>pick(BASEBALL_LOCATIONS,v),g.location)
    +formSelect('state','試合状況',v=>pick(BASEBALL_STATES,v),g.state)
    +formInput('stadium','球場',g.stadium,'text','maxlength="100" placeholder="例：東京ドーム"')
    +formInput('giantsStarter','巨人先発投手',g.giantsStarter,'text','maxlength="100"')
    +formInput('opponentStarter','相手先発投手',g.opponentStarter,'text','maxlength="100"')
    +formInput('giantsScore','巨人の得点',g.giantsScore,'number','min="0" max="99"')
    +formInput('opponentScore','相手の得点',g.opponentScore,'number','min="0" max="99"')
    +formInput('sourceUrl','参考URL',g.sourceUrl,'url','maxlength="500" placeholder="https://..."')
    +'</div><p class="muted">勝敗は「試合終了」を選び、両チームの得点を入力すると自動判定します。スタメン・継投などの詳細データは試合登録後に入力できます。</p>'
    +(editing&&persisted?'<p class="muted">現在の保存版：'+persisted.revision+'</p>':'')
    +'<div class="baseball-actions"><button class="button primary" type="submit" '+(busy?'disabled':'')+'>'+(editing?'変更を保存':'試合を登録')+'</button></div></form></section>';
  }
  function detail(item){
    if(!item)return '';
    const g=item.game;
    return '<section class="panel baseball-detail" aria-label="試合の基本情報">'
      +'<div class="baseball-summary-line"><div class="baseball-summary-content">'
      +'<span class="baseball-summary-date">'+esc(showDate(g.date))+' ・ '+label(g.stadium)+' ・ '+esc(BASEBALL_TYPES[g.gameType]||'試合')+'</span>'
      +'<div class="baseball-score"><strong>巨人 '+label(g.giantsScore)+' <span class="baseball-dash">―</span> '+label(g.opponentScore)+' '+esc(g.opponent)+'</strong><span class="baseball-result">'+esc(result(g))+'・'+esc(status(g))+'</span></div>'
      +'<p class="baseball-summary-starters">先発：巨人 '+label(g.giantsStarter)+'　／　'+esc(g.opponent)+' '+label(g.opponentStarter)+'</p>'
      +'</div><div class="baseball-summary-actions"><button type="button" class="button secondary" data-baseball="official-preview" '+(officialBusy?'disabled':'')+'>NPB結果を取得</button><button type="button" class="button secondary" data-baseball="edit">試合情報を編集</button></div></div>'
      +(officialPreview?'<div class="baseball-official-preview" role="status"><strong>NPB公式：巨人 '+officialPreview.giantsScore+' ― '+officialPreview.opponentScore+' '+esc(g.opponent)+'</strong><span class="muted"> 最終得点のみ・まだ保存していません。</span><div><button type="button" class="button primary" data-baseball="official-apply" '+(officialBusy?'disabled':'')+'>反映する</button><button type="button" class="button secondary" data-baseball="official-discard">破棄</button></div></div>':'')
      +'<details class="baseball-extra"><summary>球場・対戦情報・参照元を見る</summary><dl class="baseball-dl">'
      +[['試合区分',BASEBALL_TYPES[g.gameType]],['開催区分',BASEBALL_LOCATIONS[g.location]],['球場',g.stadium],['試合番号',g.gameNumber]].map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+label(v)+'</dd></div>').join('')
      +'</dl>'+(g.sourceUrl?'<a href="'+esc(g.sourceUrl)+'" target="_blank" rel="noopener noreferrer">参考記録を開く</a>':'')+'</details></section>';
  }
  function page(){
    const filtered=items.filter(x=>x.game.season===season).sort((a,b)=>b.game.date.localeCompare(a.game.date)||b.game.gameNumber-a.game.gameNumber);
    const picked=filtered.find(x=>x.id===selected)||filtered[0];
    const options=filtered.map(item=>'<option value="'+esc(item.id)+'"'+(picked?.id===item.id?' selected':'')+'>'+esc(showDate(item.game.date)+'　巨人 対 '+item.game.opponent+'（'+result(item.game)+'）')+'</option>').join('');
    return '<header class="baseball-heading"><h1>⚾ 試合管理</h1></header>'
      +'<div class="baseball-toolbar">'
      +'<label class="baseball-season-field">シーズン<select id="baseball-season"><option value="2026"'+(season===2026?' selected':'')+'>2026年</option><option value="2027"'+(season===2027?' selected':'')+'>2027年</option></select></label>'
      +'<label class="baseball-game-field">試合を選択<select id="baseball-game-picker" '+(filtered.length?'':'disabled')+'>'+(filtered.length?options:'<option value="">登録済みの試合なし</option>')+'</select></label>'
      +'<button type="button" class="button primary" data-baseball="new">＋ 試合登録</button>'
      +'<button type="button" class="button secondary" data-baseball="refresh" '+(busy?'disabled':'')+'>再読込</button></div>'
      +(error?'<p class="notice" role="alert">'+esc(error)+'</p>':'')
      +(busy?'<p class="muted">処理中です…</p>':'')
      +(editing||draft?form():!loaded?'<section class="panel"><p>試合データを読み込んでいます。</p></section>'
      :!filtered.length?'<section class="panel baseball-empty"><p>このシーズンの試合はまだ登録されていません。</p>'
      +(season===2026?'<button type="button" class="button secondary" data-baseball="example">2026/9/27の検証用試合を作成</button>':'')+'</section>'
      :'<div class="baseball-workspace">'+detail(picked)
       +'<div class="baseball-main">'+notes.page()+stats.page()+'</div></div>');
  }
  async function load(){
    if(busy)return;
    busy=true;error='';render();
    try{
      const response=await fetcher('/api/baseball/games',{credentials:'same-origin',cache:'no-store'});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'試合一覧を取得できませんでした。');
      items=data.items||[];loaded=true;
      if(selected&&!items.some(x=>x.id===selected))selected='';
      if(!items.some(x=>x.id===selected&&x.game.season===season))selected=items.find(x=>x.game.season===season)?.id||'';
      notes.select(selected);
      stats.select(selected,record()?.game);
      officialPreview=null;
    }catch(e){error=e.message;}
    finally{busy=false;render();}
  }
  function click(button){
    if(notes.click(button))return true;
    if(stats.click(button))return true;
    
    const action=button.dataset.baseball;if(!action)return false;
    if(action==='official-preview'){previewOfficial();return true;}
    if(action==='official-apply'){applyOfficial();return true;}
    if(action==='official-discard'){officialPreview=null;render();return true;}
    if(action==='refresh'){if(!draft)load();return true;}
    if(action==='new'){selected='';officialPreview=null;notes.select('');stats.select('',null);draft={date:season+'-09-27',opponent:'ヤクルト',gameNumber:1,gameType:'regular',location:'home',state:'scheduled'};editing=false;error='';render();return true;}
    if(action==='example'){selected='';officialPreview=null;notes.select('');stats.select('',null);draft=baseballTestGame2026();editing=false;error='';render();return true;}
    if(action==='edit'&&record()){draft={...record().game};editing=true;error='';render();return true;}
    if(action==='cancel'){editing=false;draft=null;error='';if(!selected)selected=items.find(x=>x.game.season===season)?.id||'';notes.select(selected);stats.select(selected,record()?.game);render();return true;}
    return false;
  }
  function change(el){
    if(notes.change(el))return true;
    if(stats.change(el))return true;
    if(el.id==='baseball-season'){season=Number(el.value);selected=items.find(x=>x.game.season===season)?.id||'';officialPreview=null;notes.select(selected);stats.select(selected,record()?.game);editing=false;draft=null;render();return true;}
    if(el.id==='baseball-game-picker'){if(items.some(x=>x.id===el.value&&x.game.season===season)){selected=el.value;officialPreview=null;notes.select(selected);stats.select(selected,record()?.game);editing=false;draft=null;render();}return true;}
    return false;
  }
  async function save(event){
    const form=event.target,values=Object.fromEntries(new FormData(form));
    if(editing&&record())for(const k of ['opponent','gameType'])values[k]=record().game[k];
    const numeric=v=>v===''?null:Number(v);
    values.giantsScore=numeric(values.giantsScore);values.opponentScore=numeric(values.opponentScore);
    try{
      const game=normalizeBaseballGame(values);
      draft=game;error='';busy=true;render();
      const existing=editing?record():null;
      const response=await fetcher('/api/baseball/games',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:existing?'update':'create',id:existing?.id,revision:existing?.revision,game})});
      const result=await response.json();
      if(!response.ok)throw Error(result.error||'試合を保存できませんでした。');
      const item=result.item;items=items.filter(x=>x.id!==item.id).concat(item);
      selected=item.id;season=game.season;officialPreview=null;notes.select(selected);stats.select(selected,game);editing=false;draft=null;toast('試合を保存しました。');loaded=true;
    }catch(e){error=e.message;}
    finally{busy=false;render();}
  }

  async function previewOfficial(){
    const current=record();
    if(!current||officialBusy)return;
    officialBusy=true;officialPreview=null;error='';render();
    try{
      const response=await fetcher('/api/baseball/official-score?gameId='+encodeURIComponent(current.id),{credentials:'same-origin',cache:'no-store'});
      const answer=await response.json();
      if(!response.ok)throw Error(answer.error||'NPB公式結果を取得できませんでした。');
      if(record()?.id===current.id)officialPreview=answer;
    }catch(e){if(record()?.id===current.id)error=e.message;}
    finally{officialBusy=false;render();}
  }
  async function applyOfficial(){
    const current=record(),preview=officialPreview;
    if(!current||!preview||officialBusy)return;
    officialBusy=true;error='';render();
    try{
      const game=normalizeBaseballGame({...current.game,giantsScore:preview.giantsScore,opponentScore:preview.opponentScore,state:'finished',sourceUrl:preview.sourceUrl});
      const response=await fetcher('/api/baseball/games',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update',id:current.id,revision:current.revision,game})});
      const answer=await response.json();
      if(!response.ok)throw Error(answer.error||'公式結果を反映できませんでした。');
      items=items.filter(x=>x.id!==current.id).concat(answer.item);
      officialPreview=null;stats.select(selected,game);toast('NPB公式の最終スコアを反映しました。');
    }catch(e){error=e.message;}
    finally{officialBusy=false;render();}
  }
  function submit(event){if(notes.submit(event))return true;if(stats.submit(event))return true;if(event.target.id!=='baseball-game-form')return false;event.preventDefault();if(busy)return true;save(event);return true;}
  return {page,load,click,change,submit,input:el=>notes.input(el)||stats.input(el),keydown:notes.keydown,clearDrafts:()=>{notes.clearDrafts();stats.clearDrafts();}};
}
