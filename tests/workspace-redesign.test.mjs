import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {workspaceFresh,workspaceValidate,workspaceChange,workspaceToggleHabit,habitWeek,HABITS,WORKSPACE_KEY} from '../src/workspace-model.js';
import {collectCloudData,validateCloudData,nonEmptyCloudData} from '../src/cloud-schema.js';

const uid=()=>`t-${Math.random().toString(36).slice(2)}`;
const mem=(start={})=>{const m=new Map(Object.entries(start));return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),data:m};};

test('old workspace with quick notes stays valid and gains no-destructive project/task memo fields',()=>{
 let legacy=workspaceFresh(); delete legacy.habits;
 legacy=workspaceChange({...legacy,habits:{}},'projects',{title:'SNS運用ラボ',project:'',description:'運用方針'},'',uid);
 legacy=workspaceChange(legacy,'tasks',{title:'サイト修正',project:'SNS運用ラボ',status:'todo',priority:'high',due:'',detail:'修正内容'},'',uid);
 legacy=workspaceChange(legacy,'notes',{title:'以前のクイックメモ',project:'SNS運用ラボ',body:'元データ'},'',uid);
 for(const entry of legacy.projects)delete entry.memo;
 for(const entry of legacy.tasks)delete entry.memo;
 delete legacy.habits;
 const upgraded=workspaceValidate(legacy);
 assert.equal(upgraded.notes[0].body,'元データ');assert.equal(upgraded.projects[0].memo,'');assert.equal(upgraded.tasks[0].memo,'');
 assert.deepEqual(upgraded.habits,{});
 const p=workspaceChange(upgraded,'projects',{memo:'プロジェクトの予定'},upgraded.projects[0].id,uid);
 const t=workspaceChange(p,'tasks',{memo:'タスクの注意'},p.tasks[0].id,uid);
 assert.equal(t.projects[0].memo,'プロジェクトの予定');assert.equal(t.tasks[0].memo,'タスクの注意');
 assert.equal(t.notes[0].body,'元データ');
});

test('habit tracker has exactly four independent daily checkboxes with undo',()=>{
 assert.deepEqual(HABITS.map(h=>h.label),['野球確認','散歩','生活記録','今日の記録']);
 let w=workspaceFresh();w=workspaceToggleHabit(w,'2026-10-27','baseball');
 w=workspaceToggleHabit(w,'2026-10-27','walk');
 w=workspaceToggleHabit(w,'2026-10-28','life');
 assert.deepEqual(new Set(w.habits['2026-10-27']),new Set(['baseball','walk']));
 assert.deepEqual(w.habits['2026-10-28'],['life']);
 w=workspaceToggleHabit(w,'2026-10-27','walk');assert.deepEqual(w.habits['2026-10-27'],['baseball']);
 w=workspaceToggleHabit(w,'2026-10-27','baseball');assert.equal(w.habits['2026-10-27'],undefined);
 assert.equal(w.projects.length,0,'habits must not create a project');
});

test('habit history validates dates and refuses unknown IDs, corrupted rows or oversized histories',()=>{
 const w=workspaceFresh();
 assert.throws(()=>workspaceToggleHabit(w,'2026-02-30','walk'),/不正/);
 assert.throws(()=>workspaceToggleHabit(w,'2026-10-27','unknown'),/不正/);
 assert.throws(()=>workspaceValidate({...w,habits:{'2026-10-27':['baseball','baseball']}}),/不正/);
 assert.throws(()=>workspaceValidate({...w,habits:{'2026-10-27':['secret']}}),/不正/);
 assert.throws(()=>workspaceValidate({...w,habits:{'2026-10-27':'baseball'}}),/不正/);
});

test('weekly progress runs Monday-Sunday and crosses month boundaries',()=>{
 let w=workspaceFresh();
 w=workspaceToggleHabit(w,'2026-10-27','baseball');w=workspaceToggleHabit(w,'2026-11-01','daily');
 const week=habitWeek(w,'2026-10-27');
 assert.equal(week.length,7);assert.equal(week[0].date,'2026-10-26');assert.equal(week[6].date,'2026-11-01');
 assert.equal(week[1].count,1);assert.equal(week[6].count,1);
});

test('habits, task notes and project notes are included in the EXISTING Cloud D1 payload without extra keys',()=>{
 let w=workspaceToggleHabit(workspaceFresh(),'2026-10-27','daily');
 w=workspaceChange(w,'projects',{title:'Player Lens',project:'',memo:'プロジェクトメモ',description:''},'',uid);
 w=workspaceChange(w,'tasks',{title:'テスト',project:'Player Lens',memo:'タスクメモ',status:'doing',priority:'normal'},'',uid);
 const store=mem({[WORKSPACE_KEY]:JSON.stringify(w)});
 const cloud=collectCloudData(store);
 assert.equal(nonEmptyCloudData(cloud),true);validateCloudData(cloud);
 const stored=workspaceValidate(JSON.parse(cloud.sections[WORKSPACE_KEY]));
 assert.equal(stored.tasks[0].memo,'タスクメモ');assert.equal(stored.projects[0].memo,'プロジェクトメモ');assert.equal(stored.habits['2026-10-27'][0],'daily');
 assert.equal(cloud.version,1);
});

test('habit-only data triggers backup precaution during initial cloud upload',()=>{
 const w=workspaceToggleHabit(workspaceFresh(),'2026-10-27','walk');
 const cloud=collectCloudData(mem({[WORKSPACE_KEY]:JSON.stringify(w)}));
 assert.equal(nonEmptyCloudData(cloud),true);
});

test('layout removes stand-alone quick memo nav and provides accessible habit and task forms',()=>{
 const shell=readFileSync(new URL('../src/shell.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../src/workspace.js',import.meta.url),'utf8');
 assert.doesNotMatch(shell,/data-nav="notes"/);
 assert.match(shell,/data-nav="habits"/);
 assert.match(shell,/name="memo"/);
 assert.match(js,/data-workspace-save-note="tasks"/);
 assert.match(js,/data-workspace-save-note="projects"/);
 assert.match(js,/data-workspace-record/);
});
