import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_SOURCE_HEALTH_KEY, normalizeHomeSourceHealth, readHomeSourceHealth, recordHomeSourceSuccess, formatHomeSourceFreshness } from '../src/source-health.js';

function storage(seed={}) {
  const values = new Map(Object.entries(seed));
  return { getItem:key=>values.get(key)||null, setItem:(key,value)=>values.set(key,String(value)) };
}

test('home source freshness accepts only known sources and valid timestamps',()=>{
  assert.deepEqual(normalizeHomeSourceHealth({sogo:123,xin:456,other:999,broken:'today',negative:-1,future:253402300800000}),{sogo:123,xin:456});
  assert.deepEqual(normalizeHomeSourceHealth(null),{});
  assert.deepEqual(recordHomeSourceSuccess({sogo:123},'xin',789),{sogo:123,xin:789});
  assert.deepEqual(recordHomeSourceSuccess({sogo:123},'other',789),{sogo:123});
});

test('home source freshness persists safely per browser storage',()=>{
  const clean=storage({[HOME_SOURCE_HEALTH_KEY]:JSON.stringify({sogo:123,xin:456,extra:789})});
  assert.deepEqual(readHomeSourceHealth(clean),{sogo:123,xin:456});
  clean.setItem(HOME_SOURCE_HEALTH_KEY,'{bad');
  assert.deepEqual(readHomeSourceHealth(clean),{});
  assert.deepEqual(readHomeSourceHealth({getItem(){throw new Error('blocked')}}),{});
});

test('home source freshness labels recent, minute, hour and missing updates',()=>{
  const now=20_000_000;
  assert.equal(formatHomeSourceFreshness(null,now),'Not updated yet');
  assert.equal(formatHomeSourceFreshness(now-5_000,now),'Just now');
  assert.equal(formatHomeSourceFreshness(now-125_000,now),'2 min ago');
  assert.equal(formatHomeSourceFreshness(now-7_200_000,now),'2 hr ago');
});
