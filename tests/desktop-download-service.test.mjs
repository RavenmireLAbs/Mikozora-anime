import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DownloadService, downloadIdFor } from '../desktop/src/lib/download-service.js';

async function waitFor(predicate, label) {
  const deadline = Date.now() + 10000;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function listFiles(root) {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else out.push(path);
    }
  }
  await walk(root);
  return out.sort();
}

test('download service retries, converts, plays, exports, cleans private copy and preserves folder file on remove', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mikozora-download-service-'));
  const baseDir = join(root, 'app-downloads');
  const exportRoot = join(root, 'chosen-folder');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(exportRoot, { recursive: true }));

  let resolveAttempts = 0;
  const resolver = {
    resolve: async () => {
      resolveAttempts++;
      if (resolveAttempts === 1) throw new Error('temporary host failure');
      return {
        url: 'https://cdn.example/episode.mp4?token=temporary',
        mime: 'video/mp4',
        referer: 'https://cdn.example/',
        host: 'FixtureHost',
        serverLabel: 'Fixture Server',
        subtitleDescription: 'Available subtitle tracks',
        fixedHeight: 720,
        tracks: [{
          url: 'https://cdn.example/en.srt', label: 'English', language: 'en',
          mime: 'application/x-subrip', preferred: true,
        }],
        files: [{ url: 'https://cdn.example/episode.mp4', height: 720 }],
      };
    },
    downloadOptions: async () => ({ servers: [{ id: 'sogo-fixture-0', label: 'Fixture', qualities: [{ id: 'best', label: 'Best' }], note: '' }], unavailable: 0 }),
  };
  const mediaProcessor = {
    remux: async ({ inputs, output }) => {
      const source = await readFile(inputs[0], 'utf8');
      const data = Buffer.from(`converted:${source}`);
      await writeFile(output, data);
      return { bytes: data.length, width: 1280, height: 720, hasVideo: true, hasAudio: true };
    },
    probe: async () => ({ hasVideo: true, hasAudio: true, width: 1280, height: 720 }),
  };
  const settings = new Map();
  const store = {
    get: (key, fallback) => (settings.has(key) ? settings.get(key) : fallback),
    set: (key, value) => settings.set(key, value),
    flush: () => {},
  };
  const service = new DownloadService({
    baseDir,
    store,
    resolver,
    mediaProcessor,
    publicUrlImpl: async (url) => new URL(url),
    safeGetImpl: async () => Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHello offline\n'),
    safeFetchImpl: async (url) => ({
      response: new Response('source-video', { headers: { 'content-type': 'video/mp4' } }),
      url: new URL(url),
    }),
  });
  await service.init();

  const payload = {
    episodes: [{
      item: { source: 'sogo', url: 'https://animesogo.to/watch/example', title: 'Example: The Series', image: '', type: 'TV' },
      episode: { url: 'https://animesogo.to/watch/example-episode-1', number: '1', title: 'Episode 1', ids: 'token' },
    }],
    language: 'english', server: 'auto', quality: 'best',
  };
  const id = downloadIdFor('sogo', payload.episodes[0].episode.url);
  assert.match(id, /^[a-f0-9]{32}$/);

  assert.deepEqual(await service.enqueue(JSON.stringify(payload)), { added: 1, skipped: 0 });
  let record = await waitFor(async () => {
    const found = (await service.list()).find((item) => item.id === id);
    return found?.status === 'failed' ? found : null;
  }, 'first attempt to fail');
  assert.match(record.error, /temporary host failure/);

  assert.deepEqual(await service.enqueue(JSON.stringify(payload)), { added: 1, skipped: 0 });
  record = await waitFor(async () => {
    const found = (await service.list()).find((item) => item.id === id);
    return found?.status === 'completed' ? found : null;
  }, 'retry to complete');
  assert.equal(record.qualityLabel, '720p (source label)');
  assert.equal(record.subtitleDescription, 'English subtitles saved');
  assert.equal(record.exportPath, undefined, 'public records must not expose the internal export path');

  const privateFile = join(baseDir, 'media', id, 'episode.mp4');
  assert.equal(await readFile(privateFile, 'utf8'), 'converted:source-video');
  await assert.rejects(access(join(baseDir, 'media', id, 'work')));

  const token = await service.createPlaybackToken(id);
  assert.ok(token);
  assert.equal(service.validPlaybackToken(id, token), true);
  assert.equal(service.validPlaybackToken(id, 'wrong'), false);
  assert.match(await service.subtitleContent(id, 0), /WEBVTT[\s\S]*00:00:01\.000 --> 00:00:02\.000[\s\S]*Hello offline/);

  assert.equal((await service.setDownloadFolder(exportRoot)).granted, true);
  assert.deepEqual(await service.queueExport(id), { queued: true });
  record = await waitFor(async () => {
    const found = (await service.list()).find((item) => item.id === id);
    return found?.exportStatus === 'completed' && found?.cleanupStatus === 'complete' ? found : null;
  }, 'folder export to verify and clean up');
  assert.equal(record.storageMode, 'folder');
  assert.match(record.exportUri, /^file:/);
  assert.equal(record.exportSubtitleCount, 1);
  await assert.rejects(access(privateFile));

  const exported = (await listFiles(exportRoot)).sort();
  assert.equal(exported.length, 2);
  assert.ok(exported.some((file) => file.endsWith('.mp4')));
  assert.ok(exported.some((file) => file.endsWith('.srt')));
  assert.ok(exported[0].includes('Example The Series - '));
  const exportedVideo = exported.find((file) => file.endsWith('.mp4'));
  assert.equal(await readFile(exportedVideo, 'utf8'), 'converted:source-video');
  assert.match(await service.subtitleContent(id, 0), /Hello offline/);

  await service.remove(id);
  assert.deepEqual(await service.list(), []);
  assert.equal(await readFile(exportedVideo, 'utf8'), 'converted:source-video', 'removing the app record keeps user-owned exports');
  await service.shutdown();
});

