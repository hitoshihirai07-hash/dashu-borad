// 一試合分のデータ。公式記録の取込機構ではなく、入力・照合用の形式を提供する。
const BASEBALL_DATA_TEAMS = ['giants', 'opponent'];
const baseballDataText = (value, max = 100) => {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' || value.length > max) throw Error('文字項目の形式または長さが不正です。');
  return value.trim();
};
const baseballDataCount = (value, max = 999) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') throw Error('成績の数値が不正です。');
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) throw Error('成績は0以上の整数で入力してください。');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > max) throw Error('成績の数値が範囲外です。');
  return n;
};
export const EMPTY_BASEBALL_DATA = () => ({
  innings: [], lineups: { giants: [], opponent: [] }, batters: { giants: [], opponent: [] }, pitchers: { giants: [], opponent: [] },
  decisions: { win: '', loss: '', save: '' }, sourceUrl: ''
});
export function parsePitchingInnings(value) {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value).trim();
  if (!/^(?:[0-9]|[1-2][0-9]|30)(?:\.[012])?$/.test(str)) throw Error('投球回は 5、0.1、0.2 などで入力してください。');
  const [full, remain = '0'] = str.split('.');
  const outs = Number(full) * 3 + Number(remain);
  if (outs > 90) throw Error('投球回の範囲を超えています。');
  return outs;
}
export function displayPitchingInnings(outs) {
  if (outs === null || outs === undefined) return '';
  const n = baseballDataCount(outs, 90);
  if (n === null) return '';
  return Math.floor(n / 3) + (n % 3 ? '.' + n % 3 : '');
}
export function normalizeBaseballData(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('試合詳細データが不正です。');
  const innings = input.innings ?? [];
  if (!Array.isArray(innings) || innings.length > 18) throw Error('イニングは18回まで登録できます。');
  const normalizedInnings = innings.map((item, index) => {
    if (!item || typeof item !== 'object') throw Error('イニングの得点形式が不正です。');
    if (Number(item.number) !== index + 1) throw Error('イニング番号が連続していません。');
    return { number: index + 1, giants: baseballDataCount(item.giants, 99), opponent: baseballDataCount(item.opponent, 99) };
  });
  if (!input.lineups || !input.pitchers) throw Error('スタメンまたは投手起用の形式が不正です。');
  const lineups = {}, pitchers = {};
  for (const team of BASEBALL_DATA_TEAMS) {
    const rows = input.lineups[team] ?? [];
    if (!Array.isArray(rows) || rows.length > 9) throw Error('スタメンは各チーム9人までです。');
    const numbers = new Set();
    lineups[team] = rows.map(row => {
      const order = Number(row.order);
      if (!Number.isInteger(order) || order < 1 || order > 9 || numbers.has(order)) throw Error('スタメンの打順が重複、または不正です。');
      numbers.add(order);
      const name = baseballDataText(row.name, 80), position = baseballDataText(row.position, 15);
      if (!name || !position) throw Error('スタメンには守備位置と選手名が必要です。');
      const atBats = baseballDataCount(row.atBats, 20), hits = baseballDataCount(row.hits, 20), rbi = baseballDataCount(row.rbi, 30);
      if (atBats !== null && hits !== null && hits > atBats) throw Error('安打数が打数を超えています。');
      return {order, position, name, atBats, hits, rbi};
    }).sort((a, b) => a.order - b.order);
    const pen = input.pitchers[team] ?? [];
    if (!Array.isArray(pen) || pen.length > 30) throw Error('投手起用は各チーム30人までです。');
    pitchers[team] = pen.map(row => {
      const name = baseballDataText(row.name, 80);
      if (!name) throw Error('投手名を入力してください。');
      const outs = row.outs === '' || row.outs == null ? null : baseballDataCount(row.outs, 90);
      const stats = {};
      for (const field of ['pitches', 'hits', 'walks', 'strikeouts', 'runs', 'earnedRuns']) stats[field] = baseballDataCount(row[field], 999);
      return {name, outs, ...stats};
    });
  }

  // 保存済みの旧形式ではbattersがないため、先発打者から自動補完する。
  const batters={};
  for(const team of BASEBALL_DATA_TEAMS){
    const legacy=lineups[team].map(p=>({order:p.order,position:p.position,name:p.name,atBats:p.atBats,hits:p.hits,rbi:p.rbi}));
    const source=Object.hasOwn(input.batters||{},team)?input.batters[team]:legacy;
    if(!Array.isArray(source)||source.length>60)throw Error('打撃成績は各チーム60人まで登録できます。');
    const starters=new Set();
    batters[team]=source.map(row=>{
      if(!row||typeof row!=='object')throw Error('打撃成績の形式が不正です。');
      const order=Number(row.order);
      if(!Number.isInteger(order)||order<1||order>9)throw Error('打撃成績の打順は1～9です。');
      const name=baseballDataText(row.name,80),position=baseballDataText(row.position,20);
      if(!name||!position)throw Error('選手名と守備位置を入力してください。');
      const stats={};
      for(const key of ['atBats','hits','rbi','walks','hitByPitch','strikeouts'])stats[key]=baseballDataCount(row[key],40);
      if(stats.atBats!==null&&stats.hits!==null&&stats.hits>stats.atBats)throw Error('安打数が打数を超えています。');
      const starter=!starters.has(order);starters.add(order);
      return {order,position,name,...stats,starter};
    });
  }

  const decisions = {};
  for (const field of ['win', 'loss', 'save']) decisions[field] = baseballDataText(input.decisions?.[field], 80);
  const sourceUrl = baseballDataText(input.sourceUrl, 500);
  if (sourceUrl) {
    let parsed;
    try { parsed = new URL(sourceUrl); } catch { throw Error('参照URLが不正です。'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw Error('参照URLはhttp(s)のみ利用可能です。');
  }
  return {innings: normalizedInnings, lineups, batters, pitchers, decisions, sourceUrl};
}
export function scoreMismatch(game, data) {
  if (!game || !data?.innings?.length) return false;
  const complete = data.innings.every((row, index) => row.opponent !== null && (row.giants !== null || index === data.innings.length - 1));
  if (!complete || game.giantsScore === null || game.opponentScore === null) return false;
  const giants = data.innings.reduce((sum, row) => sum + (row.giants || 0), 0);
  const opponent = data.innings.reduce((sum, row) => sum + (row.opponent || 0), 0);
  return giants !== game.giantsScore || opponent !== game.opponentScore;
}
const baseballFixturePitcher = (name, outs, hits, walks, strikeouts, earnedRuns) => ({name, outs, pitches: null, hits, walks, strikeouts, runs: null, earnedRuns});
export function baseballGameData2026Fixture() {
  return normalizeBaseballData({
    innings: [
      [0,0],[3,0],[5,0],[0,0],[2,0],[1,0],[0,0],[0,0],[null,0]
    ].map(([giants, opponent], i) => ({number: i + 1, giants, opponent})),
    lineups: {
      giants: [
        ['中','松本 剛'],['遊','泉口 友汰'],['左','丸 佳浩'],['一','ダルベック'],['捕','大城 卓三'],
        ['二','吉川 尚輝'],['三','リチャード'],['右','平山 功太'],['投','小笠原 慎之介']
      ].map(([position, name], i) => ({order:i+1,position,name})),
      opponent: [
        ['遊','長岡 秀樹'],['右','増田 珠'],['二','田中 陽翔'],['左','西村 瑠伊斗'],['三','松下 歩叶'],
        ['中','岩田 幸宏'],['一','赤羽 由紘'],['捕','松本 直樹'],['投','高橋 奎二']
      ].map(([position, name], i) => ({order:i+1,position,name}))
    },

    batters:{
      giants:[
        [1,'中左','松本 剛',6,2,0,0,0,1],
        [1,'左','皆川 岳飛',0,0,0,0,0,0],
        [2,'遊','泉口 友汰',2,1,3,3,0,0],
        [2,'三','石塚 裕惺',0,0,0,0,0,0],
        [3,'左','丸 佳浩',3,1,2,2,0,0],
        [3,'投','船迫 大雅',0,0,0,0,0,0],
        [3,'二遊','門脇 誠',0,0,0,0,0,0],
        [4,'一','ダルベック',2,0,0,1,1,2],
        [4,'投','中川 皓太',0,0,0,0,0,0],
        [4,'打中','佐々木 俊輔',1,0,0,0,0,1],
        [5,'捕','大城 卓三',4,0,0,0,0,3],
        [5,'捕','甲斐 拓也',1,0,0,0,0,1],
        [6,'二','吉川 尚輝',2,0,0,3,0,0],
        [6,'投','則本 昂大',0,0,0,0,0,0],
        [6,'投','平内 龍太',0,0,0,0,0,0],
        [7,'三一','リチャード',2,1,2,1,2,1],
        [8,'右','平山 功太',4,2,1,1,0,2],
        [9,'投','小笠原 慎之介',3,1,2,0,0,1],
        [9,'一二','増田 陸',2,1,1,0,0,0]
      ].map(([order,position,name,atBats,hits,rbi,walks,hitByPitch,strikeouts])=>({
        order,position,name,atBats,hits,rbi,walks,hitByPitch,strikeouts
      })),
      opponent:[]
    },
    pitchers: {
      giants:[
        baseballFixturePitcher('小笠原 慎之介',15,4,1,5,0),baseballFixturePitcher('中川 皓太',3,1,0,0,0),baseballFixturePitcher('船迫 大雅',3,1,0,1,0),
        baseballFixturePitcher('則本 昂大',3,1,1,1,0),baseballFixturePitcher('平内 龍太',3,0,0,0,0)
      ],
      opponent:[
        baseballFixturePitcher('高橋 奎二',8,4,4,4,7),baseballFixturePitcher('大西 広樹',1,2,1,0,1),
        baseballFixturePitcher('廣澤 優',3,0,2,0,0),baseballFixturePitcher('荘司 宏太',3,1,3,3,2),
        baseballFixturePitcher('丸山 翔大',3,2,1,1,1),baseballFixturePitcher('リランソ',3,0,0,2,0),baseballFixturePitcher('石原 勇輝',3,0,0,2,0)
      ]
    },
    decisions:{win:'小笠原 慎之介',loss:'高橋 奎二',save:''},
    sourceUrl:'https://npb.jp/bis/eng/2026/games/s2026092701960.html'
  });
}
