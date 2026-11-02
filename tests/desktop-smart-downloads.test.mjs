import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EpisodeStore } from '../desktop/src/lib/episode-store.js';
import { EpisodeService, smartQueueDecision } from '../desktop/src/lib/episode-service.js';
import { DownloadService, downloadIdFor } from '../desktop/src/lib/download-service.js';

const item = {
  source: 'sogo', url: 'https://animesogo.to/watch/example', title: 'Example Series',
  image: '', type: 'TV', badge: '', status: '',
};
const ep = (n) => ({
  key: `number:${n}`, number: String(n), title: `Episode ${n}`,
  url: `${item.url}/ep-${n}`, ids: `episode-${n}-token`, numeric: Number(n),
});
const preset = {
  language: 'english', server: 'sogo-hd-1', quality: 'v:1280x720',
  subtitleMode: 'auto', subtitleTracks: [],
};

class FakeDownloads {
  constructor() {
    this.records = [];
    this.calls = [];
    this.failPreset = false;
  }

  async list() { return JSON.parse(JSON.stringify(this.records)); }

  async enqueueSmart(request) {
    this.calls.push(JSON.parse(JSON.stringify(request)));
    if (this.failPreset && request.preset.server !== 'auto') throw new Error('preset unavailable');
    if (this.records.some((record) => record.episode.url === request.episode.url)) return { added: 0, skipped: 1 };
    this.records.push({
      item: request.item, episode: request.episode, status: 'queued', autoDownload: true,
      smartWifiOnly: request.wifiOnly, smartNotify: request.notifyWhenReady,
    });
    return { added: 1, skipped: 0 };
  }
}

function payload(watched = []) {
  return JSON.stringify({
    titles: [{ ...item, smartDownload: true, watchedEpisodes: watched, downloadPreset: preset }],
    smartDownloads: { enabled: true, wifiOnly: true, maxUnwatchedPerSeries: 1, notifyWhenReady: true },
  });
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test('Windows Smart Downloads queue only post-baseline episodes, respect the cap and fall back safely', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mikozora-smart-service-'));
  let clock = 3_000_000;
  const now = () => (clock += 1000);
  let seq = 0;
  let episodes = [ep(1)];
  const downloads = new FakeDownloads();
  const service = new EpisodeService({
    store: new EpisodeStore({ file: join(dir, 'episode-updates.json'), now, randomUUID: () => `uuid-${++seq}` }),
    downloadService: downloads,
    fetchEpisodes: async () => episodes.map((episode) => ({ ...episode })),
    notify: () => {},
    onStateChanged: () => {},
    now,
    batchDelayMs: 0,
    intervalMs: 60 * 60 * 1000,
  });
  await service.start();
  const eventFor = (n) => service.state().updates.find((event) => event.episode.number === String(n));

  await service.syncTitles(payload(), true);
  await service.idle();
  assert.deepEqual(downloads.calls, [], 'the silent baseline must not download old episodes');

  episodes = [ep(1), ep(2), ep(3)];
  await service.checkNow();
  await service.idle();
  assert.equal(downloads.calls.length, 1);
  assert.equal(downloads.calls[0].episode.number, '2');
  assert.equal(downloads.calls[0].episode.ids, 'episode-2-token');
  assert.deepEqual(downloads.calls[0].preset, preset);
  assert.equal(eventFor(2).smartDownloadStatus, 'queued');
  assert.equal(eventFor(3).smartDownloadStatus, 'pendingCap');

  await service.syncTitles(payload([ep(2).url]), false);
  assert.equal(downloads.calls.length, 2, 'watching the queued episode frees the cap');
  assert.equal(downloads.calls[1].episode.number, '3');
  assert.equal(eventFor(3).smartDownloadStatus, 'queued');

  downloads.records.push({ item, episode: ep(4), status: 'completed', autoDownload: false });
  episodes = [ep(1), ep(2), ep(3), ep(4)];
  await service.checkNow();
  await service.idle();
  assert.equal(downloads.calls.length, 2, 'an existing manual download is not duplicated');
  assert.equal(eventFor(4).smartDownloadStatus, 'existing');

  downloads.failPreset = true;
  await service.syncTitles(payload([ep(2).url, ep(3).url]), false);
  episodes = [ep(1), ep(2), ep(3), ep(4), ep(5)];
  await service.checkNow();
  await service.idle();
  assert.deepEqual(downloads.calls.slice(2).map((call) => [call.episode.number, call.preset.server, call.preset.quality]), [
    ['5', 'sogo-hd-1', 'v:1280x720'],
    ['5', 'auto', 'best'],
  ]);
  assert.equal(eventFor(5).smartDownloadStatus, 'queued');

  await service.shutdown();
});

