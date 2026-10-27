import {CLOUD_KEYS,collectCloudData,nonEmptyCloudData,validateCloudData} from './cloud-schema.js';
// Conservative synchronization: compare-and-swap on the server; no silent last-writer-wins.
export function createCloudSync({storage,fetcher=globalThis.fetch,download,onApply,onStatus,api='/api/state',loc=location}){
  const revisionKey='toki-sync-ack-revision-v1',pendingKey='toki-sync-pending-v1';
  const online=['https:','http:'].includes(loc.protocol);
  let status=online?'loading':'local',detail='',revision=0,remote=null,acked='',backed=false,dirty=false,posting=false,scheduled=null,refreshing=false;
  const snapshot=()=>JSON.stringify(collectCloudData(storage));
  const announce=(next,message='')=>{status=next;detail=message;onStatus?.(status,detail);};
  const localData=()=>collectCloudData(storage);
  const canWrite=()=>!online||['local','setup','ready','dirty'].includes(status);
  const beforeWrite=key=>{if(CLOUD_KEYS.includes(key)&&!canWrite())throw Error('クラウド同期を確認できません。上部の同期状態を確認してから操作してください。');};
  function afterWrite(key){if(!CLOUD_KEYS.includes(key)||status==='local'||!online)return;if(status==='setup'){backed=false;onStatus?.(status,detail);return;}dirty=true;storage.setItem(pendingKey,'1');announce('dirty','この端末に保存済み・クラウドへ送信中');schedule();}
  const setItem=(key,value)=>{beforeWrite(key);storage.setItem(key,value);afterWrite(key);};
  function apply(data){validateCloudData(data);for(const key of CLOUD_KEYS)storage.setItem(key,data.sections[key]);onApply?.();}
  async function request(method='GET',body){const res=await fetcher(api,{method,credentials:'same-origin',cache:'no-store',headers:method==='POST'?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});if(res.status===404)return {unavailable:true};const result=await res.json().catch(()=>({error:`通信エラー (${res.status})`}));return {...result,ok:res.ok,statusCode:res.status};}
  function saveAck(){acked=snapshot();dirty=false;storage.removeItem(pendingKey);storage.setItem(revisionKey,String(revision));announce('ready','クラウドに保存済み');}
  function schedule(){if(scheduled)clearTimeout(scheduled);scheduled=setTimeout(()=>{scheduled=null;flush();},250);}
  async function flush(){if(posting||!dirty||!['ready','dirty'].includes(status))return;posting=true;const sent=snapshot();try{
      const payload=JSON.parse(sent);const answer=await request('POST',{baseRevision:revision,payload});
      if(answer.statusCode===409){announce('conflict','他端末の変更と競合しました。端末内の内容は保持しています。');return;}
      if(!answer.ok)throw Error(answer.error||'送信に失敗しました。');
      revision=answer.revision;storage.setItem(revisionKey,String(revision));acked=sent;
      if(snapshot()===sent){saveAck();}else{dirty=true;announce('dirty','追加の変更を同期しています');schedule();}
    }catch(e){announce('error','クラウド未同期です。端末内の変更は残っています。'+e.message);}finally{posting=false;}}
  async function init(){if(!online){announce('local','端末内のみで動作します。');return;}
    announce('loading','クラウドの保存状態を確認中');
    try{const answer=await request();if(answer.unavailable){announce('local','このURLにクラウドAPIがありません。端末内のみで保存します。');return;}
      if(!answer.ok)throw Error(answer.error||'クラウドAPIが応答しません。');
      if(!Number.isSafeInteger(answer.revision)||answer.revision<0||!(answer.payload===null||typeof answer.payload==='object'))throw Error('クラウドAPIの応答形式が正しくありません。');
      revision=answer.revision;remote=answer.payload;
      const here=localData(),raw=JSON.stringify(here),oldRev=Number(storage.getItem(revisionKey)||0),wasPending=storage.getItem(pendingKey)==='1';
      if(wasPending){if(oldRev===revision){acked='';dirty=true;announce('dirty','前回未送信の内容を再送します');schedule();}else announce('conflict','別の端末にも変更があります。まず端末のバックアップを保存してください。');return;}
      if(!remote){announce('setup','クラウドは空です。最初のデータを登録してください。');return;}
      if(raw===JSON.stringify(validateCloudData(remote))){saveAck();return;}
      if(nonEmptyCloudData(here)){announce('choose','この端末とクラウドの内容が異なります。端末のバックアップを保存してからクラウドを読み込んでください。');return;}
      apply(remote);saveAck();
    }catch(e){announce('error','接続または認証設定を確認してください。'+e.message);}}
  function backup(){const data=localData();download(JSON.stringify({...data,exportedAt:new Date().toISOString()},null,2),`ときの記録_全データバックアップ_${new Date().toISOString().slice(0,10)}.json`,'application/json');backed=true;onStatus?.(status,detail);}
  async function start(){if(status!=='setup')throw Error('初回設定の状態ではありません。');const data=localData();if(nonEmptyCloudData(data)&&!backed)throw Error('先に全データのバックアップを書き出してください。');announce('loading','クラウドに初期データを送信中');try{const answer=await request('POST',{baseRevision:0,payload:data});if(!answer.ok){if(answer.statusCode===409){announce('conflict','別の端末で初期登録されています。');return;}throw Error(answer.error||'初回登録が失敗しました。');}revision=answer.revision;remote=data;saveAck();}catch(e){announce('error',e.message);}}
  function useRemote(){if(!['choose','conflict'].includes(status))throw Error('読込操作が必要な状態ではありません。');if(!backed)throw Error('先に端末の全データバックアップを書き出してください。');if(!remote){init();return;}apply(remote);saveAck();}
  async function retry(){if(status==='error'){if(storage.getItem(pendingKey)==='1'){
        // After a network failure, re-fetch to verify CAS before retrying.
        try{const r=await request();if(!r.ok)throw Error(r.error||'再接続できません。');if(r.revision!==revision){remote=r.payload;announce('conflict','別端末の更新を検出しました。');return;}revision=r.revision;announce('dirty','未同期の内容を送信中');dirty=true;await flush();}catch(e){announce('error',e.message);}return;
      }await init();return;}
    if(status==='conflict'){await init();return;}
    if(status==='ready'){await refresh();return;}
  }
  async function refresh(){if(refreshing||posting||!['ready','dirty'].includes(status)||dirty)return;refreshing=true;try{const answer=await request();if(!answer.ok)throw Error(answer.error||'再取得失敗');if(answer.revision!==revision){if(snapshot()!==acked){remote=answer.payload;announce('conflict','クラウドと端末の両方が変更されています。');return;}if(!answer.payload)throw Error('クラウドの保存データが見つかりません。');apply(answer.payload);revision=answer.revision;saveAck();}}catch(e){announce('error','クラウドを確認できません。'+e.message);}finally{refreshing=false;}}
  async function restore(input){
    if(!['local','ready'].includes(status))throw Error('クラウドが同期済みの状態で復元してください。');
    if(!backed&&nonEmptyCloudData(localData()))throw Error('復元前に現在の全データをバックアップしてください。');
    if(!confirm('すべての記録を復元データで置き換えます。元の記録はバックアップに残しましたか？'))return;
    const content=validateCloudData(input);
    apply(content);
    if(status==='ready'){dirty=true;storage.setItem(pendingKey,'1');announce('dirty','復元データを送信中');schedule();}
    else announce('local','端末内へバックアップを復元しました。');
  }
  let timer=null;
  if(online){timer=setInterval(()=>{if(typeof document!=='undefined'&&!document.hidden)refresh();},30000);timer?.unref?.();if(typeof window!=='undefined')window.addEventListener('focus',()=>refresh());}
  const panel=()=>{
    const message=detail||({ready:'同期済み',dirty:'同期中',loading:'接続中',local:'端末保存のみ',setup:'初回登録待ち',choose:'クラウド読込待ち',conflict:'同期競合',error:'通信エラー'}[status]);
    const action=(()=>{if(status==='setup')return `<button class="button secondary" data-cloud="backup">全データをバックアップ</button><button class="button primary" data-cloud="start" ${!backed&&nonEmptyCloudData(localData())?'disabled':''}>クラウド利用開始</button>`;
      if(['choose','conflict'].includes(status))return `<button class="button secondary" data-cloud="backup">端末の全データをバックアップ</button><button class="button primary" data-cloud="remote" ${!backed?'disabled':''}>クラウドの内容を読み込む</button>`;
      if(['error','ready'].includes(status))return `<button class="button secondary" data-cloud="retry">接続・更新を確認</button>`;return '';})();
    return `<section class="panel cloud-panel"><h2>端末間の同期</h2><p role="status"><strong>${({ready:'保存済み',dirty:'送信中',error:'未同期',conflict:'競合',local:'端末内のみ',setup:'初回準備',choose:'内容の確認',loading:'接続中'}[status])}</strong> — ${message.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</p><div class="workspace-actions">${action}</div><p class="muted">${status==='local'?'クラウド同期を使用する場合はCloudflareの設定を完了してください。':'更新競合・通信エラーでは勝手に上書きせず、保存データを保護します。'}</p></section>`;
  };
  const act=async a=>{if(a==='backup')backup();else if(a==='start')await start();else if(a==='remote')useRemote();else if(a==='retry')await retry();};
  return {init,act,panel,setItem,beforeWrite,restore,status:()=>status,detail:()=>detail,isRemote:()=>online&&status!=='local',backup,refresh};
}
