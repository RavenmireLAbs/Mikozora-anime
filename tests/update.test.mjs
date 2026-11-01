import test from 'node:test';
import assert from 'node:assert/strict';
import { UPDATE_KEY, CHECK_INTERVAL_MS, DEFAULT_UPDATE_STATE, parseVersion, compareVersions, isNewerVersion, releaseFromApi, readUpdateState, saveUpdateState, shouldAutoCheck, withCheckResult, visibleUpdate, dismissUpdate } from '../src/update.js';

class Store {
  constructor(initial={}) { this.values=new Map(Object.entries(initial)); }
  getItem(k) { return this.values.has(k)?this.values.get(k):null; }
  setItem(k,v) { this.values.set(k,String(v)); }
}

test('parses and compares release versions', () => {
  assert.deepEqual(parseVersion('v0.15.0'), [0,15,0]);
  assert.deepEqual(parseVersion('1.2'), [1,2,0]);
  assert.deepEqual(parseVersion(' 2.0.1 '), [2,0,1]);
  assert.equal(parseVersion('latest'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(undefined), null);
  assert.equal(compareVersions('0.15.0','v0.15.0'), 0);
  assert.equal(compareVersions('0.15.1','0.15.0'), 1);
  assert.equal(compareVersions('0.14.9','0.15.0'), -1);
  assert.equal(compareVersions('1.0.0','0.99.9'), 1);
  assert.equal(compareVersions('junk','0.15.0'), 0);
  assert.equal(isNewerVersion('0.16.0','0.15.0'), true);
  assert.equal(isNewerVersion('0.15.0','0.15.0'), false);
  assert.equal(isNewerVersion('0.14.0','0.15.0'), false);
});

test('shapes the GitHub releases payload and prefers the Android APK', () => {
  const info = releaseFromApi({
    tag_name: 'v0.16.0',
    html_url: 'https://github.com/RavenmireLAbs/Mikozora-anime/releases/tag/v0.16.0',
    assets: [
      { name: 'notes.zip', browser_download_url: 'https://example.com/notes.zip' },
      { name: 'Other.apk', browser_download_url: 'https://example.com/other.apk' },
      { name: 'Mikozora-v0.16.0-Android.apk', browser_download_url: 'https://example.com/Mikozora.apk' },
    ],
  });
  assert.deepEqual(info, { version:'0.16.0', pageUrl:'https://github.com/RavenmireLAbs/Mikozora-anime/releases/tag/v0.16.0', apkUrl:'https://example.com/Mikozora.apk' });
  assert.deepEqual(releaseFromApi({ tag_name:'v1.0.0', html_url:'https://example.com/r' }), { version:'1.0.0', pageUrl:'https://example.com/r', apkUrl:'' });
  const insecure = releaseFromApi({ tag_name:'v1.0.0', html_url:'http://example.com/r', assets:[{ name:'a.apk', browser_download_url:'http://example.com/a.apk' }] });
  assert.equal(insecure.pageUrl, '');
  assert.equal(insecure.apkUrl, '');
  assert.equal(releaseFromApi({ tag_name:'nightly' }), null);
  assert.equal(releaseFromApi(null), null);
  assert.equal(releaseFromApi('v1.0.0'), null);
});

test('persists update state and tolerates junk', () => {
  const store = new Store();
  assert.deepEqual(readUpdateState(store), DEFAULT_UPDATE_STATE);
  saveUpdateState(store, { ...DEFAULT_UPDATE_STATE, autoCheck:false, lastCheck:123, latest:'0.16.0', dismissed:'0.15.0' });
  const read = readUpdateState(store);
  assert.equal(read.autoCheck, false);
  assert.equal(read.lastCheck, 123);
  assert.equal(read.latest, '0.16.0');
  assert.equal(read.dismissed, '0.15.0');
  store.setItem(UPDATE_KEY, '{not json');
  assert.deepEqual(readUpdateState(store), DEFAULT_UPDATE_STATE);
  store.setItem(UPDATE_KEY, JSON.stringify({ latest: 42, lastCheck: 'soon', autoCheck: 'yes' }));
  const cleaned = readUpdateState(store);
  assert.equal(cleaned.latest, '');
  assert.equal(cleaned.lastCheck, 0);
  assert.equal(cleaned.autoCheck, true);
});

test('throttles automatic checks to twice a day', () => {
  const now = 1_000_000_000_000;
  assert.equal(shouldAutoCheck({ ...DEFAULT_UPDATE_STATE, lastCheck: 0 }, now), true);
  assert.equal(shouldAutoCheck({ ...DEFAULT_UPDATE_STATE, lastCheck: now - CHECK_INTERVAL_MS + 1 }, now), false);
  assert.equal(shouldAutoCheck({ ...DEFAULT_UPDATE_STATE, lastCheck: now - CHECK_INTERVAL_MS }, now), true);
  assert.equal(shouldAutoCheck({ ...DEFAULT_UPDATE_STATE, autoCheck: false, lastCheck: 0 }, now), false);
});

test('records check results and shows only un-dismissed newer releases', () => {
  const now = 1_700_000_000_000;
  const info = { version:'0.16.0', pageUrl:'https://example.com/r', apkUrl:'https://example.com/a.apk' };
  const checked = withCheckResult(DEFAULT_UPDATE_STATE, info, now);
  assert.equal(checked.lastCheck, now);
  assert.equal(checked.latest, '0.16.0');
  assert.deepEqual(visibleUpdate(checked, '0.15.0'), info);
  assert.equal(visibleUpdate(checked, '0.16.0'), null);
  assert.equal(visibleUpdate(checked, '0.17.0'), null);
  const failed = withCheckResult(DEFAULT_UPDATE_STATE, null, now);
  assert.equal(failed.lastCheck, now);
  assert.equal(failed.latest, '');
  assert.equal(visibleUpdate(failed, '0.15.0'), null);
  const dismissed = dismissUpdate(checked);
  assert.equal(dismissed.dismissed, '0.16.0');
  assert.equal(visibleUpdate(dismissed, '0.15.0'), null);
  const newer = withCheckResult(dismissed, { ...info, version:'0.16.1' }, now);
  assert.equal(visibleUpdate(newer, '0.15.0')?.version, '0.16.1');
});
