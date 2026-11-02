import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_SYNC_KEY,
  applySyncSnapshotToStorage,
  markDeviceSyncPublished,
  parseDeviceSyncFile,
  prepareDeviceSync,
  readDeviceSyncMeta,
  resetDeviceSyncPublication,
  setDeviceSyncTransport,
  snapshotFromStorage,
} from '../src/device-sync.js';
import { APPEARANCE_KEY } from '../src/appearance.js';
import { CONTENT_KEY } from '../src/content.js';
import { SMART_DOWNLOADS_KEY } from '../src/smart-downloads.js';

class Store {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const item = (n, title = `Series ${n}`) => ({
  source: 'sogo',
  url: `https://example.test/series-${n}`,
  title,
  image: `https://example.test/${n}.jpg`,
  type: 'TV',
});
const keyOf = (value) => `${value.source}|${value.url}`;
const ep = (series, n) => ({ number: String(n), url: `https://example.test/series-${series}/ep-${n}`, title: `Episode ${n}`, ids: '' });

function seed(store, data, platform, id) {
  readDeviceSyncMeta(store, platform, { create: true, randomId: () => id });
  applySyncSnapshotToStorage(store, data);
  return store;
}

function publish(store, peers, platform, now) {
  const result = prepareDeviceSync(store, peers, { platform, now });
  if (result.shouldWrite) markDeviceSyncPublished(store, result.signature, result.revision, now);
  return result;
}

test('prepares a bounded own-device file and does not republish an unchanged snapshot', () => {
  const store = seed(new Store(), {
    library: [item(1)],
    collections: [{ id: 'favourites', name: 'Favourites', items: [keyOf(item(1))] }],
    history: [{ item: item(1), episode: ep(1, 1), time: 900 }],
    progress: [],
    appearance: { mode: 'light', accent: 'pink' },
    content: { hideNsfw: true },
    smartDownloads: { enabled: true },
  }, 'android', 'aaaaaaaaaaaaaaaa');
  store.setItem('moku.update.v1', JSON.stringify({ dismissed: '9.9.9' }));
  store.setItem('moku.startup.v1', JSON.stringify({ version: '0.25.1', status: 'seen' }));

  const first = publish(store, [], 'android', 1000);
  assert.equal(first.fileName, 'mikozora-sync-android-aaaaaaaaaaaaaaaa.json');
  assert.equal(first.shouldWrite, true);
  assert.deepEqual(Object.keys(first.payload.data).sort(), [
    'appearance', 'collections', 'content', 'history', 'library', 'progress', 'smartDownloads',
  ]);
  assert.equal(JSON.stringify(first.payload).includes('9.9.9'), false);
  assert.equal(parseDeviceSyncFile(first.payloadText)?.deviceId, 'aaaaaaaaaaaaaaaa');
  assert.ok(JSON.parse(store.getItem(DEVICE_SYNC_KEY)).recordMeta.library[keyOf(item(1))]);

  const second = prepareDeviceSync(store, [], { platform: 'android', now: 2000 });
  assert.equal(second.shouldWrite, false);
  assert.equal(second.revision, first.revision);
});

test('transport choice stays local and reconnecting a transport forces one republish', () => {
  const store = seed(new Store(), {
    library: [item(1)],
    collections: [{ id: 'favourites', name: 'Favourites', items: [keyOf(item(1))] }],
    history: [],
    progress: [],
    appearance: { mode: 'dark', accent: 'blue' },
    content: { hideNsfw: false },
    smartDownloads: { enabled: false },
  }, 'android', 'aaaaaaaaaaaaaaaa');

  const first = publish(store, [], 'android', 1000);
  assert.equal(first.shouldWrite, true);
  assert.equal(prepareDeviceSync(store, [], { platform: 'android', now: 2000 }).shouldWrite, false);

  const googleMeta = setDeviceSyncTransport(store, 'google', 'android');
  assert.equal(googleMeta.transport, 'google');
  assert.equal(JSON.parse(store.getItem(DEVICE_SYNC_KEY)).transport, 'google');
  assert.equal(Object.hasOwn(first.payload, 'transport'), false, 'transport must not travel in sync payloads');

  resetDeviceSyncPublication(store, 'android');
  const republished = prepareDeviceSync(store, [], { platform: 'android', now: 3000 });
  assert.equal(republished.shouldWrite, true, 'a newly connected Drive folder may not contain this device file yet');
  assert.equal(republished.revision, first.revision + 1);
  assert.equal(setDeviceSyncTransport(store, 'carrier-pigeon', 'android').transport, 'folder');
});

test('two devices converge on library, collections, progress and settings additions', () => {
  const android = seed(new Store(), {
    library: [item(1)],
    collections: [{ id: 'favourites', name: 'Favourites', items: [keyOf(item(1))] }],
    history: [{ item: item(1), episode: ep(1, 1), time: 800 }],
    progress: [{ key: keyOf(item(1)), item: item(1), episodes: [ep(1, 1), ep(1, 2)], watched: [ep(1, 1).url], updatedAt: 800 }],
    appearance: { mode: 'dark', accent: 'green' },
    content: { hideNsfw: false },
    smartDownloads: { enabled: false, titleKeys: [keyOf(item(1))] },
  }, 'android', 'aaaaaaaaaaaaaaaa');
  const windows = seed(new Store(), {
    library: [item(2)],
    collections: [
      { id: 'favourites', name: 'Favourites', items: [] },
      { id: 'collection-weekend', name: 'Weekend', items: [keyOf(item(2))] },
    ],
    history: [],
    progress: [],
    appearance: { mode: 'light', accent: 'amber' },
    content: { hideNsfw: true },
    smartDownloads: { enabled: true, collectionIds: ['collection-weekend'] },
  }, 'windows', 'bbbbbbbbbbbbbbbb');

  const androidFile = publish(android, [], 'android', 1000);
  const windowsFile = publish(windows, [androidFile.payloadText], 'windows', 2000);
  let windowsData = snapshotFromStorage(windows);
  assert.deepEqual(windowsData.library.map((entry) => entry.title).sort(), ['Series 1', 'Series 2']);
  assert.ok(windowsData.collections.some((collection) => collection.id === 'collection-weekend'));
  assert.equal(windowsData.progress[0]?.watched[0], ep(1, 1).url);
  assert.deepEqual(windowsData.appearance, { mode: 'light', accent: 'amber' });
  assert.equal(windowsData.smartDownloads.titleKeys.includes(keyOf(item(1))), true);
  assert.equal(windowsData.smartDownloads.collectionIds.includes('collection-weekend'), true);

  const androidMerged = publish(android, [windowsFile.payloadText], 'android', 3000);
  const androidData = snapshotFromStorage(android);
  assert.equal(androidMerged.peerCount, 1);
  assert.deepEqual(androidData.library.map((entry) => entry.title).sort(), ['Series 1', 'Series 2']);
  assert.ok(androidData.collections.some((collection) => collection.name === 'Weekend'));
  assert.deepEqual(androidData.appearance, { mode: 'light', accent: 'amber' });
  assert.equal(androidData.content.hideNsfw, true);

  publish(windows, [androidMerged.payloadText], 'windows', 4000);
  windowsData = snapshotFromStorage(windows);
  assert.deepEqual(windowsData.library.map((entry) => entry.title).sort(), androidData.library.map((entry) => entry.title).sort());
});

test('library deletions and later re-additions propagate through tombstones', () => {
  const android = seed(new Store(), { library: [item(1)] }, 'android', 'aaaaaaaaaaaaaaaa');
  const windows = seed(new Store(), { library: [] }, 'windows', 'bbbbbbbbbbbbbbbb');
  const firstAndroid = publish(android, [], 'android', 1000);
  const firstWindows = publish(windows, [firstAndroid.payloadText], 'windows', 2000);
  assert.equal(snapshotFromStorage(windows).library.length, 1);

  applySyncSnapshotToStorage(windows, { ...snapshotFromStorage(windows), library: [] });
  const deletedWindows = publish(windows, [], 'windows', 3000);
  publish(android, [firstWindows.payloadText, deletedWindows.payloadText], 'android', 4000);
  assert.equal(snapshotFromStorage(android).library.length, 0);

  applySyncSnapshotToStorage(windows, { ...snapshotFromStorage(windows), library: [item(1)] });
  const readdedWindows = publish(windows, [], 'windows', 5000);
  publish(android, [readdedWindows.payloadText], 'android', 6000);
  assert.equal(snapshotFromStorage(android).library.length, 1);
});

test('unwatching an episode and removing a collection member propagate', () => {
  const series = item(1);
  const common = {
    library: [series],
    collections: [{ id: 'favourites', name: 'Favourites', items: [keyOf(series)] }],
    history: [
      { item: series, episode: ep(1, 2), time: 900 },
      { item: series, episode: ep(1, 1), time: 800 },
    ],
    progress: [{ key: keyOf(series), item: series, episodes: [ep(1, 1), ep(1, 2)], watched: [ep(1, 1).url, ep(1, 2).url], updatedAt: 900 }],
  };
  const android = seed(new Store(), common, 'android', 'aaaaaaaaaaaaaaaa');
  const windows = seed(new Store(), { library: [] }, 'windows', 'bbbbbbbbbbbbbbbb');
  const androidFile = publish(android, [], 'android', 1000);
  publish(windows, [androidFile.payloadText], 'windows', 2000);

  const changed = snapshotFromStorage(windows);
  changed.collections = changed.collections.map((collection) => collection.id === 'favourites' ? { ...collection, items: [] } : collection);
  changed.history = changed.history.filter((entry) => entry.episode.url !== ep(1, 2).url);
  changed.progress = changed.progress.map((entry) => ({ ...entry, watched: [ep(1, 1).url], updatedAt: 2500 }));
  applySyncSnapshotToStorage(windows, changed);
  const windowsFile = publish(windows, [], 'windows', 3000);

  publish(android, [windowsFile.payloadText], 'android', 4000);
  const merged = snapshotFromStorage(android);
  assert.deepEqual(merged.collections.find((collection) => collection.id === 'favourites')?.items, []);
  assert.deepEqual(merged.history.map((entry) => entry.episode.url), [ep(1, 1).url]);
  assert.deepEqual(merged.progress[0]?.watched, [ep(1, 1).url]);
});

test('malformed, future and own peer files are ignored safely', () => {
  const store = seed(new Store(), { library: [item(1)] }, 'android', 'aaaaaaaaaaaaaaaa');
  const own = publish(store, [], 'android', 1000);
  const future = JSON.stringify({ ...own.payload, version: 99, device: { ...own.payload.device, id: 'bbbbbbbbbbbbbbbb' } });
  const result = prepareDeviceSync(store, ['not json', own.payloadText, future, '{"format":"other"}'], { platform: 'android', now: 2000 });
  assert.equal(result.peerCount, 0);
  assert.equal(result.ignoredPeerFiles, 4);
  assert.equal(parseDeviceSyncFile(future), null);
  assert.equal(snapshotFromStorage(store).library.length, 1);
});

test('never-written default settings lose the first merge, then explicit changes win', () => {
  const android = seed(new Store(), {
    library: [item(1)],
    appearance: { mode: 'light', accent: 'pink' },
    content: { hideNsfw: true },
    smartDownloads: { enabled: true },
  }, 'android', 'aaaaaaaaaaaaaaaa');
  const windows = new Store();
  readDeviceSyncMeta(windows, 'windows', { create: true, randomId: () => 'bbbbbbbbbbbbbbbb' });
  applySyncSnapshotToStorage(windows, { library: [item(2)] });
  // Simulate a fresh installation whose normalized scalar stores were only
  // being read as defaults and had never actually been written by the user.
  windows.removeItem(APPEARANCE_KEY);
  windows.removeItem(CONTENT_KEY);
  windows.removeItem(SMART_DOWNLOADS_KEY);

  const androidFile = publish(android, [], 'android', 1000);
  const windowsFile = publish(windows, [androidFile.payloadText], 'windows', 2000);
  let windowsData = snapshotFromStorage(windows);
  assert.deepEqual(windowsData.library.map((entry) => entry.title).sort(), ['Series 1', 'Series 2']);
  assert.deepEqual(windowsData.appearance, { mode: 'light', accent: 'pink' });
  assert.equal(windowsData.content.hideNsfw, true);
  assert.equal(windowsData.smartDownloads.enabled, true);

  publish(android, [windowsFile.payloadText], 'android', 3000);
  assert.deepEqual(snapshotFromStorage(android).appearance, { mode: 'light', accent: 'pink' });

  windowsData = snapshotFromStorage(windows);
  applySyncSnapshotToStorage(windows, { ...windowsData, appearance: { mode: 'dark', accent: 'amber' } });
  const explicitWindowsFile = publish(windows, [], 'windows', 4000);
  publish(android, [explicitWindowsFile.payloadText], 'android', 5000);
  assert.deepEqual(snapshotFromStorage(android).appearance, { mode: 'dark', accent: 'amber' });
});
