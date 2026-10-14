import test from 'node:test';
import assert from 'node:assert/strict';

const model = await import('../src/model.js');
const life = await import('../src/life-model.js');

const timeRecord = (overrides={}) => ({
  id: overrides.id || Math.random().toString(36),
  rev:'r1',parents:[],field:'プロ野球',project:'SNS',date:'2026-10-10',activity:'SNS投稿',minutes:30,note:'',deleted:false,updatedAt:'2026-10-10T12:00:00Z',
  ...overrides
});

test('recentRecordPresets returns the latest unique active activities with their last used duration',()=>{
  assert.equal(typeof model.recentRecordPresets,'function');
  const records=[
    timeRecord({id:'1',activity:'記事作成',project:'プロ野球観戦メモ',minutes:60,date:'2026-10-10',updatedAt:'2026-10-10T10:00:00Z'}),
    timeRecord({id:'2',activity:'SNS投稿',minutes:30,date:'2026-10-11',updatedAt:'2026-10-11T10:00:00Z'}),
    timeRecord({id:'3',activity:'記事作成',project:'プロ野球観戦メモ',minutes:90,date:'2026-10-12',updatedAt:'2026-10-12T10:00:00Z'}),
    timeRecord({id:'4',activity:'削除済み',deleted:true,date:'2026-10-13',updatedAt:'2026-10-13T10:00:00Z'}),
    timeRecord({id:'5',field:'その他',project:'未分類',activity:'学習',minutes:120,date:'2026-10-13',updatedAt:'2026-10-13T11:00:00Z'})
  ];
  assert.deepEqual(model.recentRecordPresets(records,3),[
    {field:'その他',project:'未分類',activity:'学習',minutes:120},
    {field:'プロ野球',project:'プロ野球観戦メモ',activity:'記事作成',minutes:90},
    {field:'プロ野球',project:'SNS',activity:'SNS投稿',minutes:30}
  ]);
});

test('sleep preset applies the selected day wake time and previous night bedtime',()=>{
  assert.equal(typeof life.sleepPresetDefaults,'function');
  assert.equal(typeof life.sleepPresetForDate,'function');
  const presets=life.sleepPresetDefaults();
  presets.weekdays['3']={wake:'07:00',bed:'00:30'}; // Wednesday
  presets.weekdays['4']={wake:'07:00',bed:'23:30'}; // Thursday
  assert.deepEqual(life.sleepPresetForDate(presets,'2026-10-15'),{wake:'07:00',bed:'00:30'}); // Thursday log uses Wednesday night
});

test('previousSleepValues copies only wake and bed from the previous saved day',()=>{
  assert.equal(typeof life.previousSleepValues,'function');
  const records=[life.lifeRecord('2026-10-13',{wake:'07:10',bed:'23:40'}),life.lifeRecord('2026-10-14',{wake:'07:20',bed:'00:10',mood:5})];
  assert.deepEqual(life.previousSleepValues(records,'2026-10-15'),{wake:'07:20:00',bed:'00:10:00'});
  assert.equal(life.previousSleepValues(records,'2026-10-13'),null);
});

test('weeklyMarkdown combines time and life records into Obsidian-friendly frontmatter and summary',()=>{
  assert.equal(typeof life.weeklyMarkdown,'function');
  const timeRecords=[
    timeRecord({id:'t1',date:'2026-10-12',activity:'記事作成',project:'プロ野球観戦メモ',minutes:90}),
    timeRecord({id:'t2',date:'2026-10-13',activity:'SNS投稿',project:'SNS',minutes:30}),
    timeRecord({id:'t3',date:'2026-10-01',activity:'範囲外',minutes:300})
  ];
  const lifeRecords=[
    life.lifeRecord('2026-10-12',{sleep:7,condition:4,mood:4,exercise:30,walk:20,oneLine:'記事を更新'}),
    life.lifeRecord('2026-10-13',{sleep:8,condition:5,mood:3,exercise:0,walk:40,oneLine:'SNSを整理'})
  ];
  const md=life.weeklyMarkdown({range:{start:'2026-10-12',end:'2026-10-18'},timeRecords,lifeRecords});
  assert.match(md,/type: toki-weekly/);
  assert.match(md,/time_total_minutes: 120/);
  assert.match(md,/sleep_average: 7\.5/);
  assert.match(md,/## 時間の記録[\s\S]*合計: 2時間/);
  assert.match(md,/プロ野球観戦メモ: 1時間30分/);
  assert.match(md,/## 生活ログ[\s\S]*平均気分: 3\.5 \/ 5/);
  assert.match(md,/## 今週のひとこと[\s\S]*10\/12: 記事を更新/);
  assert.doesNotMatch(md,/範囲外/);
});
