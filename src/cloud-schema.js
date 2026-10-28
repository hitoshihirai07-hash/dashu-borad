import {KEY,validate,fresh} from './model.js';
import {LIFE_KEY,lifeValidate,lifeFresh,SAMSUNG_HEALTH_KEY,healthValidate,healthFresh,SLEEP_PRESET_KEY,validateSleepPresets,sleepPresetDefaults} from './life-model.js';
import {WORKSPACE_KEY,workspaceValidate,workspaceFresh} from './workspace-model.js';
export const CLOUD_KEYS=[KEY,LIFE_KEY,SAMSUNG_HEALTH_KEY,SLEEP_PRESET_KEY,WORKSPACE_KEY,'toki-input-defaults-v2'];
export const CLOUD_MARKER='toki-cloud-state-v1';
export function validateCloudData(data){
  if(!data||data.format!==CLOUD_MARKER||data.version!==1||!data.sections||typeof data.sections!=='object'||Array.isArray(data.sections))throw Error('同期データの形式が違います。');
  const s=data.sections;
  for(const k of CLOUD_KEYS)if(!Object.hasOwn(s,k)||typeof s[k]!=='string')throw Error('同期データの項目が足りません。');
  const json=k=>JSON.parse(s[k]);
  validate(json(KEY));lifeValidate(json(LIFE_KEY));healthValidate(json(SAMSUNG_HEALTH_KEY));validateSleepPresets(json(SLEEP_PRESET_KEY));workspaceValidate(json(WORKSPACE_KEY));
  const input=json('toki-input-defaults-v2');if(!input||typeof input!=='object'||typeof input.field!=='string'||input.field.length>80||!input.projects||typeof input.projects!=='object'||Object.keys(input.projects).length>100||Object.entries(input.projects).some(([a,b])=>a.length>80||typeof b!=='string'||b.length>80))throw Error('入力候補の同期データが不正です。');
  return data;
}
export function collectCloudData(storage){
  const defaults={
    [KEY]:JSON.stringify(fresh()),[LIFE_KEY]:JSON.stringify(lifeFresh()),[SAMSUNG_HEALTH_KEY]:JSON.stringify(healthFresh()),
    [SLEEP_PRESET_KEY]:JSON.stringify(sleepPresetDefaults()),[WORKSPACE_KEY]:JSON.stringify(workspaceFresh()),
    'toki-input-defaults-v2':JSON.stringify({field:'プロ野球',projects:{}})
  };
  const sections={};for(const key of CLOUD_KEYS)sections[key]=storage.getItem(key)||defaults[key];
  return validateCloudData({format:CLOUD_MARKER,version:1,sections});
}
export function nonEmptyCloudData(data){const s=data.sections;return [JSON.parse(s[KEY]).records.length,JSON.parse(s[LIFE_KEY]).records.length,JSON.parse(s[SAMSUNG_HEALTH_KEY]).records.length,JSON.parse(s[WORKSPACE_KEY]).projects.length,JSON.parse(s[WORKSPACE_KEY]).tasks.length,JSON.parse(s[WORKSPACE_KEY]).notes.length,JSON.parse(s[WORKSPACE_KEY]).prompts.length,(JSON.parse(s[WORKSPACE_KEY]).hiddenProjects||[]).length,Object.keys(JSON.parse(s[WORKSPACE_KEY]).habits||{}).length].some(Boolean)||!!Object.values(JSON.parse(s[SLEEP_PRESET_KEY]).weekdays||{}).some(v=>v.wake||v.bed);}
