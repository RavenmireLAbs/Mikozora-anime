import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { titleKey } from '../src/collections.js';
import {
  cleanDirectStream,
  episodePlaybackKey,
  formatPlaybackClock,
  normalizeOnlinePlayback,
  normalizeOnlinePositions,
  onlinePositionFor,
  readOnlinePlayback,
  rememberOnlinePosition,
  saveOnlinePlayback,
} from '../src/online-playback.js';
import {
  buildReleaseRadar,
  dismissReleaseRadarEntry,
  effectiveReleaseRadarRule,
  releaseRadarMonitorFields,
  setReleaseRadarRule,
} from '../src/release-radar.js';
import {
  applyPortabilityPreview,
  attachPortabilityMatch,
  buildAniListJson,
  buildLibraryCsv,
  buildMalXml,
  buildPortabilityPreview,
  buildPortableLibrary,
  buildShareCardSvg,
  parsePortableLibrary,
} from '../src/library-portability.js';
import {
  buildCommandIndex,
  clearSearchHistory,
  recordSearch,
  removeSavedSearch,
  saveSearch,
  searchCommands,
} from '../src/command-centre.js';
import { moodShelves, pickRandomTitle, similarTitles } from '../src/discovery.js';
import { monitoredTitles } from '../src/episode-updates.js';
import { BACKUP_KEYS } from '../src/backup.js';
import { ONLINE_PLAYBACK_KEY, ONLINE_PLAYBACK_PREFERENCE_VERSION, ONLINE_POSITIONS_KEY } from '../src/online-playback.js';
import { RELEASE_RADAR_KEY } from '../src/release-radar.js';
import { LIBRARY_PORTABILITY_KEY } from '../src/library-portability.js';
import { SEARCH_CENTRE_KEY } from '../src/command-centre.js';
import {
  alertSuppressed as desktopAlertSuppressed,
  inboxSuppressed as desktopInboxSuppressed,
} from '../desktop/src/lib/episode-store.js';
import {
  cleanOnlineStreamContext,
  onlineStreamHeaders,
  onlineStreamResponseHeaders,
} from '../desktop/src/lib/player-network.js';

const item = (id, title = `Series ${id}`, genres = ['Action']) => ({
  source: 'sogo',
  url: `https://animesogo.to/series/${id}`,
  title,
  image: '',
  type: 'TV',
  badge: '',
  status: 'Ongoing',
  genres,
  aired: '2024',
});
const episode = (id, number) => ({
  number: String(number),
  url: `https://animesogo.to/watch/${id}-ep-${number}`,
  title: `Episode ${number}`,
  ids: '',
});
const readText = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Online Player Pro keeps only bounded direct positions and clears finished episodes', () => {
  const series = item(1);
  const first = episode(1, 1);
  const second = episode(1, 2);

  assert.deepEqual(normalizeOnlinePlayback({ qualityCap: 4320, subtitleLanguage: 'spanish' }), {
    preferenceVersion: ONLINE_PLAYBACK_PREFERENCE_VERSION,
    directFirst: false,
    resume: true,
    autoPlayNext: true,
    qualityCap: 2160,
    subtitleLanguage: 'english',
  });
  assert.equal(normalizeOnlinePlayback({ directFirst: true }).directFirst, false, 'legacy auto-saved preferences move to the new off default');
  assert.equal(normalizeOnlinePlayback({ preferenceVersion: ONLINE_PLAYBACK_PREFERENCE_VERSION, directFirst: true }).directFirst, true, 'a later explicit on choice is remembered');
  const playbackStorage = new Map([[ONLINE_PLAYBACK_KEY, JSON.stringify({ directFirst: true })]]);
  const playbackStore = {
    getItem: key => playbackStorage.get(key) || null,
    setItem: (key, value) => playbackStorage.set(key, value),
  };
  assert.equal(readOnlinePlayback(playbackStore).directFirst, false);
  saveOnlinePlayback(playbackStore, { preferenceVersion: ONLINE_PLAYBACK_PREFERENCE_VERSION, directFirst: true });
  assert.equal(readOnlinePlayback(playbackStore).directFirst, true);
  assert.equal(formatPlaybackClock(3661.8), '1:01:01');

  let positions = rememberOnlinePosition({}, series, first, 321.9, 1400, 1000);
  positions = rememberOnlinePosition(positions, series, second, 88, 1400, 2000);
  assert.equal(onlinePositionFor(positions, series, first).seconds, 321);
  assert.equal(onlinePositionFor(positions, series, second).seconds, 88);

  positions = rememberOnlinePosition(positions, series, first, 1398, 1400, 3000, true);
  assert.equal(onlinePositionFor(positions, series, first), null);
  const goodKey = episodePlaybackKey(series, second);
  assert.deepEqual(normalizeOnlinePositions({
    bad: { seconds: -5 },
    [goodKey]: { seconds: 42.8, duration: 100, updatedAt: 5 },
  }), { [goodKey]: { seconds: 42, duration: 100, updatedAt: 5 } });

  const stream = cleanDirectStream({
    url: 'https://cdn.example/video/index.m3u8?token=private',
    mime: 'application/vnd.apple.mpegurl',
    token: 'stream-token',
    tracks: [{ label: 'English', language: 'en', preferred: true }],
  });
  assert.equal(stream.kind, 'hls');
  assert.equal(stream.token, 'stream-token');
  assert.equal(stream.tracks[0].preferred, true);
  assert.equal(cleanDirectStream({ url: 'http://cdn.example/video.mp4' }), null);
});

