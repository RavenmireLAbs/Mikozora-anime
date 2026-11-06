import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { titleKey } from '../src/collections.js';
import {
  cleanupBytes,
  downloadCleanupCandidates,
  downloadStorageSummary,
  moveQueueOrder,
  normalizeOfflineManager,
  queueOrderIds,
  sortManagerDownloads,
} from '../src/offline-manager.js';
import {
  nextDownloadedEpisodes,
  normalizeOfflinePlayback,
  offlinePlaybackPayload,
  offlineSubtitleStyle,
} from '../src/offline-playback.js';
import {
  buildBingeSession,
  buildCatchUpQueue,
  normalizeWatchPlanner,
  plannerSummary,
  setWatchPlan,
} from '../src/watch-planner.js';
import {
  buildWrapped,
  computeWatchStats,
  formatWatchDuration,
  parseDurationMinutes,
} from '../src/watch-stats.js';

const idOf = (suffix) => String(suffix).padStart(32, '0');
const GiB = 1024 ** 3;

const showA = {
  source: 'sogo',
  url: 'https://animesogo.to/watch/show-a',
  title: 'Show A',
  image: '',
  type: 'TV',
  genres: ['Action', 'Fantasy'],
};
const showB = {
  source: 'xin',
  url: 'https://animexin.dev/show-b',
  title: 'Show B',
  image: '',
  type: 'ONA',
  genres: ['Action', 'Romance'],
};
const showC = {
  source: 'waves',
  url: 'https://xprime.today/show-c',
  title: 'Show C',
  image: '',
  type: 'Movie',
  genres: ['Slice of Life'],
};

function episode(item, number) {
  return {
    number: String(number),
    title: `Episode ${number}`,
    url: `${item.url}/episode-${number}`,
  };
}

function download(idSuffix, item, number, status, bytes, added, extra = {}) {
  return {
    id: idOf(idSuffix),
    item,
    episode: episode(item, number),
    status,
    bytes,
    added,
    downloadedAt: added,
    ...extra,
  };
}

function progressEntry(item, total, watchedThrough, updatedAt, extra = {}) {
  const episodes = Array.from({ length: total }, (_, index) => episode(item, index + 1));
  return {
    key: titleKey(item),
    item,
    episodes,
    watched: episodes.slice(0, watchedThrough).map((entry) => entry.url),
    updatedAt,
    ...extra,
  };
}

test('Offline Manager normalizes rules, summarizes storage and orders the visible queue', () => {
  assert.deepEqual(normalizeOfflineManager({
    storageLimitGb: 4,
    autoDeleteWatchedDays: 8,
    autoCleanup: 'yes',
    queueOrder: [idOf(2), idOf(2), 'not-an-id', idOf(1)],
  }), {
    storageLimitGb: 5,
    autoDeleteWatchedDays: 7,
    autoCleanup: false,
    queueOrder: [idOf(2), idOf(1)],
  });

  const records = [
    download(1, showA, 1, 'completed', 300, 100),
    download(2, showA, 2, 'completed', 200, 200),
    download(3, showB, 1, 'completed', 500, 300),
    download(4, showB, 2, 'downloading', 0, 400),
    download(5, showA, 3, 'queued', 0, 500),
    download(6, showB, 3, 'queued', 0, 600),
    download(7, showB, 4, 'failed', 0, 700),
  ];
  const summary = downloadStorageSummary(records, {
    [idOf(1)]: true,
    [idOf(3)]: { watched: true, watchedAt: 123 },
  });
  assert.equal(summary.totalRecords, 7);
  assert.equal(summary.totalBytes, 1000);
  assert.equal(summary.completedCount, 3);
  assert.equal(summary.completedBytes, 1000);
  assert.equal(summary.watchedCount, 2);
  assert.equal(summary.watchedBytes, 800);
  assert.equal(summary.unwatchedBytes, 200);
  assert.equal(summary.activeCount, 1);
  assert.equal(summary.queuedCount, 2);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.bySeries[0].title, 'Show B', 'equal series usage is ordered by episode count');
  assert.equal(summary.bySeries[0].bytes, 500);
  assert.equal(summary.bySeries.find((entry) => entry.title === 'Show A').bytes, 500);
  assert.equal(summary.bySource.find((entry) => entry.source === 'xin').watchedBytes, 500);

  const explicit = [idOf(6), idOf(4), idOf(5)];
  assert.deepEqual(queueOrderIds(records, explicit), explicit);
  assert.deepEqual(moveQueueOrder(explicit, idOf(5), -1), [idOf(6), idOf(5), idOf(4)]);
  assert.deepEqual(moveQueueOrder(explicit, idOf(5), 'front'), [idOf(5), idOf(6), idOf(4)]);
  assert.equal(sortManagerDownloads(records, { queueOrder: explicit })[0].id, idOf(4), 'the active transfer stays first in the all-downloads view');
  assert.deepEqual(
    sortManagerDownloads(records, { sort: 'size-desc' }).slice(0, 3).map((record) => record.id),
    [idOf(3), idOf(1), idOf(2)],
  );
});

