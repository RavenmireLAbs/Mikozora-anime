// Release Radar presentation and per-title alert choices built on the
// episode-update events Mikozora already stores natively. It never invents
// an airing schedule: calendar entries use when Mikozora discovered an
// episode, and any "pattern" is calculated only from those observed events.
import { titleKey } from './collections.js';
import { localDayKey } from './watch-stats.js';

export const RELEASE_RADAR_KEY = 'moku.releaseRadar.v1';
export const RELEASE_RADAR_MODES = [
  { id: 'alerts', label: 'Alerts + inbox' },
  { id: 'inbox', label: 'Inbox only' },
  { id: 'muted', label: 'Muted' },
];
const MODE_IDS = new Set(RELEASE_RADAR_MODES.map(mode => mode.id));
const MAX_RULES = 1000;
const MAX_DISMISSED = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

function keyOf(value) {
  if (typeof value === 'string') return value.includes('|') ? value : '';
  return value?.source && value?.url ? titleKey(value) : '';
}

function cleanRule(value) {
  const input = value && typeof value === 'object' ? value : {};
  const mode = MODE_IDS.has(input.mode) ? input.mode : 'alerts';
  const snoozedUntil = Number(input.snoozedUntil);
  const updatedAt = Number(input.updatedAt);
  return {
    mode,
    snoozedUntil: Number.isFinite(snoozedUntil) && snoozedUntil > 0 ? Math.trunc(snoozedUntil) : 0,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.trunc(updatedAt) : 0,
  };
}

export function normalizeReleaseRadar(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rules = Object.fromEntries(
    Object.entries(input.rules && typeof input.rules === 'object' ? input.rules : {})
      .filter(([key]) => typeof key === 'string' && key.includes('|') && key.length <= 700)
      .map(([key, rule]) => [key, cleanRule(rule)])
      .filter(([, rule]) => rule.mode !== 'alerts' || rule.snoozedUntil > 0)
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .slice(0, MAX_RULES),
  );
  const dismissedInbox = [...new Set((Array.isArray(input.dismissedInbox) ? input.dismissedInbox : [])
    .map(entry => String(entry || '').trim().slice(0, 160))
    .filter(Boolean))].slice(-MAX_DISMISSED);
  return { rules, dismissedInbox };
}

export function readReleaseRadar(storage) {
  try {
    return normalizeReleaseRadar(JSON.parse(storage?.getItem?.(RELEASE_RADAR_KEY) || 'null'));
  } catch {
    return { rules: {}, dismissedInbox: [] };
  }
}

export function saveReleaseRadar(storage, value) {
  const normalized = normalizeReleaseRadar(value);
  try {
    storage?.setItem?.(RELEASE_RADAR_KEY, JSON.stringify(normalized));
  } catch { /* The normalized state remains available for this session. */ }
  return normalized;
}

export function setReleaseRadarRule(state, itemOrKey, patch, now = Date.now()) {
  const clean = normalizeReleaseRadar(state);
  const key = keyOf(itemOrKey);
  if (!key) return clean;
  const next = cleanRule({ ...(clean.rules[key] || {}), ...(patch || {}), updatedAt: now });
  if (next.mode === 'alerts' && !next.snoozedUntil) delete clean.rules[key];
  else clean.rules[key] = next;
  return normalizeReleaseRadar(clean);
}

export function dismissReleaseRadarEntry(state, id) {
  const clean = normalizeReleaseRadar(state);
  const entryId = String(id || '').trim().slice(0, 160);
  if (!entryId || clean.dismissedInbox.includes(entryId)) return clean;
  clean.dismissedInbox.push(entryId);
  return normalizeReleaseRadar(clean);
}

export function effectiveReleaseRadarRule(state, itemOrKey, now = Date.now()) {
  const clean = normalizeReleaseRadar(state);
  const key = keyOf(itemOrKey);
  const rule = cleanRule(clean.rules[key]);
  const snoozed = rule.snoozedUntil > now;
  return {
    ...rule,
    key,
    snoozed,
    // Device alerts are suppressed for both "Inbox only" and "Muted", but
    // only Muted/snoozed titles are suppressed from the visible inbox count.
    alertSuppressed: rule.mode !== 'alerts' || snoozed,
    suppressed: rule.mode === 'muted' || snoozed,
  };
}

export function releaseRadarMonitorFields(state, item, now = Date.now()) {
  const rule = effectiveReleaseRadarRule(state, item, now);
  return {
    alertMode: rule.mode,
    // The native stores already treat a non-alert mode as alert-suppressed;
    // this timestamp only carries the optional snooze, including for a
    // title set to "Inbox only".
    alertsMutedUntil: rule.snoozed ? rule.snoozedUntil : 0,
  };
}