test('Release Radar separates device-alert suppression from inbox visibility and builds every view', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const series = item(2, 'Radar Weekly');
  const key = titleKey(series);
  let radar = setReleaseRadarRule({}, series, { mode: 'inbox' }, now);

  const inboxRule = effectiveReleaseRadarRule(radar, series, now);
  assert.equal(inboxRule.alertSuppressed, true);
  assert.equal(inboxRule.suppressed, false);
  assert.deepEqual(releaseRadarMonitorFields(radar, series, now), {
    alertMode: 'inbox',
    alertsMutedUntil: 0,
  });

  radar = setReleaseRadarRule(radar, series, { snoozedUntil: now + 7 * 86400000 }, now);
  const snoozedRule = effectiveReleaseRadarRule(radar, series, now);
  assert.equal(snoozedRule.alertSuppressed, true);
  assert.equal(snoozedRule.suppressed, true);
  assert.equal(releaseRadarMonitorFields(radar, series, now).alertsMutedUntil, now + 7 * 86400000);

  const updates = [0, 7, 14].map((daysAgo, index) => ({
    id: `u${index + 1}`,
    titleId: key,
    item: series,
    episode: episode(2, index + 1),
    discoveredAt: now - daysAgo * 86400000,
    read: index === 2,
  }));
  const downloads = [{
    id: 'd1',
    status: 'completed',
    autoDownload: true,
    downloadedAt: now - 3600000,
    item: series,
    episode: episode(2, 1),
  }];
  const view = buildReleaseRadar({ updates, downloads, monitoredItems: [series], radar, now });
  assert.equal(view.entries.length, 4);
  assert.equal(view.visibleUnread, 0, 'the active snooze hides the badge count but keeps history');
  assert.equal(view.readyDownloads, 1);
  assert.equal(view.digest[0].count, 3);
  assert.equal(view.calendar.length, 14);
  assert.equal(view.activity[0].pattern.typicalDays, 7);

  const dismissed = dismissReleaseRadarEntry(radar, 'download:d1');
  const dismissedView = buildReleaseRadar({ updates, downloads, monitoredItems: [series], radar: dismissed, now });
  assert.equal(dismissedView.entries.find(entry => entry.type === 'download').read, true);

  const monitored = monitoredTitles(
    [series],
    [{ id: 'favourites', name: 'Favourites', items: [key] }],
    null,
    [],
    [],
    radar,
    now,
  );
  assert.equal(monitored[0].alertMode, 'inbox');
  assert.equal(monitored[0].alertsMutedUntil, now + 7 * 86400000);
});