test('watched cleanup respects age and storage limits without targeting unsafe records', () => {
  const now = Date.UTC(2026, 10, 5, 12);
  const day = 24 * 60 * 60 * 1000;
  const oldWatched = download(11, showA, 1, 'completed', 100, now - 12 * day);
  const recentWatched = download(12, showA, 2, 'completed', 200, now - 2 * day);
  const folderOnly = download(13, showA, 3, 'completed', 300, now - 20 * day, {
    storageMode: 'folder', exportVerified: true, cleanupStatus: 'complete',
  });
  const exporting = download(14, showB, 1, 'completed', 400, now - 20 * day, { exportStatus: 'exporting' });
  const unwatched = download(15, showB, 2, 'completed', 500, now - 20 * day);
  const watched = {
    [oldWatched.id]: { watched: true, watchedAt: now - 10 * day },
    [recentWatched.id]: { watched: true, watchedAt: now - day },
    [folderOnly.id]: { watched: true, watchedAt: now - 15 * day },
    [exporting.id]: { watched: true, watchedAt: now - 15 * day },
  };
  const ageCandidates = downloadCleanupCandidates(
    [recentWatched, folderOnly, exporting, unwatched, oldWatched],
    { autoDeleteWatchedDays: 7, storageLimitGb: 0 },
    watched,
    now,
  );
  assert.deepEqual(ageCandidates.map((entry) => entry.record.id), [oldWatched.id]);
  assert.equal(ageCandidates[0].reason, 'watched-age');
  assert.equal(cleanupBytes(ageCandidates), 100);

  const oldestLarge = download(21, showA, 4, 'completed', 0.7 * GiB, now - 30 * day);
  const nextLarge = download(22, showA, 5, 'completed', 0.5 * GiB, now - 20 * day);
  const largeUnwatched = download(23, showB, 3, 'completed', 0.5 * GiB, now - 10 * day);
  const limitCandidates = downloadCleanupCandidates(
    [nextLarge, largeUnwatched, oldestLarge],
    { autoDeleteWatchedDays: 0, storageLimitGb: 1 },
    {
      [oldestLarge.id]: { watched: true, watchedAt: now - 29 * day },
      [nextLarge.id]: { watched: true, watchedAt: now - 19 * day },
    },
    now,
  );
  assert.deepEqual(limitCandidates.map((entry) => entry.record.id), [oldestLarge.id]);
  assert.equal(limitCandidates[0].reason, 'storage-limit');
});

test('Offline Playback Pro normalizes shared preferences and finds the next saved episode', () => {
  const prefs = normalizeOfflinePlayback({
    playbackRate: 1.4,
    seekSeconds: 12,
    subtitleSize: 24,
    subtitleColor: 'unknown',
    subtitleBackground: 'solid',
    sleepTimerMinutes: 40,
    autoPlayNext: false,
    volume: 0.6,
  });
  assert.deepEqual(prefs, {
    playbackRate: 1.5,
    seekSeconds: 10,
    subtitleSize: 22,
    subtitleColor: 'white',
    subtitleBackground: 'solid',
    sleepTimerMinutes: 45,
    autoPlayNext: false,
    volume: 0.6,
  });
  assert.deepEqual(offlineSubtitleStyle({ ...prefs, subtitleColor: 'yellow', subtitleBackground: 'none' }), {
    '--offline-subtitle-color': '#ffe45c',
    '--offline-subtitle-background': 'transparent',
    '--offline-subtitle-size': '22px',
  });

  const current = download(31, showA, 1, 'completed', 100, 100);
  const records = [
    download(34, showA, 10, 'completed', 100, 400),
    current,
    download(32, showA, 2, 'completed', 100, 200),
    download(33, showA, 3, 'completed', 100, 300),
    download(35, showA, 4, 'queued', 0, 500),
    download(36, showB, 2, 'completed', 100, 600),
  ];
  const next = nextDownloadedEpisodes(records, current, 2);
  assert.deepEqual(next.map((record) => record.episode.number), ['2', '3']);
  assert.deepEqual(
    offlinePlaybackPayload(prefs, [...next, { id: 'not-a-download-id' }]).nextDownloadIds,
    next.map((record) => record.id),
  );
});

