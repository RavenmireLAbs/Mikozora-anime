import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCENTS,MODES,APPEARANCE_KEY,DEFAULT_APPEARANCE,normalizeAppearance,readAppearance,saveAppearance,applyAppearance,syncNativeAppearance} from '../src/appearance.js';

function storage(seed={}) {
 const map=new Map(Object.entries(seed));
 return {getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),snapshot:()=>Object.fromEntries(map)};
}
test('dark green remains the default; malformed preferences safely fall back per field',()=>{
 assert.deepEqual(readAppearance(storage()),{mode:'dark',accent:'green'});
 for(const raw of ['{oops','null','[]','"light"','17','true','{}'])
  assert.deepEqual(readAppearance(storage({[APPEARANCE_KEY]:raw})),DEFAULT_APPEARANCE,raw);
 assert.deepEqual(normalizeAppearance({mode:'light',accent:'unknown',other:'ignored'}),{mode:'light',accent:'green'});
 assert.deepEqual(normalizeAppearance({mode:'system',accent:'purple'}),{mode:'dark',accent:'purple'});
 assert.deepEqual(normalizeAppearance({mode:null,accent:42}),DEFAULT_APPEARANCE);
 assert.deepEqual(readAppearance({getItem(){throw new Error('blocked')}}),DEFAULT_APPEARANCE);
});
test('all ten combinations persist independently without touching existing user data',()=>{
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
  assert.deepEqual(calls,[['light','pink'],['dark','green']]);
  globalThis.window={MokuBridge:{setAppearance(){throw new Error('offline')}}};assert.doesNotThrow(()=>syncNativeAppearance(null));
  globalThis.window={};assert.doesNotThrow(()=>syncNativeAppearance(null));
 } finally {if(original===undefined)delete globalThis.window;else globalThis.window=original;}
});
