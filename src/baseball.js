import {BASEBALL_OPPONENTS,BASEBALL_TYPES,BASEBALL_STATES,BASEBALL_LOCATIONS,normalizeBaseballGame,baseballTestGame2026} from './baseball-model.js';
export function createBaseball({escapeHTML:esc,render,toast,fetcher=fetch}){
  let items=[],loaded=false,busy=false,error='',season=2026,selected='',editing=false,draft=null;
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
    return '<section class="panel baseball-edit"><div class="panel-heading"><h2>'+(editing?'試合情報を修正':'試合を新規登録')+'</h2><button type="button" class="button secondary" data-baseball="cancel">一覧へ戻る</button></div>'
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
    +'</div><p class="muted">勝敗は「試合終了」を選び、両チームの得点を入力すると自動判定します。スタメン・継投・観戦メモは次の段階で追加します。</p>'
    +(editing&&persisted?'<p class="muted">現在の保存版：'+persisted.revision+'</p>':'')
    +'<div class="baseball-actions"><button class="button primary" type="submit" '+(busy?'disabled':'')+'>'+(editing?'変更を保存':'試合を登録')+'</button></div></form></section>';
  }
  function detail(item){
    if(!item)return '<section class="panel baseball-detail"><h2>試合詳細</h2><p class="muted">左の試合一覧から選択してください。</p></section>';
    const g=item.game;
    return '<section class="panel baseball-detail"><div class="panel-heading"><h2>'+esc(title(g))+'</h2><button type="button" class="button secondary" data-baseball="edit">編集</button></div>'
      +'<div class="baseball-score"><strong>巨人 '+label(g.giantsScore)+' － '+label(g.opponentScore)+' '+esc(g.opponent)+'</strong><span>'+esc(result(g))+' ・ '+esc(status(g))+'</span></div>'
      +'<dl class="baseball-dl">'
      +[['試合区分',BASEBALL_TYPES[g.gameType]],['開催区分',BASEBALL_LOCATIONS[g.location]],['球場',g.stadium],['巨人先発',g.giantsStarter],['相手先発',g.opponentStarter],['同日の試合番号',g.gameNumber]].map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+label(v)+'</dd></div>').join('')
      +'</dl>'+(g.sourceUrl?'<a href="'+esc(g.sourceUrl)+'" target="_blank" rel="noopener noreferrer">参考記録を開く</a>':'')
      +'<p class="muted baseball-phase">この段階では試合基本情報のみを管理します。スタメン・継投・観戦メモは次の実装対象です。</p></section>';
  }
  function page(){
    const filtered=items.filter(x=>x.game.season===season).sort((a,b)=>b.game.date.localeCompare(a.game.date)||b.game.gameNumber-a.game.gameNumber);
    return '<header class="page-heading"><div><h1>⚾ 試合管理</h1><p>巨人の試合を日付ごとに管理。2026年の試合で登録と読み戻しを検証します。</p></div></header>'
      +'<div class="baseball-toolbar"><label>シーズン <select id="baseball-season"><option value="2026"'+(season===2026?' selected':'')+'>2026年</option><option value="2027"'+(season===2027?' selected':'')+'>2027年</option></select></label><button type="button" class="button secondary" data-baseball="refresh" '+(busy?'disabled':'')+'>最新情報を取得</button><button type="button" class="button primary" data-baseball="new">＋ 試合を登録</button></div>'
      +(error?'<p class="notice" role="alert">'+esc(error)+'</p>':'')
      +(busy?'<p class="muted">処理中です…</p>':'')
      +(!loaded?'<section class="panel"><p>試合データを読み込んでいます。</p></section>':editing||draft?form():'<div class="baseball-layout"><section class="panel baseball-list"><div class="panel-heading"><h2>試合一覧</h2><small>'+filtered.length+'試合</small></div>'
      +(filtered.length?filtered.map(x=>'<button type="button" class="baseball-row'+(selected===x.id?' is-selected':'')+'" data-baseball-select="'+esc(x.id)+'"><strong>'+esc(title(x.game))+'</strong><span>'+esc(status(x.game))+' ・ '+esc(result(x.game))+'</span></button>').join(''):'<p class="muted">このシーズンの試合はまだありません。</p>')
      +(season===2026?'<button type="button" class="button secondary baseball-example" data-baseball="example">9/27 巨人対ヤクルトを入力例として開く</button>':'')
      +'</section>'+detail(record()&&record().game.season===season?record():filtered[0])+'</div>');
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
      if(!selected&&items.some(x=>x.game.season===season))selected=items.find(x=>x.game.season===season).id;
    }catch(e){error=e.message;}
    finally{busy=false;render();}
  }
  function click(button){
    if(button.dataset.baseballSelect!==undefined){selected=button.dataset.baseballSelect;editing=false;draft=null;render();return true;}
    const action=button.dataset.baseball;if(!action)return false;
    if(action==='refresh'){if(!draft)load();return true;}
    if(action==='new'){selected='';draft={date:season+'-09-27',opponent:'ヤクルト',gameNumber:1,gameType:'regular',location:'home',state:'scheduled'};editing=false;error='';render();return true;}
    if(action==='example'){selected='';draft=baseballTestGame2026();editing=false;error='';render();return true;}
    if(action==='edit'&&record()){draft={...record().game};editing=true;error='';render();return true;}
    if(action==='cancel'){editing=false;draft=null;error='';render();return true;}
    return false;
  }
  function change(el){
    if(el.id==='baseball-season'){season=Number(el.value);selected=items.find(x=>x.game.season===season)?.id||'';editing=false;draft=null;render();return true;}
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
      selected=item.id;season=game.season;editing=false;draft=null;toast('試合を保存しました。');loaded=true;
    }catch(e){error=e.message;}
    finally{busy=false;render();}
  }
  function submit(event){if(event.target.id!=='baseball-game-form')return false;event.preventDefault();if(busy)return true;save(event);return true;}
  return {page,load,click,change,submit};
}