test('Planner ranks unfinished started series, deduplicates linked versions and builds a binge session', () => {
  const now = new Date(2026, 10, 5, 12).getTime();
  const day = 24 * 60 * 60 * 1000;
  const linkedA = { ...showA, source: 'suge', url: 'https://animesuge.to/watch/show-a' };
  const keyA = titleKey(showA);
  const keyLinkedA = titleKey(linkedA);
  const keyB = titleKey(showB);
  const keyC = titleKey(showC);
  const progress = [
    progressEntry(showA, 6, 2, now - day),
    progressEntry(linkedA, 6, 1, now - 20 * day),
    progressEntry(showB, 4, 3, now),
    progressEntry(showC, 5, 1, now),
  ];
  const plans = {
    [keyB]: { mode: 'tonight', episodesPerSession: 1, updatedAt: now },
  };
  const queue = buildCatchUpQueue({
    progress,
    plans,
    libraryMeta: {
      [keyB]: { status: 'watching', rating: 5, updatedAt: now },
      [keyC]: { status: 'dropped', rating: 0, updatedAt: now },
    },
    relatedKeysByTitle: {
      [keyA]: [keyA, keyLinkedA],
      [keyLinkedA]: [keyA, keyLinkedA],
    },
    now,
  });
  assert.equal(queue.length, 2, 'the linked Show A versions and dropped title must not create extra cards');
  const byKey = new Map(queue.map((entry) => [entry.key, entry]));
  assert.equal(byKey.get(keyA).watchedCount, 2);
  assert.equal(byKey.get(keyA).behindCount, 4);
  assert.equal(byKey.get(keyA).episode.number, '3');
  assert.equal(byKey.get(keyB).behindCount, 1);
  assert.deepEqual(plannerSummary(queue), {
    titlesBehind: 2,
    episodesBehind: 5,
    plannedTonight: 1,
    plannedWeekend: 0,
    nearlyFinished: 1,
  });
  assert.deepEqual(
    buildBingeSession(queue, { episodeGoal: 4 }).map((entry) => `${entry.item.title} ${entry.episode.number}`),
    ['Show B 4', 'Show A 3', 'Show A 4', 'Show A 5'],
  );
  assert.deepEqual(
    buildCatchUpQueue({
      progress,
      plans,
      libraryMeta: {
        [keyB]: { status: 'watching', rating: 5, updatedAt: now },
        [keyC]: { status: 'dropped', rating: 0, updatedAt: now },
      },
      relatedKeysByTitle: { [keyA]: [keyA, keyLinkedA], [keyLinkedA]: [keyA, keyLinkedA] },
      sort: 'finish',
      now,
    }).map((entry) => entry.item.title),
    ['Show B', 'Show A'],
  );

  assert.equal(normalizeWatchPlanner({ [keyA]: { mode: 'later', episodesPerSession: 99 } })[keyA].episodesPerSession, 10);
  assert.deepEqual(setWatchPlan(plans, showB, { mode: '' }, now), {});
});

test('Watch Stats and Wrapped use local history, progress and shelf data without double-counting opens', () => {
  const now = new Date(2026, 10, 5, 12);
  const at = (month, day) => new Date(2026, month, day, 12).getTime();
  const history = [
    { item: showA, episode: episode(showA, 2), time: at(10, 5) },
    { item: showA, episode: episode(showA, 2), time: at(10, 4) }, // older open of same episode
    { item: showA, episode: episode(showA, 1), time: at(10, 5) },
    { item: showA, episode: episode(showA, 3), time: at(10, 4) },
    { item: showB, episode: episode(showB, 1), time: at(10, 3) },
    { item: showB, episode: episode(showB, 2), time: at(9, 31) },
    { item: showC, episode: episode(showC, 1), time: at(9, 10) },
  ];
  const progress = [
    progressEntry(showA, 4, 3, now.getTime()),
    progressEntry(showB, 2, 2, now.getTime()),
  ];
  const stats = computeWatchStats({
    history,
    progress,
    library: [showA, showB],
    libraryMeta: {
      [titleKey(showA)]: { status: 'watching', rating: 5, note: 'Finish soon', updatedAt: now.getTime() },
      [titleKey(showB)]: { status: 'completed', rating: 3, updatedAt: now.getTime() },
    },
    now,
  });
  assert.equal(stats.historyEpisodes, 6);
  assert.equal(stats.currentStreak, 3);
  assert.equal(stats.longestStreak, 3);
  assert.equal(stats.activeDays, 5);
  assert.equal(stats.last7Days, 5);
  assert.equal(stats.estimatedMinutes, 144);
  assert.deepEqual(stats.topGenres[0], { id: 'action', label: 'Action', count: 5 });
  assert.equal(stats.topSources[0].id, 'sogo');
  assert.equal(stats.weekly.at(-1).count, 4);
  assert.equal(stats.monthly.at(-1).count, 4);
  assert.equal(stats.progress.titlesStarted, 2);
  assert.equal(stats.progress.titlesCompleted, 1);
  assert.equal(stats.progress.titlesInProgress, 1);
  assert.ok(Math.abs(stats.progress.completionRate - 5 / 6) < 0.000001);
  assert.equal(stats.shelf.averageRating, 4);
  assert.equal(stats.shelf.withNotes, 1);

  const wrapped = buildWrapped({ history, month: '2026-11', now });
  assert.equal(wrapped.episodes, 4);
  assert.equal(wrapped.activeDays, 3);
  assert.deepEqual(wrapped.busiestDay, { day: '2026-11-05', count: 2 });
  assert.deepEqual(wrapped.newSeries.map((item) => item.title), ['Show A']);
  assert.equal(wrapped.previousMonthEpisodes, 2);
  assert.equal(wrapped.episodeChange, 2);

  assert.equal(parseDurationMinutes('1h 5m'), 65);
  assert.equal(parseDurationMinutes('00:24:30'), 25);
  assert.equal(parseDurationMinutes(1500), 25);
  assert.equal(formatWatchDuration(150), '2h 30m');
  assert.equal(formatWatchDuration(1500), '1d 1h');
});

