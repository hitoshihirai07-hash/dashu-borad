import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const shell=readFileSync(new URL('../src/shell.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/workspace.css',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const routeNames=['dashboard','tasks','calendar','projects','habits','records','life-log','prompts','templates','links','share'];

function nav(name){const start=shell.indexOf(`<nav class="${name}"`);const end=shell.indexOf('</nav>',start);assert.ok(start>=0&&end>start,`missing ${name}`);return shell.slice(start,end);}

const pcNav=nav('desktop-nav');
const mobileNav=nav('mobile-nav');

test('all existing pages remain reachable on desktop and on mobile',()=>{
  for(const name of routeNames){
    assert.match(pcNav+(name==='share'?shell.slice(shell.indexOf('<div class="sidebar-foot">'),shell.indexOf('</aside>')):''),new RegExp(`href="#${name}"[^>]*data-nav="${name}"`),`desktop ${name}`);
    assert.match(mobileNav,new RegExp(`href="#${name}"[^>]*data-nav="${name}"`),`mobile ${name}`);
  }
});

test('desktop has a small top-level navigation and accessible grouped pages',()=>{
  assert.equal([...pcNav.matchAll(/class="sidebar-primary"/g)].length,4);
  assert.equal([...pcNav.matchAll(/class="sidebar-group"/g)].length,2);
  assert.equal([...pcNav.matchAll(/name="desktop-sidebar-groups"/g)].length,2);
  assert.match(pcNav,/<details[^>]+class="sidebar-group">\s*<summary>/);
  assert.match(shell,/<nav class="mobile-nav" aria-label=/);
});

test('desktop menu scrolls separately and mobile bottom navigation is preserved',()=>{
  assert.match(css,/\.sidebar \.desktop-nav\s*\{[^}]*overflow-y:auto;/);
  assert.match(css,/@media \(min-width:601px\)/);
  assert.match(css,/@media \(max-width:600px\)\s*\{\s*\.sidebar \.desktop-nav \{ display:none; \}/);
  assert.match(css,/\.sidebar \.mobile-nav \{ display:flex; \}/);
});

test('current group auto-opens on navigation, but not again after manually closing',()=>{
  const script=app.slice(app.indexOf('let lastSidebarView=null;'),app.indexOf('function render(){view='));
  const groups=[
    {open:false, current:false, querySelector(selector){return selector.includes('projects')?{}:null;},classList:{toggle(key,value){assert.equal(key,'has-current');groups[0].current=value;}}},
    {open:false, current:false, querySelector(selector){return selector.includes('records')?{}:null;},classList:{toggle(key,value){assert.equal(key,'has-current');groups[1].current=value;}}},
  ];
  const sandbox={document:{querySelectorAll(){return groups;}}};
  vm.createContext(sandbox);vm.runInContext(script+'\nthis.syncSidebarGroups=syncSidebarGroups;',sandbox);
  sandbox.syncSidebarGroups('projects');assert.equal(groups[0].open,true);assert.equal(groups[0].current,true);
  groups[0].open=false;sandbox.syncSidebarGroups('projects');assert.equal(groups[0].open,false);
  sandbox.syncSidebarGroups('records');assert.equal(groups[1].open,true);assert.equal(groups[1].current,true);
  assert.equal(groups[0].current,false);
});
