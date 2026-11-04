import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { titleKey } from '../src/collections.js';
import {
  FRANCHISE_CHAINS_KEY,
  buildFranchiseChainViews,
  buildMarathonSession,
  chainForTitle,
  createFranchiseChain,
  deleteFranchiseChain,
  dismissFranchiseSuggestion,
  franchiseChainSummary,
  franchiseEntryLabel,
  moveFranchiseEntry,
  normalizeFranchiseChains,
  rankFranchiseCandidates,
  readFranchiseChains,
  saveFranchiseChains,
  scoreFranchiseCandidate,
  sortFranchiseItems,
  suggestedChainName,
  suggestFranchiseChains,
  updateFranchiseChain,
} from '../src/franchise-chains.js';
import { BACKUP_KEYS, buildBackup, parseBackup } from '../src/backup.js';
import {
  applySyncSnapshotToStorage,
  markDeviceSyncPublished,
  prepareDeviceSync,
  readDeviceSyncMeta,
  snapshotFromStorage,
} from '../src/device-sync.js';

class Store {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const item = (id, title, options = {}) => ({
  source: options.source || 'sogo',
  url: `https://example.test/${options.source || 'sogo'}/${id}`,
  title,
  image: `https://example.test/${id}.jpg`,
  type: options.type || 'TV',
  status: options.status || 'Completed',
  genres: options.genres || ['Action', 'Fantasy'],
  year: options.year,
  episodeCount: options.episodeCount,
});
const ep = (id, number, source = 'sogo') => ({
  number: String(number),
  url: `https://example.test/${source}/${id}/ep-${number}`,
  title: `Episode ${number}`,
  ids: '',
});
const categoryOf = value => ({ sogo: 'Anime', animesalt: 'Anime', xin: 'Donghua' })[typeof value === 'string' ? value : value?.source] || '';

const season1 = item(1, 'Star Journey', { year: 2020, episodeCount: 2 });
const season2 = item(2, 'Star Journey Season 2', { year: 2022, episodeCount: 2 });
const season2Part2 = item(3, 'Star Journey Season 2 Part 2', { year: 2023, episodeCount: 2 });
const movie = item(4, 'Star Journey The Movie', { year: 2024, type: 'Movie', episodeCount: 1 });
const season2Alt = item(2, 'Star Journey Season 2', { source: 'animesalt', year: 2022, episodeCount: 2 });

test('franchise chains normalize, persist and keep one title in one chain', () => {
  let state = createFranchiseChain(null, {
    id: 'star-journey',
    items: [season2, season1, season2],
  }, 1000);
  assert.equal(state.chains['star-journey'].name, 'Star Journey');
  assert.deepEqual(state.chains['star-journey'].entries.map(entry => entry.label), ['Season 2', 'Season 1']);
  assert.equal(chainForTitle(state, season1).id, 'star-journey');

  state = moveFranchiseEntry(state, 'star-journey', season1, -1, 1100);
  assert.deepEqual(state.chains['star-journey'].entries.map(entry => entry.key), [titleKey(season1), titleKey(season2)]);

  state = createFranchiseChain(state, {
    id: 'second-chain',
    name: 'Moved season',
    items: [season2, movie],
  }, 1200);
  assert.deepEqual(state.chains['star-journey'].entries.map(entry => entry.key), [titleKey(season1)]);
  assert.deepEqual(state.chains['second-chain'].entries.map(entry => entry.key), [titleKey(season2), titleKey(movie)]);

  state = updateFranchiseChain(state, 'second-chain', { items: [movie, season2] }, 1300);
  assert.deepEqual(state.chains['second-chain'].entries.map(entry => entry.label), ['Movie', 'Season 2']);
  state = updateFranchiseChain(state, 'second-chain', { items: [] }, 1400);
  assert.equal(state.chains['second-chain'], undefined);

  const store = new Store();
  assert.equal(saveFranchiseChains(store, state), true);
  assert.deepEqual(readFranchiseChains(store), normalizeFranchiseChains(state));
  assert.equal(FRANCHISE_CHAINS_KEY, 'moku.franchiseChains.v1');

  state = deleteFranchiseChain(state, 'star-journey');
  assert.deepEqual(state.chains, {});
});

test('suggested names, labels and order are conservative and reviewable', () => {
  assert.equal(suggestedChainName([season2Part2, movie, season1, season2]), 'Star Journey');
  assert.deepEqual(sortFranchiseItems([movie, season2Part2, season2, season1]).map(entry => entry.title), [
    'Star Journey',
    'Star Journey Season 2',
    'Star Journey Season 2 Part 2',
    'Star Journey The Movie',
  ]);
  assert.equal(franchiseEntryLabel(season1, [season1, season2]), 'Season 1');
  assert.equal(franchiseEntryLabel(season2, [season2, season2Part2]), 'Season 2 · Part 1');
  assert.equal(franchiseEntryLabel(movie, [movie]), 'Movie');
});

test('franchise scoring separates sequels from likely duplicate source listings', () => {
  const sequel = scoreFranchiseCandidate(season1, season2, { categoryOf });
  assert.ok(sequel.score >= 80);
  assert.equal(sequel.sameEntry, false);

  const sameEntry = scoreFranchiseCandidate(season2, season2Alt, { categoryOf });
  assert.equal(sameEntry.sameEntry, true);
  assert.ok(sameEntry.score < 55);
  assert.deepEqual(rankFranchiseCandidates(season1, [season2Alt, season2, movie], { categoryOf }).map(entry => entry.item.title), [
    'Star Journey Season 2',
    'Star Journey The Movie',
  ]);

  const donghuaSeason2 = item(99, 'Star Journey Season 2', { source: 'xin', year: 2022 });
  assert.equal(scoreFranchiseCandidate(season1, donghuaSeason2, { categoryOf }).score, 0);
});

test('local suggestions dedupe source versions, support dismissal and propose missing entries', () => {
  const suggestions = suggestFranchiseChains(
    [season2Alt, movie, season2Part2, season1, season2],
    null,
    { categoryOf },
  );
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].kind, 'create');
  assert.deepEqual(suggestions[0].items.map(entry => entry.title), [
    'Star Journey',
    'Star Journey Season 2',
    'Star Journey Season 2 Part 2',
    'Star Journey The Movie',
  ]);
  assert.equal(suggestions[0].items.filter(entry => entry.title === 'Star Journey Season 2').length, 1);

