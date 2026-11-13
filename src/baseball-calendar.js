// Giants match calendar: self-contained markup driven by saved games, not by remote fetching.
export function renderGiantsMonth(items,year,month,escapeHTML){
  if(!Number.isInteger(year)||!Number.isInteger(month)||month<1||month>12)throw Error('表示月が不正です。');
  const esc=escapeHTML;
  const first=new Date(Date.UTC(year,month-1,1)).getUTCDay();
  const days=new Date(Date.UTC(year,month,0)).getUTCDate();
  const count=Math.ceil((first+days)/7)*7;
  const dateKey=day=>String(year)+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  const grouped=new Map();
  for(const item of items){
    const game=item.game;
    if(!game||game.season!==year||Number(game.date.slice(5,7))!==month)continue;
    const on=grouped.get(game.date)||[];
    on.push(item);grouped.set(game.date,on);
  }
  const resultText=game=>{
    if(game.state==='postponed')return '延期';
    if(game.state==='canceled')return '中止';
    if(game.state==='finished'&&game.giantsScore!==null&&game.opponentScore!==null){
      const sign=game.giantsScore>game.opponentScore?'○':game.giantsScore<game.opponentScore?'●':'△';
      return game.giantsScore+'－'+game.opponentScore+' '+sign;
    }
    return '試合前';
  };
  const oneGame=item=>{
    const game=item.game;
    const where=game.location==='home'?'主催':'遠征';
    return '<button type="button" class="baseball-calendar-game'+(game.state==='finished'?' finished':'')+'" data-baseball="calendar-pick" data-game-id="'+esc(item.id)+'" aria-label="'+esc(game.date+' 巨人対'+game.opponent+' '+resultText(game)+' 試合詳細を開く')+'">'
      +'<strong>'+esc(game.opponent)+'</strong><span class="baseball-calendar-location">'+where+'</span>'
      +'<span class="baseball-calendar-score">'+esc(resultText(game))+'</span>'
      +'<small>先発：'+esc(game.giantsStarter||'未登録')+'</small>'
      +'</button>';
  };
  const title=year+'年'+month+'月',monthLabel=month+'月';
  let grid='';
  for(let cell=0;cell<count;cell++){
    const day=cell-first+1;
    if(day<1||day>days){grid+='<div class="baseball-calendar-day is-outside" aria-hidden="true"></div>';continue;}
    const games=grouped.get(dateKey(day))||[];
    grid+='<div class="baseball-calendar-day"><span class="baseball-calendar-date">'+day+'</span>'
      +games.map(oneGame).join('')+'</div>';
  }
  const monthGames=[...grouped.values()].flat().sort((a,b)=>a.game.date.localeCompare(b.game.date)||a.game.gameNumber-b.game.gameNumber);
  const mobile=monthGames.map(item=>'<div class="baseball-calendar-mobile-item"><span class="baseball-calendar-mobile-date">'+Number(item.game.date.slice(-2))+'日</span>'+oneGame(item)+'</div>').join('');
  return '<section class="panel baseball-calendar" aria-label="'+title+'の試合">'
    +'<div class="baseball-calendar-heading">'
    +'<button type="button" class="button secondary" data-baseball="calendar-prev" '+(month===1?'disabled':'')+' aria-label="前の月">‹</button>'
    +'<h2>'+title+' <small>'+monthGames.length+'試合</small></h2>'
    +'<button type="button" class="button secondary" data-baseball="calendar-next" '+(month===12?'disabled':'')+' aria-label="次の月">›</button>'
    +'</div>'
    +'<div class="baseball-calendar-grid">'+['日','月','火','水','木','金','土'].map(day=>'<div class="baseball-calendar-weekday">'+day+'</div>').join('')+grid+'</div>'
    +'<div class="baseball-calendar-month-list">'+(mobile||'<p class="muted">'+monthLabel+'は登録済みの試合がありません。</p>')+'</div>'
    +(monthGames.length===0?'<p class="baseball-calendar-empty muted">この月は登録済みの試合がありません。</p>':'')
    +'<p class="baseball-calendar-help">試合を選択すると、観戦メモ・スタメン・選手成績が開きます。</p>'
    +'</section>';
}
