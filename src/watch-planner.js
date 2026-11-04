// Catch-up planning from the progress snapshots Mikozora already keeps.
//
// The planner does not invent an airing schedule. It answers a local,
// practical question: of the series already started, what is waiting, how
// far behind is it, and what would make a good next sitting?
import { titleKey } from './collections.js';
import { normalizeProgress, watchedUrlSetForEpisodes } from './progress.js';
import { chronologicalEpisodes } from './episode-tools.js';
import { normalizeLibraryMeta } from './library-meta.js';

export const WATCH_PLANNER_KEY = 'moku.watchPlanner.v1';
export const WATCH_PLAN_MODES = [
  { id: 'tonight', label: 'Tonight' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'later', label: 'Later' },
];
const PLAN_MODE_IDS = new Set(WATCH_PLAN_MODES.map(mode => mode.id));
const MAX_PLANS = 300;

function keyOf(value) {
  if (typeof value === 'string') return value.includes('|') ? value : '';
  return value?.source && value?.url ? titleKey(value) : '';
}

function relatedKeysFor(key, relatedKeysByTitle) {
  const raw = relatedKeysByTitle && typeof relatedKeysByTitle === 'object' ? relatedKeysByTitle[key] : null;
  const out = new Set([key]);
  if (Array.isArray(raw) || raw instanceof Set) {
    for (const value of raw) {
      const clean = keyOf(value);
      if (clean) out.add(clean);
    }
  } else if (raw) {
    const clean = keyOf(raw);
    if (clean) out.add(clean);
  }
  return [...out];
}

function cleanPlan(value) {
  const input = value && typeof value === 'object' ? value : {};
  if (!PLAN_MODE_IDS.has(input.mode)) return null;
  const episodes = Number(input.episodesPerSession);
  return {
    mode: input.mode,
    episodesPerSession: Number.isFinite(episodes) ? Math.max(1, Math.min(10, Math.trunc(episodes))) : 3,
    updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : 0,
  };
}

export function normalizeWatchPlanner(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => typeof key === 'string' && key.includes('|') && key.length <= 700)
      .map(([key, plan]) => [key, cleanPlan(plan)])
      .filter(([, plan]) => plan)
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .slice(0, MAX_PLANS),
  );
}

export function readWatchPlanner(storage) {
  try {
    return normalizeWatchPlanner(JSON.parse(storage?.getItem?.(WATCH_PLANNER_KEY) || 'null'));
  } catch {
    return {};
  }
}

export function saveWatchPlanner(storage, value) {
  const normalized = normalizeWatchPlanner(value);
  try {
    storage?.setItem?.(WATCH_PLANNER_KEY, JSON.stringify(normalized));
  } catch { /* The current session can still use the normalized value. */ }
  return normalized;
}

export function setWatchPlan(plans, itemOrKey, patch, now = Date.now()) {
  const clean = normalizeWatchPlanner(plans);
  const key = keyOf(itemOrKey);
  if (!key) return clean;
  if (!patch || patch.mode === '' || patch.mode === null) {
    delete clean[key];
    return clean;
  }
  const next = cleanPlan({ ...(clean[key] || {}), ...patch, updatedAt: now });
  if (next) clean[key] = next;
  else delete clean[key];
  return normalizeWatchPlanner(clean);
}

export function watchPlanLabel(mode) {
  return WATCH_PLAN_MODES.find(entry => entry.id === mode)?.label || '';
}

function scoreEntry(entry, now) {
  const ageDays = Math.max(0, (now - (entry.updatedAt || 0)) / (24 * 60 * 60 * 1000));
  const recency = Math.max(0, 20 - ageDays);
  const planBonus = entry.plan?.mode === 'tonight' ? 45 : entry.plan?.mode === 'weekend' ? 28 : entry.plan?.mode === 'later' ? 10 : 0;
  const statusBonus = entry.personalStatus === 'watching' ? 8 : entry.personalStatus === 'plan' ? 5 : entry.personalStatus === 'paused' ? -18 : 0;
  return Math.round(
    Math.min(entry.behindCount, 30) * 2
    + recency
    + (entry.behindCount <= 3 ? 15 : 0)
    + entry.percent * 10
    + (Number(entry.personalRating) || 0) * 2
    + planBonus
    + statusBonus,
  );
}

