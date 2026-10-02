import test from 'node:test';
import assert from 'node:assert/strict';
import {LIFE_KEY,LIFE_FIELDS,lifeFresh,lifeRecord,lifeValidate,lifeParseCSV,lifeExportCSV,lifeMerge,lifeSummary,lifeRange} from '../src/life-model.js';
import {KEY} from '../src/model.js';
const row=(date='2024-02-29',values={})=>lifeRecord(date,{sleep:7,condition:3,fatigue:2,mood:4,water:3,walk:30,exercise:0,...values});
const data=records=>({...lifeFresh(),records});
test('separate schema accepts blank values and zero without accepting time-record backups',()=>{
 assert.notEqual(LIFE_KEY,KEY);assert.equal(LIFE_FIELDS.length,25);
 const r=row();assert.equal(r.exercise,0);assert.equal(r.temperature,null);
 assert.deepEqual(lifeValidate(data([r])),data([r]));
 assert.throws(()=>lifeValidate({format:'toki-records',version:2,records:[]}));
 for(const values of [{sleep:25},{exercise:-1},{condition:'abc'},{wake:'25:00'},{bath:'maybe'}])assert.throws(()=>row('2024-02-29',values));
 assert.throws(()=>row('2023-02-29'));assert.throws(()=>lifeValidate(data([r,r])));
});
test('CSV roundtrip preserves all fields, commas, multiline text, seconds and timestamp placeholders',()=>{
 const r=row('2024-02-29',{timestamp:'-',weekday:'木',wake:'08:05:30',breakfast:'a,"b"\n改行',reflection:'=テスト',lateMeal:'なし',bath:'あり',screen:'いいえ',rest:'はい'});
 const csv=lifeExportCSV(data([r]));const parsed=lifeParseCSV(csv,{decodeEscapes:true});
 for(const f of LIFE_FIELDS)assert.deepEqual(parsed.records[0][f.key],r[f.key]);
 assert.equal(parsed.records[0].timestamp,'-');assert.equal(parsed.records[0].weekday,'木');
 const cells=csv.replace(/^\uFEFF/,'').split('\r\n')[0];assert.match(cells,/"タイムスタンプ","日付","曜日"/);
});
test('CSV handles reordered columns, rejects missing columns, bad rows and duplicate dates atomically',()=>{
 const csv=lifeExportCSV(data([row()]));
 assert.throws(()=>lifeParseCSV('日付,睡眠時間\n2024/02/29,7'));
 assert.throws(()=>lifeParseCSV(csv.replace('2024/02/29','2024/02/30')));
 assert.throws(()=>lifeParseCSV(csv+'\r\n'+csv.split('\r\n').slice(1).join('\r\n')));
 assert.throws(()=>lifeParseCSV(csv+'\r\n"unterminated'));
 const simple=lifeExportCSV(data([row('2024-02-29',{reflection:''})])).replace(/^\uFEFF/,'').split('\r\n');
 const reverse=simple.map(line=>line.split(',').reverse().join(',')).join('\r\n');
 assert.equal(lifeParseCSV(reverse).records[0].date,'2024-02-29');
});
test('merge by date skips conflicts by default and only replaces them explicitly; repeated import is idempotent',()=>{
 const local=data([row()]),incoming=data([row('2024-02-29',{sleep:8}),row('2024-03-01')]);
 const plan=lifeMerge(local,incoming);assert.equal(plan.added,1);assert.equal(plan.conflicts,1);assert.equal(plan.data.records[0].sleep,7);
 const overwrite=lifeMerge(local,incoming,'replace');assert.equal(overwrite.data.records[0].sleep,8);
 const again=lifeMerge(overwrite.data,incoming);assert.equal(again.added,0);assert.equal(again.conflicts,0);
 const deleted=data([{...row(),deleted:true}]);assert.equal(lifeMerge(deleted,local).data.records[0].deleted,true);
});
test('summary excludes deleted and missing values, includes zero, and uses recorded sample counts',()=>{
 const records=[row('2024-02-28',{sleep:6,exercise:0}),row('2024-02-29',{sleep:8,exercise:20}),row('2024-03-01',{sleep:null,exercise:null}),{...row('2024-03-02',{sleep:24}),deleted:true}];
 const s=lifeSummary(records);assert.equal(s.days,3);assert.equal(s.metrics.sleep.average,7);assert.equal(s.metrics.sleep.count,2);assert.equal(s.metrics.exercise.average,10);assert.equal(s.metrics.exercise.total,20);
 assert.equal(lifeSummary([]).metrics.sleep.average,null);
 assert.deepEqual(lifeRange('week','2024-03-01'),{start:'2024-02-26',end:'2024-03-03'});
 assert.deepEqual(lifeRange('month','2024-02-29'),{start:'2024-02-01',end:'2024-02-29'});
});

test('external CSV literal apostrophes are preserved and app escapes are decoded only explicitly',()=>{
 const external=lifeExportCSV(data([row('2024-02-29',{reflection:'literal-placeholder'})])).replace('"literal-placeholder"','"\'=literal"');
 assert.equal(lifeParseCSV(external).records[0].reflection,"'=literal");
 const appCSV=lifeExportCSV(data([row('2024-02-29',{reflection:'=formula-like-text'})]));
 assert.equal(lifeParseCSV(appCSV).records[0].reflection,"'=formula-like-text");
 assert.equal(lifeParseCSV(appCSV,{decodeEscapes:true}).records[0].reflection,'=formula-like-text');
});