test('queued records recover on service startup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mikozora-download-recovery-'));
  const baseDir = join(root, 'downloads');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(baseDir, { recursive: true });
  const id = downloadIdFor('sogo', 'https://animesogo.to/watch/recovery-episode-1');
  await writeFile(join(baseDir, 'downloads.json'), JSON.stringify([{
    id,
    item: { source: 'sogo', url: 'https://animesogo.to/watch/recovery', title: 'Recovery', image: '', type: 'TV' },
    episode: { url: 'https://animesogo.to/watch/recovery-episode-1', number: '1', title: '', ids: 'x' },
    language: 'english', serverChoice: 'auto', qualityChoice: 'best',
    status: 'downloading', subtitleDescription: 'Preparing subtitles', added: Date.now(),
  }]));

  const service = new DownloadService({
    baseDir,
    resolver: {
      resolve: async () => ({
        url: 'https://cdn.example/recovery.mp4', mime: 'video/mp4', referer: '', host: 'Fixture',
        serverLabel: 'Fixture', subtitleDescription: 'No subtitles', fixedHeight: -1, tracks: [], files: [],
      }),
      downloadOptions: async () => ({ servers: [], unavailable: 0 }),
    },
    mediaProcessor: {
      remux: async ({ output }) => { const data = Buffer.from('recovered'); await writeFile(output, data); return { bytes: data.length, hasVideo: true, hasAudio: true }; },
      probe: async () => ({ hasVideo: true, hasAudio: true }),
    },
    publicUrlImpl: async (url) => new URL(url),
    safeGetImpl: async () => Buffer.alloc(0),
    safeFetchImpl: async (url) => ({ response: new Response('recovered-source'), url: new URL(url) }),
  });
  await service.init();
  const record = await waitFor(async () => (await service.list())[0]?.status === 'completed' ? (await service.list())[0] : null, 'recovered download');
  assert.equal(record.id, id);
  await service.shutdown();
});
