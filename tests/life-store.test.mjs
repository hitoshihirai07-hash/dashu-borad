import test from 'node:test';
import assert from 'node:assert/strict';
import {createLifeStore} from '../src/life-store.js';
import {LIFE_KEY,lifeFresh,lifeRecord} from '../src/life-model.js';
function storage(){const values=new Map([['toki-records-v1','original time data']]);return {values,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};}
test('life CRUD persists independently, reloads, and retains deleted records in backups',()=>{
 const s=storage(),store=createLifeStore(s),r=lifeRecord('2024-03-01',{sleep:6});store.save({...lifeFresh(),records:[r]});
 assert.equal(s.values.get('toki-records-v1'),'original time data');assert.equal(createLifeStore(s).get().records[0].sleep,6);
 store.save({...store.get(),records:[{...r,sleep:8}]});store.save({...store.get(),records:[{...r,deleted:true}]});
 assert.equal(createLifeStore(s).get().records[0].deleted,true);
});
test('stale-tab changes block writes and leave latest storage untouched',()=>{
 const s=storage(),a=createLifeStore(s),b=createLifeStore(s);a.save({...lifeFresh(),records:[lifeRecord('2024-03-01')]});
 assert.throws(()=>b.save({...lifeFresh(),records:[lifeRecord('2024-03-02')]}),/別のタブ/);assert.equal(b.get().records[0].date,'2024-03-01');
});
test('corrupt saved data is protected and quota errors do not mutate memory or storage',()=>{
 const s=storage();s.values.set(LIFE_KEY,'corrupt');const broken=createLifeStore(s);assert.match(broken.error(),/読み込めません/);assert.throws(()=>broken.save(lifeFresh()));assert.equal(s.values.get(LIFE_KEY),'corrupt');
 s.values.delete(LIFE_KEY);const store=createLifeStore(s);s.setItem=()=>{throw Error('quota');};assert.throws(()=>store.save({...lifeFresh(),records:[lifeRecord('2024-03-01')]}),/保存できません/);assert.equal(store.get().records.length,0);
});
