import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APP_VERSION, EXPERIENCE_KEY, LEGACY_KEYS, RELEASES, startupExperience, completeExperience } from '../src/releases.js';

class Store {
  constructor(initial={}) { this.values=new Map(Object.entries(initial)); }
  getItem(k) { return this.values.has(k)?this.values.get(k):null; }
  setItem(k,v) { this.values.set(k,String(v)); }
}
const state=s=>JSON.parse(s.getItem(EXPERIENCE_KEY));

test('fresh install shows introduction until explicitly dismissed, then remains quiet',()=>{
  const s=new Store();
  assert.deepEqual(startupExperience(s),{mode:'intro'});
  assert.deepEqual(state(s),{version:APP_VERSION,status:'pending',mode:'intro'});
  // The app may initialize its other keys before the welcome is dismissed.
  for(const key of LEGACY_KEYS)s.setItem(key,'[]');
  assert.deepEqual(startupExperience(s),{mode:'intro'},'restart before dismissal remains a first launch');
  assert.equal(completeExperience(s),true);
  assert.deepEqual(state(s),{version:APP_VERSION,status:'seen'});
  assert.equal(startupExperience(s),null,'same version does not show again');
});

test('upgrade from an older installation shows changes once without touching its data',()=>{
  const s=new Store({
    'moku.library.v1':'[{"title":"Saved show","source":"sogo"}]',
    'moku.history.v1':'[{"time":123}]',
    'moku.collections.v1':'[{"name":"Favourites"}]',
    'unrelated':'unchanged',
  });
  const before=new Map(s.values);
  assert.deepEqual(startupExperience(s),{mode:'update'});
  assert.equal(state(s).status,'pending');
  assert.deepEqual(startupExperience(s),{mode:'update'},'an interrupted update is shown again');
  completeExperience(s);
  assert.equal(startupExperience(s),null);
  for(const [key,value] of before)assert.equal(s.getItem(key),value,`${key} preserved`);
  assert.deepEqual(startupExperience(s,'9.0.1'),{mode:'update'},'a later app version triggers update notes');
  assert.deepEqual(state(s),{version:'9.0.1',status:'pending',mode:'update'});
  completeExperience(s,'9.0.1');assert.equal(startupExperience(s,'9.0.1'),null);
});

test('an interrupted first run stays an introduction even if a new version arrives',()=>{
  const s=new Store();startupExperience(s,'0.8.0');
  s.setItem('moku.library.v1','[]');
  assert.deepEqual(startupExperience(s,'0.8.1'),{mode:'intro'});
  assert.deepEqual(state(s),{version:'0.8.1',status:'pending',mode:'intro'});
});

test('corrupt or unavailable storage cannot crash the app',()=>{
  const s=new Store({[EXPERIENCE_KEY]:'not-json','moku.library.v1':'[]'});
  assert.deepEqual(startupExperience(s),{mode:'update'});
  const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
  assert.deepEqual(startupExperience(blocked),{mode:'intro'});assert.equal(completeExperience(blocked),false);
});

test('release, package and Android versions agree, with a current changelog',async()=>{
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
  const gradle=await readFile(new URL('../android/app/build.gradle',import.meta.url),'utf8');
  assert.equal(pkg.version,APP_VERSION);assert.equal(lock.version,APP_VERSION);assert.equal(lock.packages[''].version,APP_VERSION);
  assert.match(gradle,new RegExp(`versionName ['"]${APP_VERSION.replaceAll('.','\\.')}['"]`));
  assert.equal(RELEASES[0].version,APP_VERSION);assert.ok(RELEASES[0].entries.length>0);
  assert.equal(new Set(RELEASES.map(r=>r.version)).size,RELEASES.length);
});
