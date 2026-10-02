import {localDate,validDate,shiftDate} from './model.js';
import {LIFE_KEY,LIFE_FIELDS,lifeFresh,lifeRecord,lifeWeekday,lifeValidate,lifeParseCSV,lifeExportCSV,lifeMerge,lifeRange,lifeSummary} from './life-model.js';
import {createLifeStore} from './life-store.js';

export function createLifeLog({storage,render,toast,download,icon,escapeHTML:esc}){
  const store=createLifeStore(storage),$life=s=>document.querySelector(s);
  let mode='today',anchor=localDate(),detail=0,metric='sleep',page=1,query='',deleted=false,editing=null,editSnapshot='',pendingDelete=null,importData=null,importSnapshot='',importCSVText=null;
  const fmt=n=>n===null||n===undefined?'—':String(Number(n.toFixed(2)));
  const fieldFor=key=>LIFE_FIELDS.find(f=>f.key===key);
  const showValue=(f,r)=>f.type==='number'?`${fmt(r[f.key])}${r[f.key]!==null&&f.unit?' '+f.unit:''}`:esc(r[f.key]||'—');
  const tabs=(attribute,selected,items,label)=>`<div class="segmented life-tabs" role="group" aria-label="${label}">${items.map(([key,name])=>`<button type="button" data-${attribute}="${key}" class="${String(key)===String(selected)?'active':''}" aria-pressed="${String(key)===String(selected)}">${name}</button>`).join('')}</div>`;
  const sections=[[0,'からだ・睡眠'],[1,'食事・習慣'],[2,'振り返り']];
  const currentRecords=()=>store.get().records.filter(r=>!r.deleted);
  const card=(label,value,unit='',small='')=>`<div class="stat"><div><div class="stat-label">${label}</div><div class="stat-value"><strong>${value}</strong>${unit}</div>${small?`<small>${small}</small>`:''}</div></div>`;
  function summaryCards(records,previous){
    const s=lifeSummary(records),p=lifeSummary(previous),delta=key=>{const a=s.metrics[key].average,b=p.metrics[key].average;if(a===null||b===null)return '前期間との比較なし';const diff=a-b;return `前期間比 ${diff>0?'+':''}${fmt(diff)}${fieldFor(key).unit||''}`;};
    return `<section class="stats life-stats" aria-label="生活ログの集計">${card('記録した日数',s.days,'日')}${card('平均睡眠',fmt(s.metrics.sleep.average),'時間',delta('sleep'))}${card('平均体調',fmt(s.metrics.condition.average),'/ 5',delta('condition'))}${card('平均疲労感',fmt(s.metrics.fatigue.average),'/ 5',delta('fatigue'))}</section>`;
  }
  function dayPanel(){
    const r=currentRecords().find(r=>r.date===anchor);
    if(!r)return `<section class="panel life-day"><div class="empty-state">${icon('calendar')}<h2>${anchor===localDate()?'今日':'この日'}はまだ記録がありません</h2><p>からだの調子も、日々のひとことも。<br>空欄のままでも保存できます。</p><button class="button primary" data-life="add-date">${icon('plus')}この日の生活を記録</button><button class="text-button" data-life="import">CSVからはじめる</button></div></section>`;
    return `<section class="stats life-day-stats" aria-label="この日の状態">${card('睡眠時間',fmt(r.sleep),'時間')}${card('体調',fmt(r.condition),'/ 5')}${card('気分',fmt(r.mood),'/ 5')}</section><section class="panel life-day"><div class="panel-heading"><h2>${anchor===localDate()?'今日':'この日'}の記録</h2><div class="life-row"><button class="text-button" data-life-edit="${r.date}">${icon('edit')}編集</button><button class="text-button" data-life-delete="${r.date}">${icon('trash')}削除</button></div></div>${tabs('life-detail',detail,sections,'記録の項目')}<dl class="life-values">${LIFE_FIELDS.filter(f=>f.group===detail&&!['sleep','condition','mood'].includes(f.key)).map(f=>`<div class="${f.type==='text'?'life-text-value':''}"><dt>${f.label}${f.hint?`<small>${f.hint}</small>`:''}</dt><dd>${showValue(f,r)}</dd></div>`).join('')}</dl><small class="muted">日付 ${r.date.replaceAll('-','/')}（${esc(r.weekday)}） · タイムスタンプ ${esc(r.timestamp||'—')}</small></section>`;
  }
  function trend(records,range){
    const f=fieldFor(metric),byDate=new Map(records.map(r=>[r.date,r])),bins=[];
    for(let d=new Date(range.start+'T12:00:00');localDate(d)<=range.end;d.setDate(d.getDate()+1))bins.push([localDate(d),byDate.get(localDate(d))?.[metric]??null]);
    const values=bins.map(b=>b[1]).filter(v=>v!==null),maximum=f.max===5?5:Math.max(1,...values)*1.15;
    const w=540,h=180,left=35,right=14,top=12,bottom=28,plotH=h-top-bottom,plotW=w-left-right;
    const x=i=>left+(bins.length===1?plotW/2:i*plotW/(bins.length-1)),y=n=>top+plotH-n/maximum*plotH;
    let svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${f.label}の日別推移"><title>${f.label}：${esc(bins.map(([date,n])=>`${date} ${n===null?'未記録':fmt(n)+(f.unit||'')}`).join('、'))}</title>`;
    for(let i=0;i<=4;i++){const yy=top+i*plotH/4;svg+=`<line x1="${left}" x2="${w-right}" y1="${yy}" y2="${yy}" stroke="#e3ebe6"/><text x="${left-7}" y="${yy+4}" text-anchor="end">${fmt(maximum*(1-i/4))}</text>`;}
    let points=[];const flush=()=>{if(points.length)svg+=`<polyline points="${points.join(' ')}" fill="none" stroke="#327655" stroke-width="2.5"/>`;points=[];};
    bins.forEach(([date,n],i)=>{if(n===null)flush();else points.push(`${x(i)},${y(n)}`);if(i%Math.max(1,Math.ceil(bins.length/7))===0||i===bins.length-1)svg+=`<text x="${x(i)}" y="${h-6}" text-anchor="middle">${date.slice(5).replace('-','/')}</text>`;});flush();
    bins.forEach(([date,n],i)=>{if(n!==null)svg+=`<circle cx="${x(i)}" cy="${y(n)}" r="3.5" fill="#24634b"><title>${date}：${fmt(n)}${f.unit||''}</title></circle>`;});
    return `<div class="life-chart">${svg}</svg>${!values.length?'<p class="life-chart-empty">この期間の記録はまだありません</p>':''}<small class="muted">${f.hint||f.unit||''} · 空欄は未記録として表示</small>`;
  }
  function aggregate(records,range){
    const s=lifeSummary(records);
    return `<div class="life-analysis"><section class="panel"><div class="panel-heading"><h2>日々の推移</h2><select id="life-metric" aria-label="推移の項目">${LIFE_FIELDS.filter(f=>f.type==='number').map(f=>`<option value="${f.key}" ${metric===f.key?'selected':''}>${f.label}</option>`).join('')}</select></div>${trend(records,range)}<div class="life-totals"><span>歩いた時間 <strong>${fmt(s.metrics.walk.total)}分</strong></span><span>運動時間 <strong>${fmt(s.metrics.exercise.total)}分</strong></span></div></section><section class="panel"><div class="panel-heading"><h2>期間の平均</h2><small>入力した日だけで集計</small></div><dl class="life-averages">${LIFE_FIELDS.filter(f=>f.type==='number').map(f=>`<div><dt>${f.label}</dt><dd><strong>${fmt(s.metrics[f.key].average)}</strong> ${f.unit||'/ 5'}<small>${s.metrics[f.key].count}日</small></dd></div>`).join('')}</dl></section></div><details class="panel life-habits"><summary>食事・習慣の集計</summary><div class="life-habit-grid">${LIFE_FIELDS.filter(f=>f.type==='choice').map(f=>`<div><span>${f.label}</span><strong>${s.habits[f.key].yes} / ${s.habits[f.key].count}日</strong><small>「${f.options[1]}」の日数 / 入力日数</small></div>`).join('')}</div><p class="muted">食事の内容や振り返りは「履歴」から各日の記録を開いて確認できます。</p></details>`;
  }
  function history(){
    const records=[...store.get().records].filter(r=>r.deleted===deleted&&(!query||[r.date,...LIFE_FIELDS.filter(f=>f.type==='text').map(f=>r[f.key])].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort((a,b)=>b.date.localeCompare(a.date));
    const pages=Math.max(1,Math.ceil(records.length/8));page=Math.min(Math.max(page,1),pages);
    return `<div class="list-tools"><div class="search">${icon('search')}<input id="life-search" type="search" aria-label="生活ログを検索" placeholder="日付・食事・ひとことで検索" value="${esc(query)}"></div><label><input id="life-deleted" type="checkbox" ${deleted?'checked':''}>削除済みを表示</label></div><section class="panel"><div class="panel-heading"><h2>${deleted?'削除済み':'生活の履歴'}</h2><small>${records.length}日分</small></div><div class="life-history">${records.slice((page-1)*8,page*8).map(r=>`<article><div><strong>${r.date.replaceAll('-','/')} <small>(${esc(r.weekday)})</small></strong><span>睡眠 ${fmt(r.sleep)}h · 体調 ${fmt(r.condition)} · 気分 ${fmt(r.mood)}</span><p>${esc(r.oneLine||r.reflection||'ひとことは未入力')}</p></div><div class="life-row">${deleted?`<button class="icon-button" data-life-restore="${r.date}" aria-label="${r.date}を復元">${icon('restore')}</button>`:`<button class="icon-button" data-life-edit="${r.date}" aria-label="${r.date}を編集">${icon('edit')}</button><button class="icon-button" data-life-delete="${r.date}" aria-label="${r.date}を削除">${icon('trash')}</button>`}</div></article>`).join('')||'<p class="empty-state">条件に合う生活ログはありません。</p>'}</div>${pages>1?`<div class="pagination"><button class="button secondary" data-life-page="-1" ${page===1?'disabled':''}>前へ</button><span>${page} / ${pages}</span><button class="button secondary" data-life-page="1" ${page===pages?'disabled':''}>次へ</button></div>`:''}</section>`;
  }
  function pageHTML(){
    const range=lifeRange(mode,anchor),records=currentRecords().filter(r=>r.date>=range.start&&r.date<=range.end),prev=lifeRange(mode,shiftDate(mode==='today'?'day':mode,anchor,-1)),previous=currentRecords().filter(r=>r.date>=prev.start&&r.date<=prev.end);
    const dateLabel=mode==='week'?`${range.start.replaceAll('-','/')} – ${range.end.slice(5).replace('-','/')}`:mode==='month'?`${anchor.slice(0,4)}年${+anchor.slice(5,7)}月`:`${anchor.replaceAll('-','/')}（${lifeWeekday(anchor)}）`;
    return `<div class="life-page"><header class="page-heading"><div><h1>生活ログ</h1><p>日々の調子を、ひと目で。振り返りは自動で。</p></div><button class="button primary" data-life="today-edit">${icon('plus')}${currentRecords().some(r=>r.date===localDate())?'今日の記録を編集':'今日を記録'}</button></header>${store.error()?`<div class="notice" role="alert">${esc(store.error())}<button class="text-button" data-life="rescue">保存データを救出</button></div>`:''}<div class="toolbar">${tabs('life-mode',mode,[['today','今日'],['week','週'],['month','月'],['history','履歴']],'生活ログの表示')}${mode!=='history'?`<div class="date-control"><button class="icon-button" data-life-shift="-1" aria-label="生活ログの前の期間">${icon('left')}</button><div class="date-input-wrap">${icon('calendar')}<span>${dateLabel}</span><input id="life-anchor" type="date" value="${anchor}" min="1900-01-01" max="2200-12-31" aria-label="生活ログの表示日付"></div><button class="icon-button" data-life-shift="1" aria-label="生活ログの次の期間">${icon('right')}</button></div><button class="text-button" data-life="today">今日に戻る</button>`:''}</div>${mode==='history'?history():mode==='today'?dayPanel():summaryCards(records,previous)+aggregate(records,range)}<details class="panel life-data-tools"><summary>CSV移行・バックアップ <small>この端末に保存</small></summary><div class="download-row"><button class="button secondary" data-life="import">${icon('download')}CSV / JSONを読み込む</button><button class="button secondary" data-life="backup">JSONバックアップ</button><button class="button secondary" data-life="csv">CSV出力</button></div><p>生活ログは時間記録とは別に、このブラウザー内に保存します。自動同期はありません。端末間の移動にはJSONを使ってください。</p><p>ブラウザーのデータ削除で記録は失われます。定期的にバックアップしてください。CSVは削除済みを除く全記録、JSONは削除状態も含む全記録を書き出します。</p></details></div>`;
  }
  function formFields(){
    return sections.map(([group])=>`<section data-life-form-section="${group}" ${group!==0?'hidden':''}><div class="life-input-grid">${LIFE_FIELDS.filter(f=>f.group===group).map(f=>`<label class="${f.type==='text'?'life-input-text':''}">${f.label}${f.unit?` <small>(${f.unit})</small>`:''}${f.type==='choice'?`<select name="${f.key}"><option value="">未入力</option>${f.options.map(v=>`<option>${v}</option>`).join('')}</select>`:f.type==='text'?`<textarea name="${f.key}" rows="${group===2?2:1}" maxlength="4000"></textarea>`:`<input name="${f.key}" type="${f.type}" ${f.type==='number'?`min="${f.min}" max="${f.max}" step="${f.step===1?1:'any'}"`:'step="1"'}>`}${f.hint?`<small>${f.hint}</small>`:''}</label>`).join('')}</div></section>`).join('');
  }
  function setFormTab(group){
    $life('#life-form-tabs').innerHTML=tabs('life-form-tab',group,sections,'生活ログの入力項目');
    document.querySelectorAll('[data-life-form-section]').forEach(el=>el.hidden=Number(el.dataset.lifeFormSection)!==group);
  }
  function openRecord(date){
    editing=store.get().records.find(r=>r.date===date)||null;editSnapshot=JSON.stringify(editing);
    const f=$life('#life-form');f.reset();$life('#life-form-fields').innerHTML=formFields();f.elements.date.value=date;f.elements.date.disabled=!!editing;
    for(const field of LIFE_FIELDS)f.elements[field.key].value=editing?.[field.key]??'';
    $life('#life-form-error').textContent='';$life('#life-title').textContent=editing?'生活ログを編集':'生活ログを記録';setFormTab(0);$life('#life-dialog').showModal();
  }
  function save(next){store.save(next);render();}
  $life('#life-form').addEventListener('submit',event=>{
    event.preventDefault();try{
      const f=event.currentTarget,date=f.elements.date.value,here=store.get().records.find(r=>r.date===date)||null;
      if(JSON.stringify(here)!==editSnapshot)throw Error('この日付の生活ログは更新されています。閉じてから開き直してください。');
      const values=Object.fromEntries(LIFE_FIELDS.map(field=>[field.key,f.elements[field.key].value]));
      const r=lifeRecord(date,{...values,...(editing?{timestamp:editing.timestamp,weekday:editing.weekday}:{})});save({...store.get(),records:[...store.get().records.filter(x=>x.date!==date),r]});anchor=date;$life('#life-dialog').close();render();toast('生活ログを保存しました。');
    }catch(error){$life('#life-form-error').textContent=error.message;}
  });
  // Hidden tabs can contain invalid number inputs; surface their tab before browser validation.
  $life('#life-form').addEventListener('invalid',event=>{const field=fieldFor(event.target.name);if(field)setFormTab(field.group);},true);
  $life('#life-delete-apply').addEventListener('click',()=>{
    try{const here=store.get().records.find(r=>r.date===pendingDelete?.date);if(JSON.stringify(here)!==JSON.stringify(pendingDelete))throw Error('記録が更新されています。閉じてから確認し直してください。');save({...store.get(),records:store.get().records.map(r=>r.date===here.date?{...r,deleted:true,updatedAt:new Date().toISOString()}:r)});$life('#life-delete-dialog').close();toast('生活ログを削除しました。履歴の「削除済み」から復元できます。');}catch(error){$life('#life-delete-error').textContent=error.message;}
  });
  function importPreview(){
    const plan=lifeMerge(store.get(),importData),local=new Map(store.get().records.map(r=>[r.date,r]));
    const conflicts=importData.records.filter(r=>{const here=local.get(r.date);return here&&JSON.stringify([here.timestamp,here.weekday,here.deleted,...LIFE_FIELDS.map(f=>here[f.key])])!==JSON.stringify([r.timestamp,r.weekday,r.deleted,...LIFE_FIELDS.map(f=>r[f.key])]);});
    $life('#life-import-content').innerHTML=`<div class="merge-summary"><span>追加 <strong>${plan.added}日</strong></span><span>同じ内容 <strong>${plan.unchanged}日</strong></span><span>内容が異なる日 <strong>${plan.conflicts}日</strong></span></div><p class="muted">${importData.records.length}日分を確認しました。まだ保存されていません。</p><div class="life-import-dates">${importData.records.slice(0,8).map(r=>`<span>${r.date}${r.deleted?'（削除済み）':''}</span>`).join('')}${importData.records.length>8?'<span>ほか</span>':''}</div>${conflicts.slice(0,5).map(r=>{const here=local.get(r.date),fields=[{key:'timestamp',label:'タイムスタンプ'},{key:'weekday',label:'曜日'},{key:'deleted',label:'削除状態'},...LIFE_FIELDS];return `<details class="life-import-conflict"><summary>${r.date} の違いを確認</summary><dl>${fields.filter(f=>here[f.key]!==r[f.key]).map(f=>`<div><dt>${f.label}</dt><dd>この端末：${esc(here[f.key]??'未入力')}<br>ファイル：${esc(r[f.key]??'未入力')}</dd></div>`).join('')}</dl></details>`;}).join('')}${conflicts.length>5?`<p class="muted">ほか ${conflicts.length-5}日の相違があります。置き換えはすべての相違する日に適用されます。</p>`:''}`;
  }
  async function importFile(file){
    if(!file)return;try{
      if(file.size>10*1024*1024)throw Error('10MB以下のCSV / JSONを選んでください。');
      let text;if(file.arrayBuffer){const bytes=await file.arrayBuffer();try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('shift_jis',{fatal:true}).decode(bytes);}}else text=await file.text();
      importCSVText=/^\s*\{/.test(text)?null:text;
      importData=importCSVText===null?lifeValidate(JSON.parse(text)):lifeParseCSV(text);
      importSnapshot=JSON.stringify(store.get());
      $life('#life-import-error').textContent='';$life('#life-import-policy').value='keep';
      $life('#life-import-unescape').checked=false;$life('#life-import-unescape-label').hidden=importCSVText===null;importPreview();
      $life('#life-import-dialog').showModal();
    }catch(error){toast(error instanceof SyntaxError?'生活ログのJSONを読み込めません。ファイルの形式を確認してください。':error.message);}finally{$life('#life-import-file').value='';}
  }
  $life('#life-import-file').addEventListener('change',event=>importFile(event.target.files[0]));
  $life('#life-import-apply').addEventListener('click',()=>{
    try{if(JSON.stringify(store.get())!==importSnapshot)throw Error('確認中に生活ログが更新されました。ファイルを読み込み直してください。');const plan=lifeMerge(store.get(),importData,$life('#life-import-policy').value);save(plan.data);$life('#life-import-dialog').close();toast(`生活ログを取り込みました（追加 ${plan.added}日）。`);}catch(error){$life('#life-import-error').textContent=error.message;}
  });
  return {
    page:pageHTML,
    onStorage(event){if(event.key===LIFE_KEY||event.key===null){store.reload();render();}},
    change(target){
      if(target.id==='life-import-unescape'){try{importData=lifeParseCSV(importCSVText,{decodeEscapes:target.checked});importPreview();$life('#life-import-error').textContent='';}catch(error){$life('#life-import-error').textContent=error.message;}return true;}
      if(target.id==='life-anchor'&&validDate(target.value)){anchor=target.value;render();return true;}
      if(target.id==='life-metric'&&fieldFor(target.value)?.type==='number'){metric=target.value;render();return true;}
      if(target.id==='life-deleted'){deleted=target.checked;page=1;render();return true;}
      return false;
    },
    input(target){if(target.id!=='life-search')return false;query=target.value;page=1;const el=$life('.life-history');if(el){const temp=document.createElement('div');temp.innerHTML=history();el.closest('.panel').innerHTML=temp.querySelector('.panel').innerHTML;}return true;},
    click(button){
      const b=button.dataset;
      if(b.lifeMode){mode=b.lifeMode;page=1;render();return true;}
      if(b.lifeDetail!==undefined){detail=Number(b.lifeDetail);render();return true;}
      if(b.lifeFormTab!==undefined){setFormTab(Number(b.lifeFormTab));return true;}
      if(b.lifeShift){const next=shiftDate(mode==='today'?'day':mode,anchor,Number(b.lifeShift));if(validDate(next)){anchor=next;render();}return true;}
      if(b.lifePage){page+=Number(b.lifePage);render();return true;}
      if(b.lifeEdit){openRecord(b.lifeEdit);return true;}
      if(b.lifeDelete){pendingDelete=store.get().records.find(r=>r.date===b.lifeDelete);$life('#life-delete-description').textContent=`${b.lifeDelete}の生活ログを削除します。`;$life('#life-delete-error').textContent='';$life('#life-delete-dialog').showModal();return true;}
      if(b.lifeRestore){save({...store.get(),records:store.get().records.map(r=>r.date===b.lifeRestore?{...r,deleted:false,updatedAt:new Date().toISOString()}:r)});toast('生活ログを復元しました。');return true;}
      if(!b.life)return false;
      if(b.life==='today-edit')openRecord(localDate());
      if(b.life==='add-date')openRecord(anchor);
      if(b.life==='today'){anchor=localDate();render();}
      if(b.life==='import')$life('#life-import-file').click();
      if(b.life==='backup'){if(store.error())throw Error('保存データを救出してからバックアップを確認してください。');download(JSON.stringify({...store.get(),exportedAt:new Date().toISOString()},null,2),`生活ログ_${localDate()}_${Date.now()}.json`,'application/json');toast('生活ログのバックアップを保存します。');}
      if(b.life==='csv'){if(store.error())throw Error('保存データを救出してからCSVを確認してください。');download(lifeExportCSV(store.get()),`生活ログ_${localDate()}.csv`,'text/csv;charset=utf-8');toast('生活ログのCSVを保存します。');}
      if(b.life==='rescue')download(store.raw(),'生活ログ_救出.txt','text/plain;charset=utf-8');
      return true;
    }
  };
}
