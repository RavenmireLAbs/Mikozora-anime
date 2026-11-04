import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_FORMAT, BACKUP_VERSION, backupFileName, buildBackup, parseBackup, applyBackup } from '../src/backup.js';

class Store {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(k) { return this.values.has(k) ? this.values.get(k) : null; }
  setItem(k, v) { this.values.set(k, String(v)); }
  removeItem(k) { this.values.delete(k); }
}

const full = () => new Store({
  'moku.library.v1': JSON.stringify([{ source: 'sogo', url: 'https://x/1' }]),
  'moku.collections.v1': JSON.stringify([{ id: 'favourites', name: 'Favourites', items: [] }]),
  'moku.history.v1': JSON.stringify([{ item: {}, episode: {}, time: 1 }, { item: {}, episode: {}, time: 2 }]),
  'moku.progress.v1': JSON.stringify([{ key: 'sogo|https://x/1' }]),
  'moku.sourceMatches.v1': JSON.stringify({
    version: 1,
    edges: {
      'animesalt|https://y/1\nsogo|https://x/1': {
        keys: ['animesalt|https://y/1', 'sogo|https://x/1'],
        items: {
          'animesalt|https://y/1': { source: 'animesalt', url: 'https://y/1', title: 'Same Show' },
          'sogo|https://x/1': { source: 'sogo', url: 'https://x/1', title: 'Same Show' },
        },
        updatedAt: 1,
      },
    },
  }),
  'moku.libraryMeta.v1': JSON.stringify({ 'sogo|https://x/1': { rating: 5, note: 'Rewatch', status: 'watching', updatedAt: 1 } }),
  'moku.watchPlanner.v1': JSON.stringify({ 'sogo|https://x/1': { mode: 'tonight', episodesPerSession: 3, updatedAt: 2 } }),
  'moku.offlineManager.v1': JSON.stringify({ storageLimitGb: 10, autoDeleteWatchedDays: 30, autoCleanup: true, queueOrder: [] }),
  'moku.offlinePlayback.v1': JSON.stringify({ playbackRate: 1.25, seekSeconds: 15, subtitleSize: 22, subtitleColor: 'yellow', subtitleBackground: 'solid', sleepTimerMinutes: 30, autoPlayNext: true }),
  'moku.appearance.v1': JSON.stringify({ mode: 'dark', accent: 'blue' }),
  'unrelated.key': 'keep me',
});

test('buildBackup collects only the known stores', () => {
  const backup = buildBackup(full(), Date.UTC(2026, 10, 2, 3, 4));
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.version, BACKUP_VERSION);
  assert.equal(backup.createdAt, '2026-11-02T03:04:00.000Z');
  assert.deepEqual(Object.keys(backup.data).sort(),
    ['moku.appearance.v1', 'moku.collections.v1', 'moku.history.v1', 'moku.library.v1', 'moku.libraryMeta.v1', 'moku.offlineManager.v1', 'moku.offlinePlayback.v1', 'moku.progress.v1', 'moku.sourceMatches.v1', 'moku.watchPlanner.v1'].sort());
  assert.ok(!('unrelated.key' in backup.data));
  assert.equal(backupFileName(new Date(2026, 10, 2, 3, 4)), 'mikozora-backup-2026-11-02-0304.json');
});

test('parseBackup round-trips and summarizes, applyBackup replaces device state', () => {
  const parsed = parseBackup(JSON.stringify(buildBackup(full())));
  assert.deepEqual(parsed.summary, { library: 1, collections: 1, history: 2, progress: 1, sourceMatches: 1 });
  const device = new Store({
    'moku.library.v1': '[]',
    'moku.sourceMatches.v1': '{"version":1,"edges":{"stale":{}}}',
    'moku.watchPlanner.v1': '{"stale|https://x/old":{"mode":"later"}}',
    'moku.offlinePlayback.v1': '{"playbackRate":2}',
    'moku.update.v1': '{"autoCheck":false}',
    'unrelated.key': 'keep me',
  });
  applyBackup(device, parsed.data);
  assert.equal(JSON.parse(device.getItem('moku.library.v1')).length, 1);
  assert.equal(JSON.parse(device.getItem('moku.libraryMeta.v1'))['sogo|https://x/1'].rating, 5);
  assert.equal(Object.keys(JSON.parse(device.getItem('moku.sourceMatches.v1')).edges).length, 1);
  assert.equal(JSON.parse(device.getItem('moku.sourceMatches.v1')).edges.stale, undefined);
  assert.equal(JSON.parse(device.getItem('moku.watchPlanner.v1'))['sogo|https://x/1'].mode, 'tonight');
  assert.equal(JSON.parse(device.getItem('moku.offlineManager.v1')).storageLimitGb, 10);
  assert.equal(JSON.parse(device.getItem('moku.offlinePlayback.v1')).seekSeconds, 15);
  assert.equal(device.getItem('moku.update.v1'), null); // absent from backup: cleared
  assert.equal(device.getItem('unrelated.key'), 'keep me'); // never touched

  const olderBackup = { ...parsed.data };
  delete olderBackup['moku.sourceMatches.v1'];
  delete olderBackup['moku.watchPlanner.v1'];
  delete olderBackup['moku.offlineManager.v1'];
  delete olderBackup['moku.offlinePlayback.v1'];
  applyBackup(device, olderBackup);
  assert.equal(device.getItem('moku.sourceMatches.v1'), null, 'a backup without confirmed links must clear stale links');
  assert.equal(device.getItem('moku.watchPlanner.v1'), null, 'an older point-in-time backup must clear newer planner state');
  assert.equal(device.getItem('moku.offlineManager.v1'), null);
  assert.equal(device.getItem('moku.offlinePlayback.v1'), null);
});

test('parseBackup rejects foreign, damaged and newer files', () => {
  assert.throws(() => parseBackup('not json'), /not a Mikozora backup/);
  assert.throws(() => parseBackup('{"format":"other","data":{}}'), /not a Mikozora backup/);
  assert.throws(
    () => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 1, data: { 'moku.library.v1': '[]' } })),
    /newer version/);
  assert.throws(
    () => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { 'moku.library.v1': '{broken' } })),
    /damaged/);
  assert.throws(
    () => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { 'moku.library.v1': 42 } })),
    /damaged/);
  assert.throws(
    () => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: {} })),
    /empty/);
  // Unknown keys inside data are ignored; known ones survive.
  const parsed = parseBackup(JSON.stringify({
    format: BACKUP_FORMAT, version: 1, data: { 'evil.key': '"x"', 'moku.library.v1': '[]' },
  }));
  assert.deepEqual(Object.keys(parsed.data), ['moku.library.v1']);
});