test('portable library exports round-trip without guessing unmatched external rows', () => {
  const series = item(3, 'Portable, & Co.');
  const key = titleKey(series);
  const episodes = [episode(3, 2), episode(3, 1), episode(3, 3)];
  const context = {
    library: [series],
    collections: [
      { id: 'favourites', name: 'Favourites', items: [key] },
      { id: 'weekend', name: 'Weekend', items: [key] },
    ],
    libraryMeta: { [key]: { rating: 4, note: 'Rewatch with Sam', status: 'watching', updatedAt: 10 } },
    progress: [{ key, item: series, episodes, watched: [episode(3, 1).url], updatedAt: 20 }],
    exportedAt: Date.parse('2026-11-04T00:00:00Z'),
  };

  const portable = buildPortableLibrary(context);
  assert.equal(portable.entries[0].title, series.title);
  assert.deepEqual(portable.entries[0].collections, ['Favourites', 'Weekend']);
  assert.equal(portable.entries[0].watchedEpisodes, 1);

  const csv = buildLibraryCsv(context);
  assert.match(csv, /"Portable, & Co\."/);
  assert.equal(parsePortableLibrary(csv, 'library.csv').entries[0].url, series.url);

  const mal = buildMalXml(context);
  assert.match(mal, /<myanimelist>/);
  assert.match(mal, /\[Mikozora sogo\|https:\/\/animesogo\.to\/series\/3\]/);
  assert.equal(parsePortableLibrary(mal, 'library.xml').entries[0].personalStatus, 'watching');

  const aniListText = buildAniListJson(context);
  assert.equal(typeof aniListText, 'string');
  assert.equal(JSON.parse(aniListText).format, 'mikozora-anilist-style');
  assert.equal(parsePortableLibrary(aniListText, 'library.json').entries[0].rating, 4);

  const parsed = parsePortableLibrary(JSON.stringify(portable), 'mikozora.json');
  const preview = buildPortabilityPreview({ entries: parsed.entries, ...context });
  assert.equal(preview.summary.existingTitles, 1);
  const applied = applyPortabilityPreview({ preview, ...context, now: 100 });
  assert.equal(applied.applied.updated, 1);
  assert.deepEqual(
    applied.progress.find(entry => entry.key === key).watched,
    [episode(3, 1).url],
  );

  const unmatchedPreview = buildPortabilityPreview({
    entries: [parsed.entries[0], {
      title: 'Unknown External Title',
      personalStatus: 'plan',
      watchedEpisodes: 2,
      collections: [],
      source: '',
      url: '',
    }],
    ...context,
    library: [],
  });
  assert.equal(unmatchedPreview.summary.unmatched, 1);
  assert.equal(unmatchedPreview.unmatched[0].title, 'Unknown External Title');
  assert.equal(unmatchedPreview.exactEntries.some(entry => entry.entry.title === 'Unknown External Title'), false);
  const matchedEntries = attachPortabilityMatch([
    parsed.entries[0],
    unmatchedPreview.unmatched[0],
  ], unmatchedPreview.unmatchedEntries[0].entryIndex, item(9, 'Chosen Source Title'));
  const matchedPreview = buildPortabilityPreview({ entries: matchedEntries, ...context, library: [] });
  assert.equal(matchedPreview.summary.unmatched, 0);
  assert.equal(matchedPreview.exactEntries.some(entry => entry.entry.url === item(9).url), true);

  const card = buildShareCardSvg({
    title: `${series.title} <script>`,
    subtitle: 'A local card',
    stats: [{ label: 'Episodes', value: '12' }],
  });
  assert.match(card, /^<\?xml/);
  assert.doesNotMatch(card, /<script>/);
  assert.match(card, /&lt;script&gt;/);
});