test('Smart queue decisions use the selected series and ignore watched automatic records at the cap', () => {
  const track = { item, watchedEpisodes: [ep(1).url] };
  const records = [
    { item, episode: ep(1), status: 'completed', autoDownload: true },
    { item, episode: ep(2), status: 'completed', autoDownload: false },
    { item: { ...item, url: `${item.url}-other` }, episode: ep(3), status: 'downloading', autoDownload: true },
  ];
  assert.equal(smartQueueDecision({ episode: ep(1) }, track, records, 1), 'watched');
  assert.equal(smartQueueDecision({ episode: ep(2) }, track, records, 1), 'existing');
  assert.equal(smartQueueDecision({ episode: ep(4) }, track, records, 1), 'queue');
});

test('Windows DownloadService marks Smart records and claims the ready notification exactly once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mikozora-smart-download-'));
  const ready = [];
  const settings = new Map();
  const service = new DownloadService({
    baseDir: join(dir, 'downloads'),
    store: {
      get: (key, fallback) => settings.has(key) ? settings.get(key) : fallback,
      set: (key, value) => settings.set(key, value),
      flush: () => {},
    },
    resolver: {
      resolve: async () => ({
        url: 'https://cdn.example/episode.mp4', mime: 'video/mp4', referer: 'https://cdn.example/',
        host: 'Fixture', serverLabel: 'Fixture', subtitleDescription: 'No subtitle tracks', fixedHeight: 720, tracks: [],
      }),
      downloadOptions: async () => ({ servers: [], unavailable: 0 }),
    },
    mediaProcessor: {
      remux: async ({ inputs, output }) => {
        const source = await readFile(inputs[0], 'utf8');
        const data = Buffer.from(`converted:${source}`);
        await writeFile(output, data);
        return { bytes: data.length, width: 1280, height: 720, hasVideo: true, hasAudio: true };
      },
      probe: async () => ({ hasVideo: true, hasAudio: true }),
    },
    publicUrlImpl: async (url) => new URL(url),
    safeFetchImpl: async (url) => ({ response: new Response('source-video'), url: new URL(url) }),
    safeGetImpl: async () => Buffer.from(''),
    onDownloadReady: (record) => ready.push(record),
  });
  await service.init();
  const episode = { url: ep(9).url, number: '9', title: 'Episode 9', ids: 'episode-9-token' };
  assert.deepEqual(await service.enqueueSmart({
    item, episode, preset: { language: 'english', server: 'auto', quality: 'best', subtitleMode: 'auto', subtitleTracks: [] },
    wifiOnly: true, notifyWhenReady: true,
  }), { added: 1, skipped: 0 });
  const id = downloadIdFor(item.source, episode.url);
  const record = await waitFor(async () => {
    const found = (await service.list()).find((entry) => entry.id === id);
    return found?.status === 'completed' ? found : null;
  }, 'Smart download to complete');
  assert.equal(record.autoDownload, true);
  assert.equal(record.smartWifiOnly, true);
  assert.equal(record.smartNotify, true);
  assert.ok(record.readyNotifiedAt > 0);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].episode.number, '9');
  assert.equal(await service.notifyDownloadReady(id), false);
  assert.equal(ready.length, 1);
  await service.shutdown();
});
