import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SMART_DOWNLOADS_KEY,
  normalizeDownloadPreset,
  normalizeSmartDownloads,
  readSmartDownloads,
  saveSmartDownloads,
  smartDownloadsForSync,
  smartQueueDecision,
  smartTitleSelection,
  withDownloadPreset,
} from '../src/smart-downloads.js';
import { monitoredTitles } from '../src/episode-updates.js';
import { titleKey } from '../src/collections.js';
import { BACKUP_KEYS } from '../src/backup.js';

const series = { source: 'sogo', url: 'https://animesogo.to/watch/example', title: 'Example', image: 'cover', type: 'TV' };
const other = { source: 'xin', url: 'https://animexin.dev/example/', title: 'Other' };
const key = titleKey(series);
const trackId = `s:${'a'.repeat(32)}`;

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => values.set(name, String(value)),
    values,
  };
}

test('Smart Download settings normalize safely and round-trip through storage', () => {
  const normalized = normalizeSmartDownloads({
    enabled: true,
    wifiOnly: false,
    maxUnwatchedPerSeries: 99,
    notifyWhenReady: false,
    titleKeys: [key, key, 'junk', 'sogo|not-a-url'],
    collectionIds: ['favourites', 'favourites', 'bad id'],
    presets: {
      [key]: {
        language: 'indonesian', server: 'sogo-hd-1', quality: 'v:1280x720', subtitleMode: 'custom',
        subtitleTracks: [
          { id: trackId, label: 'English SDH', language: 'en' },
          { id: trackId, label: 'Duplicate', language: 'en' },
          { id: 'not-a-track', label: 'Bad', language: 'en' },
        ],
      },
      junk: { server: 'auto' },
    },
  });
  assert.deepEqual(normalized, {
    enabled: true,
    wifiOnly: false,
    maxUnwatchedPerSeries: 10,
    notifyWhenReady: false,
    titleKeys: [key],
    collectionIds: ['favourites'],
    presets: {
      [key]: {
        language: 'indonesian', server: 'sogo-hd-1', quality: 'v:1280x720', subtitleMode: 'custom',
        subtitleTracks: [{ id: trackId, label: 'English SDH', language: 'en' }],
      },
    },
  });

  const storage = memoryStorage();
  saveSmartDownloads(storage, normalized);
  assert.deepEqual(readSmartDownloads(storage), normalized);
  assert.ok(storage.values.has(SMART_DOWNLOADS_KEY));
  storage.setItem(SMART_DOWNLOADS_KEY, '{not json');
  assert.equal(readSmartDownloads(storage).enabled, false);
  assert.deepEqual(smartDownloadsForSync(normalized), {
    enabled: true, wifiOnly: false, maxUnwatchedPerSeries: 10, notifyWhenReady: false,
  });
  assert.ok(BACKUP_KEYS.includes(SMART_DOWNLOADS_KEY));
});

test('download presets keep durable choices only and fall back from invalid combinations', () => {
  assert.deepEqual(normalizeDownloadPreset({
    language: 'klingon', server: 'https://example.invalid/file', quality: '2160p', subtitleMode: 'custom',
    subtitleTracks: [{ id: trackId, label: 'English', language: 'en', url: 'https://expires.invalid/en.vtt' }],
  }), {
    language: 'english', server: 'auto', quality: 'best', subtitleMode: 'auto', subtitleTracks: [],
  });
  assert.deepEqual(normalizeDownloadPreset({
    language: 'english', server: 'sogo-vidstream-1', quality: 'best', subtitleMode: 'none',
    subtitleTracks: [{ id: trackId, label: 'English', language: 'en' }],
  }), {
    language: 'english', server: 'sogo-vidstream-1', quality: 'best', subtitleMode: 'none', subtitleTracks: [],
  });

  const saved = withDownloadPreset(normalizeSmartDownloads(null), key, {
    language: 'indonesian', server: 'sogo-hd-2', quality: 'f:720', subtitleMode: 'auto', subtitleTracks: [],
  });
  assert.deepEqual(saved.presets[key], {
    language: 'indonesian', server: 'sogo-hd-2', quality: 'f:720', subtitleMode: 'auto', subtitleTracks: [],
  });
});

test('title selection can be direct or through a selected collection', () => {
  const settings = normalizeSmartDownloads({ titleKeys: [], collectionIds: ['weekend'] });
  const collections = [
    { id: 'favourites', name: 'Favourites', items: [] },
    { id: 'weekend', name: 'Weekend', items: [key] },
  ];
  assert.deepEqual(smartTitleSelection(settings, key, collections), {
    selected: true, direct: false, collections: [{ id: 'weekend', name: 'Weekend' }],
  });
  assert.deepEqual(smartTitleSelection({ ...settings, titleKeys: [key] }, key, collections), {
    selected: true, direct: true, collections: [{ id: 'weekend', name: 'Weekend' }],
  });
  assert.equal(smartTitleSelection(settings, titleKey(other), collections).selected, false);
});

test('monitored titles carry Smart selection, presets and watched episodes only where needed', () => {
  const collections = [
    { id: 'favourites', name: 'Favourites', items: [key] },
    { id: 'weekend', name: 'Weekend', items: [titleKey(other)] },
  ];
  const settings = normalizeSmartDownloads({
    enabled: true,
    titleKeys: [key],
    collectionIds: [],
    presets: {
      [key]: { language: 'english', server: 'sogo-hd-1', quality: 'best', subtitleMode: 'auto', subtitleTracks: [] },
      [titleKey(other)]: { language: 'english', server: 'auto', quality: 'best', subtitleMode: 'auto', subtitleTracks: [] },
    },
  });
  const ep1 = 'https://animesogo.to/watch/example/ep-1';
  const ep2 = 'https://animesogo.to/watch/example/ep-2';
  const watched = monitoredTitles(
    [series, other],
    collections,
    settings,
    [{ key, item: series, watched: [ep1] }],
    [{ item: series, episode: { url: ep2 } }],
  );
  assert.equal(watched[0].smartDownload, true);
  assert.deepEqual(watched[0].watchedEpisodes, [ep1, ep2]);
  assert.equal(watched[0].downloadPreset.server, 'sogo-hd-1');
  assert.equal(watched[1].smartDownload, undefined);
  assert.equal(watched[1].watchedEpisodes, undefined);
  assert.equal(watched[1].downloadPreset.server, 'auto');
});

test('queue decisions skip watched and existing episodes and count only automatic unwatched records', () => {
  const ep = (n) => `https://animesogo.to/watch/example/ep-${n}`;
  const records = [
    { episode: { url: ep(1) }, status: 'completed', autoDownload: true },
    { episode: { url: ep(2) }, status: 'completed', autoDownload: false },
  ];
  assert.equal(smartQueueDecision({ episodeUrl: ep(3), watchedEpisodes: [ep(3)], records, maxUnwatchedPerSeries: 3 }), 'watched');
  assert.equal(smartQueueDecision({ episodeUrl: ep(2), watchedEpisodes: [], records, maxUnwatchedPerSeries: 3 }), 'existing');
  assert.equal(smartQueueDecision({ episodeUrl: ep(3), watchedEpisodes: [], records, maxUnwatchedPerSeries: 1 }), 'cap');
  assert.equal(smartQueueDecision({ episodeUrl: ep(3), watchedEpisodes: [ep(1)], records, maxUnwatchedPerSeries: 1 }), 'queue');
});
