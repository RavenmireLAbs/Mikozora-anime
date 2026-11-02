import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEVICE_SYNC_MAX_FILE_BYTES,
  DeviceSyncService,
} from '../desktop/src/lib/device-sync-service.js';

class MemoryStore {
  constructor() {
    this.values = new Map();
    this.flushes = 0;
  }

  get(key, fallback) { return this.values.has(key) ? this.values.get(key) : fallback; }
  set(key, value) { this.values.set(key, value); }
  flush() { this.flushes += 1; }
}

test('desktop device sync reads only bounded Mikozora files and writes atomically', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'mikozora-device-sync-'));
  const store = new MemoryStore();
  const service = new DeviceSyncService({ store, randomUUID: () => 'fixed-test-uuid' });
  const ownName = 'mikozora-sync-windows-aaaaaaaaaaaaaaaa.json';
  const peerName = 'mikozora-sync-android-bbbbbbbbbbbbbbbb.json';

  assert.deepEqual(await service.settings(), { configured: false, granted: false, name: '' });
  assert.deepEqual(await service.setFolder(folder), { configured: true, granted: true, name: folder.split('/').at(-1) });
  assert.equal(store.flushes, 1);

  await writeFile(join(folder, peerName), '{"peer":true}\n', 'utf8');
  await writeFile(join(folder, 'notes.txt'), 'not sync data', 'utf8');
  await writeFile(join(folder, 'mikozora-sync-windows-nothex.json'), '{}', 'utf8');
  await writeFile(join(folder, 'mikozora-sync-windows-cccccccccccccccc.json'), 'x'.repeat(DEVICE_SYNC_MAX_FILE_BYTES + 1), 'utf8');

  assert.deepEqual(await service.writeFile(ownName, '{"own":1}\n'), { written: true, name: ownName, bytes: 10 });
  assert.equal(await readFile(join(folder, ownName), 'utf8'), '{"own":1}\n');
  assert.deepEqual((await readdir(folder)).filter((name) => name.includes('.tmp-')), []);

  // A second write replaces the device file in place rather than leaving
  // a provider-visible partial JSON document at the final name.
  await service.writeFile(ownName, '{"own":2}\n');
  const listed = await service.readFolder();
  assert.deepEqual(listed.files.map((file) => file.name), [peerName, ownName]);
  assert.deepEqual(listed.files.map((file) => file.text), ['{"peer":true}\n', '{"own":2}\n']);
  assert.ok(listed.files.every((file) => Number.isFinite(file.modifiedAt)));
});

test('desktop device sync rejects unsafe writes and keeps shared files when disconnected', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'mikozora-device-sync-'));
  const service = new DeviceSyncService({ store: new MemoryStore() });
  const name = 'mikozora-sync-windows-aaaaaaaaaaaaaaaa.json';

  await service.setFolder(folder);
  await service.writeFile(name, '{}');
  await assert.rejects(service.writeFile('../mikozora-sync-windows-aaaaaaaaaaaaaaaa.json', '{}'), /Invalid device-sync file name/);
  await assert.rejects(service.writeFile('mikozora-backup.json', '{}'), /Invalid device-sync file name/);
  await assert.rejects(service.writeFile(name, ''), /too large/);
  await assert.rejects(service.writeFile(name, 'x'.repeat(DEVICE_SYNC_MAX_FILE_BYTES + 1)), /too large/);

  assert.deepEqual(await service.clearFolder(), { configured: false, granted: false, name: '' });
  assert.equal(await readFile(join(folder, name), 'utf8'), '{}', 'disconnecting must not delete the already-shared file');
  await assert.rejects(service.readFolder(), /Choose a sync folder/);
  await assert.rejects(service.writeFile(name, '{}'), /Choose a sync folder/);
});

test('desktop device sync reports a missing folder without exposing its path', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'mikozora-device-sync-'));
  const service = new DeviceSyncService({ store: new MemoryStore() });
  await service.setFolder(folder);
  await rm(folder, { recursive: true, force: true });

  const settings = await service.settings();
  assert.equal(settings.configured, true);
  assert.equal(settings.granted, false);
  assert.equal(settings.name.includes(tmpdir()), false);
  await assert.rejects(service.readFolder(), /access was lost/);
  await assert.rejects(service.setFolder(join(folder, 'missing')), /did not grant read and write access/);
});

test('desktop device sync reads at most the twelve newest candidate files', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'mikozora-device-sync-'));
  const service = new DeviceSyncService({ store: new MemoryStore() });
  await service.setFolder(folder);

  for (let index = 0; index < 13; index += 1) {
    const name = `mikozora-sync-windows-${String(index).padStart(16, '0')}.json`;
    const path = join(folder, name);
    await writeFile(path, `{"index":${index}}`, 'utf8');
    const date = new Date(Date.UTC(2026, 0, index + 1));
    await utimes(path, date, date);
  }

  const listed = await service.readFolder();
  assert.equal(listed.files.length, 12);
  assert.equal(listed.files.some((file) => file.text === '{"index":0}'), false);
  assert.equal(listed.files.some((file) => file.text === '{"index":12}'), true);
});