  const dismissed = dismissFranchiseSuggestion(null, suggestions[0], 2000);
  assert.deepEqual(suggestFranchiseChains([season1, season2, season2Part2, movie], dismissed, { categoryOf }), []);

  const existing = createFranchiseChain(null, { id: 'star', items: [season1, season2] }, 2100);
  const additions = suggestFranchiseChains([season1, season2, season2Part2], existing, { categoryOf });
  assert.equal(additions.length, 1);
  assert.equal(additions[0].kind, 'add');
  assert.equal(additions[0].chainId, 'star');
  assert.deepEqual(additions[0].candidateItems.map(entry => entry.title), ['Star Journey Season 2 Part 2']);
});

test('Marathon Mode follows chain order, crosses a completed season and builds one session', () => {
  const state = createFranchiseChain(null, {
    id: 'star',
    items: [season1, season2],
  }, 1000);
  const progress = [
    { item: season1, episodes: [ep(1, 2), ep(1, 1)], watched: [ep(1, 1).url], updatedAt: 3000 },
    { item: season2, episodes: [ep(2, 1), ep(2, 2)], watched: [], updatedAt: 2500 },
  ];
  const [view] = buildFranchiseChainViews(state, { knownItems: [season1, season2], progress });
  assert.equal(view.status, 'in-progress');
  assert.equal(view.currentEntry.key, titleKey(season1));
  assert.equal(view.nextAction.kind, 'play');
  assert.equal(view.nextAction.episode.number, '2');
  assert.equal(view.percent, 0.25);
  assert.deepEqual(buildMarathonSession(view, { episodeGoal: 3 }).map(step => `${step.entryLabel}:${step.episode.number}`), [
    'Season 1:2',
    'Season 2:1',
    'Season 2:2',
  ]);

  const handoffProgress = [
    { item: season1, episodes: [ep(1, 1), ep(1, 2)], watched: [ep(1, 1).url, ep(1, 2).url], updatedAt: 4000 },
    progress[1],
  ];
  const [handoff] = buildFranchiseChainViews(state, { knownItems: [season1, season2], progress: handoffProgress });
  assert.equal(handoff.handoff, true);
  assert.equal(handoff.currentEntry.key, titleKey(season2));
  assert.equal(handoff.nextAction.episode.number, '1');
  assert.equal(handoff.entriesCompleted, 1);
  assert.equal(franchiseChainSummary([handoff]).handoffs, 1);

  const [personalComplete] = buildFranchiseChainViews(state, {
    knownItems: [season1, season2],
    libraryMeta: { [titleKey(season1)]: { rating: 0, note: '', status: 'completed', updatedAt: 10 } },
  });
  assert.equal(personalComplete.entries[0].completed, true);
  assert.equal(personalComplete.currentEntry.key, titleKey(season2));
  assert.equal(personalComplete.nextAction.kind, 'open');
});