export function buildCatchUpQueue({
  progress = [],
  history = [],
  libraryMeta = {},
  plans = {},
  relatedKeysByTitle = {},
  sort = 'smart',
  limit = 50,
  now = Date.now(),
} = {}) {
  const cleanProgress = normalizeProgress(progress);
  const cleanMeta = normalizeLibraryMeta(libraryMeta);
  const cleanPlans = normalizeWatchPlanner(plans);
  const candidates = [];

  for (const entry of cleanProgress) {
    const episodes = chronologicalEpisodes(entry.episodes || []);
    if (!episodes.length) continue;
    const relatedKeys = relatedKeysFor(entry.key, relatedKeysByTitle);
    const watched = watchedUrlSetForEpisodes(cleanProgress, history, entry.item, episodes, relatedKeys);
    let watchedCount = 0;
    let lastWatchedIndex = -1;
    episodes.forEach((episode, index) => {
      if (watched.has(episode.url)) {
        watchedCount++;
        lastWatchedIndex = index;
      }
    });
    if (!watchedCount) continue;
    const upNextEpisodes = episodes.slice(lastWatchedIndex + 1).filter(episode => !watched.has(episode.url));
    if (!upNextEpisodes.length) continue;

    const meta = cleanMeta[entry.key] || {};
    if (meta.status === 'dropped' || meta.status === 'completed') continue;
    const candidate = {
      key: entry.key,
      componentKey: relatedKeys.slice().sort().join('\n'),
      item: entry.item,
      episodes,
      episode: upNextEpisodes[0],
      upNextEpisodes,
      watchedCount,
      total: episodes.length,
      behindCount: upNextEpisodes.length,
      unwatchedCount: episodes.length - watchedCount,
      percent: episodes.length ? watchedCount / episodes.length : 0,
      updatedAt: entry.updatedAt || 0,
      plan: cleanPlans[entry.key] || null,
      personalStatus: meta.status || '',
      personalRating: Number(meta.rating) || 0,
    };
    candidate.score = scoreEntry(candidate, now);
    candidates.push(candidate);
  }

  // Confirmed source links describe one story, so the planner must offer it
  // once. Keep the strongest/most recent playable version as representative.
  const byComponent = new Map();
  for (const candidate of candidates) {
    const previous = byComponent.get(candidate.componentKey);
    if (!previous || candidate.score > previous.score || (candidate.score === previous.score && candidate.updatedAt > previous.updatedAt)) {
      byComponent.set(candidate.componentKey, candidate);
    }
  }

  const planRank = candidate => candidate.plan?.mode === 'tonight' ? 0 : candidate.plan?.mode === 'weekend' ? 1 : candidate.plan?.mode === 'later' ? 2 : 3;
  const queue = [...byComponent.values()].sort((a, b) => {
    if (sort === 'finish') return a.behindCount - b.behindCount || b.percent - a.percent || b.updatedAt - a.updatedAt;
    if (sort === 'behind') return b.behindCount - a.behindCount || b.updatedAt - a.updatedAt;
    if (sort === 'recent') return b.updatedAt - a.updatedAt || b.score - a.score;
    if (sort === 'planned') return planRank(a) - planRank(b) || b.score - a.score;
    return b.score - a.score || b.updatedAt - a.updatedAt;
  });
  const max = Number.isFinite(Number(limit)) ? Math.max(0, Math.trunc(Number(limit))) : 50;
  return max ? queue.slice(0, max) : queue;
}

export function plannerSummary(queue) {
  const clean = Array.isArray(queue) ? queue : [];
  return {
    titlesBehind: clean.length,
    episodesBehind: clean.reduce((sum, entry) => sum + (Number(entry.behindCount) || 0), 0),
    plannedTonight: clean.filter(entry => entry.plan?.mode === 'tonight').length,
    plannedWeekend: clean.filter(entry => entry.plan?.mode === 'weekend').length,
    nearlyFinished: clean.filter(entry => entry.behindCount > 0 && entry.behindCount <= 3).length,
  };
}

export function buildBingeSession(queue, { episodeGoal = 6, defaultPerTitle = 3 } = {}) {
  const goal = Math.max(1, Math.min(50, Math.trunc(Number(episodeGoal) || 6)));
  const fallbackPerTitle = Math.max(1, Math.min(10, Math.trunc(Number(defaultPerTitle) || 3)));
  const session = [];
  for (const entry of Array.isArray(queue) ? queue : []) {
    if (session.length >= goal) break;
    const perTitle = Math.max(1, Math.min(10, Math.trunc(Number(entry.plan?.episodesPerSession) || fallbackPerTitle)));
    for (const episode of (entry.upNextEpisodes || []).slice(0, perTitle)) {
      if (session.length >= goal) break;
      session.push({
        key: entry.key,
        item: entry.item,
        episode,
        episodes: entry.episodes,
        behindCount: entry.behindCount,
        watchedCount: entry.watchedCount,
        total: entry.total,
      });
    }
  }
  return session;
}
