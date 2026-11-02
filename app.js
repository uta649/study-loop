(() => {
  'use strict';

  const STORAGE_KEY = 'study_loop_ultimate_v1';
  const LEGACY_KEY = 'study_loop_data_v1';
  const $ = (id) => document.getElementById(id);
  const SUBJECTS = ['数学','英語','国語','物理','化学','生物','地学','地理','日本史','世界史','公共・政経','情報','その他'];
  const DEFAULT_TASKS = [
    { text: '今日の最重要課題を1つ決める', priority: true },
    { text: '期限が来た復習を先に行う', priority: false },
    { text: 'スマホを勉強場所から離す', priority: false }
  ];
  const intervals = { again: 1, hard: 2, good: 3, easy: 7 };
  const dateKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const parseDate = (key) => { const [y,m,d] = key.split('-').map(Number); return new Date(y,m-1,d,12); };
  const addDays = (key, n) => { const d=parseDate(key); d.setDate(d.getDate()+n); return dateKey(d); };
  let today = dateKey();
  let viewDate = today;
  let route = (location.hash.replace('#','') || 'home');
  let toastTimer = null;
  let deferredInstallPrompt = null;
  let clockInterval = null;
  let saveTimer = null;
  let store = loadStore();

  function uid(){ return (crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2,10)}`; }
  function freshDay(){
    return { tasks: DEFAULT_TASKS.map(t=>({id:uid(),text:t.text,priority:t.priority,done:false})), priority:'', reflection:{good:'',improve:'',next:'',learned:'',focus:3,confidence:3}, distractions:[], logs:[] };
  }
  function defaultStore(){
    const subjectTargets = {};
    SUBJECTS.forEach((s,i)=>subjectTargets[s] = [240,240,120,180,180,0,0,0,0,0,0,60,60][i] || 0);
    return {
      schema:1,
      profile:{target:'京都大学',examDate:'',dailyGoal:180,weeklyGoal:1200,subjects:SUBJECTS.slice(),subjectTargets},
      days:{}, plans:[], reviews:[], mistakes:[], notes:[], tests:[], timer:null,timerDraftDuration:null,timerDraftSubject:'数学',
      totals:{focusSessions:0,completedReviews:0}, preferences:{focusMinutes:25,shortBreak:5,longBreak:15,sessionsPerLongBreak:4,notifications:false},
      meta:{createdAt:new Date().toISOString(),lastBackupAt:null}
    };
  }
  function migrateLegacy(old){
    const s=defaultStore();
    if(!old || typeof old!=='object') return s;
    Object.entries(old.days||{}).forEach(([key,d])=>{
      const nd=freshDay();
      nd.priority=d.priority||'';
      nd.tasks=Array.isArray(d.tasks)?d.tasks.map(t=>({id:uid(),text:String(t.text||''),priority:false,done:!!t.done})):nd.tasks;
      nd.logs=(d.logs||[]).map(l=>({id:uid(),date:key,time:l.time||new Date().toISOString(),minutes:Number(l.minutes)||0,subject:l.subject||'その他',source:l.source||'legacy',note:''})).filter(l=>l.minutes>0);
      nd.reflection={good:d.good||'',improve:d.improve||'',next:d.next||'',learned:d.learned||'',focus:d.focusScore||3,confidence:d.confidenceScore||3};
      nd.distractions=(d.urgeCount||d.slipCount)?[{id:uid(),type:'legacy',count:(d.urgeCount||0)+(d.slipCount||0),time:new Date().toISOString()}]:[];
      s.days[key]=nd;
    });
    s.plans=(old.plan||[]).map(p=>({id:p.id||uid(),date:p.date||today,subject:p.subject||'その他',title:p.title||'',minutes:Number(p.minutes)||30,priority:'normal',status:p.done?'done':'todo',actualMin:0,createdAt:p.createdAt||new Date().toISOString()}));
    s.reviews=(old.reviews||[]).map(r=>({id:r.id||uid(),subject:r.subject||'その他',front:r.topic||'',back:'意味・解説を追加してください',due:r.due||today,interval:1,stage:r.stage||0,lastReviewed:r.lastReviewed||null,history:[]}));
    s.mistakes=(old.mistakes||[]).map(m=>({id:m.id||uid(),date:(m.createdAt||'').slice(0,10)||today,subject:m.subject||'その他',unit:'',question:m.question||'',cause:m.cause||'',lesson:m.fix||'',status:m.retried?'done':'todo',retryCount:m.retried?1:0,nextReview:addDays(today,1),createdAt:m.createdAt||new Date().toISOString()}));
    return s;
  }
  function loadStore(){
    try {
      const raw=localStorage.getItem(STORAGE_KEY);
      if(raw){ const parsed=JSON.parse(raw); return normalizeStore(parsed); }
      const legacy=localStorage.getItem(LEGACY_KEY);
      if(legacy){ const converted=migrateLegacy(JSON.parse(legacy)); localStorage.setItem(STORAGE_KEY,JSON.stringify(converted)); return converted; }
    } catch(e){ console.warn('データを読み込めませんでした',e); }
    return defaultStore();
  }
  function normalizeStore(x){
    const base=defaultStore();
    if(!x || typeof x!=='object') return base;
    const s={...base,...x};
    s.profile={...base.profile,...(x.profile||{})};
    s.profile.subjects=Array.isArray(s.profile.subjects)&&s.profile.subjects.length?s.profile.subjects:SUBJECTS.slice();
    s.profile.subjectTargets={...base.profile.subjectTargets,...(s.profile.subjectTargets||{})};
    s.days=(x.days&&typeof x.days==='object')?x.days:{};
    s.plans=Array.isArray(x.plans)?x.plans:[];
    s.reviews=Array.isArray(x.reviews)?x.reviews:[];
    s.mistakes=Array.isArray(x.mistakes)?x.mistakes:[];
    s.notes=Array.isArray(x.notes)?x.notes:[];
    s.tests=Array.isArray(x.tests)?x.tests:[];
    s.totals={...base.totals,...(x.totals||{})};
    s.preferences={...base.preferences,...(x.preferences||{})};
    s.meta={...base.meta,...(x.meta||{})};
    if(!s.days[today]) s.days[today]=freshDay();
    Object.keys(s.days).forEach(k=>{ const d=s.days[k]; if(!Array.isArray(d.tasks))d.tasks=[];if(!Array.isArray(d.logs))d.logs=[];if(!Array.isArray(d.distractions))d.distractions=[];if(!d.reflection)d.reflection={good:'',improve:'',next:'',learned:'',focus:3,confidence:3}; });
    return s;
  }
  function saveStore(){
    try { localStorage.setItem(STORAGE_KEY,JSON.stringify(store)); $('saveStatus').textContent='保存済み · '+new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}); }
    catch(e){ $('saveStatus').textContent='保存容量不足。バックアップしてください'; toast('保存できませんでした。データを書き出してください。',true); }
  }
  function scheduleSave(){ clearTimeout(saveTimer); saveTimer=setTimeout(saveStore,220); }
  function dayData(key=viewDate){ if(!store.days[key])store.days[key]=freshDay();return store.days[key]; }
  function subjectOptions(selected){ return store.profile.subjects.map(s=>`<option value="${esc(s)}" ${s===selected?'selected':''}>${esc(s)}</option>`).join(''); }
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function fmtDate(key,options={month:'numeric',day:'numeric',weekday:'short'}){return new Intl.DateTimeFormat('ja-JP',options).format(parseDate(key));}
  function fmtLong(key){return new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(parseDate(key));}
  function minsLabel(n){const m=Math.max(0,Math.round(n||0));const h=Math.floor(m/60),r=m%60;return h?`${h}時間${r?`${r}分`:''}`:`${r}分`;}
  function pct(a,b){return b>0?Math.round(a/b*100):0;}
  function logsBetween(start,end){const out=[];Object.entries(store.days).forEach(([date,d])=>{if(date>=start&&date<=end)(d.logs||[]).forEach(l=>out.push({...l,date:l.date||date}));});return out.sort((a,b)=>(a.time||'').localeCompare(b.time||''));}
  function minutesOn(key){return (store.days[key]?.logs||[]).reduce((n,l)=>n+(Number(l.minutes)||0),0);}
  function totalMinutes(start,end){return logsBetween(start,end).reduce((n,l)=>n+(Number(l.minutes)||0),0);}
  function streak(){let key=today;if(minutesOn(key)===0)key=addDays(today,-1);let count=0;for(let i=0;i<366;i++){if(minutesOn(key)<=0)break;count++;key=addDays(key,-1);}return count;}
  function dueReviews(){return store.reviews.filter(r=>r.due<=today).sort((a,b)=>a.due.localeCompare(b.due));}
  function dateDiff(a,b){return Math.round((parseDate(b)-parseDate(a))/86400000);}
  function addLog({date=today,minutes,subject='その他',source='manual',note='',planId=null,startAt=null}){
    const n=Math.round(Number(minutes)); if(!Number.isFinite(n)||n<1)return false;
    const d=dayData(date);const log={id:uid(),date,time:new Date().toISOString(),startAt,minutes:Math.min(1440,n),subject,source,note,planId};d.logs.push(log);
    if(planId){const p=store.plans.find(x=>x.id===planId);if(p)p.actualMin=(p.actualMin||0)+log.minutes;}
    saveStore();return log;
  }
  function toast(message,error=false){const box=document.createElement('div');box.className='toast'+(error?' error':'');box.textContent=message;$('toastRegion').appendChild(box);setTimeout(()=>box.remove(),3600);}
  function setRoute(next){route=next;location.hash=next;render();window.scrollTo({top:0,behavior:'smooth'});}
  function checkDateRollover(){const current=dateKey();if(current!==today){const previous=today;today=current;if(viewDate===previous)viewDate=current;dayData(today);saveStore();render();toast('日付が変わりました。新しい日の記録を開始できます。');}}
  function updateHeader(){
    $('headerDate').textContent=fmtLong(today);
    document.querySelectorAll('.nav-link').forEach(a=>a.classList.toggle('active',a.dataset.route===route));
    const t=store.timer;const strip=$('timerStrip');
    if(t&&!t.paused){strip.classList.remove('hidden');$('timerStripLabel').textContent=t.mode==='focus'?`${t.subject} · 集中中`:'休憩中';$('timerStripTime').textContent=clockText(timerRemaining(t));}
    else strip.classList.add('hidden');
  }
  function timerRemaining(t){return t.paused?Math.max(0,t.remainingSec):Math.max(0,Math.ceil((t.endAt-Date.now())/1000));}
  function clockText(sec){sec=Math.max(0,sec|0);return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
  function statCard(icon,label,value,unit,foot=''){return `<div class="stat-card"><div class="stat-label"><span class="stat-icon">${icon}</span>${label}</div><div class="stat-value">${value}<small>${unit}</small></div>${foot?`<div class="stat-foot">${foot}</div>`:''}</div>`;}
  function sectionHead(title,sub='',right=''){return `<div class="panel-header"><div><h2>${title}</h2>${sub?`<p>${sub}</p>`:''}</div>${right}</div>`;}
  function pageHead(eyebrow,title,sub,right=''){return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${sub}</p></div>${right}</div>`;}
  function dateNav(key){return `<div class="date-nav"><button type="button" data-action="date-shift" data-delta="-1" aria-label="前の日">‹</button><input class="field" type="date" id="viewDateInput" value="${key}"><button type="button" data-action="date-shift" data-delta="1" aria-label="次の日">›</button><button class="btn btn-small btn-soft" data-action="date-today">今日</button></div>`;}

  function render(){
    if(!store.days[today])dayData(today);
    updateHeader();
    const view=$('appView');
    if(route==='plan')view.innerHTML=renderPlanPage();
    else if(route==='review')view.innerHTML=renderReviewPage();
    else if(route==='analysis')view.innerHTML=renderAnalysisPage();
    else if(route==='notes')view.innerHTML=renderNotesPage();
    else if(route==='settings')view.innerHTML=renderSettingsPage();
    else {route='home';view.innerHTML=renderHomePage();}
    bindViewInputs();
  }

  function renderHomePage(){
    const d=dayData(viewDate);const suggestedBreak=(Number(store.totals.focusSessions||0)>0 && Number(store.totals.focusSessions||0)%Number(store.preferences.sessionsPerLongBreak||4)===0)?store.preferences.longBreak:store.preferences.shortBreak;const logs=d.logs||[];const study=logs.reduce((n,l)=>n+l.minutes,0);const done=d.tasks.filter(t=>t.done).length;const goal=store.profile.dailyGoal;const due=dueReviews().length;const plans=store.plans.filter(p=>p.date===viewDate).sort((a,b)=>a.priority==='high'?-1:1);
    const activeTimer=store.timer;const percent=pct(study,goal);const examDays=store.profile.examDate?dateDiff(today,store.profile.examDate):null;
    const tasksHtml=d.tasks.length?d.tasks.map(t=>`<div class="task-row ${t.done?'done':''}"><input class="check" type="checkbox" ${t.done?'checked':''} data-action="toggle-task" data-id="${t.id}" aria-label="${esc(t.text)}"><span class="task-text">${esc(t.text)}</span>${t.priority?'<span class="task-priority">優先</span>':''}<button class="task-delete" data-action="delete-task" data-id="${t.id}" aria-label="削除">×</button></div>`).join(''):'<div class="empty">今日のタスクはまだありません。最初の一つを追加しましょう。</div>';
    const planHtml=plans.length?plans.slice(0,5).map(p=>`<div class="list-card"><div class="list-card-main"><div class="list-title">${esc(p.title)}</div><div class="list-meta"><span class="pill">${esc(p.subject)}</span><span class="pill">予定 ${p.minutes}分</span>${p.priority==='high'?'<span class="pill yellow">最優先</span>':''}${p.status==='done'?'<span class="pill green">完了</span>':'<span class="pill blue">未完了</span>'}</div><div class="list-actions">${p.status!=='done'?`<button class="btn btn-small btn-primary" data-action="start-plan" data-id="${p.id}">この計画で集中</button><button class="btn btn-small btn-soft" data-action="complete-plan" data-id="${p.id}">完了にする</button>`:''}<button class="btn btn-small btn-quiet" data-action="go-plan">編集</button></div></div></div>`).join(''):'<div class="empty">今日の計画はありません。学習計画から追加できます。</div>';
    const ringProgress=activeTimer?Math.min(100,Math.max(0,100-(timerRemaining(activeTimer)/activeTimer.durationSec*100))):0;
    return `${pageHead('YOUR DAILY LOOP',viewDate===today?'今日の学習を設計する':`${fmtDate(viewDate,{month:'long',day:'numeric',weekday:'long'})}の記録`,'計画を小さく区切り、集中して実行し、振り返りから次の一手を決めましょう。',dateNav(viewDate))}
      <section class="hero"><div class="hero-inner"><div><div class="eyebrow">${esc(store.profile.target)}への積み上げ</div><h2>${viewDate===today?'今日の一歩を、確実に。':'この日の学習記録'}</h2><p>完璧な一日より、次の一つを始めること。今日の最重要課題を決めて、最初の5分から取り組みましょう。${examDays!==null?` <span class="pill blue">目標日まで ${examDays>=0?`あと${examDays}日`:`${Math.abs(examDays)}日経過`}</span>`:''}</p></div><div class="hero-actions"><button class="btn btn-primary" data-action="start-quick">▶ まず5分始める</button><button class="btn btn-soft" data-action="go-plan">計画を立てる</button></div></div></section>
      <section class="stat-grid">
        ${statCard('◷','今日の学習時間',minsLabel(study),'','目標 '+minsLabel(goal))}
        ${statCard('◎','目標達成率',percent,'%','実績 ÷ 1日の目標')}
        ${statCard('✓','タスク完了',done,`/${d.tasks.length}件`,d.tasks.length?'今日のチェックリスト':'タスクを追加してください')}
        ${statCard('↻','復習期限',due,'件',due?'今日取り組む復習':'期限内の復習はありません')}
      </section>
      <div class="grid">
        <section class="panel col-7 timer-panel">${sectionHead('FOCUS SESSION','集中する時間を決める',activeTimer?'<span class="pill green">タイマー稼働中</span>':'<span class="pill">集中モード</span>')}
          <div class="timer-layout"><div class="timer-main"><div class="timer-mode">${activeTimer?(activeTimer.mode==='focus'?'FOCUS':'BREAK'):'READY TO FOCUS'}</div><div class="timer-display" id="timerDisplay">${activeTimer?clockText(timerRemaining(activeTimer)):clockText(store.preferences.focusMinutes*60)}</div><div class="timer-caption" id="timerCaption">${activeTimer?(activeTimer.paused?'一時停止中':'集中を続けましょう'):'まずは取り組む科目と時間を選択'}</div>
            <div class="timer-settings"><select id="timerSubject" aria-label="集中する科目">${subjectOptions(activeTimer?.subject||store.timerDraftSubject||'数学')}</select><select id="timerDuration" aria-label="集中時間">${[5,15,25,40,50,60,90].map(n=>`<option value="${n}" ${n===(store.timerDraftDuration||store.preferences.focusMinutes)?'selected':''}>${n}分</option>`).join('')}</select></div>
            <div class="timer-controls"><button class="btn btn-primary" data-action="timer-toggle">${activeTimer?(activeTimer.paused?'再開':'一時停止'):'集中開始'}</button>${activeTimer?`<button class="btn btn-soft" data-action="timer-finish">終了して記録</button><button class="btn btn-quiet" data-action="timer-reset">リセット</button>`:''}</div>
          </div><div class="timer-ring" id="timerRing" style="--timer-progress:${ringProgress}%"><div class="timer-ring-content"><b>${percent}%</b><span>今日の目標</span></div></div></div>
          <div class="timer-controls"><button class="btn btn-small btn-soft" data-action="start-break">☕ ${suggestedBreak}分の休憩</button></div><div class="divider"></div><div class="split-head"><span class="small muted">タイマーの使い方</span><span class="pill">${store.preferences.shortBreak}分休憩</span></div><p class="tiny muted">画面を閉じても終了時刻を保持します。途中で終了した場合は、実際に取り組んだ分だけを記録できます。</p>
        </section>
        <section class="panel col-5">${sectionHead('DAILY PRIORITY','今日の最重要課題')}
          <label for="dailyPriority">今日、必ず前に進めたいこと</label><textarea id="dailyPriority" maxlength="180" placeholder="例：数学の微積分を例題3題解き、解法を説明できるようにする">${esc(d.priority)}</textarea>
          <div class="progress-row"><span>今日の目標</span><strong>${minsLabel(study)} / ${minsLabel(goal)}</strong></div><div class="progress-track"><div class="progress-fill ${percent>=100?'green':''}" style="width:${Math.min(100,percent)}%"></div></div>
          <div class="form-actions"><button class="btn btn-small btn-soft" data-action="add-task-prompt">＋ タスクを追加</button><button class="btn btn-small btn-quiet" data-action="go-settings">目標を変更</button></div>
          <div class="callout section-gap"><strong>注意を取り戻す</strong><br>動画を見たくなったら、衝動を記録してスマホを遠ざけ、5分だけ机に戻ります。自分を責めるより、次の行動を決めることを優先しましょう。</div>
        </section>
        <section class="panel col-6">${sectionHead('TODAY CHECKLIST',`完了 ${done} / ${d.tasks.length} 件`)}<div class="task-list">${tasksHtml}</div><form id="taskForm" class="inline-form section-gap"><input class="field" name="task" maxlength="100" placeholder="追加する行動を入力"><button class="btn btn-primary" type="submit">追加</button></form></section>
        <section class="panel col-6">${sectionHead('TODAY PLAN',`${fmtDate(viewDate)}の学習予定`,'<button class="btn btn-small btn-soft" data-action="go-plan">すべて見る</button>')}<div class="stack">${planHtml}</div></section>
        <section class="panel col-8">${sectionHead('LAST 7 DAYS','記録した学習時間の推移','<span class="pill">目標 '+minsLabel(store.profile.weeklyGoal)+'/週</span>')}${weekChartHtml(7,viewDate)}<div class="progress-row"><span>今週の学習時間</span><strong>${minsLabel(totalMinutes(addDays(today,-6),today))} / ${minsLabel(store.profile.weeklyGoal)}</strong></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100,pct(totalMinutes(addDays(today,-6),today),store.profile.weeklyGoal))}%"></div></div></section>
        <section class="panel col-4">${sectionHead('QUICK REVIEW','復習を先に済ませる',`<span class="pill ${due?'yellow':'green'}">${due}件</span>`)}${due?`<p class="muted small">期限が来たカードがあります。短時間でも、何も見ずに思い出すことから始めましょう。</p><button class="btn btn-primary" data-action="go-review">復習を開始する</button>`:'<div class="empty">今日が期限の復習はありません。</div>'}<div class="divider"></div><div class="small muted">連続学習日数</div><div class="stat-value">${streak()}<small>日</small></div><p class="tiny muted">休んだ日があっても、再開した日から記録を積み直せます。</p></section>
        <section class="panel col-6">${sectionHead('ATTENTION RESET','誘惑を記録して切り替える')}<p class="small muted">衝動に気づいた時点で記録。行動のパターンを責めずに観察します。</p><div class="form-actions"><button class="btn btn-soft" data-action="log-urge">動画を見たくなった</button><button class="btn" data-action="log-slip">動画を見た</button></div><div class="list-meta"><span class="pill">衝動 ${d.distractions.filter(x=>x.type==='urge').length}回</span><span class="pill">視聴 ${d.distractions.filter(x=>x.type==='slip').length}回</span></div><div class="notice tiny muted">アプリからYouTubeを強制ブロックすることはできません。端末のDigital Wellbeingやフォーカスモードを併用してください。</div></section>
        <section class="panel col-6">${sectionHead('DAILY REFLECTION','今日の経験を次の改善につなげる')}<form id="reflectionForm"><label>今日できたこと</label><textarea name="good" data-reflection maxlength="500" placeholder="できた行動や前進を書き留める">${esc(d.reflection.good)}</textarea><label>改善したいこと</label><textarea name="improve" data-reflection maxlength="500" placeholder="原因と、次に変える行動を具体的に">${esc(d.reflection.improve)}</textarea><label>明日の最初の一歩</label><input class="field" name="next" data-reflection maxlength="180" value="${esc(d.reflection.next)}" placeholder="机に座ったら、まず何をする？"><div class="form-grid"><div><label>集中度：${d.reflection.focus}/5</label><input class="field" type="range" min="1" max="5" name="focus" data-reflection value="${d.reflection.focus}"></div><div><label>手応え：${d.reflection.confidence}/5</label><input class="field" type="range" min="1" max="5" name="confidence" data-reflection value="${d.reflection.confidence}"></div></div></form></section>
      </div>`;
  }
  function weekChartHtml(days,anchor){
    const dates=[];for(let i=days-1;i>=0;i--)dates.push(addDays(anchor,-i));const vals=dates.map(d=>minutesOn(d));const max=Math.max(60,...vals);
    return `<div class="week-chart">${dates.map((date,i)=>`<div class="chart-col"><div class="chart-value">${vals[i]||'—'}</div><div class="chart-track"><div class="chart-bar" style="height:${vals[i]?Math.max(4,vals[i]/max*100):0}%"></div></div><div class="chart-day">${fmtDate(date,{weekday:'short'})}</div></div>`).join('')}</div>`;
  }

  function renderPlanPage(){
    const selected=store.plans.filter(p=>p.date===viewDate).sort((a,b)=>(a.priority==='high'?-1:0)-(b.priority==='high'?-1:0));
    const weekDays=Array.from({length:7},(_,i)=>addDays(viewDate,-parseDate(viewDate).getDay()+i));
    const rows=selected.length?selected.map(p=>`<div class="list-card"><div class="list-card-main"><div class="list-title">${esc(p.title)}</div><div class="list-meta"><span class="pill">${esc(p.subject)}</span><span class="pill">${p.minutes}分予定</span><span class="pill">実績 ${p.actualMin||0}分</span>${p.priority==='high'?'<span class="pill yellow">最優先</span>':''}${p.status==='done'?'<span class="pill green">完了</span>':'<span class="pill blue">未完了</span>'}</div><div class="progress-row"><span>予定に対する実績</span><strong>${pct(p.actualMin||0,p.minutes)}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100,pct(p.actualMin||0,p.minutes))}%"></div></div><div class="list-actions">${p.status!=='done'?`<button class="btn btn-small btn-primary" data-action="start-plan" data-id="${p.id}">この計画で集中</button><button class="btn btn-small btn-soft" data-action="complete-plan" data-id="${p.id}">完了</button>`:`<button class="btn btn-small btn-soft" data-action="reopen-plan" data-id="${p.id}">未完了に戻す</button>`}<button class="btn btn-small btn-quiet" data-action="edit-plan" data-id="${p.id}">編集</button><button class="btn btn-small btn-quiet" data-action="delete-plan" data-id="${p.id}">削除</button></div></div></div>`).join(''):'<div class="empty">この日の計画はありません。次に取り組む課題を1つ登録しましょう。</div>';
    const weekPlan=weekDays.map(date=>{const ps=store.plans.filter(p=>p.date===date);const total=ps.reduce((n,p)=>n+p.minutes,0);return `<button class="day-tab ${date===viewDate?'selected':''} ${date===today?'today':''}" data-action="choose-date" data-date="${date}"><b>${parseDate(date).getDate()}</b>${fmtDate(date,{weekday:'short'})}<small>${total?minsLabel(total):'—'}</small></button>`;}).join('');
    return `${pageHead('WEEKLY PLANNER','学習計画','「何を・いつ・どこまで」を決め、実績を見て計画を調整します。',dateNav(viewDate))}<div class="grid"><section class="panel col-12">${sectionHead('THIS WEEK','日付を選択して、その日の予定を確認') }<div class="day-tabs">${weekPlan}</div></section><section class="panel col-5">${sectionHead('ADD A PLAN','具体的な行動に分解する')}<form id="planForm"><label>日付</label><input class="field" type="date" name="date" value="${viewDate}" required><label>科目</label><select name="subject">${subjectOptions('数学')}</select><label>取り組む内容</label><input class="field" name="title" maxlength="140" placeholder="例：数学・微積分の標準問題を3題解く" required><div class="form-grid"><div><label>予定時間（分）</label><input class="field" type="number" name="minutes" min="5" max="600" step="5" value="30" required></div><div><label>優先度</label><select name="priority"><option value="normal">通常</option><option value="high">最優先</option></select></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">＋ 計画に追加</button></div></form><div class="callout section-gap"><strong>計画のコツ</strong><br>「数学を勉強する」より「数列の例題を3題解き、解法を説明する」のように、終わりが分かる形にします。</div></section><section class="panel col-7">${sectionHead(`${fmtDate(viewDate,{month:'long',day:'numeric',weekday:'long'})}の予定`,`${selected.length}件 · 予定合計 ${minsLabel(selected.reduce((n,p)=>n+p.minutes,0))}`)}<div class="stack">${rows}</div></section><section class="panel col-12">${sectionHead('WEEKLY LOAD','今週の計画時間と実績時間')}${weeklyPlanChart()}</section></div>`;
  }
  function weeklyPlanChart(){
    const start=addDays(today,-parseDate(today).getDay());const days=Array.from({length:7},(_,i)=>addDays(start,i));const max=Math.max(60,...days.map(d=>store.plans.filter(p=>p.date===d).reduce((n,p)=>n+p.minutes,0)),...days.map(d=>minutesOn(d)));
    return `<div class="week-chart">${days.map(d=>{const planned=store.plans.filter(p=>p.date===d).reduce((n,p)=>n+p.minutes,0),actual=minutesOn(d);return `<div class="chart-col"><div class="chart-value">${actual||planned||'—'}</div><div class="chart-track" style="position:relative"><div class="chart-bar" style="height:${Math.max(planned?2:0,planned/max*100)}%;background:linear-gradient(180deg,#b4a2ff,#7663c5);opacity:.55;position:absolute;bottom:0;width:100%"></div><div class="chart-bar" style="height:${Math.max(actual?2:0,actual/max*100)}%;position:absolute;bottom:0;width:100%"></div></div><div class="chart-day">${fmtDate(d,{weekday:'short'})}</div></div>`;}).join('')}</div><div class="list-meta"><span class="pill blue">実績</span><span class="pill" style="border-color:#8a7ac8;color:#d4caff">計画（背景）</span></div>`;
  }

  function renderReviewPage(){
    const due=dueReviews();const upcoming=store.reviews.filter(r=>r.due>today).sort((a,b)=>a.due.localeCompare(b.due)).slice(0,8);const card=due[0];
    const reviewCard=card?`<div class="review-card"><div class="list-meta"><span class="pill">${esc(card.subject)}</span><span class="pill yellow">${card.due<today?`${dateDiff(card.due,today)}日超過`:'今日が期限'}</span><span class="pill">間隔 ${card.interval||1}日</span></div><div class="front">${esc(card.front)}</div>${card.revealed?`<div class="back">${esc(card.back||'答え・解説が未登録です。編集から追加できます。')}</div>`:`<button class="btn btn-soft" data-action="reveal-card" data-id="${card.id}">答えを表示する</button>`}<div class="review-rating"><button class="rating-btn again" data-action="rate-card" data-id="${card.id}" data-rating="again" ${card.revealed?'':'disabled'}>もう一度</button><button class="rating-btn" data-action="rate-card" data-id="${card.id}" data-rating="hard" ${card.revealed?'':'disabled'}>難しい</button><button class="rating-btn" data-action="rate-card" data-id="${card.id}" data-rating="good" ${card.revealed?'':'disabled'}>できた</button><button class="rating-btn easy" data-action="rate-card" data-id="${card.id}" data-rating="easy" ${card.revealed?'':'disabled'}>簡単</button></div></div>`:'<div class="empty">期限が来た復習カードはありません。新しい項目を登録するか、先の復習予定を確認しましょう。</div>';
    return `${pageHead('SPACED RETRIEVAL','復習で、知識を使える形にする','答えを見る前に思い出す。思い出せた難易度に合わせて、次の復習日を調整します。')}<div class="grid"><section class="panel col-7">${sectionHead('DUE NOW',`今日取り組むカード ${due.length}件`,'<span class="pill yellow">優先</span>')}${reviewCard}<div class="tiny muted section-gap">「もう一度」なら翌日、「難しい」なら短い間隔、「できた／簡単」なら間隔を伸ばします。忘れることは復習の手がかりです。</div></section><section class="panel col-5">${sectionHead('ADD A FLASHCARD','用語・公式・解法を短く登録する')}<form id="reviewForm"><label>科目</label><select name="subject">${subjectOptions('英語')}</select><label>表：何を思い出す？</label><textarea name="front" maxlength="240" required placeholder="例：微分係数の定義は？"></textarea><label>裏：答え・説明</label><textarea name="back" maxlength="500" required placeholder="例：lim(h→0) {f(a+h)-f(a)}/h"></textarea><div class="form-actions"><button class="btn btn-primary" type="submit">復習カードを追加</button></div></form></section><section class="panel col-12">${sectionHead('UPCOMING','これから期限が来る復習')}${upcoming.length?`<div class="stack">${upcoming.map(r=>`<div class="list-card"><div class="list-card-main"><div class="list-title">${esc(r.front)}</div><div class="list-meta"><span class="pill">${esc(r.subject)}</span><span class="pill">次回 ${r.due}</span><span class="pill">間隔 ${r.interval||1}日</span></div><div class="list-actions"><button class="btn btn-small btn-quiet" data-action="edit-card" data-id="${r.id}">編集</button><button class="btn btn-small btn-quiet" data-action="delete-card" data-id="${r.id}">削除</button></div></div></div>`).join('')}</div>`:'<div class="empty">先の復習予定はありません。</div>'}</section><section class="panel col-12">${sectionHead('REVIEW HISTORY','最近の復習記録')}<div class="list-meta"><span class="pill green">累計 ${store.totals.completedReviews||0}回の評価</span><span class="pill">登録カード ${store.reviews.length}枚</span></div></section></div>`;
  }

  function renderAnalysisPage(){
    const last7=totalMinutes(addDays(today,-6),today),last30=totalMinutes(addDays(today,-29),today),prev7=totalMinutes(addDays(today,-13),addDays(today,-7));const weekChange=prev7?Math.round((last7-prev7)/prev7*100):null;const sessions=logsBetween(addDays(today,-6),today).length;const avg=sessions?Math.round(last7/sessions):0;
    const subjectMins={};logsBetween(addDays(today,-6),today).forEach(l=>subjectMins[l.subject]=(subjectMins[l.subject]||0)+l.minutes);
    const subjectRows=store.profile.subjects.map(s=>({s,m:subjectMins[s]||0,target:Number(store.profile.subjectTargets[s])||0})).filter(x=>x.m||x.target>0).sort((a,b)=>b.m-a.m);
    const tests=store.tests.slice().sort((a,b)=>b.date.localeCompare(a.date));
    const insights=buildInsights(last7,prev7,subjectRows,dueReviews().length);
    return `${pageHead('PERFORMANCE REVIEW','学習を分析する','時間だけでなく、計画とのずれ・科目の偏り・テスト結果を見て改善点を探します。')}<div class="stat-grid">${statCard('◷','直近7日間',minsLabel(last7),'','前週 '+(weekChange===null?'比較データなし':(weekChange>=0?'+':'')+weekChange+'%'))}${statCard('▥','直近30日間',minsLabel(last30),'','1日平均 '+minsLabel(Math.round(last30/30)))}${statCard('◎','平均セッション',minsLabel(avg),'','直近7日間 · '+sessions+'回')}${statCard('↻','連続学習',streak(),'日','記録がある日を連続で集計')}</div><div class="grid"><section class="panel col-8">${sectionHead('STUDY TREND','直近7日間の実績')}${weekChartHtml(7,today)}<div class="progress-row"><span>週目標 ${minsLabel(store.profile.weeklyGoal)}</span><strong>${pct(last7,store.profile.weeklyGoal)}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100,pct(last7,store.profile.weeklyGoal))}%"></div></div><div class="divider"></div>${sectionHead('SUBJECT BALANCE','直近7日間の科目別時間')}<div class="subject-bars">${subjectRows.map(x=>`<div class="subject-bar-row"><span>${esc(x.s)}</span><div class="subject-bar-track"><div class="subject-bar-fill" style="width:${Math.max(x.m?2:0,Math.min(100,pct(x.m,Math.max(1,...subjectRows.map(z=>z.m)))))}%"></div></div><strong>${minsLabel(x.m)}</strong></div>`).join('')||'<div class="empty">学習時間を記録すると、科目の配分が表示されます。</div>'}</div></section><section class="panel col-4">${sectionHead('DATA INSIGHTS','記録から見える改善候補')}<p class="tiny muted">以下は保存された記録からのルールベースの提案です。診断や合格判定ではありません。</p>${insights.map(i=>`<div class="insight"><span class="insight-icon">${i.icon}</span><div><strong>${esc(i.title)}</strong><p>${esc(i.body)}</p></div></div>`).join('')}</section><section class="panel col-5">${sectionHead('ADD A TEST','模試・定期テストの結果を記録')}<form id="testForm"><label>テスト名</label><input class="field" name="name" maxlength="100" placeholder="例：全統記述模試" required><div class="form-grid"><div><label>実施日</label><input class="field" type="date" name="date" value="${today}" required></div><div><label>科目</label><select name="subject">${subjectOptions('数学')}</select></div><div><label>得点</label><input class="field" type="number" min="0" step="any" name="score" required></div><div><label>満点</label><input class="field" type="number" min="1" step="any" name="max" value="100" required></div></div><label>振り返り（任意）</label><textarea name="note" maxlength="400" placeholder="失点の原因・次回までに直すこと"></textarea><div class="form-actions"><button class="btn btn-primary" type="submit">結果を保存</button></div></form></section><section class="panel col-7">${sectionHead('TEST HISTORY','科目ごとの推移を確認')}<div class="stack">${tests.length?tests.slice(0,12).map(t=>{const p=t.score/t.max*100;return `<div class="list-card"><div class="list-card-main"><div class="list-title">${esc(t.name)}</div><div class="list-meta"><span class="pill">${t.date}</span><span class="pill">${esc(t.subject)}</span><span class="pill blue">${t.score} / ${t.max}点</span></div><div class="progress-row"><span>得点率</span><strong>${p.toFixed(1)}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100,p)}%"></div></div>${t.note?`<div class="list-note">${esc(t.note)}</div>`:''}<div class="list-actions"><button class="btn btn-small btn-quiet" data-action="delete-test" data-id="${t.id}">削除</button></div></div></div>`;}).join(''):'<div class="empty">模試やテストの結果を登録すると、変化を追跡できます。</div>'}</div></section><section class="panel col-12">${sectionHead('SCORE TREND','最近の模試・テストの得点率')}<div class="score-trend">${testTrendHtml(tests)}</div></section><section class="panel col-12">${sectionHead('HOW TO READ THE DATA','数字は自分を責めるためではなく、次の計画を調整するために使う')}<div class="grid"><div class="col-4"><div class="note-card"><h3>学習時間</h3><p>長さだけでなく、科目・問題演習・復習の内容を合わせて確認します。</p></div></div><div class="col-4"><div class="note-card"><h3>科目バランス</h3><p>週ごとの目標時間と実績を比べ、必要な科目に時間を戻します。</p></div></div><div class="col-4"><div class="note-card"><h3>テスト結果</h3><p>得点率だけで判断せず、失点原因と次に直す行動を記録します。</p></div></div></div></section></div>`;
  }
  function buildInsights(last7,prev7,subjectRows,due){
    const out=[];
    if(due>0)out.push({icon:'↻',title:`期限が来た復習が${due}件`,body:'新しい教材に進む前に、短い時間で期限切れカードを処理すると知識の抜けを見つけやすくなります。'});
    if(last7<store.profile.weeklyGoal)out.push({icon:'◷',title:'週目標との差を確認',body:`今週は目標まであと${minsLabel(store.profile.weeklyGoal-last7)}です。残り日数に合わせ、無理のない量に分割しましょう。`});
    else out.push({icon:'✓',title:'週目標を達成',body:'記録上は週目標に到達しています。時間を増やすより、間違いの解き直しや説明できるかを確認しましょう。'});
    if(prev7>0){const delta=Math.round((last7-prev7)/prev7*100);out.push({icon:'↗',title:'前週との比較',body:delta>=0?`学習時間は前週より${delta}%増えています。継続できた要因を振り返ってください。`:`学習時間は前週より${Math.abs(delta)}%減っています。予定を小さく分け、再開しやすい最初の一歩を作りましょう。`});}
    const absent=subjectRows.filter(x=>x.target>0&&x.m===0).slice(0,3);
    if(absent.length)out.push({icon:'△',title:'今週まだ記録がない科目',body:absent.map(x=>x.s).join('・')+'です。予定を確認し、必要な科目なら短い演習から再開します。'});
    if(!out.length)out.push({icon:'◎',title:'記録が蓄積中',body:'学習時間・復習・テストを続けて記録すると、より具体的な傾向を確認できます。'});
    return out.slice(0,4);
  }

  function testTrendHtml(tests){
    const data=tests.slice(0,10).reverse();
    if(!data.length)return '<div class="empty">テスト結果を登録すると得点率の推移を表示します。</div>';
    return `<div class="score-trend-grid">${data.map(t=>{const p=Math.max(0,Math.min(100,t.score/t.max*100));return `<div class="score-trend-item"><div class="score-trend-percent">${p.toFixed(0)}%</div><div class="score-trend-track"><div class="score-trend-fill" style="height:${p}%"></div></div><div class="score-trend-label">${esc(t.subject)}<br>${esc(t.date.slice(5))}</div></div>`;}).join('')}</div>`;
  }

  function renderNotesPage(){
    const mistakes=store.mistakes.slice().sort((a,b)=>(a.nextReview||a.date).localeCompare(b.nextReview||b.date));const due=mistakes.filter(m=>m.status!=='done'&&(!m.nextReview||m.nextReview<=today));
    const notes=store.notes.slice().sort((a,b)=>b.date.localeCompare(a.date));
    return `${pageHead('ERROR LOG & KNOWLEDGE','間違いを、次の得点力に変える','間違えた原因と修正方法を残し、解き直して初めて「改善した」と判断します。')}<div class="grid"><section class="panel col-5">${sectionHead('ADD A MISTAKE','原因・修正策まで記録する')}<form id="mistakeForm"><label>科目</label><select name="subject">${subjectOptions('数学')}</select><label>単元</label><input class="field" name="unit" maxlength="80" placeholder="例：数列・漸化式"><label>問題・間違えた内容</label><textarea name="question" maxlength="400" required placeholder="何を問われ、どこで間違えたか"></textarea><label>間違いの原因</label><select name="cause"><option>知識・公式が不足</option><option>解法の方針が立たない</option><option>計算ミス</option><option>問題文の読み違い</option><option>時間配分</option><option>理解があいまい</option><option>その他</option></select><label>修正策・次にやること</label><textarea name="lesson" maxlength="500" placeholder="例：公式を何も見ずに書き、類題を翌日に解く"></textarea><label>次に解き直す日</label><input class="field" type="date" name="nextReview" value="${addDays(today,1)}"><div class="form-actions"><button class="btn btn-primary" type="submit">間違いノートに保存</button></div></form></section><section class="panel col-7">${sectionHead('RETRY QUEUE',`解き直し対象 ${due.length}件`)}<div class="stack">${mistakes.length?mistakes.map(m=>`<div class="list-card"><div class="list-card-main"><div class="list-title">${esc(m.question)}</div><div class="list-meta"><span class="pill">${esc(m.subject)}</span>${m.unit?`<span class="pill">${esc(m.unit)}</span>`:''}<span class="pill ${m.status==='done'?'green':'yellow'}">${m.status==='done'?'解き直し済み':'未解き直し'}</span><span class="pill">次回 ${m.nextReview||'未設定'}</span></div><div class="list-note"><b>原因：</b>${esc(m.cause)}<br><b>修正策：</b>${esc(m.lesson||'未記入')}</div><div class="list-actions"><button class="btn btn-small ${m.status==='done'?'btn-soft':'btn-primary'}" data-action="retry-mistake" data-id="${m.id}">${m.status==='done'?'再び未完了に':'解き直した'}</button><button class="btn btn-small btn-quiet" data-action="delete-mistake" data-id="${m.id}">削除</button></div></div></div>`).join(''):'<div class="empty">まだ間違いの記録はありません。解けなかった問題を残すことから始めましょう。</div>'}</div></section><section class="panel col-5">${sectionHead('KNOWLEDGE NOTE','理解したことを自分の言葉で残す')}<form id="noteForm"><label>科目</label><select name="subject">${subjectOptions('数学')}</select><label>テーマ・見出し</label><input class="field" name="title" maxlength="100" required placeholder="例：合成関数の微分"><label>自分の言葉で説明する</label><textarea name="body" maxlength="1000" required placeholder="要点・なぜそうなるか・例を記録"></textarea><div class="form-actions"><button class="btn btn-primary" type="submit">知識ノートを保存</button></div></form></section><section class="panel col-7">${sectionHead('MY KNOWLEDGE','自分で説明できる知識を蓄積する')}<div class="stack">${notes.length?notes.map(n=>`<article class="note-card"><div class="list-meta"><span class="pill">${esc(n.subject)}</span><span class="pill">${n.date}</span></div><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p><div class="list-actions"><button class="btn btn-small btn-quiet" data-action="note-to-card" data-id="${n.id}">復習カードにする</button><button class="btn btn-small btn-quiet" data-action="delete-note" data-id="${n.id}">削除</button></div></article>`).join(''):'<div class="empty">学んだ内容を自分の言葉で説明して保存しましょう。</div>'}</div></section></div>`;
  }

  function renderSettingsPage(){
    const p=store.profile;const pref=store.preferences;
    return `${pageHead('PERSONAL SETTINGS','自分の学習環境を整える','目標・科目・タイマー設定を調整し、記録を安全に保管します。')}<div class="grid"><section class="panel col-6">${sectionHead('YOUR GOAL','目標と学習量を設定する')}<form id="profileForm"><label>志望校・目標</label><input class="field" name="target" maxlength="100" value="${esc(p.target)}"><label>受験・目標日（任意）</label><input class="field" type="date" name="examDate" value="${esc(p.examDate||'')}"><div class="form-grid"><div><label>1日の学習目標（分）</label><input class="field" name="dailyGoal" type="number" min="30" max="900" step="30" value="${p.dailyGoal}"></div><div><label>1週間の学習目標（分）</label><input class="field" name="weeklyGoal" type="number" min="60" max="6000" step="60" value="${p.weeklyGoal}"></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">目標を保存</button></div></form><div class="divider"></div>${sectionHead('SUBJECTS','使う科目をカンマ区切りで設定')}<form id="subjectsForm"><label>科目一覧</label><textarea name="subjects" maxlength="500">${esc(p.subjects.join('、'))}</textarea><p class="tiny muted">例：数学、英語、国語、物理、化学、地理、情報</p><button class="btn btn-soft" type="submit">科目一覧を更新</button></form><div class="divider"></div>${sectionHead('WEEKLY SUBJECT TARGETS','科目ごとの目標時間（週）')}<form id="subjectTargetsForm"><div class="form-grid">${p.subjects.map(s=>`<div><label>${esc(s)}（分／週）</label><input class="field" type="number" min="0" max="3000" step="30" name="target:${esc(s)}" value="${Number(p.subjectTargets[s])||0}"></div>`).join('')}</div><div class="form-actions"><button class="btn btn-soft" type="submit">科目別目標を保存</button></div></form></section><section class="panel col-6">${sectionHead('FOCUS TIMER','集中・休憩の標準時間')}<form id="timerSettingsForm"><div class="form-grid"><div><label>集中（分）</label><input class="field" name="focusMinutes" type="number" min="5" max="120" value="${pref.focusMinutes}"></div><div><label>短い休憩（分）</label><input class="field" name="shortBreak" type="number" min="1" max="30" value="${pref.shortBreak}"></div><div><label>長い休憩（分）</label><input class="field" name="longBreak" type="number" min="5" max="60" value="${pref.longBreak}"></div><div><label>長い休憩までの集中回数</label><input class="field" name="sessionsPerLongBreak" type="number" min="2" max="8" value="${pref.sessionsPerLongBreak}"></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">タイマー設定を保存</button></div></form><div class="divider"></div>${sectionHead('NOTIFICATIONS','タイマー終了を知らせる')}<label class="checkline"><input type="checkbox" id="notificationToggle" ${pref.notifications?'checked':''}> 通知を許可する（ブラウザが対応している場合）</label><p class="tiny muted">通知はブラウザの許可が必要です。端末や省電力設定によっては表示されない場合があります。</p><div class="divider"></div>${sectionHead('DATA STORAGE','端末内のデータを保護する')}<p class="small muted">学習記録はこのブラウザの保存領域に保存されます。端末変更・ブラウザ初期化の前に、JSONバックアップを作成してください。</p><div class="form-actions"><button class="btn btn-soft" data-action="install-app" ${deferredInstallPrompt?'':'disabled'}>${deferredInstallPrompt?'ホーム画面にインストール':'Chromeメニューからホーム画面に追加'}</button></div><p class="tiny muted">Android：Chromeで公開URLを開き、メニュー →「アプリをインストール」または「ホーム画面に追加」を選びます。</p><div class="form-actions"><button class="btn btn-primary" data-action="export-json">JSONバックアップ</button><button class="btn btn-soft" data-action="export-csv">学習ログCSV</button><button class="btn" data-action="import-json">バックアップ読込</button></div><div class="form-actions"><button class="btn btn-soft" data-action="persist-storage">保存領域の保護を依頼</button></div><p class="tiny muted" id="storageInfo">保存容量の状態を確認できます。</p></section><section class="panel col-12 danger-zone">${sectionHead('DATA RESET','データの初期化')}<p class="small muted">初期化すると、このアプリに保存された学習記録・計画・復習・テスト結果がすべて削除されます。実行前にバックアップしてください。</p><button class="btn btn-danger" data-action="reset-data">すべてのデータを削除</button></section><section class="panel col-12">${sectionHead('DIGITAL WELLBEING','スマホ・動画との距離をつくる')}<div class="grid"><div class="col-6"><div class="note-card"><h3>Androidの設定を使う</h3><p>設定 → Digital Wellbeing（デジタルウェルビーイング）→ アプリタイマーから、YouTubeの利用時間を設定できます。機種によりメニュー名は異なります。</p></div></div><div class="col-6"><div class="note-card"><h3>勉強を始める前の環境</h3><p>スマホを別の場所に置く／通知を切る／休憩中も動画アプリを開かない時間を決める。アプリは他アプリを強制停止できません。</p></div></div></div></section></div>`;
  }

  function bindViewInputs(){
    const date=$('viewDateInput');if(date)date.addEventListener('change',()=>{viewDate=date.value||today;render();});
    const priority=$('dailyPriority');if(priority)priority.addEventListener('input',()=>{dayData(viewDate).priority=priority.value;scheduleSave();});
    const taskForm=$('taskForm');if(taskForm)taskForm.addEventListener('submit',e=>{e.preventDefault();const input=taskForm.elements.task;const text=input.value.trim();if(!text)return;dayData(viewDate).tasks.push({id:uid(),text,priority:false,done:false});saveStore();render();toast('今日のタスクを追加しました。');});
    const planForm=$('planForm');if(planForm)planForm.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(planForm);const title=String(f.get('title')||'').trim();const minutes=Number(f.get('minutes'));if(!title||minutes<5||minutes>600){toast('内容と5〜600分の予定時間を入力してください。',true);return;}store.plans.push({id:uid(),date:String(f.get('date')),subject:String(f.get('subject')),title,minutes,priority:String(f.get('priority')),status:'todo',actualMin:0,createdAt:new Date().toISOString()});saveStore();render();toast('学習計画を追加しました。');});
    const reviewForm=$('reviewForm');if(reviewForm)reviewForm.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(reviewForm);store.reviews.push({id:uid(),subject:String(f.get('subject')),front:String(f.get('front')).trim(),back:String(f.get('back')).trim(),due:today,interval:1,stage:0,history:[],createdAt:new Date().toISOString()});saveStore();render();toast('復習カードを登録しました。');});
    const mistakeForm=$('mistakeForm');if(mistakeForm)mistakeForm.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(mistakeForm);store.mistakes.push({id:uid(),date:today,subject:String(f.get('subject')),unit:String(f.get('unit')),question:String(f.get('question')).trim(),cause:String(f.get('cause')),lesson:String(f.get('lesson')),status:'todo',retryCount:0,nextReview:String(f.get('nextReview'))||addDays(today,1),createdAt:new Date().toISOString()});saveStore();render();toast('間違いノートに保存しました。');});
    const noteForm=$('noteForm');if(noteForm)noteForm.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(noteForm);store.notes.push({id:uid(),date:today,subject:String(f.get('subject')),title:String(f.get('title')).trim(),body:String(f.get('body')).trim()});saveStore();render();toast('知識ノートを保存しました。');});
    const testForm=$('testForm');if(testForm)testForm.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(testForm);const score=Number(f.get('score')),max=Number(f.get('max'));if(!Number.isFinite(score)||!Number.isFinite(max)||max<=0||score<0||score>max){toast('得点は0点以上、満点以下で入力してください。',true);return;}store.tests.push({id:uid(),name:String(f.get('name')).trim(),date:String(f.get('date')),subject:String(f.get('subject')),score,max,note:String(f.get('note'))});saveStore();render();toast('テスト結果を保存しました。');});
    const profileForm=$('profileForm');if(profileForm)profileForm.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(profileForm);store.profile.target=String(f.get('target')).trim()||'学習目標';store.profile.examDate=String(f.get('examDate'));store.profile.dailyGoal=clamp(f.get('dailyGoal'),30,900);store.profile.weeklyGoal=clamp(f.get('weeklyGoal'),60,6000);saveStore();render();toast('目標を保存しました。');});
    const subjectsForm=$('subjectsForm');if(subjectsForm)subjectsForm.addEventListener('submit',e=>{e.preventDefault();const names=String(new FormData(subjectsForm).get('subjects')).split(/[、,，\n]/).map(s=>s.trim()).filter(Boolean).slice(0,20);if(!names.length){toast('科目を1つ以上入力してください。',true);return;}const unique=[...new Set(names)];const targets={};unique.forEach(s=>targets[s]=store.profile.subjectTargets[s]||0);store.profile.subjects=unique;store.profile.subjectTargets=targets;saveStore();render();toast('科目一覧を更新しました。');});
    const subjectTargetsForm=$('subjectTargetsForm');if(subjectTargetsForm)subjectTargetsForm.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(subjectTargetsForm);store.profile.subjects.forEach(s=>store.profile.subjectTargets[s]=clamp(f.get(`target:${s}`),0,3000));saveStore();render();toast('科目別目標を保存しました。');});
    const timerSettings=$('timerSettingsForm');if(timerSettings)timerSettings.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(timerSettings);store.preferences.focusMinutes=clamp(f.get('focusMinutes'),5,120);store.preferences.shortBreak=clamp(f.get('shortBreak'),1,30);store.preferences.longBreak=clamp(f.get('longBreak'),5,60);store.preferences.sessionsPerLongBreak=clamp(f.get('sessionsPerLongBreak'),2,8);saveStore();render();toast('タイマー設定を保存しました。');});
    const notif=$('notificationToggle');if(notif)notif.addEventListener('change',async()=>{if(notif.checked&&'Notification'in window){const permission=await Notification.requestPermission();store.preferences.notifications=permission==='granted';notif.checked=store.preferences.notifications;if(!store.preferences.notifications)toast('通知は許可されませんでした。',true);}else{store.preferences.notifications=false;}saveStore();});
    document.querySelectorAll('[data-reflection]').forEach(input=>input.addEventListener('input',()=>{const r=dayData(viewDate).reflection;r[input.name]=input.type==='range'?Number(input.value):input.value;scheduleSave();}));
    const subj=$('timerSubject'),dur=$('timerDuration');if(subj)subj.addEventListener('change',()=>{if(!store.timer)store.timerDraftSubject=subj.value;});if(dur)dur.addEventListener('change',()=>{if(!store.timer){store.timerDraftDuration=clamp(dur.value,5,120);const display=$('timerDisplay');if(display)display.textContent=clockText(store.timerDraftDuration*60);}});
    if($('storageInfo')&&navigator.storage?.estimate){navigator.storage.estimate().then(x=>{$('storageInfo').textContent=`ブラウザ保存領域の目安：${Math.round((x.usage||0)/1024)} KB 使用 / ${Math.round((x.quota||0)/1024/1024)} MB 利用可能`;}).catch(()=>{});}
  }
  function clamp(v,min,max){const n=Math.round(Number(v));return Number.isFinite(n)?Math.min(max,Math.max(min,n)):min;}

  function openDialog(title,eyebrow,html){$('dialogTitle').textContent=title;$('dialogEyebrow').textContent=eyebrow;$('dialogBody').innerHTML=html;const dlg=$('appDialog');if(!dlg.open)dlg.showModal();}
  function closeDialog(){const dlg=$('appDialog');if(dlg.open)dlg.close();}
  function openManualLog(){openDialog('学習時間を記録','QUICK LOG',`<form id="manualLogForm" class="modal-form"><label>日付</label><input class="field" type="date" name="date" value="${today}" required><label>科目</label><select name="subject">${subjectOptions('数学')}</select><label>学習時間（分）</label><input class="field" type="number" name="minutes" min="1" max="1440" value="30" required><label>内容・メモ（任意）</label><textarea name="note" maxlength="300" placeholder="例：青チャートの例題 4〜6"></textarea><div class="form-actions"><button class="btn btn-primary" type="submit">記録する</button><button class="btn btn-quiet" type="button" data-action="close-dialog">キャンセル</button></div></form>`);}
  function startTimer(opts={}){
    if(store.timer&&!store.timer.paused){toast('タイマーはすでに動いています。',true);return;}
    if(store.timer&&store.timer.paused){store.timer.paused=false;store.timer.endAt=Date.now()+store.timer.remainingSec*1000;saveStore();ensureClock();updateHeader();render();toast('タイマーを再開しました。');return;}
    const mode=opts.mode||'focus';const duration=opts.durationSec||(mode==='focus'?(store.timerDraftDuration||store.preferences.focusMinutes)*60:store.preferences.shortBreak*60);
    store.timer={mode,durationSec:duration,remainingSec:duration,endAt:Date.now()+duration*1000,paused:false,subject:opts.subject||$('timerSubject')?.value||store.timerDraftSubject||'数学',planId:opts.planId||null,date:today,startedAt:new Date().toISOString()};
    saveStore();ensureClock();updateHeader();render();toast(mode==='focus'?'集中セッションを開始しました。':'休憩を開始しました。');
  }
  function toggleTimer(){
    const t=store.timer;
    if(!t){startTimer();return;}
    if(t.paused){t.paused=false;t.endAt=Date.now()+t.remainingSec*1000;toast('タイマーを再開しました。');}
    else{t.remainingSec=timerRemaining(t);t.paused=true;t.endAt=null;toast('タイマーを一時停止しました。');}
    saveStore();updateHeader();render();ensureClock();
  }
  function finishTimer(partial=true){
    const t=store.timer;if(!t)return;
    const remaining=timerRemaining(t);const elapsed=Math.max(0,t.durationSec-remaining);const mins=partial?Math.floor(elapsed/60):Math.round(t.durationSec/60);
    if(t.mode==='focus'&&mins>0){addLog({date:t.date||today,minutes:mins,subject:t.subject,source:'timer-partial',note:'タイマーから記録',planId:t.planId,startAt:t.startedAt});store.totals.focusSessions=(store.totals.focusSessions||0)+1;}
    else if(t.mode==='focus'&&mins===0){toast('1分未満のため、学習時間は記録しませんでした。');}
    store.timer=null;saveStore();stopClock();render();if(t.mode==='focus'&&mins>0)toast(`${mins}分を${t.subject}の学習時間に記録しました。`);else if(t.mode==='break')toast('休憩を終了しました。');
  }
  function completeTimer(){
    const t=store.timer;if(!t)return;
    if(t.mode==='focus'){
      const mins=Math.max(1,Math.round(t.durationSec/60));addLog({date:t.date||today,minutes:mins,subject:t.subject,source:'timer',note:'集中タイマー完了',planId:t.planId});store.totals.focusSessions=(store.totals.focusSessions||0)+1;
      store.lastTimerMode='focus';store.lastTimerAt=new Date().toISOString();
    }else{store.lastTimerMode='break';store.lastTimerAt=new Date().toISOString();}
    store.timer=null;saveStore();stopClock();render();
    if(t.mode==='focus'){
      toast(`${Math.round(t.durationSec/60)}分の集中を記録しました。次は短い休憩を。`);
      if(store.preferences.notifications&&'Notification'in window&&Notification.permission==='granted')try{new Notification('集中セッション完了',{body:`${t.subject}を${Math.round(t.durationSec/60)}分記録しました。`});}catch(e){}
    }else toast('休憩が終了しました。次のセッションに戻れます。');
  }
  function ensureClock(){if(clockInterval)return;clockInterval=setInterval(()=>{
    const t=store.timer;if(!t){stopClock();return;}
    if(!t.paused&&timerRemaining(t)<=0){completeTimer();return;}
    updateHeader();const display=$('timerDisplay');if(display)display.textContent=clockText(timerRemaining(t));const cap=$('timerCaption');if(cap)cap.textContent=t.paused?'一時停止中':t.mode==='focus'?'集中を続けましょう':'休憩中';const ring=$('timerRing');if(ring)ring.style.setProperty('--timer-progress',`${Math.min(100,Math.max(0,100-timerRemaining(t)/t.durationSec*100))}%`);
  },250);}
  function stopClock(){if(clockInterval){clearInterval(clockInterval);clockInterval=null;}updateHeader();}
  function startPlan(p){if(store.timer&&!confirm('進行中のタイマーを終了して、この計画を開始しますか？'))return;if(store.timer){store.timer=null;stopClock();}const duration=Math.max(5,Math.min(180,p.minutes))*60;startTimer({mode:'focus',durationSec:duration,subject:p.subject,planId:p.id});}
  function changePlanStatus(id,status){const p=store.plans.find(x=>x.id===id);if(!p)return;p.status=status;p.completedAt=status==='done'?today:null;saveStore();render();toast(status==='done'?'計画を完了にしました。':'計画を未完了に戻しました。');}
  function gradeCard(id,rating){const c=store.reviews.find(x=>x.id===id);if(!c)return;const current=Math.max(1,Number(c.interval)||1);let next=1;
    if(rating==='again'){c.stage=0;next=1;}
    if(rating==='hard'){c.stage=Math.max(0,c.stage||0);next=Math.max(1,Math.ceil(current*1.25));}
    if(rating==='good'){c.stage=(c.stage||0)+1;next=[1,3,7,14,30,60,90][Math.min(c.stage-1,6)]||90;}
    if(rating==='easy'){c.stage=(c.stage||0)+2;next=Math.max(4,Math.ceil(current*2.2));}
    c.interval=next;c.due=addDays(today,next);c.lastReviewed=today;c.revealed=false;c.history=c.history||[];c.history.push({date:today,rating,interval:next});store.totals.completedReviews=(store.totals.completedReviews||0)+1;saveStore();render();toast(`${next}日後に再確認します。`);
  }
  function exportJSON(){store.meta.lastBackupAt=new Date().toISOString();saveStore();const blob=new Blob([JSON.stringify(store,null,2)],{type:'application/json'});downloadBlob(blob,`study-loop-backup-${today}.json`);toast('JSONバックアップを書き出しました。');}
  function exportCSV(){const rows=[['日付','科目','分','記録方法','メモ']];logsBetween('0000-01-01','9999-12-31').forEach(l=>rows.push([l.date,l.subject,l.minutes,l.source,l.note||'']));const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),`study-loop-logs-${today}.csv`);toast('学習ログCSVを書き出しました。');}
  function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  function importJSON(file){const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(reader.result);if(!parsed||typeof parsed!=='object'||!parsed.days||typeof parsed.days!=='object')throw new Error('format');const restored=parsed.profile?normalizeStore(parsed):migrateLegacy(parsed);if(!confirm('現在のデータを読み込んだバックアップで置き換えます。続行しますか？'))return;store=restored;saveStore();viewDate=today;render();toast('バックアップを読み込みました。');}catch(e){toast('読み込めませんでした。有効なSTUDY LOOPのJSONを選択してください。',true);}};reader.readAsText(file);}
  function createEditPlan(id){const p=store.plans.find(x=>x.id===id);if(!p)return;openDialog('計画を編集','EDIT PLAN',`<form id="editPlanForm" class="modal-form"><input type="hidden" name="id" value="${p.id}"><label>日付</label><input class="field" type="date" name="date" value="${p.date}"><label>科目</label><select name="subject">${subjectOptions(p.subject)}</select><label>取り組む内容</label><input class="field" name="title" maxlength="140" value="${esc(p.title)}" required><div class="form-grid"><div><label>予定時間（分）</label><input class="field" type="number" name="minutes" min="5" max="600" value="${p.minutes}"></div><div><label>優先度</label><select name="priority"><option value="normal" ${p.priority!=='high'?'selected':''}>通常</option><option value="high" ${p.priority==='high'?'selected':''}>最優先</option></select></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">変更を保存</button><button class="btn btn-quiet" type="button" data-action="close-dialog">キャンセル</button></div></form>`);}
  function createEditCard(id){const c=store.reviews.find(x=>x.id===id);if(!c)return;openDialog('復習カードを編集','EDIT FLASHCARD',`<form id="editCardForm" class="modal-form"><input type="hidden" name="id" value="${c.id}"><label>科目</label><select name="subject">${subjectOptions(c.subject)}</select><label>表</label><textarea name="front" maxlength="240" required>${esc(c.front)}</textarea><label>裏</label><textarea name="back" maxlength="500" required>${esc(c.back)}</textarea><div class="form-actions"><button class="btn btn-primary" type="submit">変更を保存</button><button class="btn btn-quiet" type="button" data-action="close-dialog">キャンセル</button></div></form>`);}

  document.addEventListener('click',e=>{
    const a=e.target.closest('[data-action]');if(!a)return;const action=a.dataset.action;const id=a.dataset.id;
    if(action==='go-home')setRoute('home');
    else if(action==='go-plan')setRoute('plan');
    else if(action==='go-review')setRoute('review');
    else if(action==='go-settings')setRoute('settings');
    else if(action==='date-shift'){viewDate=addDays(viewDate,Number(a.dataset.delta)||0);render();}
    else if(action==='date-today'){viewDate=today;render();}
    else if(action==='choose-date'){viewDate=a.dataset.date;render();}
    else if(action==='toggle-task'){const t=dayData(viewDate).tasks.find(x=>x.id===id);if(t){t.done=a.checked;saveStore();render();}}
    else if(action==='delete-task'){const d=dayData(viewDate);d.tasks=d.tasks.filter(x=>x.id!==id);saveStore();render();}
    else if(action==='add-task-prompt'){openDialog('タスクを追加','DAILY ACTION',`<form id="dialogTaskForm"><label>次に行う具体的な行動</label><input class="field" name="text" maxlength="100" required placeholder="例：英単語を20語テストする"><label class="checkline"><input type="checkbox" name="priority"> 最優先タスクにする</label><div class="form-actions"><button class="btn btn-primary" type="submit">追加</button></div></form>`);}
    else if(action==='start-quick'){if(store.timer){if(!confirm('現在のタイマーを終了して、5分タイマーを始めますか？'))return;store.timer=null;saveStore();stopClock();}startTimer({mode:'focus',durationSec:5*60,subject:$('timerSubject')?.value||store.timerDraftSubject||'数学'});}
    else if(action==='timer-toggle')toggleTimer();
    else if(action==='timer-finish'){if(confirm('ここまでの学習時間を記録してタイマーを終了しますか？'))finishTimer(true);}
    else if(action==='timer-reset'){if(confirm('タイマーをリセットします。経過時間は記録されません。続けますか？')){store.timer=null;saveStore();stopClock();render();}}
    else if(action==='start-break'){if(store.timer){if(!confirm('進行中のタイマーを終了して、休憩を開始しますか？'))return;store.timer=null;saveStore();stopClock();}const total=Number(store.totals.focusSessions||0),long=total>0&&total%Number(store.preferences.sessionsPerLongBreak||4)===0;const mins=long?store.preferences.longBreak:store.preferences.shortBreak;startTimer({mode:'break',durationSec:mins*60});}
    else if(action==='start-plan'){const p=store.plans.find(x=>x.id===id);if(p)startPlan(p);}
    else if(action==='complete-plan')changePlanStatus(id,'done');
    else if(action==='reopen-plan')changePlanStatus(id,'todo');
    else if(action==='edit-plan')createEditPlan(id);
    else if(action==='delete-plan'){if(confirm('この学習計画を削除しますか？')){store.plans=store.plans.filter(x=>x.id!==id);saveStore();render();}}
    else if(action==='reveal-card'){const c=store.reviews.find(x=>x.id===id);if(c){c.revealed=true;render();}}
    else if(action==='rate-card')gradeCard(id,a.dataset.rating);
    else if(action==='edit-card')createEditCard(id);
    else if(action==='delete-card'){if(confirm('この復習カードを削除しますか？')){store.reviews=store.reviews.filter(x=>x.id!==id);saveStore();render();}}
    else if(action==='retry-mistake'){const m=store.mistakes.find(x=>x.id===id);if(m){m.status=m.status==='done'?'todo':'done';if(m.status==='done'){m.retryCount=(m.retryCount||0)+1;m.lastRetried=today;}else m.nextReview=addDays(today,1);saveStore();render();toast(m.status==='done'?'解き直し済みにしました。':'再確認リストに戻しました。');}}
    else if(action==='delete-mistake'){if(confirm('この間違い記録を削除しますか？')){store.mistakes=store.mistakes.filter(x=>x.id!==id);saveStore();render();}}
    else if(action==='note-to-card'){const n=store.notes.find(x=>x.id===id);if(n){store.reviews.push({id:uid(),subject:n.subject,front:n.title,back:n.body,due:today,interval:1,stage:0,history:[]});saveStore();setRoute('review');toast('知識ノートから復習カードを作成しました。');}}
    else if(action==='delete-note'){if(confirm('この知識ノートを削除しますか？')){store.notes=store.notes.filter(x=>x.id!==id);saveStore();render();}}
    else if(action==='delete-test'){if(confirm('このテスト結果を削除しますか？')){store.tests=store.tests.filter(x=>x.id!==id);saveStore();render();}}
    else if(action==='log-urge'||action==='log-slip'){const d=dayData(today);d.distractions.push({id:uid(),type:action==='log-urge'?'urge':'slip',time:new Date().toISOString()});saveStore();render();toast(action==='log-urge'?'衝動を記録しました。スマホを遠ざけて5分だけ始めましょう。':'視聴を記録しました。ここで区切り、次の行動に戻りましょう。');}
    else if(action==='install-app'){if(deferredInstallPrompt){deferredInstallPrompt.prompt();deferredInstallPrompt.userChoice.then(choice=>{if(choice.outcome==='accepted')toast('インストールを開始しました。');deferredInstallPrompt=null;render();}).catch(()=>{});}else toast('Chromeのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。');}
    else if(action==='export-json')exportJSON();
    else if(action==='export-csv')exportCSV();
    else if(action==='import-json')$('importInput').click();
    else if(action==='persist-storage'){if(navigator.storage?.persist){navigator.storage.persist().then(ok=>toast(ok?'ブラウザに保存領域の保護が許可されました。':'ブラウザは保存領域の保護を許可しませんでした。',!ok));}else toast('このブラウザは保存領域の保護に対応していません。',true);}
    else if(action==='reset-data'){if(confirm('本当にすべてのデータを削除しますか？この操作は取り消せません。')&&confirm('最後の確認です。バックアップを取ったうえで、完全に削除しますか？')){store=defaultStore();localStorage.removeItem(LEGACY_KEY);saveStore();viewDate=today;render();toast('データを初期化しました。');}}
    else if(action==='close-dialog')closeDialog();
    else if(action==='go-route')setRoute(a.dataset.route);
  });
  document.addEventListener('submit',e=>{
    if(e.target.id==='manualLogForm'){
      e.preventDefault();const f=new FormData(e.target);const minutes=Number(f.get('minutes'));if(minutes<1||minutes>1440){toast('1〜1440分で入力してください。',true);return;}addLog({date:String(f.get('date')),minutes,subject:String(f.get('subject')),source:'manual',note:String(f.get('note'))});closeDialog();render();toast(`${minutes}分を記録しました。`);
    }
    if(e.target.id==='dialogTaskForm'){
      e.preventDefault();const f=new FormData(e.target);const text=String(f.get('text')).trim();if(text){dayData(viewDate).tasks.push({id:uid(),text,priority:f.get('priority')==='on',done:false});saveStore();closeDialog();render();toast('タスクを追加しました。');}
    }
    if(e.target.id==='editPlanForm'){
      e.preventDefault();const f=new FormData(e.target),p=store.plans.find(x=>x.id===String(f.get('id')));if(p){const min=Number(f.get('minutes'));if(min<5||min>600){toast('予定時間は5〜600分です。',true);return;}Object.assign(p,{date:String(f.get('date')),subject:String(f.get('subject')),title:String(f.get('title')).trim(),minutes:min,priority:String(f.get('priority'))});saveStore();closeDialog();render();toast('計画を更新しました。');}
    }
    if(e.target.id==='editCardForm'){
      e.preventDefault();const f=new FormData(e.target),c=store.reviews.find(x=>x.id===String(f.get('id')));if(c){Object.assign(c,{subject:String(f.get('subject')),front:String(f.get('front')).trim(),back:String(f.get('back')).trim()});saveStore();closeDialog();render();toast('復習カードを更新しました。');}
    }
  });
  $('quickAddButton').addEventListener('click',openManualLog);
  $('importInput').addEventListener('change',e=>{const file=e.target.files&&e.target.files[0];if(file)importJSON(file);e.target.value='';});
  $('appDialog').addEventListener('click',e=>{if(e.target===$('appDialog'))closeDialog();});
  window.addEventListener('hashchange',()=>{route=location.hash.replace('#','')||'home';if(!['home','plan','review','analysis','notes','settings'].includes(route))route='home';render();});
  window.addEventListener('beforeunload',()=>{if(store.timer&&!store.timer.paused){store.timer.remainingSec=timerRemaining(store.timer);store.timer.endAt=Date.now()+store.timer.remainingSec*1000;}saveStore();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){checkDateRollover();if(store.timer&&!store.timer.paused&&timerRemaining(store.timer)<=0)completeTimer();}});
  setInterval(checkDateRollover,30000);

  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;if(route==='settings')render();});
  window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;toast('STUDY LOOPをホーム画面に追加しました。');if(route==='settings')render();});

  // Restore a timer across refreshes and keep the countdown based on a deadline, not interval drift.
  if(store.timer){if(!store.timer.paused&&timerRemaining(store.timer)<=0)completeTimer();else ensureClock();}
  render();
  if('serviceWorker'in navigator&&(location.protocol==='https:'||location.hostname==='localhost'))window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));
})();
