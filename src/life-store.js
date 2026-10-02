import {LIFE_KEY,lifeFresh,lifeValidate} from './life-model.js';

export function createLifeStore(storage){
  let data=lifeFresh(),snapshot=JSON.stringify(data),failure='';
  const read=()=>{const raw=storage.getItem(LIFE_KEY);return raw?lifeValidate(JSON.parse(raw)):lifeFresh();};
  function reload(){
    try{data=read();snapshot=JSON.stringify(data);failure='';}
    catch{failure='生活ログを読み込めません。既存データを保護するため保存を停止しています。「保存データを救出」から元のデータを書き出してください。';}
  }
  reload();
  return {
    get:()=>data,error:()=>failure,reload,
    raw:()=>storage.getItem(LIFE_KEY)||'',
    save(next){
      if(failure)throw Error(failure);
      const checked=lifeValidate(next);let current;
      try{current=read();}catch{reload();throw Error(failure);}
      if(JSON.stringify(current)!==snapshot){data=current;snapshot=JSON.stringify(data);throw Error('別のタブで生活ログが更新されました。閉じて内容を確認し、もう一度操作してください。');}
      try{storage.setItem(LIFE_KEY,JSON.stringify(checked));}catch{throw Error('生活ログを端末に保存できません。空き容量や保存設定を確認してください。入力内容は残しています。');}
      data=checked;snapshot=JSON.stringify(data);return data;
    }
  };
}
