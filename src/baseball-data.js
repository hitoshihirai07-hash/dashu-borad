import {EMPTY_BASEBALL_DATA,normalizeBaseballData,parsePitchingInnings,displayPitchingInnings,scoreMismatch,baseballGameData2026Fixture} from './baseball-data-model.js';
const BASEBALL_DATA_TEAM_LABELS={giants:'巨人',opponent:'対戦相手'};
const baseballDataSafeInt=value=>value==null||value===''||value==='-'||value==='—'?null:Number(value);
const baseballDataSplitColumns=line=>line.split(/[\t,]/).map(v=>v.trim());
const baseballDataSample=(team)=>team==='giants'?'1,中,松本 剛\n2,遊,泉口 友汰':'1,遊,長岡 秀樹\n2,右,増田 珠';
export function parseBaseballEntry(fields) {
  if (!fields || typeof fields!=='object') throw Error('入力データが不正です。');
  const nums=(value,side)=>{
    const words=String(value||'').trim().split(/[\s,、]+/).filter(Boolean);
    if(words.length>18)throw Error('イニングは18回まで入力できます。');
    return words.map(v=>{
      if(v.toUpperCase()==='X'||v==='-'||v==='—')return null;
      if(!/^\d+$/.test(v)||Number(v)>99)throw Error(side+'のイニング得点が不正です。');
      return Number(v);
    });
  };
  const gs=nums(fields.giantsInnings,'巨人'),os=nums(fields.opponentInnings,'対戦相手');
  const max=Math.max(gs.length,os.length);
  const innings=Array.from({length:max},(_,i)=>({number:i+1,giants:gs[i]??null,opponent:os[i]??null}));
  const lineups={},pitchers={};
  for(const team of ['giants','opponent']){
    lineups[team]=String(fields[team+'Lineup']||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(line=>{
      const cols=baseballDataSplitColumns(line);
      if(cols.length<3)throw Error(BASEBALL_DATA_TEAM_LABELS[team]+'のスタメンは「打順,守備,選手名」で入力してください。');
      return {order:Number(cols[0]),position:cols[1],name:cols[2],atBats:baseballDataSafeInt(cols[3]),hits:baseballDataSafeInt(cols[4]),rbi:baseballDataSafeInt(cols[5])};
    });
    pitchers[team]=String(fields[team+'Pitchers']||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(line=>{
      const cols=baseballDataSplitColumns(line);
      if(!cols[0])throw Error(BASEBALL_DATA_TEAM_LABELS[team]+'の投手名を入力してください。');
      return {name:cols[0],outs:parsePitchingInnings(cols[1]||''),pitches:baseballDataSafeInt(cols[2]),hits:baseballDataSafeInt(cols[3]),walks:baseballDataSafeInt(cols[4]),strikeouts:baseballDataSafeInt(cols[5]),runs:baseballDataSafeInt(cols[6]),earnedRuns:baseballDataSafeInt(cols[7])};
    });
  }
  return normalizeBaseballData({innings,lineups,pitchers,
    decisions:{win:String(fields.win||''),loss:String(fields.loss||''),save:String(fields.save||'')},
    sourceUrl:String(fields.sourceUrl||'')});
}
export function baseballEntryFields(data){
  const source=normalizeBaseballData(data||EMPTY_BASEBALL_DATA());
  const scores=team=>source.innings.map(i=>i[team]===null?'X':String(i[team])).join(' ');
  const lineup=team=>source.lineups[team].map(p=>[p.order,p.position,p.name,p.atBats,p.hits,p.rbi].map(v=>v??'').join(',')).join('\n');
  const pen=team=>source.pitchers[team].map(p=>[p.name,displayPitchingInnings(p.outs),p.pitches,p.hits,p.walks,p.strikeouts,p.runs,p.earnedRuns].map(v=>v??'').join(',')).join('\n');
  return {giantsInnings:scores('giants'),opponentInnings:scores('opponent'),
    giantsLineup:lineup('giants'),opponentLineup:lineup('opponent'),giantsPitchers:pen('giants'),opponentPitchers:pen('opponent'),
    win:source.decisions.win,loss:source.decisions.loss,save:source.decisions.save,sourceUrl:source.sourceUrl};
}
export function createBaseballData({escapeHTML:esc,render,toast,fetcher=fetch,draftStorage=typeof sessionStorage!=='undefined'?sessionStorage:null}){
  let gameId='',game=null,revision=0,loaded=false,busy=false,error='',data=EMPTY_BASEBALL_DATA(),editing=false,fields=null,token=0;
  const draftKey=id=>'toki-baseball-stats-draft-v1:'+id;
  const clean=id=>{try{draftStorage?.removeItem(draftKey(id));}catch{}};
  const saveDraft=()=>{if(!gameId||!editing||!fields)return;try{draftStorage?.setItem(draftKey(gameId),JSON.stringify(fields));}catch{}};
  const getDraft=id=>{try{const d=JSON.parse(draftStorage?.getItem(draftKey(id))||'null');if(!d||typeof d!=='object')return null;const keys=Object.keys(baseballEntryFields(null));if(keys.some(k=>typeof d[k]!=='string'||d[k].length>16000))return null;return d;}catch{return null;}};
  const td=v=>esc(v===null||v===undefined||v===''?'—':v);
  const field=(key,label,placeholder='',lines=3)=>'<label>'+label+'<textarea name="'+key+'" data-baseball-stats-field="'+key+'" rows="'+lines+'" placeholder="'+esc(placeholder)+'" spellcheck="false">'+esc(fields[key])+'</textarea></label>';
  const textInput=(key,label)=>'<label>'+label+'<input type="text" name="'+key+'" data-baseball-stats-field="'+key+'" maxlength="80" value="'+esc(fields[key])+'"></label>';
  const formatTable=(headers,body)=>'<div class="baseball-data-scroll"><table><thead><tr>'+headers.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';
  function overview(){
    if(!loaded)return '<p class="muted">試合データを読み込み中です。</p>';
    const hasAny=data.innings.length||data.lineups.giants.length||data.pitchers.giants.length;
    if(!hasAny)return '<p class="muted">スタメン・継投・イニング得点はまだ登録されていません。「データを編集」から登録できます。</p>';
    let out='';
    if(data.innings.length){
      const row=team=>'<tr><th scope="row">'+BASEBALL_DATA_TEAM_LABELS[team]+'</th>'+data.innings.map(x=>'<td>'+td(x[team]===null?'X':x[team])+'</td>').join('')+'<th>'+data.innings.reduce((s,x)=>s+(x[team]||0),0)+'</th></tr>';
      out+='<h3>イニング別得点</h3>'+formatTable(['チーム',...data.innings.map(x=>x.number),'計'],row('opponent')+row('giants'));
      if(scoreMismatch(game,data))out+='<p class="notice" role="status">イニング別得点と試合基本情報の最終スコアが一致しません。確認してください。</p>';
    }
    for(const team of ['giants']){
      if(data.lineups[team].length)out+='<h3>'+BASEBALL_DATA_TEAM_LABELS[team]+'のスタメン</h3>'+formatTable(['打順','守備','選手','打数','安打','打点'],data.lineups[team].map(p=>'<tr><td>'+p.order+'</td><td>'+td(p.position)+'</td><td>'+td(p.name)+'</td><td>'+td(p.atBats)+'</td><td>'+td(p.hits)+'</td><td>'+td(p.rbi)+'</td></tr>').join(''));
      if(data.pitchers[team].length)out+='<h3>'+BASEBALL_DATA_TEAM_LABELS[team]+'の投手起用</h3>'+formatTable(['順','投手','回','球数','被安打','与四球','奪三振','失点','自責'],data.pitchers[team].map((p,i)=>'<tr><td>'+(i+1)+'</td><td>'+td(p.name)+'</td><td>'+td(displayPitchingInnings(p.outs))+'</td>'+['pitches','hits','walks','strikeouts','runs','earnedRuns'].map(k=>'<td>'+td(p[k])+'</td>').join('')+'</tr>').join(''));
    }
    out+='<h3>責任投手</h3><div class="baseball-data-decisions">勝：'+td(data.decisions.win)+' ／ 敗：'+td(data.decisions.loss)+' ／ セーブ：'+td(data.decisions.save)+'</div>';
    if(data.sourceUrl)out+='<p class="baseball-data-source"><a href="'+esc(data.sourceUrl)+'" target="_blank" rel="noopener noreferrer">記録の参照元を開く</a></p>';
    return out;
  }
  function form(){
    return '<form id="baseball-data-form" class="baseball-data-form">'
    +'<p class="muted">表の行は「カンマ」または「タブ」で区切ります。打撃成績・球数などは空欄でも保存できます。貼り付けにも対応しています。</p>'
    +'<h3>イニング別得点</h3><div class="baseball-data-fields">'
    +field('giantsInnings','巨人（1回から順に）','0 3 5 0 2 1 0 0 X',2)
    +field('opponentInnings','対戦相手（1回から順に）','0 0 0 0 0 0 0 0 0',2)+'</div>'
    +'<h3>スタメン</h3><p class="muted">打順,守備,選手名,打数,安打,打点（後ろの3項目は省略可）</p><div class="baseball-data-fields">'
    +field('giantsLineup','巨人',baseballDataSample('giants'),9)+'</div>'
    +'<h3>投手起用</h3><p class="muted">投手名,投球回,球数,被安打,与四球,奪三振,失点,自責点。投球回の「0.1」は1/3回、「0.2」は2/3回です。</p><div class="baseball-data-fields">'
    +field('giantsPitchers','巨人（登板順）','小笠原 慎之介,5,,4,1,5,0,0',6)+'</div>'
    +'<h3>責任投手</h3><div class="baseball-data-fields">'+textInput('win','勝利投手')+textInput('loss','敗戦投手')+textInput('save','セーブ投手')+'</div>'
    +'<div class="baseball-data-fields">'+ '<label>公式記録・参照URL<input type="url" name="sourceUrl" data-baseball-stats-field="sourceUrl" value="'+esc(fields.sourceUrl)+'" placeholder="https://..."></label></div>'
    +'<div class="baseball-data-actions"><button type="submit" class="button primary" '+(busy?'disabled':'')+'>試合データを保存</button><button type="button" class="button secondary" data-baseball-stats="cancel">入力を中止</button></div></form>';
  }
  function page(){
    if(!gameId)return '';
    const canExample=game?.date==='2026-09-27'&&game?.opponent==='ヤクルト'&&game?.gameType==='regular';
    return '<section class="panel baseball-data" aria-label="試合データ"><div class="panel-heading"><div><h2>巨人のスタメン・投手成績</h2><small>相手球団はイニング得点のみ表示</small></div><div class="baseball-data-head-actions">'
      +(!editing?'<button type="button" class="button secondary" data-baseball-stats="edit" '+(!loaded||busy?'disabled':'')+'>データを編集</button>':'')
      +'<button type="button" class="button secondary" data-baseball-stats="reload" '+(busy||editing?'disabled':'')+'>保存済みデータを再取得</button></div></div>'
      +(error?'<p class="notice" role="alert">'+esc(error)+(editing?' 入力内容は保持しています。':'')+'</p>':'')
      +(busy?'<p class="muted">保存・取得処理中…</p>':'')
      +(editing?form():overview())
      +(canExample&&!editing&&loaded?'<div class="baseball-data-actions"><button type="button" class="button secondary" data-baseball-stats="fixture">2026/9/27の検証用入力例を開く</button></div>':'')
      +'</section>';
  }
  async function load(id=gameId){
    if(!id||busy)return;
    const mark=++token;busy=true;error='';render();
    try{
      const response=await fetcher('/api/baseball/data?gameId='+encodeURIComponent(id),{credentials:'same-origin',cache:'no-store'});
      const body=await response.json();
      if(!response.ok)throw Error(body.error||'試合データを取得できませんでした。');
      if(mark!==token||id!==gameId)return;
      revision=body.revision;data=normalizeBaseballData(body.data||EMPTY_BASEBALL_DATA());loaded=true;
    }catch(e){if(mark===token&&id===gameId)error=e.message;}
    finally{if(mark===token&&id===gameId){busy=false;render();}}
  }
  function select(id,currentGame){
    if(gameId===id){game=currentGame||null;return;}
    saveDraft();++token;gameId=id||'';game=currentGame||null;revision=0;loaded=false;busy=false;error='';data=EMPTY_BASEBALL_DATA();
    fields=getDraft(gameId);editing=Boolean(fields);
    if(gameId)load(gameId);
  }
  function input(el){
    const key=el.dataset?.baseballStatsField;
    if(!editing||!fields||!key||!Object.hasOwn(fields,key))return false;
    fields[key]=el.value;saveDraft();return true;
  }
  function click(button){
    const action=button.dataset?.baseballStats;
    if(!action)return false;
    if(action==='reload'){if(!editing&&!busy)load();return true;}
    if(action==='edit'&&loaded&&!busy){fields=baseballEntryFields(data);editing=true;error='';saveDraft();render();return true;}
    if(action==='fixture'&&loaded&&!busy&&game?.date==='2026-09-27'&&game?.opponent==='ヤクルト'){
      const fixture=baseballGameData2026Fixture();fixture.lineups.opponent=[];fixture.pitchers.opponent=[];fields=baseballEntryFields(fixture);editing=true;error='';saveDraft();render();return true;
    }
    if(action==='cancel'&&!busy){fields=null;editing=false;error='';clean(gameId);render();return true;}
    return true;
  }
  function change(el){return input(el);}
  async function save(){
    if(!editing||!fields||busy||!loaded)return;
    let next;
    try{next=parseBaseballEntry(fields);next.lineups.opponent=data.lineups.opponent;next.pitchers.opponent=data.pitchers.opponent;}catch(e){error=e.message;render();return;}
    const id=gameId,rev=revision;busy=true;error='';render();
    try{
      const response=await fetcher('/api/baseball/data',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId:id,revision:rev,data:next})});
      const answer=await response.json();
      if(!response.ok)throw Error(answer.error||'試合データの保存に失敗しました。');
      if(id!==gameId)return;
      revision=answer.revision;data=normalizeBaseballData(answer.data);loaded=true;editing=false;fields=null;clean(id);toast('試合データを保存しました。');
    }catch(e){if(id===gameId)error=e.message;}
    finally{if(id===gameId){busy=false;render();}}
  }
  function submit(event){if(event.target?.id!=='baseball-data-form')return false;event.preventDefault();if(busy)return true;
    const d=Object.fromEntries(new FormData(event.target));
    fields={...fields,...d};saveDraft();save();return true;
  }
  function clearDrafts(){
    try{for(let i=(draftStorage?.length||0)-1;i>=0;i--){const k=draftStorage.key(i);if(k?.startsWith('toki-baseball-stats-draft-v1:'))draftStorage.removeItem(k);}}catch{}
    clean(gameId);
  }
  return {page,load,select,input,click,change,submit,clearDrafts};
}