test('v0.30 shared UI and both native bridges expose the same feature contracts', async () => {
  const [main, data, css, preload, bridge, androidBridge, androidStore, androidWorker, androidPlayer] = await Promise.all([
    readFile('src/main.jsx', 'utf8'),
    readFile('src/data.js', 'utf8'),
    readFile('src/style.css', 'utf8'),
    readFile('desktop/src/preload.cjs', 'utf8'),
    readFile('desktop/src/bridge.js', 'utf8'),
    readFile('android/app/src/main/java/app/moku/anime/MainActivity.java', 'utf8'),
    readFile('android/app/src/main/java/app/moku/anime/OfflineStore.java', 'utf8'),
    readFile('android/app/src/main/java/app/moku/anime/DownloadWorker.java', 'utf8'),
    readFile('android/app/src/main/java/app/moku/anime/OfflinePlayerActivity.java', 'utf8'),
  ]);

  for (const marker of [
    'function PlannerPage',
    'function StatsPage',
    "route.page==='planner'",
    "route.page==='stats'",
    'buildCatchUpQueue',
    'buildBingeSession',
    'computeWatchStats',
    'buildWrapped',
    'downloadCleanupCandidates',
    'offlinePlaybackPayload',
    'setDownloadQueueOrder',
  ]) assert.ok(main.includes(marker), `main.jsx must wire ${marker}`);
  assert.match(css, /video::cue/);
  assert.match(css, /offline-manager-panel/);
  assert.match(css, /planner-card/);
  assert.match(css, /wrapped-panel/);

  assert.match(data, /bridgeCall\('setDownloadQueueOrder'/);
  assert.match(data, /openOfflinePlayer/);
  assert.match(preload, /setDownloadQueueOrder: call\('setDownloadQueueOrder'\)/);
  assert.match(preload, /openOfflinePlayer: fire\('openOfflinePlayer'\)/);
  assert.match(bridge, /method === 'setDownloadQueueOrder'/);
  assert.match(bridge, /method === 'openDownload' \|\| method === 'openOfflinePlayer'/);

  assert.match(androidBridge, /public void setDownloadQueueOrder\(String id, String payload\)/);
  assert.match(androidBridge, /public void openOfflinePlayer\(String downloadId, String payload\)/);
  assert.match(androidBridge, /putExtra\("nextDownloadIds", nextIds\)/);
  assert.match(androidStore, /static JSONObject setQueueOrder/);
  assert.match(androidStore, /nextQueueOrder\(c\)/);
  assert.match(androidWorker, /isQueueTurn\(c,id\)/);
  assert.match(androidWorker, /OfflineStore\.queueCandidates\(c\)/);
  assert.match(androidPlayer, /applySubtitleStyle\(view\)/);
  assert.match(androidPlayer, /setPlaybackParameters\(new PlaybackParameters\(speed\)\)/);
  assert.match(androidPlayer, /seekBy\(-seekSeconds\*1000L\)/);
  assert.match(androidPlayer, /startSleepTimer\(\)/);
  assert.match(androidPlayer, /openNextDownload\(\)/);
  assert.match(androidPlayer, /sleepDeadlineElapsedMs/);
});