test('Search Centre and Command Centre stay local, bounded and searchable', () => {
  let centre = recordSearch({}, 'Moon Blade', 'sogo', 100);
  centre = recordSearch(centre, 'moon blade', 'sogo', 200);
  centre = saveSearch(centre, 'Moon Blade', 'sogo', 300, 'Blade searches');
  assert.equal(centre.history.length, 1);
  assert.equal(centre.saved[0].name, 'Blade searches');
  centre = removeSavedSearch(centre, centre.saved[0].id);
  assert.equal(centre.saved.length, 0);
  assert.equal(clearSearchHistory(centre).history.length, 0);

  const series = item(4, 'Moon Blade');
  const next = episode(4, 5);
  const commands = buildCommandIndex({
    actions: [{ id: 'action:planner', kind: 'action', title: 'Open Planner', page: 'planner', keywords: 'planner schedule catch up' }],
    library: [series],
    planner: [{ item: series, episode: next, behindCount: 3 }],
    downloads: [{ id: 'd4', item: series, episode: next, status: 'completed' }],
    updates: [{ id: 'u4', item: series, episode: next, read: false }],
  });
  assert.equal(commands.some(command => command.kind === 'planner-episode'), true);
  assert.equal(commands.some(command => command.kind === 'download'), true);
  assert.equal(commands.some(command => command.kind === 'update'), true);
  assert.equal(searchCommands(commands, 'moon ep 5').some(command => command.kind === 'planner-episode'), true);
  assert.equal(searchCommands(commands, 'schedule')[0].page, 'planner');
});

test('Discovery 2.0 explains similar picks, mood shelves and deterministic random choices', () => {
  const seed = item(5, 'Seed Quest', ['Action', 'Fantasy']);
  const close = item(6, 'Close Quest', ['Action', 'Fantasy']);
  const cozy = item(7, 'Cozy Days', ['Slice of Life', 'Comedy']);
  const libraryTitle = item(8, 'Saved Quest', ['Action', 'Fantasy']);
  const candidates = [seed, close, cozy, libraryTitle];

  const similar = similarTitles(seed, candidates, { library: [libraryTitle], progress: [], history: [] });
  assert.equal(similar[0].title, 'Close Quest');
  assert.match(similar[0].recommendationReason, /Action|Fantasy/);
  assert.equal(similar.some(entry => entry.title === 'Saved Quest'), false);

  const shelves = moodShelves(candidates, { library: [], progress: [], history: [] });
  assert.equal(shelves.some(shelf => shelf.id === 'cozy' && shelf.items[0].title === 'Cozy Days'), true);
  assert.equal(shelves.some(shelf => shelf.id === 'adrenaline' && shelf.items.some(entry => entry.title === 'Close Quest')), true);

  const firstPick = pickRandomTitle(candidates, { seed: 'tonight' });
  const secondPick = pickRandomTitle(candidates, { seed: 'tonight' });
  assert.equal(firstPick.url, secondPick.url);
  const rerolled = pickRandomTitle(candidates, { seed: 'tonight', excludeKeys: [firstPick] });
  assert.notEqual(rerolled.url, firstPick.url);
});

