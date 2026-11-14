import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {ACCENTS,MODES,APPEARANCE_KEY,DEFAULT_APPEARANCE,normalizeAppearance,readAppearance,saveAppearance,applyAppearance,syncNativeAppearance} from '../src/appearance.js';
import { backgroundFor as desktopBackgroundFor } from '../desktop/src/lib/appearance.js';

function storage(seed={}) {
 const map=new Map(Object.entries(seed));
 return {getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),snapshot:()=>Object.fromEntries(map)};
}
test('light green is the default; malformed preferences safely fall back per field',()=>{
 assert.deepEqual(readAppearance(storage()),{mode:'light',accent:'green'});
 for(const raw of ['{oops','null','[]','"light"','17','true','{}'])
  assert.deepEqual(readAppearance(storage({[APPEARANCE_KEY]:raw})),DEFAULT_APPEARANCE,raw);
 assert.deepEqual(normalizeAppearance({mode:'light',accent:'unknown',other:'ignored'}),{mode:'light',accent:'green'});
 assert.deepEqual(normalizeAppearance({mode:'system',accent:'purple'}),{mode:'light',accent:'purple'});
 assert.deepEqual(normalizeAppearance({mode:null,accent:42}),DEFAULT_APPEARANCE);
 assert.deepEqual(readAppearance({getItem(){throw new Error('blocked')}}),DEFAULT_APPEARANCE);
});
test('Midnight Sakura is selectable and its palette stays aligned across web and Windows',async()=>{
 const sakura=ACCENTS.find(accent=>accent.id==='midnight-sakura');
 assert.deepEqual({label:sakura.label,dark:sakura.dark,light:sakura.light,bgDark:sakura.bgDark,bgLight:sakura.bgLight,navDark:sakura.navDark,secondaryDark:sakura.secondaryDark,secondaryLight:sakura.secondaryLight},{label:'Midnight Sakura',dark:'#E98BB5',light:'#B44B78',bgDark:'#11131B',bgLight:'#F7F4F1',navDark:'#151722',secondaryDark:'#8EDFD0',secondaryLight:'#267360'});
 assert.equal(desktopBackgroundFor({mode:'dark',accent:'midnight-sakura'}),sakura.bgDark);
 assert.equal(desktopBackgroundFor({mode:'light',accent:'midnight-sakura'}),sakura.bgLight);
 const generated=await readFile(new URL('../src/theme-generated.css',import.meta.url),'utf8');
 assert.match(generated,/data-mode="dark"\]\[data-accent="midnight-sakura"\]\{[^}]*--accent:#E98BB5;--bg:#11131B/);
 assert.match(generated,/--moku-text-b9d9a1:#8EDFD0;--moku-text-e0ffbd:#B9F4E6;--moku-bg-dcfab5:#F5B8D3/);
});
test('all twelve combinations persist independently without touching existing user data',()=>{
 const base={'moku.library.v1':'saved titles','moku.collections.v1':'collections','moku.history.v1':'history','folder':'folder grant','episode-updates':'settings'};
 const s=storage(base);
 for(const {id:mode} of MODES)for(const {id:accent} of ACCENTS){
  assert.equal(saveAppearance(s,{mode,accent,extra:'discard'}),true);
  assert.deepEqual(readAppearance(s),{mode,accent});
 }
 const snapshot=s.snapshot();delete snapshot[APPEARANCE_KEY];assert.deepEqual(snapshot,base);
 assert.equal(saveAppearance({setItem(){throw new Error('blocked')}},{mode:'light',accent:'blue'}),false);
});
test('DOM attributes and browser theme color update immediately for every combination',()=>{
 let meta='';const root={dataset:{}},doc={documentElement:root,querySelector:()=>({setAttribute:(name,value)=>{assert.equal(name,'content');meta=value}})};
 for(const accent of ACCENTS)for(const {id:mode} of MODES){
  const result=applyAppearance(doc,{mode,accent:accent.id});
  assert.deepEqual(result,{mode,accent:accent.id});
  assert.equal(root.dataset.mode,mode);assert.equal(root.dataset.accent,accent.id);
  assert.equal('themed' in root.dataset,!(mode==='dark'&&accent.id==='green'));
  assert.equal(meta,mode==='light'?accent.bgLight:accent.bgDark);
 }
 assert.doesNotThrow(()=>applyAppearance({documentElement:{dataset:{}},querySelector:()=>null},null));
});
test('optional native bridge receives validated choices and bridge failures do not break the web app',()=>{
 const original=globalThis.window;let calls=[];
 try{
  globalThis.window={MokuBridge:{setAppearance:(...x)=>calls.push(x)}};
  syncNativeAppearance({mode:'light',accent:'pink'});syncNativeAppearance({mode:'invalid',accent:'invalid'});
  assert.deepEqual(calls,[['light','pink'],['light','green']]);
  globalThis.window={MokuBridge:{setAppearance(){throw new Error('offline')}}};assert.doesNotThrow(()=>syncNativeAppearance(null));
  globalThis.window={};assert.doesNotThrow(()=>syncNativeAppearance(null));
 } finally {if(original===undefined)delete globalThis.window;else globalThis.window=original;}
});
