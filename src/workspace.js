import {WORKSPACE_KEY,HABITS,workspaceFresh,workspaceValidate,workspaceChange,workspaceDelete,workspaceSetProjectVisibility,workspaceToggleHabit,habitWeek,taskBuckets,firstRoutineDate,workspaceAdvanceTask,workspaceSetTaskStatus,workspaceToggleTaskStep,workspaceMoveLink,workspaceToggleFocus,calendarPeriod,calendarItems} from './workspace-model.js';

export function createWorkspace({storage,render,toast,escapeHTML:esc,icon,getTimeRecords,uid,localDate,startRecord}){
  let value=workspaceFresh(),error='',filter='',search='',formType='tasks',formId='';
  let selectedProject='',selectedTask='',promptFilter='',projectSettingsOpen=false,habitDate=localDate(),calendarDate=localDate(),calendarView='month',calendarFlags={tasks:true,events:true,habits:true},savedSnapshot=JSON.stringify(workspaceFresh());
  const titles={projects:'プロジェクト',tasks:'タスク',notes:'以前のメモ',prompts:'プロンプト',templates:'タスクテンプレート',links:'毎日使うリンク',events:'個人予定'};
  const clean=t=>esc(t||'').replace(/\n/g,'<br>');
  const suggestedLinks=[{title:'プロ野球観戦メモ',url:'https://pro-baseball-watch-guide.com/'},{title:'Notion',url:'https://www.notion.so/'},{title:'ベンチからの一手',url:'https://bench-first.pages.dev/'},{title:'Player Lens',url:'https://pro-baseball-watch-guide.com/player-lens/'}];
  const timeText=mins=>`${Math.floor(mins/60)}時間${mins%60?`${mins%60}分`:''}`;
  const timeEntries=(project='',taskId='')=>getTimeRecords().filter(r=>!r.deleted&&(taskId?r.taskId===taskId:r.project===project));
  function reload(){
    try{value=storage.getItem(WORKSPACE_KEY)?workspaceValidate(JSON.parse(storage.getItem(WORKSPACE_KEY))):workspaceFresh();savedSnapshot=JSON.stringify(value);error='';}
    catch{error='作業管理の保存データを読み取れません。データ保護のため編集を停止しました。';}
  }
  reload();
  const allNames=()=>[...new Set([
    ...value.projects.map(p=>p.title),...value.tasks.map(t=>t.project),
    ...value.notes.map(n=>n.project||'未分類'),
    ...value.prompts.map(p=>p.project),...value.templates.map(t=>t.project),
    ...getTimeRecords().filter(r=>!r.deleted).map(r=>r.project),
  ].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja'));
  const names=()=>allNames().filter(n=>!value.hiddenProjects.includes(n));
  const projectOptions=(selected='')=>`<option value="">未分類</option>${[...new Set([...names(),...(selected?[selected]:[])])].map(n=>`<option value="${esc(n)}" ${selected===n?'selected':''}>${esc(n)}</option>`).join('')}`;
  function save(next){
    if(error)throw Error(error);
    const checked=workspaceValidate(next);
    // Detect another tab updating this workspace between editing and saving.
    const current=storage.getItem(WORKSPACE_KEY)?workspaceValidate(JSON.parse(storage.getItem(WORKSPACE_KEY))):workspaceFresh();
    if(JSON.stringify(current)!==savedSnapshot){reload();render();throw Error('別のタブで作業管理が更新されました。内容を確認して、もう一度操作してください。');}
    storage.setItem(WORKSPACE_KEY,JSON.stringify(checked));
    value=checked;savedSnapshot=JSON.stringify(checked);render();
  }
  const weekday=['日','月','火','水','木','金','土'];
  function repeatLabel(rule){return !rule?'':rule.type==='daily'?'毎日':rule.type==='weekly'?`毎週 ${rule.days.map(n=>weekday[n]).join('・')}曜`:`毎月${rule.monthDay}日`;}
  function completedLabel(t){return t.skipped?'スキップ':({done:'完了',doing:'進行中',waiting:'待機中',someday:'いつかやる',todo:'未着手'}[t.status]||'未着手');}
  function dated(t){return t.due?`期限 ${esc(t.due)}`:'期限なし';}
  const focusIds=()=> (value.focusDays[localDate()]||[]).filter(id=>value.tasks.some(t=>t.id===id&&!['done','waiting','someday'].includes(t.status)));
  const focusButton=t=>!['done','waiting','someday'].includes(t.status)?`<button type="button" class="button secondary work-focus-btn" data-workspace-focus="${esc(t.id)}">${focusIds().includes(t.id)?'今日の3件から外す':'今日の3件に選ぶ'}</button>`:'';
  const formatDay=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const makeDay=(date,amount)=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+amount);return formatDay(d);};
  const shiftMonth=(date,offset)=>{const d=new Date(date.slice(0,7)+'-01T12:00:00');d.setMonth(d.getMonth()+offset);return formatDay(d);};
  const daySequence=(a,b)=>{const days=[];for(let day=a;day<=b;day=makeDay(day,1))days.push(day);return days;};
  function itemRow(t){
    return `<div class="work-task-row ${selectedTask===t.id?'selected':''}">
      <button type="button" class="work-task-select" data-workspace-select-task="${esc(t.id)}" aria-pressed="${selectedTask===t.id}">
        <strong class="${t.status==='done'?'done':''}">${esc(t.title)}</strong>
        <span class="workspace-meta">${t.project?esc(t.project)+' ・ ':''}${dated(t)}</span>
        ${['waiting','someday'].includes(t.status)?`<span class="work-note-marker">${esc(completedLabel(t))}</span>`:''}${t.reviewDate&&['waiting','someday'].includes(t.status)?`<span class="work-note-marker ${t.reviewDate<=localDate()&&['waiting','someday'].includes(t.status)?'work-review-due':''}">確認目安 ${esc(t.reviewDate)}</span>`:''}${t.memo?'<span class="work-note-marker">メモあり</span>':''}${t.repeat?`<span class="work-note-marker">↻ ${esc(repeatLabel(t.repeat))}</span>`:''}${t.skipped?'<span class="work-note-marker">スキップ済み</span>':''}
      </button>
      <select class="work-task-status" data-workspace-status="${esc(t.id)}" aria-label="${esc(t.title)}のステータス">
        <option value="todo" ${t.status==='todo'?'selected':''}>未着手</option>
        <option value="doing" ${t.status==='doing'?'selected':''}>進行中</option>
        <option value="waiting" ${t.status==='waiting'?'selected':''}>待機中</option>
        <option value="someday" ${t.status==='someday'?'selected':''}>いつかやる</option>
        <option value="done" ${t.status==='done'?'selected':''}>完了</option>
      </select>
    </div>`;
  }
  const taskList=(arr,empty='タスクはありません。')=>arr.length?`<div class="work-task-list">${arr.map(itemRow).join('')}</div>`:`<p class="muted work-empty">${empty}</p>`;
  function visibleTask(id){return value.tasks.find(t=>t.id===id);}
  function detailTask(t){
    const records=timeEntries('',t.id),minutes=records.reduce((s,r)=>s+r.minutes,0);
    return `<section class="panel work-detail" aria-label="タスク詳細">
      <div class="work-detail-head"><div><span class="work-eyebrow">タスク詳細</span><h2>${esc(t.title)}</h2><p class="workspace-meta">${esc(t.project||'未分類')} ・ ${dated(t)} ・ ${completedLabel(t)}</p></div><button type="button" class="button secondary work-edit" data-workspace-edit="tasks:${esc(t.id)}">編集</button></div>
      ${t.detail?`<section class="work-detail-section"><h3>タスクの内容</h3><p class="work-long-text">${clean(t.detail)}</p></section>`:''}
      ${(t.waitingFor||t.startCondition||t.reviewDate)?`<section class="work-detail-section"><h3>待機・確認の情報</h3>${t.waitingFor?`<p class="work-long-text"><strong>待機理由：</strong>${clean(t.waitingFor)}</p>`:''}${t.startCondition?`<p class="work-long-text"><strong>作業開始の条件：</strong>${clean(t.startCondition)}</p>`:''}${t.reviewDate?`<p class="workspace-meta">確認目安：${esc(t.reviewDate)}（作業期限とは別）</p>`:''}${['waiting','someday'].includes(t.status)?`<button type="button" class="button secondary" data-workspace-resume="${esc(t.id)}">未着手に戻す</button>`:''}</section>`: ['waiting','someday'].includes(t.status)?`<div class="workspace-actions"><button type="button" class="button secondary" data-workspace-resume="${esc(t.id)}">未着手に戻す</button></div>`:''}

      ${t.repeat?`<section class="work-detail-section"><h3>ルーチン：${esc(repeatLabel(t.repeat))}</h3><p class="muted">完了すると次回分を自動作成します。未完了分は1件のまま残ります。</p><div class="workspace-actions"><button type="button" class="button secondary" data-workspace-skip="${esc(t.id)}">今回だけスキップ</button><button type="button" class="button secondary" data-workspace-stop-repeat="${esc(t.id)}">繰り返しを解除</button></div></section>`:''}
      ${t.steps.length?`<section class="work-detail-section"><h3>作業チェックリスト <small>${t.steps.filter(s=>s.done).length}/${t.steps.length}</small></h3><div class="work-step-list">${t.steps.map((s,i)=>`<label class="work-step"><input type="checkbox" data-workspace-step="${esc(t.id)}" data-index="${i}" ${s.done?'checked':''} ${t.status==='done'?'disabled':''}><span class="${s.done?'checked':''}">${esc(s.text)}</span></label>`).join('')}</div></section>`:''}
      ${t.status!=='done'?`<div class="workspace-actions">${focusButton(t)}<button type="button" class="button secondary" data-workspace-save-template="${esc(t.id)}">このタスクをテンプレートに保存</button></div>`:''}
      ${t.routineId?`<section class="work-detail-section"><h3>同じルーチンの履歴</h3><p class="muted">${value.tasks.filter(x=>x.routineId===t.routineId&&x.status==='done').length}回完了・スキップ</p></section>`:''}
      ${value.prompts.filter(p=>p.project===t.project).length?`<section class="work-detail-section"><h3>このプロジェクトのプロンプト</h3>${[...value.prompts.filter(p=>p.project===t.project)].sort((a,b)=>Number(b.pinned)-Number(a.pinned)).map(p=>`<div class="work-linked-prompt"><span>${p.pinned?'★ ':''}${esc(p.title)}</span><button type="button" class="button secondary" data-workspace-copy="${esc(p.id)}">コピー</button></div>`).join('')}</section>`:''}
      <form class="work-note-form" data-workspace-save-note="tasks" data-id="${esc(t.id)}"><label for="work-task-note">タスクメモ</label><p class="muted">作業途中の気づきや次にやることを残せます。</p><textarea id="work-task-note" name="memo" rows="6" maxlength="10000" placeholder="このタスクについてのメモ">${esc(t.memo||'')}</textarea><button class="button primary" type="submit">メモを保存</button></form>
      <section class="work-detail-section"><div class="work-section-head"><h3>作業時間：${timeText(minutes)}</h3><button type="button" class="button secondary" data-workspace-record="${esc(t.id)}">時間を記録</button></div>${recordHistory(records)}</section>
    </section>`;
  }
  function recordHistory(records){
    if(!records.length)return '<p class="muted">記録はまだありません。</p>';
    return `<ul class="work-record-list">${[...records].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10).map(r=>`<li><span>${esc(r.date)} ・ ${esc(r.activity)}</span><strong>${timeText(r.minutes)}</strong>${r.note?`<small>${clean(r.note)}</small>`:''}</li>`).join('')}</ul>`;
  }
  function detailProject(project){
    const p=value.projects.find(x=>x.title===project),records=timeEntries(project),minutes=records.reduce((s,r)=>s+r.minutes,0);
    const oldNotes=value.notes.filter(x=>(x.project||'未分類')===project);
    return `<section class="panel work-detail" aria-label="プロジェクト詳細">
      <div class="work-detail-head"><div><span class="work-eyebrow">プロジェクト詳細</span><h2>${esc(project)}</h2><p class="workspace-meta">作業時間 ${timeText(minutes)} ・ タスク ${value.tasks.filter(t=>t.project===project).length}件</p></div>${p?`<button class="button secondary" type="button" data-workspace-edit="projects:${esc(p.id)}">編集</button>`:''}</div>
      ${p?.description?`<section class="work-detail-section"><h3>概要</h3><p class="work-long-text">${clean(p.description)}</p></section>`:''}
      <section class="work-detail-section"><div class="work-section-head"><h3>プロジェクト別プロンプト</h3><button type="button" class="button secondary" data-workspace-new-prompt="${esc(project)}">追加</button></div>${value.prompts.filter(x=>x.project===project).length?[...value.prompts.filter(x=>x.project===project)].sort((a,b)=>Number(b.pinned)-Number(a.pinned)).map(x=>`<div class="work-linked-prompt"><span>${x.pinned?'★ ':''}${esc(x.title)}</span><button type="button" class="button secondary" data-workspace-copy="${esc(x.id)}">コピー</button><button type="button" class="button secondary" data-workspace-edit="prompts:${esc(x.id)}">編集</button></div>`).join(''):'<p class="muted">まだプロンプトはありません。</p>'}</section>
      <form class="work-note-form" data-workspace-save-note="projects" data-project="${esc(project)}"><label for="work-project-note">プロジェクトメモ</label><p class="muted">目的・更新方針・今後の予定など。</p><textarea id="work-project-note" name="memo" rows="7" maxlength="10000" placeholder="このプロジェクトで覚えておきたいこと">${esc(p?.memo||'')}</textarea><button class="button primary" type="submit">メモを保存</button></form>
      ${oldNotes.length?`<section class="work-detail-section"><h3>以前のメモ（${oldNotes.length}件）</h3><p class="muted">旧クイックメモを削除せず、このプロジェクト内に表示しています。</p>${oldNotes.map(n=>`<div class="work-legacy-note"><strong>${esc(n.title)}</strong><p class="work-long-text">${clean(n.body)}</p><button type="button" class="button secondary" data-workspace-edit="notes:${esc(n.id)}">編集・移動</button><button type="button" class="button secondary" data-workspace-convert="${esc(n.id)}">タスクにする</button></div>`).join('')}</section>`:''}
      <section class="work-detail-section"><div class="work-section-head"><h3>最近の作業記録</h3><button class="button secondary" type="button" data-workspace-record-project="${esc(project)}">時間を記録</button></div>${recordHistory(records)}</section>
    </section>`;
  }
  function tasks(){
    const b=taskBuckets(value.tasks,localDate()),matched=value.tasks.filter(t=>(!filter||t.project===filter)&&(!search||`${t.title} ${t.detail} ${t.memo} ${t.project} ${t.waitingFor} ${t.startCondition}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())));
    if(selectedTask&&!matched.some(t=>t.id===selectedTask))selectedTask='';
    const picked=matched.find(t=>t.id===selectedTask)||matched[0];if(picked)selectedTask=picked.id;
    const sections=[['期限切れ',b.overdue],['今日',b.today],['今後の予定',b.upcoming],['日付未定（着手可能）',b.undated],['確認目安が来た待機',b.review],['待機中',b.waiting.filter(t=>!b.review.includes(t))],['いつかやる',b.someday.filter(t=>!b.review.includes(t))],['完了済み',b.done]];
    return `<header class="page-heading"><div><h1>タスク</h1><p>選ぶと右側に内容・メモ・作業時間が表示されます。</p></div><div class="workspace-actions"><a class="button secondary" href="#templates">テンプレートから追加</a><button class="button primary" type="button" data-workspace-new="tasks">${icon('plus')}タスク追加</button></div></header>
      ${error?`<p class="notice" role="alert">${esc(error)}</p>`:''}
      <p class="muted work-help">日付が未定の作業は「待機中」「いつかやる」で保管できます。確認目安は期限ではありません。ルーチンはタスク編集で「毎日・毎週・毎月」を選びます。指定曜日のタスクが完了すると、次の予定日が自動で作られます。</p>
      <div class="workspace-filter"><label>プロジェクト<select id="workspace-project-filter"><option value="">すべて</option>${[...new Set([...names(),...(filter?[filter]:[])])].map(n=>`<option value="${esc(n)}" ${filter===n?'selected':''}>${esc(n)}</option>`).join('')}</select></label><label>タスク検索<input id="workspace-search" type="search" value="${esc(search)}" placeholder="名前・メモで検索"></label></div>
      <div class="work-task-layout"><div class="work-board panel"><div class="work-board-total">未完了 <strong>${matched.filter(t=>t.status!=='done').length}件</strong></div>${sections.filter(([label,rows])=>label==='今日'||rows.some(t=>matched.includes(t))).map(([label,rows])=>{const list=rows.filter(t=>matched.includes(t));return `<section class="work-task-group"><h2>${label}<small>${list.length}</small></h2>${taskList(list)}</section>`;}).join('')}</div>${picked?detailTask(picked):'<section class="panel work-detail"><h2>タスクを追加してください</h2><p class="muted">作業したいことを一件登録すると、ここに詳細が表示されます。</p></section>'}</div>`;
  }
  function projects(){
    const projectNames=names();if(!projectNames.includes(selectedProject))selectedProject=projectNames[0]||'';
    const projectTasks=value.tasks.filter(t=>t.project===selectedProject);
    if(selectedTask&&!projectTasks.some(t=>t.id===selectedTask))selectedTask='';
    const hiddenNames=allNames().filter(n=>value.hiddenProjects.includes(n));
    return `<header class="page-heading"><div><h1>プロジェクト</h1><p>プロジェクト・タスク・メモ・時間をこの画面で確認できます。</p></div><button type="button" class="button primary" data-workspace-new="projects">${icon('plus')}新規プロジェクト</button></header>
      ${error?`<p class="notice" role="alert">${esc(error)}</p>`:''}
      <div class="work-project-layout"><nav class="panel work-project-nav" aria-label="プロジェクト一覧"><h2>プロジェクト一覧</h2>${projectNames.map(n=>`<button type="button" class="work-project-choice ${selectedProject===n?'selected':''}" data-workspace-select-project="${esc(n)}" aria-pressed="${selectedProject===n}"><span>${esc(n)}</span><small>${value.tasks.filter(t=>t.project===n&&t.status!=='done').length}件</small></button>`).join('')||'<p class="muted">表示中のプロジェクトはありません。</p>'}
        <button type="button" class="work-project-settings-toggle" data-workspace-manage-projects="1" aria-expanded="${projectSettingsOpen}">表示設定（非表示 ${hiddenNames.length}件）${projectSettingsOpen?' ▲':' ▼'}</button>
        ${projectSettingsOpen?`<div class="work-project-settings"><p>非表示にしてもタスク・メモ・時間記録は残り、タスク一覧でも確認できます。</p>${allNames().map(n=>`<div class="work-project-settings-row"><span title="${esc(n)}">${esc(n)}</span><button type="button" class="button secondary" data-workspace-project-visibility="${esc(n)}" data-visible="${value.hiddenProjects.includes(n)?'true':'false'}" aria-label="${esc(n)}を${value.hiddenProjects.includes(n)?'表示':'非表示'}にする">${value.hiddenProjects.includes(n)?'表示する':'隠す'}</button></div>`).join('')||'<p>プロジェクトはまだありません。</p>'}</div>`:''}</nav>
      <section class="panel work-project-tasks"><div class="work-section-head"><div><span class="work-eyebrow">${esc(selectedProject||'プロジェクトを選択')}</span><h2>タスク一覧</h2></div>${selectedProject?`<button type="button" class="button secondary" data-workspace-new-task="${esc(selectedProject)}">${icon('plus')}追加</button>`:''}</div><button type="button" class="work-project-overview ${selectedTask?'':'selected'}" data-workspace-overview="1">プロジェクトのメモ・概要を見る</button>${taskList(projectTasks,'このプロジェクトにはまだタスクがありません。')}</section>
      ${selectedProject?(selectedTask?detailTask(visibleTask(selectedTask)):detailProject(selectedProject)):'<section class="panel work-detail"><h2>新規プロジェクトを作成</h2><p class="muted">プロジェクトを登録すると、ここでタスクとメモをまとめられます。</p></section>'}</div>`;
  }
  function home(){
    const today=localDate(),b=taskBuckets(value.tasks,today),focus=[...b.overdue,...b.today,...value.tasks.filter(t=>t.status==='doing'&&!b.overdue.includes(t)&&!b.today.includes(t)),...b.upcoming].slice(0,6);
    const picked=focusIds().map(visibleTask).filter(Boolean),candidates=value.tasks.filter(t=>!['done','waiting','someday'].includes(t.status)&&!picked.includes(t)).sort((a,b)=>Number(b.priority==='high')-Number(a.priority==='high')||(a.due||'9999').localeCompare(b.due||'9999')).slice(0,6);
    const personal=value.events.filter(e=>e.date===today).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
    return `<section class="panel work-today-focus"><div class="panel-heading"><h2>今日やる3件 <small>${picked.length}/3</small></h2><a class="text-button" href="#tasks">タスクを探す</a></div><p class="muted">期限とは別に、今日集中するタスクを選びます。選んでも予定日は変わりません。</p>${picked.length?`<div class="work-focus-list">${picked.map(t=>`<div class="work-focus-row"><button type="button" data-workspace-select-task="${esc(t.id)}">${esc(t.title)}</button><button type="button" class="button secondary" data-workspace-focus="${esc(t.id)}">外す</button></div>`).join('')}</div>`:'<p class="work-empty muted">まだ選んでいません。下から選択できます。</p>'}${picked.length<3&&candidates.length?`<details class="work-focus-pick" ${picked.length?'':'open'}><summary>候補から選ぶ（最大3件）</summary>${candidates.map(t=>`<div class="work-focus-row"><span>${esc(t.title)}<small>${esc(t.project||'未分類')}</small></span><button type="button" class="button secondary" data-workspace-focus="${esc(t.id)}">選ぶ</button></div>`).join('')}</details>`:''}</section>
    <section class="panel work-today-events"><div class="panel-heading"><h2>今日の予定</h2><a class="text-button" href="#calendar">カレンダーを見る</a></div>${personal.length?personal.map(e=>`<div class="work-event-row"><span class="work-type-dot event"></span><strong>${esc(e.title)}</strong><small>${e.allDay?'終日':esc(e.time||'時刻なし')}</small></div>`).join(''):'<p class="muted">今日の個人予定はありません。</p>'}<button type="button" class="button secondary" data-workspace-new-event="${today}">＋予定を追加</button></section>
    <section class="panel workspace-home"><div class="panel-heading"><h2>期限・進行中のタスク</h2><a class="text-button" href="#tasks">タスク一覧へ</a></div><div class="workspace-home-stats"><span>今日 ${b.today.length}件</span><span>期限切れ ${b.overdue.length}件</span><span>進行中 ${value.tasks.filter(x=>x.status==='doing').length}件</span></div>${b.review.length?`<div class="work-review-reminder"><strong>確認目安が来た待機タスク ${b.review.length}件</strong><p>情報が出たか確認して、作業できるようになったら「未着手」に戻してください。</p>${taskList(b.review.slice(0,3))}<a href="#tasks" class="text-button">待機タスクを確認する</a></div>`:''}${focus.length?taskList(focus):'<p class="muted">今日のタスクはありません。やることを追加できます。</p>'}<div class="workspace-actions"><button type="button" class="button primary" data-workspace-new="tasks">${icon('plus')}タスクを追加</button><a class="button secondary" href="#projects">プロジェクトを開く</a></div></section>`;
  }
  function calendar(){
    const period=calendarPeriod(calendarView,calendarDate),days=daySequence(period.start,period.end),items=calendarItems(value,period.start,period.end,{...calendarFlags,today:localDate()}),picked=items[calendarDate]||[],today=localDate();
    const formatItem=x=>x.kind==='habit'?`<div class="work-calendar-entry habit"><span>習慣</span><strong>${x.count}/${x.total} 達成</strong><a href="#habits">確認</a></div>`:x.kind==='event'?`<div class="work-calendar-entry event"><span>予定</span><strong>${esc(x.title)}</strong><small>${x.allDay?'終日':esc(x.time||'時刻なし')}</small><button class="button secondary" data-workspace-edit="events:${esc(x.id)}">編集</button><button class="button secondary" data-workspace-delete="events:${esc(x.id)}">削除</button>${value.events.find(e=>e.id===x.id)?.note?`<p>${clean(value.events.find(e=>e.id===x.id).note)}</p>`:''}</div>`:x.kind==='review'?`<div class="work-calendar-entry review"><span>確認目安</span><strong>${esc(x.title)}</strong><button class="button secondary" data-workspace-select-task="${esc(x.id)}">タスクを開く</button></div>`:`<div class="work-calendar-entry task"><span>${x.virtual?'ルーチン予定（予測）':x.done?'完了したタスク':'タスク'}</span><strong>${esc(x.title)}</strong><button class="button secondary" data-workspace-select-task="${esc(x.id)}">確認</button></div>`;
    return `<header class="page-heading"><div><h1>カレンダー</h1><p>タスク・個人予定・習慣を一緒に確認。予定はタスクと別に保存します。</p></div><button type="button" class="button primary" data-workspace-new-event="${esc(calendarDate)}">${icon('plus')}予定を登録</button></header>${error?`<p class="notice" role="alert">${esc(error)}</p>`:''}
    <section class="panel work-calendar"><div class="work-calendar-toolbar"><div class="segmented">${[['month','月'],['week','週']].map(([x,l])=>`<button type="button" data-workspace-calendar-view="${x}" class="${calendarView===x?'active':''}" aria-pressed="${calendarView===x}">${l}</button>`).join('')}</div><div class="work-calendar-controls"><button class="button secondary" type="button" data-workspace-calendar-shift="-1">前へ</button><strong>${esc(calendarView==='month'?calendarDate.slice(0,7).replace('-','年')+'月':period.start+' 〜 '+period.end)}</strong><button class="button secondary" type="button" data-workspace-calendar-shift="1">次へ</button><button class="button secondary" type="button" data-workspace-calendar-today="1">今日</button></div></div>
    <div class="work-calendar-filters">${[['tasks','タスク'],['events','予定'],['habits','習慣']].map(([key,label])=>`<label class="work-calendar-filter ${key}"><input type="checkbox" data-workspace-calendar-filter="${key}" ${calendarFlags[key]?'checked':''}> ${label}</label>`).join('')}</div>
    <div class="work-calendar-grid">${['日','月','火','水','木','金','土'].map(n=>`<div class="work-calendar-weekday">${n}</div>`).join('')}${days.map((day)=>{const entries=items[day]||[];return `<button class="work-calendar-day ${day.slice(0,7)!==calendarDate.slice(0,7)?'outside':''} ${day===calendarDate?'selected':''} ${day===today?'today':''}" type="button" data-workspace-calendar-day="${day}" aria-pressed="${day===calendarDate}" aria-label="${day}：${entries.length}件"><strong>${Number(day.slice(-2))}</strong><span class="work-calendar-dots">${entries.some(e=>e.kind==='task')?'<i class="task"></i>':''}${entries.some(e=>e.kind==='event')?'<i class="event"></i>':''}${entries.some(e=>e.kind==='review')?'<i class="review"></i>':''}${entries.some(e=>e.kind==='habit'&&e.count)?'<i class="habit"></i>':''}</span>${calendarView==='week'?`<small>${entries.filter(e=>e.kind!=='habit').length}件</small>`:''}</button>`;}).join('')}</div>
    <div class="work-calendar-details"><div class="work-section-head"><h2>${esc(calendarDate)} の予定・タスク</h2><div class="workspace-actions"><button type="button" class="button secondary" data-workspace-new-event="${esc(calendarDate)}">＋予定</button><button type="button" class="button secondary" data-workspace-new-dated-task="${esc(calendarDate)}">＋タスク</button></div></div>${picked.length?picked.map(formatItem).join(''):'<p class="muted">この日に表示する項目はありません。</p>'}<p class="muted">繰り返しタスクの将来分は表示上の予測です。保存されるのは従来どおり完了・スキップ時の次回分だけです。</p></div></section>`;
  }
  function linksHome(){
    const links=value.links;
    return `<section class="panel work-daily-links"><div class="panel-heading"><h2>毎日使うリンク</h2><a class="text-button" href="#links">${links.length?'編集・並べ替え':'リンクを登録'}</a></div>${links.length?`<div class="work-link-grid">${links.map(l=>`<a class="work-link-tile" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><span class="work-link-avatar" aria-hidden="true">↗</span><span>${esc(l.title)}</span><small>別タブで開く ↗</small></a>`).join('')}</div>`:'<p class="muted">普段確認するサイトを登録すると、ここからすぐ開けます。</p>'}</section>`;
  }
  function links(){
    const ready=suggestedLinks.filter(l=>!value.links.some(x=>x.url===l.url));
    return `<header class="page-heading"><div><h1>毎日使うリンク</h1><p>普段使うサイトに1タップで移動。作業確認のチェックやタスクは増えません。</p></div><button type="button" class="button primary" data-workspace-new="links">${icon('plus')}リンクを追加</button></header>
      ${error?`<p class="notice" role="alert">${esc(error)}</p>`:''}
      <section class="panel work-links-manage"><div class="work-section-head"><h2>登録済みリンク <small>${value.links.length}件</small></h2></div><div class="work-link-manage-list">${value.links.map((l,i)=>`<div class="work-link-manage-row"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" class="work-link-open"><strong>${esc(l.title)}</strong><small>${esc(l.url)}</small></a><div class="work-link-controls"><button type="button" class="button secondary" data-workspace-move-link="${esc(l.id)}" data-direction="up" ${i===0?'disabled':''} aria-label="${esc(l.title)}を上へ">↑</button><button type="button" class="button secondary" data-workspace-move-link="${esc(l.id)}" data-direction="down" ${i===value.links.length-1?'disabled':''} aria-label="${esc(l.title)}を下へ">↓</button><button type="button" class="button secondary" data-workspace-edit="links:${esc(l.id)}">編集</button><button type="button" class="button secondary" data-workspace-delete="links:${esc(l.id)}">削除</button></div></div>`).join('')||'<p class="muted">まだリンクはありません。下の候補からワンタップで追加できます。</p>'}</div></section>
      ${ready.length?`<section class="panel work-link-suggestions"><h2>登録候補</h2><p class="muted">必要なサイトだけ追加してください。URLはいつでも編集できます。</p><div class="work-link-suggestions-list">${suggestedLinks.map((l,i)=>ready.some(x=>x.url===l.url)?`<button type="button" class="button secondary" data-workspace-suggest-link="${i}">＋ ${esc(l.title)}</button>`:'').join('')}</div></section>`:''}`;
  }
  function habitChecks(day,compact=false){
    const done=new Set(value.habits[day]||[]);
    return `<div class="habit-checks ${compact?'compact':''}">${HABITS.map(h=>`<label class="habit-item ${done.has(h.id)?'done':''}"><input type="checkbox" data-workspace-habit="${h.id}" data-date="${esc(day)}" ${done.has(h.id)?'checked':''}><span>${esc(h.label)}</span></label>`).join('')}</div>`;
  }
  function habitHome(){
    const today=localDate(),completed=(value.habits[today]||[]).length;
    return `<section class="panel habit-home"><div class="panel-heading"><h2>今日の習慣 <small>${completed}/${HABITS.length}</small></h2><a href="#habits" class="text-button">習慣の履歴</a></div>${habitChecks(today,true)}</section>`;
  }
  function habits(){
    const week=habitWeek(value,habitDate),selected=(value.habits[habitDate]||[]).length;
    const available=week.filter(d=>d.date<=localDate());
    const earned=available.reduce((a,d)=>a+d.count,0),possible=available.length*HABITS.length;
    const monthStart=habitDate.slice(0,7)+'-01',monthEnd=formatDay(new Date(Number(habitDate.slice(0,4)),Number(habitDate.slice(5,7)),0,12)),monthDays=daySequence(monthStart,monthEnd),monthEarned=monthDays.filter(d=>d<=localDate()).reduce((s,d)=>s+(value.habits[d]||[]).length,0);
    return `<header class="page-heading"><div><h1>習慣トラッカー</h1><p>プロジェクトとは別に、毎日の4項目をチェックします。</p></div><button type="button" class="button secondary" data-workspace-habit-today="1">今日へ戻る</button></header>
      <div class="habit-layout"><section class="panel"><div class="work-section-head"><div><span class="work-eyebrow">選択日</span><h2>${esc(habitDate)} <small>${selected}/${HABITS.length} 達成</small></h2></div></div>${habitChecks(habitDate)}<p class="muted">チェックはすぐ保存され、クラウド同期の対象になります。</p></section>
      <section class="panel"><div class="work-section-head"><div><span class="work-eyebrow">月曜〜日曜</span><h2>週間の達成率 <strong>${possible?Math.round(earned/possible*100):0}%</strong></h2><p class="muted">今日までの記録で集計</p></div></div><div class="habit-week">${week.map(d=>`<button type="button" data-workspace-habit-day="${esc(d.date)}" class="habit-day ${habitDate===d.date?'selected':''}"><span>${esc(d.date.slice(5))}</span><strong>${d.count}/${HABITS.length}</strong><span class="habit-meter"><span style="width:${d.count/HABITS.length*100}%"></span></span></button>`).join('')}</div><div class="workspace-actions"><button class="button secondary" type="button" data-workspace-habit-shift="-7">前の週</button><button class="button secondary" type="button" data-workspace-habit-shift="7">次の週</button></div></section></div>
    <section class="panel work-habit-month"><div class="work-section-head"><h2>月間の習慣：${esc(habitDate.slice(0,7))} <small>達成 ${monthEarned}回</small></h2><div class="workspace-actions"><button type="button" class="button secondary" data-workspace-habit-month="-1">前月</button><button type="button" class="button secondary" data-workspace-habit-month="1">次月</button></div></div><p class="muted">各日を押すと習慣をチェックできます。未来の日は達成率に含めません。</p><div class="work-habit-month-grid">${['日','月','火','水','木','金','土'].map(x=>`<span class="work-calendar-weekday">${x}</span>`).join('')}${Array.from({length:new Date(monthStart+'T12:00:00').getDay()},()=>'<span class="habit-blank"></span>').join('')}${monthDays.map(d=>{const count=(value.habits[d]||[]).length;return `<button class="habit-month-day ${habitDate===d?'selected':''} ${d>localDate()?'future':''}" data-workspace-habit-day="${d}" type="button" aria-label="${d}：${count}/${HABITS.length}達成"><span>${Number(d.slice(-2))}</span><strong>${d>localDate()?'—':count+'/'+HABITS.length}</strong></button>`}).join('')}</div></section>`;
  }
  function prompts(){
    const matches=value.prompts.filter(p=>!promptFilter||p.project===promptFilter).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));
    const options=[...new Set([...names(),...value.prompts.map(p=>p.project).filter(Boolean)])];
    return `<header class="page-heading"><div><h1>プロジェクト別プロンプト</h1><p>指示文を登録して、必要なときにコピーするだけ。AIとの接続設定は不要です。</p></div><button type="button" class="button primary" data-workspace-new="prompts">${icon('plus')}プロンプト追加</button></header>
      <div class="workspace-filter"><label>プロジェクト<select id="workspace-prompt-filter"><option value="">すべて</option>${options.map(n=>`<option value="${esc(n)}" ${promptFilter===n?'selected':''}>${esc(n)}</option>`).join('')}</select></label></div>
      <div class="workspace-cards">${matches.map(p=>`<section class="panel workspace-memo"><div class="panel-heading"><h2>${p.pinned?'★ ':''}${esc(p.title)}</h2><div class="workspace-inline"><button type="button" class="icon-button" data-workspace-edit="prompts:${esc(p.id)}" aria-label="編集">${icon('edit')}</button><button type="button" class="icon-button" data-workspace-delete="prompts:${esc(p.id)}" aria-label="削除">${icon('trash')}</button></div></div><div class="workspace-meta">${esc(p.project||'未分類')} ${p.category?'・ '+esc(p.category):''}</div><p class="workspace-body">${clean(p.body)}</p><div class="workspace-actions"><button type="button" class="button secondary" data-workspace-copy="${esc(p.id)}">プロンプトをコピー</button><button type="button" class="button secondary" data-workspace-pin="${esc(p.id)}">${p.pinned?'固定を解除':'上部に固定'}</button></div></section>`).join('')||'<section class="panel"><p class="muted">このプロジェクトのプロンプトはまだありません。</p></section>'}</div>`;
  }
  function templates(){
    return `<header class="page-heading"><div><h1>タスクテンプレート</h1><p>何度も使う作業内容とチェックリストを保存します。テンプレートからタスクを追加しても、元のテンプレートは残ります。</p></div><button type="button" class="button primary" data-workspace-new="templates">${icon('plus')}テンプレート作成</button></header>
      <p class="muted work-help">使い方：①テンプレートを登録 → ②「この内容でタスク作成」 → ③期限を設定して保存。ルーチンも設定できます。</p>
      <div class="workspace-cards">${[...value.templates].reverse().map(t=>`<section class="panel workspace-memo"><div class="panel-heading"><h2>${esc(t.title)}</h2><div class="workspace-inline"><button type="button" class="icon-button" data-workspace-edit="templates:${esc(t.id)}" aria-label="編集">${icon('edit')}</button><button type="button" class="icon-button" data-workspace-delete="templates:${esc(t.id)}" aria-label="削除">${icon('trash')}</button></div></div><div class="workspace-meta">${esc(t.project||'未分類')} ・ チェック項目 ${t.steps.length}件</div>${t.detail?`<p class="workspace-body">${clean(t.detail)}</p>`:''}${t.steps.length?`<ul class="work-template-steps">${t.steps.map(s=>`<li>${esc(s.text)}</li>`).join('')}</ul>`:''}<div class="workspace-actions"><button type="button" class="button primary" data-workspace-use-template="${esc(t.id)}">この内容でタスク作成</button></div></section>`).join('')||'<section class="panel"><p class="muted">テンプレートはまだありません。よく使う作業を登録してください。</p></section>'}</div>`;
  }
  function open(type,id='',prefill=null){
    const item=prefill||value[type].find(x=>x.id===id),dialog=document.querySelector('#workspace-dialog'),f=document.querySelector('#workspace-form');
    if(!Object.hasOwn(titles,type))throw Error('入力種類が不正です。');
    formType=type;formId=prefill?'':id;f.reset();document.querySelector('#workspace-title').textContent=`${id?'編集':'追加'}：${titles[type]}`;
    f.elements.title.value=item?.title||'';f.elements.project.innerHTML=projectOptions(item?.project||'');f.elements.project.value=item?.project||'';
    f.elements.description.value=item?.description||'';f.elements.body.value=item?.body||'';f.elements.detail.value=item?.detail||'';
    f.elements.memo.value=item?.memo||'';f.elements.due.value=item?.due||'';f.elements.priority.value=item?.priority||'normal';f.elements.status.value=item?.status||'todo';f.elements.category.value=item?.category||'';
    f.elements.steps.value=(item?.steps||[]).map(s=>s.text).join('\n');
    f.elements.repeatType.value=item?.repeat?.type||'none';f.elements.monthDay.value=String(item?.repeat?.monthDay||1);
    f.querySelectorAll('[name="repeatDay"]').forEach(el=>el.checked=!!item?.repeat?.days.includes(Number(el.value)));
    f.elements.pinned.checked=item?.pinned||false;
    if(f.elements.reviewDate)f.elements.reviewDate.value=item?.reviewDate||'';
    if(f.elements.waitingFor)f.elements.waitingFor.value=item?.waitingFor||'';
    if(f.elements.startCondition)f.elements.startCondition.value=item?.startCondition||'';
    if(f.elements.url)f.elements.url.value=item?.url||'';
    if(f.elements.eventDate)f.elements.eventDate.value=item?.date||calendarDate;
    if(f.elements.allDay)f.elements.allDay.checked=item?.allDay??false;
    if(f.elements.eventTime)f.elements.eventTime.value=item?.time||'';
    if(f.elements.eventNote)f.elements.eventNote.value=item?.note||'';
    updateRepeatFields();
    updateWaitFields();
    for(const wrap of f.querySelectorAll('[data-workspace-types]'))wrap.hidden=!wrap.dataset.workspaceTypes.split(',').includes(type);
    updateEventTime();
    document.querySelector('#workspace-form-error').textContent='';dialog.showModal();
  }
  function updateEventTime(){
    const f=document.querySelector('#workspace-form'),field=document.querySelector('#work-event-time');
    if(field)field.hidden=formType!=='events'||!!f.elements.allDay?.checked;
    if(formType==='events'&&f.elements.allDay?.checked&&f.elements.eventTime)f.elements.eventTime.value='';
  }
  function updateRepeatFields(){
    const f=document.querySelector('#workspace-form');
    const type=f.elements.repeatType.value;
    const days=document.querySelector('#workspace-weekdays'),month=document.querySelector('#workspace-monthday');
    if(days)days.hidden=type!=='weekly';
    if(month)month.hidden=type!=='monthly';
  }
  function updateWaitFields(){
    const f=document.querySelector('#workspace-form'),field=document.querySelector('#workspace-wait-fields');
    if(field)field.hidden=!['waiting','someday'].includes(f.elements.status.value);
  }
  function makeSteps(text,old=[]){
    const lines=text.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
    if(lines.length>30||lines.some(v=>v.length>200))throw Error('チェック項目は30件まで、1件200文字までです。');
    return lines.map((t,i)=>({text:t,done:old[i]?.text===t?old[i].done:false}));
  }
  function parseRepeat(f,old){
    const type=f.elements.repeatType.value||'none';
    if(type==='none')return null;
    const rule={type,days:[],monthDay:null};
    if(type==='weekly')rule.days=[...f.querySelectorAll('[name="repeatDay"]:checked')].map(x=>Number(x.value));
    if(type==='monthly')rule.monthDay=Number(f.elements.monthDay.value);
    if(type==='weekly'&&!rule.days.length)throw Error('繰り返す曜日を1つ以上選んでください。');
    const since=f.elements.due.value||localDate();
    // A changed rule/due date establishes a new first occurrence; untouched recurrence keeps its due date.
    const unchanged=old?.repeat&&JSON.stringify(old.repeat)===JSON.stringify(rule)&&old.due===f.elements.due.value;
    return {rule,due:unchanged?old.due:firstRoutineDate(rule,since)};
  }
  function click(button){
    try{
      if(button.dataset.workspaceFocus){save(workspaceToggleFocus(value,localDate(),button.dataset.workspaceFocus));toast('今日やる3件を更新しました。');return true;}
      if(button.dataset.workspaceNewEvent){calendarDate=button.dataset.workspaceNewEvent;open('events','',{date:calendarDate});return true;}
      if(button.dataset.workspaceNewDatedTask){open('tasks','',{due:button.dataset.workspaceNewDatedTask});return true;}
      if(button.dataset.workspaceCalendarDay){calendarDate=button.dataset.workspaceCalendarDay;render();return true;}
      if(button.dataset.workspaceCalendarToday!==undefined){calendarDate=localDate();render();return true;}
      if(button.dataset.workspaceCalendarView){calendarView=button.dataset.workspaceCalendarView;render();return true;}
      if(button.dataset.workspaceCalendarShift){calendarDate=calendarView==='week'?makeDay(calendarDate,7*Number(button.dataset.workspaceCalendarShift)):shiftMonth(calendarDate,Number(button.dataset.workspaceCalendarShift));render();return true;}
      if(button.dataset.workspaceHabitMonth){habitDate=shiftMonth(habitDate,Number(button.dataset.workspaceHabitMonth));render();return true;}
      if(button.dataset.workspaceResume){save(workspaceSetTaskStatus(value,button.dataset.workspaceResume,'todo',localDate(),uid));toast('未着手に戻しました。');return true;}
      if(button.dataset.workspaceMoveLink){save(workspaceMoveLink(value,button.dataset.workspaceMoveLink,button.dataset.direction));return true;}
      if(button.dataset.workspaceSuggestLink!==undefined){const l=suggestedLinks[Number(button.dataset.workspaceSuggestLink)];if(!l)throw Error('リンク候補が見つかりません。');if(value.links.some(x=>x.url===l.url))throw Error('このURLは登録済みです。');save(workspaceChange(value,'links',l,'',uid));toast('リンクを追加しました。');return true;}
      if(button.dataset.workspaceNew){open(button.dataset.workspaceNew);return true;}
      if(button.dataset.workspaceNewPrompt!==undefined){open('prompts','',{project:button.dataset.workspaceNewPrompt});return true;}
      if(button.dataset.workspaceNewTask!==undefined){open('tasks','',{project:button.dataset.workspaceNewTask});return true;}
      if(button.dataset.workspaceUseTemplate){const t=value.templates.find(x=>x.id===button.dataset.workspaceUseTemplate);if(!t)throw Error('テンプレートがありません。');open('tasks','',{title:t.title,project:t.project,detail:t.detail,priority:t.priority,steps:t.steps});return true;}
      if(button.dataset.workspaceSaveTemplate){const t=visibleTask(button.dataset.workspaceSaveTemplate);if(!t)throw Error('タスクがありません。');open('templates','',{title:t.title,project:t.project,detail:t.detail,priority:t.priority,steps:t.steps});return true;}
      if(button.dataset.workspaceSkip){const t=visibleTask(button.dataset.workspaceSkip);if(!t?.repeat)throw Error('ルーチンがありません。');if(!confirm('今回分だけスキップして、次の予定を作成しますか？'))return true;const next=workspaceAdvanceTask(value,t.id,localDate(),uid,true);selectedTask=next.tasks.find(x=>x.routineId===(t.routineId||t.id)&&x.status!=='done')?.id||'';save(next);toast('次回分を作成しました。');return true;}
      if(button.dataset.workspaceStopRepeat){const t=visibleTask(button.dataset.workspaceStopRepeat);if(!t?.repeat)throw Error('ルーチンがありません。');if(!confirm('このタスクの繰り返しを解除しますか？タスク自体は残ります。'))return true;save(workspaceChange(value,'tasks',{repeat:null},t.id,uid));toast('繰り返しを解除しました。');return true;}
      if(button.dataset.workspacePin){const p=value.prompts.find(x=>x.id===button.dataset.workspacePin);if(!p)throw Error('プロンプトがありません。');save(workspaceChange(value,'prompts',{pinned:!p.pinned},p.id,uid));return true;}
      if(button.dataset.workspaceEdit){const [type,id]=button.dataset.workspaceEdit.split(':');open(type,id);return true;}
      if(button.dataset.workspaceSelectProject!==undefined){selectedProject=button.dataset.workspaceSelectProject;selectedTask='';render();return true;}
      if(button.dataset.workspaceOverview!==undefined){selectedTask='';render();return true;}
      if(button.dataset.workspaceSelectTask){selectedTask=button.dataset.workspaceSelectTask;if(!['#tasks','#projects'].includes(location.hash))location.hash='#tasks';render();if(window.innerWidth<=600)document.querySelector('.work-detail')?.scrollIntoView?.({behavior:'smooth',block:'start'});return true;}
      if(button.dataset.workspaceManageProjects!==undefined){projectSettingsOpen=!projectSettingsOpen;render();return true;}
      if(button.dataset.workspaceProjectVisibility!==undefined){
        const project=button.dataset.workspaceProjectVisibility,visible=button.dataset.visible==='true';
        if(!allNames().includes(project))throw Error('プロジェクトが見つかりません。');
        save(workspaceSetProjectVisibility(value,project,visible));
        toast(visible?'プロジェクトを再表示しました。':'プロジェクトを非表示にしました。');return true;
      }
      if(button.dataset.workspaceRecord){const t=visibleTask(button.dataset.workspaceRecord);if(!t)throw Error('タスクがありません。');startRecord({project:t.project,taskId:t.id});return true;}
      if(button.dataset.workspaceRecordProject!==undefined){startRecord({project:button.dataset.workspaceRecordProject});return true;}
      if(button.dataset.workspaceHabitShift){const d=new Date(habitDate+'T12:00:00');d.setDate(d.getDate()+Number(button.dataset.workspaceHabitShift));habitDate=localDate(d);render();return true;}
      if(button.dataset.workspaceHabitDay){habitDate=button.dataset.workspaceHabitDay;render();return true;}
      if(button.dataset.workspaceHabitToday!==undefined){habitDate=localDate();render();return true;}
      if(button.dataset.workspaceDelete){const [type,id]=button.dataset.workspaceDelete.split(':');if(!confirm('この項目を削除しますか？先にバックアップを保存してください。'))return true;save(workspaceDelete(value,type,id));toast('削除しました。');return true;}
      if(button.dataset.workspaceConvert){const note=value.notes.find(x=>x.id===button.dataset.workspaceConvert);if(!note)throw Error('メモがありません。');open('tasks','',{title:note.title,detail:note.body,project:note.project});return true;}
      if(button.dataset.workspaceCopy){
        const p=value.prompts.find(x=>x.id===button.dataset.workspaceCopy);if(!p)throw Error('プロンプトがありません。');
        const fallback=()=>{const field=document.createElement('textarea');field.value=p.body;field.setAttribute('readonly','');field.style.position='fixed';field.style.left='-9999px';document.body.append(field);field.select();const ok=document.execCommand('copy');field.remove();if(!ok)throw Error('コピーできませんでした。');toast('コピーしました。');};
        if(navigator.clipboard?.writeText)navigator.clipboard.writeText(p.body).then(()=>toast('コピーしました。'),()=>{try{fallback();}catch(e){toast(e.message);}});
        else fallback();return true;
      }
    }catch(e){toast(e.message);return true;}return false;
  }
  function change(target){
    if(target.id==='workspace-prompt-filter'){promptFilter=target.value;render();return true;}
    if(target.dataset?.workspaceCalendarFilter){calendarFlags[target.dataset.workspaceCalendarFilter]=target.checked;render();return true;}
    if(target.name==='allDay'){updateEventTime();return true;}
    if(target.name==='repeatType'){updateRepeatFields();return true;}
    if(target.name==='status'&&formType==='tasks'){updateWaitFields();return true;}
    if(target.dataset?.workspaceStep!==undefined){try{save(workspaceToggleTaskStep(value,target.dataset.workspaceStep,Number(target.dataset.index),uid));}catch(e){toast(e.message);render();}return true;}
    if(target.id==='workspace-project-filter'){filter=target.value;selectedTask='';render();return true;}
    if(target.dataset?.workspaceStatus!==undefined){
      try{
        const t=visibleTask(target.dataset.workspaceStatus);
        if(!t)throw Error('タスクが見つかりません。');
        if(!['todo','doing','waiting','someday','done'].includes(target.value))throw Error('タスクの状態が不正です。');
        if(t.status!==target.value){const next=workspaceSetTaskStatus(value,t.id,target.value,localDate(),uid);if(t.repeat&&target.value==='done')selectedTask=next.tasks.find(x=>x.routineId===(t.routineId||t.id)&&x.status!=='done')?.id||'';save(next);toast(t.repeat&&target.value==='done'?'完了しました。次回分のタスクを作成しました。':'ステータスを更新しました。');}
      }catch(e){toast(e.message);render();}
      return true;
    }
    if(target.dataset?.workspaceHabit){try{save(workspaceToggleHabit(value,target.dataset.date,target.dataset.workspaceHabit));toast('習慣を保存しました。');}catch(e){toast(e.message);render();}return true;}
    return false;
  }
  function input(target){
    if(target.id!=='workspace-search')return false;
    search=target.value;const cursor=target.selectionStart;render();const field=document.querySelector('#workspace-search');if(field){field.focus();field.setSelectionRange(cursor,cursor);}return true;
  }
  document.querySelector('#workspace-form').addEventListener('submit',event=>{
    event.preventDefault();try{
      const f=event.currentTarget,payload={title:f.elements.title.value.trim(),project:f.elements.project.value};
      if(formType==='links'){payload.project='';payload.url=f.elements.url.value.trim();}
      if(formType==='events'){Object.assign(payload,{project:'',date:f.elements.eventDate.value,allDay:f.elements.allDay.checked,time:f.elements.allDay.checked?'':f.elements.eventTime.value,note:f.elements.eventNote.value});}
      if(formType==='tasks'){
        const old=value.tasks.find(t=>t.id===formId);
        const rpt=parseRepeat(f,old);
        Object.assign(payload,{due:rpt?.due||f.elements.due.value,status:f.elements.status.value,priority:f.elements.priority.value,detail:f.elements.detail.value,memo:f.elements.memo.value,steps:makeSteps(f.elements.steps.value,old?.steps),repeat:rpt?.rule||null,reviewDate:f.elements.reviewDate?.value||'',waitingFor:f.elements.waitingFor?.value||'',startCondition:f.elements.startCondition?.value||''});
        if(old?.status==='done'&&payload.repeat)throw Error('完了履歴にはルーチンを設定できません。新しいタスクを作成してください。');
      }
      if(formType==='templates')Object.assign(payload,{detail:f.elements.detail.value,priority:f.elements.priority.value,steps:makeSteps(f.elements.steps.value)});
      if(formType==='projects')Object.assign(payload,{description:f.elements.description.value,memo:f.elements.memo.value});
      if(formType==='notes'||formType==='prompts')payload.body=f.elements.body.value;
      if(formType==='prompts'){payload.category=f.elements.category.value;payload.pinned=f.elements.pinned.checked;if(!payload.body.trim())throw Error('プロンプトの本文を入力してください。');}
      if(formType==='projects'&&value.projects.some(p=>p.title===payload.title&&p.id!==formId))throw Error('同じ名前のプロジェクトは既にあります。');
      if(formType==='projects'&&formId){const prev=value.projects.find(p=>p.id===formId);if(prev&&prev.title!==payload.title&&([...value.tasks,...value.notes,...value.prompts,...value.templates].some(x=>x.project===prev.title)||getTimeRecords().some(r=>r.project===prev.title)))throw Error('記録があるプロジェクトの名前は変更できません。');}
      let next=workspaceChange(value,formType,payload,formId,uid);
      if(formType==='tasks'&&payload.status==='done'){
        const id=formId||next.tasks.at(-1)?.id;
        const old=value.tasks.find(t=>t.id===formId);
        if(!old||old.status!=='done'){
          // Save the edited/new task as pending first, then complete it exactly once.
          next=workspaceChange(next,'tasks',{status:'todo'},id,uid);
          next=workspaceAdvanceTask(next,id,localDate(),uid);
        }
      }
      if(formType==='tasks'){selectedTask=next.tasks.find(t=>t.id===formId&&t.status!=='done')?.id||next.tasks.at(-1)?.id||'';if(payload.project)selectedProject=payload.project;}
      if(formType==='projects')selectedProject=payload.title;
      if(formType==='events')calendarDate=payload.date;
      save(next);document.querySelector('#workspace-dialog').close();toast('保存しました。');
    }catch(e){document.querySelector('#workspace-form-error').textContent=e.message;}
  });
  document.addEventListener('submit',event=>{
    const form=event.target;if(!form.matches('[data-workspace-save-note]'))return;
    event.preventDefault();try{
      const text=form.elements.memo.value,type=form.dataset.workspaceSaveNote;
      if(type==='tasks'){
        const t=visibleTask(form.dataset.id);if(!t)throw Error('タスクが見つかりません。');
        save(workspaceChange(value,'tasks',{memo:text},t.id,uid));
      }else if(type==='projects'){
        const project=form.dataset.project,found=value.projects.find(p=>p.title===project);
        save(workspaceChange(value,'projects',found?{memo:text}:{title:project,project:'',description:'',memo:text},found?.id||'',uid));
      }else throw Error('保存対象が不正です。');
      toast('メモを保存しました。');
    }catch(e){toast(e.message);}
  });
  return {get:()=>value,visibleProjects:names,error:()=>error,reload,home,linksHome,links,tasks,projects,habitHome,habits,calendar,prompts,templates,click,change,input};
}
