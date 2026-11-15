import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceFresh,workspaceValidate,workspaceChange,workspaceDelete} from '../src/workspace-model.js';

let nextId=0;
const makeId=()=>`test-${++nextId}`;
const sample=()=>workspaceChange(workspaceFresh(),'tasks',{
 title:'記事作成',project:'巨人',status:'todo',priority:'normal',due:'2026-11-16',detail:'原稿の作成'
},'',makeId);

test('タスク削除の記録は保存・復元しても残り、同期による再追加を防ぐ',()=>{
 const original=sample(),id=original.tasks[0].id;
 const removed=workspaceDelete(original,'tasks',id);
 assert.equal(removed.tasks.length,0);
 assert.deepEqual(removed.deletedTaskIds,[id]);
 assert.deepEqual(workspaceValidate(JSON.parse(JSON.stringify(removed))).deletedTaskIds,[id]);
 assert.throws(()=>workspaceDelete(removed,'tasks',id),/見つかりません/);
});

test('削除は今日の3件とメモ紐付けを整理する',()=>{
 let w=sample(),id=w.tasks[0].id;
 w=workspaceChange(w,'quickNotes',{body:'作業メモ',taskId:id},'',makeId);
 w=workspaceValidate({...w,focusDays:{'2026-11-15':[id]}});
 const removed=workspaceDelete(w,'tasks',id);
 assert.deepEqual(removed.focusDays,{});
 assert.equal(removed.quickNotes[0].taskId,'');
 assert.equal(removed.quickNotes[0].body,'作業メモ');
});

test('既存バックアップに削除履歴がなくても読み取れる',()=>{
 const older=sample();
 delete older.deletedTaskIds;
 assert.deepEqual(workspaceValidate(older).deletedTaskIds,[]);
});

test('削除済みIDと有効タスクIDが重なる不正データを拒否する',()=>{
 const w=sample(),id=w.tasks[0].id;
 assert.throws(()=>workspaceValidate({...w,deletedTaskIds:[id]}),/削除済みタスク/);
});