test('a confirmed alternate listing can supply the playable snapshot for the same entry only', () => {
  const state = createFranchiseChain(null, { id: 'star', items: [season1, season2] }, 1000);
  const related = {
    [titleKey(season1)]: [titleKey(season1), titleKey(season2Alt)],
    [titleKey(season2Alt)]: [titleKey(season2Alt), titleKey(season1)],
  };
  // season2Alt is deliberately not the same entry as season1 in real use; this
  // fixture only proves the related-key plumbing. Use a true alternate below.
  const season1Alt = item(1, 'Star Journey', { source: 'animesalt', year: 2020, episodeCount: 2 });
  related[titleKey(season1)] = [titleKey(season1), titleKey(season1Alt)];
  related[titleKey(season1Alt)] = [titleKey(season1Alt), titleKey(season1)];
  const [view] = buildFranchiseChainViews(state, {
    knownItems: [season1, season1Alt, season2],
    progress: [{
      item: season1Alt,
      episodes: [ep(1, 1, 'animesalt'), ep(1, 2, 'animesalt')],
      watched: [ep(1, 1, 'animesalt').url],
      updatedAt: 5000,
    }],
    relatedKeysByTitle: related,
  });
  assert.equal(view.currentEntry.playItem.source, 'animesalt');
  assert.equal(view.nextAction.episode.url, ep(1, 2, 'animesalt').url);
  assert.equal(view.entries[1].watchedCount, 0, 'progress never crosses into Season 2 through the chain');
});

test('franchise chains are included in manual backups', () => {
  const state = createFranchiseChain(null, { id: 'star', items: [season1, season2] }, 1000);
  const store = new Store({ [FRANCHISE_CHAINS_KEY]: JSON.stringify(state) });
  assert.equal(BACKUP_KEYS.includes(FRANCHISE_CHAINS_KEY), true);
  const backup = buildBackup(store, 1000);
  const parsed = parseBackup(JSON.stringify(backup));
  assert.equal(parsed.summary.franchiseChains, 1);
  assert.deepEqual(normalizeFranchiseChains(JSON.parse(parsed.data[FRANCHISE_CHAINS_KEY])), state);
});

test('franchise chains converge and delete through shared-folder sync tombstones', () => {
  const publish = (store, peers, platform, now) => {
    const result = prepareDeviceSync(store, peers, { platform, now });
    if (result.shouldWrite) markDeviceSyncPublished(store, result.signature, result.revision, now);
    return result;
  };
  const state = createFranchiseChain(null, { id: 'star', items: [season1, season2] }, 1000);
  const android = new Store();
  readDeviceSyncMeta(android, 'android', { create: true, randomId: () => 'aaaaaaaaaaaaaaaa' });
  applySyncSnapshotToStorage(android, { franchiseChains: state });
  const firstAndroid = publish(android, [], 'android', 1000);
  assert.equal(Object.keys(firstAndroid.payload.data.franchiseChains.chains).length, 1);

  const windows = new Store();
  readDeviceSyncMeta(windows, 'windows', { create: true, randomId: () => 'bbbbbbbbbbbbbbbb' });
  applySyncSnapshotToStorage(windows, {});
  publish(windows, [firstAndroid.payloadText], 'windows', 2000);
  assert.equal(Object.keys(snapshotFromStorage(windows).franchiseChains.chains).length, 1);

  applySyncSnapshotToStorage(windows, { ...snapshotFromStorage(windows), franchiseChains: normalizeFranchiseChains(null) });
  const deletedWindows = publish(windows, [], 'windows', 3000);
  assert.equal(Object.keys(deletedWindows.payload.data.franchiseChains.chains).length, 0);
  publish(android, [deletedWindows.payloadText], 'android', 4000);
  assert.equal(Object.keys(snapshotFromStorage(android).franchiseChains.chains).length, 0);
});

test('Android and Windows share the Franchise Chains UI wiring', async () => {
  const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
  for (const marker of [
    "route.page==='chains'",
    '<FranchiseChainsPage',
    '<FranchiseChainPanel',
    '<FranchiseChainDialog',
    'Find related entries',
    'Build marathon session',
    'Download next',
    'Franchise Chains & Marathon Mode',
    'saveFranchiseChains(window.localStorage',
  ]) assert.equal(main.includes(marker), true, marker);
  assert.equal(styles.includes('.franchise-chain-card'), true);
  assert.equal(styles.includes('.franchise-dialog-body'), true);
});
