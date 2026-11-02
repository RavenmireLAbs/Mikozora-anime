import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Android Smart Downloads use the episode snapshot, unmetered gate and ready route', () => {
  const store = read('android/app/src/main/java/app/moku/anime/EpisodeStore.java');
  const fetcher = read('android/app/src/main/java/app/moku/anime/EpisodeFetcher.java');
  const worker = read('android/app/src/main/java/app/moku/anime/EpisodeWorker.java');
  const smart = read('android/app/src/main/java/app/moku/anime/SmartDownloads.java');
  const offline = read('android/app/src/main/java/app/moku/anime/OfflineStore.java');
  const downloads = read('android/app/src/main/java/app/moku/anime/DownloadWorker.java');
  const main = read('android/app/src/main/java/app/moku/anime/MainActivity.java');

  assert.match(store, /root\.optJSONArray\("titles"\)/);
  assert.match(store, /normalizeSmartSettings/);
  assert.match(store, /sanitizeDownloadPreset/);
  assert.match(store, /successEvents/);
  assert.match(store, /pendingSmartDownloads/);
  assert.match(fetcher, /data-ids/);
  assert.match(fetcher, /final String key,number,title,url,ids/);
  assert.match(worker, /successEvents/);
  assert.match(worker, /SmartDownloads\.queuePending/);
  assert.match(smart, /"pendingCap"/);
  assert.match(smart, /OfflineStore\.enqueue\(c, input\.toString\(\), true/);
  assert.match(offline, /NetworkType\.UNMETERED/);
  assert.match(offline, /claimReadyNotification/);
  assert.match(offline, /DownloadManager\.Listener/);
  assert.match(offline, /DownloadWorker\.notifyReady/);
  assert.match(downloads, /NET_CAPABILITY_NOT_METERED/);
  assert.match(downloads, /setStopReason/);
  assert.match(downloads, /onStopped/);
  assert.match(downloads, /EXTRA_OPEN_DOWNLOADS/);
  assert.match(main, /SmartDownloads\.queuePending/);
  assert.match(main, /takeOpenDownloads/);
  assert.match(main, /moku-open-downloads/);
});

test('Windows Smart Downloads stay wired through the tray service and ready route', () => {
  const main = read('desktop/src/main.js');
  const preload = read('desktop/src/preload.cjs');
  const episodeService = read('desktop/src/lib/episode-service.js');
  const downloadService = read('desktop/src/lib/download-service.js');

  assert.match(main, /downloadService,\s*\n\s*notify: notifyEpisodes/);
  assert.match(main, /onDownloadReady: notifyDownloadReady/);
  assert.match(main, /moku:open-downloads/);
  assert.match(preload, /takeOpenDownloads/);
  assert.match(preload, /moku-open-downloads/);
  assert.match(episodeService, /queueSmartDownloads/);
  assert.match(episodeService, /successEvents/);
  assert.match(downloadService, /enqueueSmart/);
  assert.match(downloadService, /claimReadyNotification/);
});
