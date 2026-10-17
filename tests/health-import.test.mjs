import test from 'node:test';
import assert from 'node:assert/strict';
import {SAMSUNG_HEALTH_KEY,healthFresh,healthValidate,samsungStepParseCSV,healthMerge,healthSummary,weeklyMarkdown,lifeRecord} from '../src/life-model.js';

const sample=`\uFEFFcom.samsung.shealth.step_daily_trend,7006011,6\nbinning_data,update_time,create_time,source_pkg_name,source_type,count,speed,distance,calorie,deviceuuid,pkg_name,datauuid,day_time\na.json,2026-10-16 14:57:51.369,2026-10-15 22:35:39.671,com.sec.android.app.shealth,-2,13308,1.4005865,10222.549,404.46994,watch,com.sec.android.app.shealth,a,2026-10-16 00:00:00.000,\nb.json,2026-10-16 15:00:00.792,2026-10-16 15:00:00.792,com.sec.android.app.shealth,0,9999,1.2,8000,300,phone,com.sec.android.app.shealth,b,2026-10-16 00:00:00.000,\nc.json,2026-10-17 11:45:06.316,2026-10-16 16:14:37.074,com.sec.android.app.shealth,-2,5670,1.3858143,4348.63,172.68,watch,com.sec.android.app.shealth,c,2026-10-17 00:00:00.000,`;

test('Samsung Health step CSV prefers source_type -2 and converts units for display',()=>{
  assert.ok(SAMSUNG_HEALTH_KEY);
  const data=samsungStepParseCSV(sample);
  assert.equal(data.records.length,2);
  const r=data.records[0];
  assert.equal(r.date,'2026-10-16');
  assert.equal(r.steps,13308);
  assert.equal(r.distanceKm,10.223);
  assert.equal(r.calories,404.47);
  assert.equal(r.speedKmh,5.04);
  assert.equal(r.sourceType,-2);
  assert.deepEqual(healthValidate(data),data);
});

test('Samsung Health merge adds new dates, updates changed dates, and is idempotent',()=>{
  const incoming=samsungStepParseCSV(sample);
  const first=healthMerge(healthFresh(),incoming);
  assert.equal(first.added,2);assert.equal(first.updated,0);assert.equal(first.unchanged,0);
  const again=healthMerge(first.data,incoming);
  assert.equal(again.added,0);assert.equal(again.updated,0);assert.equal(again.unchanged,2);
  const changed=structuredClone(incoming);changed.records[1].steps=6000;
  const update=healthMerge(first.data,changed);
  assert.equal(update.updated,1);assert.equal(update.data.records.find(r=>r.date==='2026-10-17').steps,6000);
});

test('health summary and weekly Markdown include imported step data without changing life-log day count',()=>{
  const health=samsungStepParseCSV(sample).records;
  const summary=healthSummary(health);
  assert.equal(summary.days,2);
  assert.equal(summary.totalSteps,18978);
  assert.equal(summary.averageSteps,9489);
  assert.equal(summary.maxSteps.steps,13308);
  const life=[lifeRecord('2026-10-16',{sleep:7,condition:4,mood:4})];
  const md=weeklyMarkdown({range:{start:'2026-10-12',end:'2026-10-18'},lifeRecords:life,healthRecords:health});
  assert.match(md,/life_days: 1/);
  assert.match(md,/steps_total: 18978/);
  assert.match(md,/## Samsung Health[\s\S]*平均歩数: 9,489歩/);
  assert.match(md,/最多: 10\/16 13,308歩/);
});