test('Windows direct-stream context and native Release Radar helpers remain scoped', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const context = cleanOnlineStreamContext({
    url: 'https://cdn.example/video.m3u8',
    referer: 'https://animesogo.to/',
    expiresAt: now + 60000,
  }, now);
  const request = {
    url: 'https://cdn.example/segment.ts',
    resourceType: 'xhr',
    referrer: 'mikozora://app/',
    requestHeaders: { Accept: '*/*' },
    responseHeaders: { 'Content-Type': ['video/mp2t'] },
  };
  assert.equal(onlineStreamHeaders(request, context, now).Referer, 'https://animesogo.to/');
  assert.deepEqual(onlineStreamResponseHeaders(request, context, now)['Access-Control-Allow-Origin'], ['*']);
  assert.equal(onlineStreamHeaders({ ...request, referrer: 'https://embed.example/play' }, context, now).Referer, undefined);
  assert.equal(onlineStreamResponseHeaders({ ...request, referrer: 'https://embed.example/play' }, context, now)['Access-Control-Allow-Origin'], undefined);
  assert.equal(onlineStreamHeaders(request, { ...context, expiresAt: now - 1 }, now).Referer, undefined);
  assert.equal(cleanOnlineStreamContext({ url: 'http://cdn.example/video.m3u8', referer: context.referer }, now), null);

  assert.equal(desktopAlertSuppressed({ alertMode: 'inbox', alertsMutedUntil: 0 }, now), true);
  assert.equal(desktopInboxSuppressed({ alertMode: 'inbox', alertsMutedUntil: 0 }, now), false);
  assert.equal(desktopInboxSuppressed({ alertMode: 'inbox', alertsMutedUntil: now + 1000 }, now), true);
  assert.equal(desktopInboxSuppressed({ alertMode: 'muted', alertsMutedUntil: 0 }, now), true);
});

test('new stores are included in manual backups', () => {
  for (const key of [
    ONLINE_PLAYBACK_KEY,
    ONLINE_POSITIONS_KEY,
    RELEASE_RADAR_KEY,
    LIBRARY_PORTABILITY_KEY,
    SEARCH_CENTRE_KEY,
  ]) assert.equal(BACKUP_KEYS.includes(key), true, key);
});

test('Android and Windows expose the same v0.31 bridge/player contracts', async () => {
  const [main, data, androidMain, directActivity, manifest, preload, bridge, desktopMain, featureSettings] = await Promise.all([
    readText('src/main.jsx'),
    readText('src/data.js'),
    readText('android/app/src/main/java/app/moku/anime/MainActivity.java'),
    readText('android/app/src/main/java/app/moku/anime/DirectPlayerActivity.java'),
    readText('android/app/src/main/AndroidManifest.xml'),
    readText('desktop/src/preload.cjs'),
    readText('desktop/src/bridge.js'),
    readText('desktop/src/main.js'),
    readText('src/feature-settings.jsx'),
  ]);

  assert.match(manifest, /DirectPlayerActivity/);
  assert.match(androidMain, /openOnlinePlayerPro/);
  assert.match(androidMain, /__mokuOnlinePosition/);
  assert.match(androidMain, /__mokuPlayerFallback/);
  assert.match(directActivity, /class DirectPlayerActivity/);
  assert.match(directActivity, /seekTo\(payload\.startPositionMs\)/);
  assert.match(directActivity, /requestFallback/);
  assert.match(main, /nativeFallbackPending/);
  assert.match(main, /nativeFallbackIgnoreCloseUntil/);
  assert.match(main, /const detailGenres=genreList\(detail\)/);
  assert.doesNotMatch(main, /detail\.genres\?\.\length\?detail\.genres\.join/);
  assert.match(main, /imageUrl\(item\.image \|\| item\.banner\)/);
  assert.match(data, /hasOnlinePlayerPro/);
  assert.match(data, /resolveOnlineStream/);
  assert.match(data, /openOnlinePlayer/);

  for (const method of ['resolveOnlineStream', 'clearOnlineStream', 'saveTextFile', 'openTextFile']) {
    assert.match(preload, new RegExp(method), `preload ${method}`);
    assert.match(bridge, new RegExp(method), `bridge ${method}`);
  }
  assert.match(desktopMain, /online-stream/);
  assert.match(desktopMain, /playerResponseHeaders/);
  assert.doesNotMatch(featureSettings, /JSON\.stringify\(buildAniListJson/);
});