export function releaseRadarModeLabel(mode) {
  return RELEASE_RADAR_MODES.find(entry => entry.id === mode)?.label || 'Alerts + inbox';
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function observedPattern(events) {
  const days = [...new Set(events.map(event => localDayKey(event.time)).filter(Boolean))].sort();
  if (days.length < 3) return null;
  const stamps = days.map(day => new Date(`${day}T12:00:00`).getTime()).filter(Number.isFinite);
  const intervals = [];
  for (let i = 1; i < stamps.length; i++) intervals.push(Math.round((stamps[i] - stamps[i - 1]) / DAY_MS));
  const typicalDays = Math.round(median(intervals));
  if (!typicalDays || typicalDays < 1 || typicalDays > 60) return null;
  const latest = Math.max(...events.map(event => event.time));
  const center = latest + typicalDays * DAY_MS;
  return {
    typicalDays,
    windowStart: center - 2 * DAY_MS,
    windowEnd: center + 2 * DAY_MS,
    basedOnDays: days.length,
  };
}

export function buildReleaseRadar({
  updates = [],
  downloads = [],
  monitoredItems = [],
  radar = {},
  now = Date.now(),
} = {}) {
  const cleanRadar = normalizeReleaseRadar(radar);
  const dismissed = new Set(cleanRadar.dismissedInbox);
  const entries = [];

  for (const update of Array.isArray(updates) ? updates : []) {
    const item = update?.item;
    const key = String(update?.titleId || keyOf(item) || '');
    const time = Number(update?.discoveredAt) || 0;
    if (!key || !item?.source || !item?.url || !update?.episode?.url || !time) continue;
    const rule = effectiveReleaseRadarRule(cleanRadar, key, now);
    entries.push({
      id: String(update.id || `${key}\n${update.episode.url}`),
      type: 'episode',
      key,
      item,
      episode: update.episode,
      time,
      read: update.read === true,
      suppressed: rule.suppressed,
      rule,
      update,
    });
  }

  for (const download of Array.isArray(downloads) ? downloads : []) {
    if (download?.status !== 'completed' || download?.autoDownload !== true) continue;
    const time = Number(download.downloadedAt) || Number(download.added) || 0;
    if (!time || now - time > 30 * DAY_MS || time > now + DAY_MS) continue;
    const key = keyOf(download.item);
    if (!key || !download.episode?.url) continue;
    const id = `download:${download.id}`;
    const rule = effectiveReleaseRadarRule(cleanRadar, key, now);
    entries.push({
      id,
      type: 'download',
      key,
      item: download.item,
      episode: download.episode,
      time,
      read: dismissed.has(id),
      suppressed: rule.mode === 'muted' || rule.snoozed,
      rule,
      download,
    });
  }

  entries.sort((a, b) => b.time - a.time || String(a.item.title || '').localeCompare(String(b.item.title || '')));

  const digestMap = new Map();
  for (const entry of entries.filter(candidate => candidate.type === 'episode')) {
    const current = digestMap.get(entry.key) || {
      key: entry.key,
      item: entry.item,
      count: 0,
      unreadCount: 0,
      visibleUnreadCount: 0,
      latestAt: 0,
      latestEpisode: null,
      episodes: [],
      rule: entry.rule,
    };
    current.count++;
    if (!entry.read) current.unreadCount++;
    if (!entry.read && !entry.suppressed) current.visibleUnreadCount++;
    if (entry.time >= current.latestAt) {
      current.latestAt = entry.time;
      current.latestEpisode = entry.episode;
    }
    current.episodes.push(entry);
    digestMap.set(entry.key, current);
  }
  const digest = [...digestMap.values()].sort((a, b) => b.latestAt - a.latestAt || b.count - a.count);

  const calendar = [];
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  for (let offset = 13; offset >= 0; offset--) {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    const key = localDayKey(date);
    const dayEntries = entries.filter(entry => localDayKey(entry.time) === key);
    calendar.push({
      key,
      label: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      count: dayEntries.length,
      episodeCount: dayEntries.filter(entry => entry.type === 'episode').length,
      downloadCount: dayEntries.filter(entry => entry.type === 'download').length,
    });
  }

  const activity = (Array.isArray(monitoredItems) ? monitoredItems : []).map(item => {
    const key = keyOf(item);
    const titleEntries = entries.filter(entry => entry.type === 'episode' && entry.key === key);
    const latest = titleEntries[0] || null;
    return {
      key,
      item,
      latestAt: latest?.time || 0,
      latestEpisode: latest?.episode || null,
      last7Days: titleEntries.filter(entry => now - entry.time < 7 * DAY_MS).length,
      last30Days: titleEntries.filter(entry => now - entry.time < 30 * DAY_MS).length,
      totalKnown: titleEntries.length,
      pattern: observedPattern(titleEntries),
      rule: effectiveReleaseRadarRule(cleanRadar, key, now),
    };
  }).filter(entry => entry.key).sort((a, b) => b.latestAt - a.latestAt || String(a.item.title || '').localeCompare(String(b.item.title || '')));

  const visibleUnread = entries.filter(entry => !entry.read && !entry.suppressed).length;
  return {
    entries,
    digest,
    calendar,
    activity,
    visibleUnread,
    episodeUnread: entries.filter(entry => entry.type === 'episode' && !entry.read && !entry.suppressed).length,
    readyDownloads: entries.filter(entry => entry.type === 'download' && !entry.read).length,
    suppressedCount: entries.filter(entry => entry.suppressed).length,
  };
}
