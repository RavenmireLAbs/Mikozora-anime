// Local watch statistics and monthly "Wrapped" recaps.
//
// History records episodes opened (Mikozora keeps the latest 100), while
// progress snapshots preserve per-title watched counts. Stats therefore use
// history for dates/streaks and progress for completions. Watch time is an
// estimate: a source-reported duration when one happens to be present,
// otherwise 24 minutes per opened episode.
import { titleKey } from './collections.js';
import { normalizeProgress, titleProgress } from './progress.js';
import { normalizeLibraryMeta, personalStatusLabel } from './library-meta.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function keyOf(value) {
  if (typeof value === 'string') return value.includes('|') ? value : '';
  return value?.source && value?.url ? titleKey(value) : '';
}

function relatedComponent(key, relatedKeysByTitle) {
  const raw = relatedKeysByTitle && typeof relatedKeysByTitle === 'object' ? relatedKeysByTitle[key] : null;
  const keys = new Set([key]);
  if (Array.isArray(raw) || raw instanceof Set) {
    for (const value of raw) {
      const clean = keyOf(value);
      if (clean) keys.add(clean);
    }
  } else if (raw) {
    const clean = keyOf(raw);
    if (clean) keys.add(clean);
  }
  return [...keys].sort().join('\n');
}

export function localDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function monthKey(value) {
  const day = localDayKey(value);
  return day ? day.slice(0, 7) : '';
}

export function monthLabel(key) {
  const match = String(key || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return 'This month';
  return new Date(Number(match[1]), Number(match[2]) - 1, 1)
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function dayNumber(day) {
  const match = String(day || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS : NaN;
}

export function parseDurationMinutes(value) {
  if (Number.isFinite(Number(value)) && Number(value) > 0) {
    const number = Number(value);
    return Math.max(1, Math.min(600, Math.round(number > 300 ? number / 60 : number)));
  }
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 0;
  const colon = text.match(/^(\d+):([0-5]\d)(?::([0-5]\d))?$/);
  if (colon) {
    const minutes = colon[3] ? Number(colon[1]) * 60 + Number(colon[2]) + Number(colon[3]) / 60
      : Number(colon[1]) + Number(colon[2]) / 60;
    return Math.max(1, Math.min(600, Math.round(minutes)));
  }
  const hours = Number(text.match(/(\d+(?:\.\d+)?)\s*h(?:r|our)?s?\b/)?.[1] || 0);
  const minutes = Number(text.match(/(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?\b/)?.[1] || 0);
  const seconds = Number(text.match(/(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?\b/)?.[1] || 0);
  const total = hours * 60 + minutes + seconds / 60;
  return total > 0 ? Math.max(1, Math.min(600, Math.round(total))) : 0;
}

function genresOf(item) {
  const raw = item?.genres;
  const values = Array.isArray(raw) ? raw : String(raw || '').split(/[|,/·]/);
  return [...new Set(values.map(value => String(value || '').trim()).filter(value => value && value.length <= 40))];
}

export function cleanHistoryEvents(history) {
  const latest = new Map();
  for (const entry of Array.isArray(history) ? history : []) {
    const key = keyOf(entry?.item);
    const episode = entry?.episode;
    const time = Number(entry?.time);
    if (!key || !episode?.url || !Number.isFinite(time) || time <= 0) continue;
    const id = `${key}\n${episode.url}`;
    const previous = latest.get(id);
    if (!previous || time > previous.time) {
      latest.set(id, {
        key,
        item: entry.item,
        episode,
        time,
        day: localDayKey(time),
        month: monthKey(time),
        genres: genresOf(entry.item),
        estimatedMinutes: parseDurationMinutes(episode.duration) || parseDurationMinutes(entry.item?.duration) || 24,
      });
    }
  }
  return [...latest.values()].sort((a, b) => b.time - a.time);
}

function rankedCounts(events, pick, limit = 8) {
  const counts = new Map();
  for (const event of events) {
    for (const value of pick(event)) {
      if (!value?.id || !value?.label) continue;
      const current = counts.get(value.id) || { ...value, count: 0 };
      current.count++;
      counts.set(value.id, current);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)))
    .slice(0, limit);
}

function streaks(events, now) {
  const days = [...new Set(events.map(event => event.day).filter(Boolean))].sort();
  if (!days.length) return { activeDays: 0, currentStreak: 0, longestStreak: 0, days };
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    if (dayNumber(days[i]) === dayNumber(days[i - 1]) + 1) run++;
    else run = 1;
    longest = Math.max(longest, run);
  }
  const daySet = new Set(days.map(dayNumber));
  const today = dayNumber(localDayKey(now));
  const end = daySet.has(today) ? today : daySet.has(today - 1) ? today - 1 : NaN;
  let current = 0;
  if (Number.isFinite(end)) {
    for (let day = end; daySet.has(day); day--) current++;
  }
  return { activeDays: days.length, currentStreak: current, longestStreak: longest, days };
}

function mondayOf(day) {
  const [year, month, date] = day.split('-').map(Number);
  const value = new Date(year, month - 1, date);
  const offset = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - offset);
  return localDayKey(value);
}

function weeklyBuckets(events, now, count = 8) {
  const current = mondayOf(localDayKey(now));
  const currentDate = new Date(`${current}T12:00:00`);
  const buckets = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(currentDate);
    date.setDate(date.getDate() - i * 7);
    const key = localDayKey(date);
    buckets.push({
      key,
      label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      count: 0,
    });
  }
  const byKey = new Map(buckets.map(bucket => [bucket.key, bucket]));
  for (const event of events) {
    const bucket = byKey.get(mondayOf(event.day));
    if (bucket) bucket.count++;
  }
  return buckets;
}

function monthlyBuckets(events, now, count = 6) {
  const buckets = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(date);
    buckets.push({ key, label: monthLabel(key), count: 0 });
  }
  const byKey = new Map(buckets.map(bucket => [bucket.key, bucket]));
  for (const event of events) {
    const bucket = byKey.get(event.month);
    if (bucket) bucket.count++;
  }
  return buckets;
}

function progressStats(progress, history, relatedKeysByTitle) {
  const entries = normalizeProgress(progress);
  const components = new Map();
  for (const entry of entries) {
    const component = relatedComponent(entry.key, relatedKeysByTitle);
    const value = titleProgress(entries, history, entry.item, relatedKeysByTitle);
    const previous = components.get(component);
    if (!previous
      || value.watchedCount > previous.watchedCount
      || (value.watchedCount === previous.watchedCount && (value.total || 0) > (previous.total || 0))) {
      components.set(component, value);
    }
  }
  const values = [...components.values()].filter(value => value.watchedCount > 0);
  const watchedEpisodes = values.reduce((sum, value) => sum + value.watchedCount, 0);
  const known = values.filter(value => value.total > 0);
  const totalKnownEpisodes = known.reduce((sum, value) => sum + value.total, 0);
  return {
    titlesStarted: values.length,
    titlesCompleted: known.filter(value => value.watchedCount >= value.total).length,
    titlesInProgress: known.filter(value => value.watchedCount < value.total).length,
    watchedEpisodes,
    totalKnownEpisodes,
    completionRate: totalKnownEpisodes ? known.reduce((sum, value) => sum + Math.min(value.watchedCount, value.total), 0) / totalKnownEpisodes : 0,
  };
}

function shelfStats(library, libraryMeta) {
  const meta = normalizeLibraryMeta(libraryMeta);
  const libraryKeys = Array.isArray(library) && library.length ? new Set(library.map(keyOf).filter(Boolean)) : null;
  const records = Object.entries(meta).filter(([key]) => !libraryKeys || libraryKeys.has(key)).map(([, record]) => record);
  const rated = records.filter(record => record.rating > 0);
  const statuses = {};
  for (const record of records) {
    if (record.status) statuses[record.status] = (statuses[record.status] || 0) + 1;
  }
  return {
    savedTitles: libraryKeys ? libraryKeys.size : 0,
    ratedTitles: rated.length,
    averageRating: rated.length ? rated.reduce((sum, record) => sum + record.rating, 0) / rated.length : 0,
    withNotes: records.filter(record => record.note?.trim()).length,
    statuses,
  };
}

export function computeWatchStats({
  history = [],
  progress = [],
  library = [],
  libraryMeta = {},
  relatedKeysByTitle = {},
  now = new Date(),
} = {}) {
  const current = now instanceof Date ? now : new Date(now);
  const events = cleanHistoryEvents(history);
  const streak = streaks(events, current);
  const inLast = days => events.filter(event => current.getTime() - event.time < days * DAY_MS && event.time <= current.getTime()).length;
  const months = [...new Set(events.map(event => event.month).filter(Boolean))].sort().reverse();
  if (!months.includes(monthKey(current))) months.unshift(monthKey(current));
  return {
    generatedAt: current.getTime(),
    historyEpisodes: events.length,
    historyLimitNote: 'Streaks and recaps use the episode-open history stored on this device; Mikozora keeps the latest 100 opened episodes.',
    estimatedMinutes: events.reduce((sum, event) => sum + event.estimatedMinutes, 0),
    activeDays: streak.activeDays,
    currentStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    last7Days: inLast(7),
    last30Days: inLast(30),
    topGenres: rankedCounts(events, event => event.genres.map(genre => ({ id: genre.toLowerCase(), label: genre }))),
    topSources: rankedCounts(events, event => [{ id: event.item.source, label: event.item.source }]),
    topSeries: rankedCounts(events, event => [{ id: event.key, label: event.item.title || 'Untitled', item: event.item }]),
    weekly: weeklyBuckets(events, current),
    monthly: monthlyBuckets(events, current),
    progress: progressStats(progress, history, relatedKeysByTitle),
    shelf: shelfStats(library, libraryMeta),
    availableMonths: months,
  };
}

function previousMonth(key) {
  const match = String(key || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return '';
  return monthKey(new Date(Number(match[1]), Number(match[2]) - 2, 1));
}

export function buildWrapped({
  history = [],
  month = '',
  now = new Date(),
} = {}) {
  const current = now instanceof Date ? now : new Date(now);
  const cleanMonth = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : monthKey(current);
  const events = cleanHistoryEvents(history);
  const monthEvents = events.filter(event => event.month === cleanMonth);
  const previousEvents = events.filter(event => event.month === previousMonth(cleanMonth));
  const byDay = new Map();
  for (const event of monthEvents) byDay.set(event.day, (byDay.get(event.day) || 0) + 1);
  const busiest = [...byDay.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const earliestByTitle = new Map();
  for (const event of [...events].sort((a, b) => a.time - b.time)) {
    if (!earliestByTitle.has(event.key)) earliestByTitle.set(event.key, event);
  }
  const newSeries = [...earliestByTitle.values()].filter(event => event.month === cleanMonth);
  return {
    month: cleanMonth,
    label: monthLabel(cleanMonth),
    episodes: monthEvents.length,
    estimatedMinutes: monthEvents.reduce((sum, event) => sum + event.estimatedMinutes, 0),
    activeDays: byDay.size,
    busiestDay: busiest ? { day: busiest[0], count: busiest[1] } : null,
    topSeries: rankedCounts(monthEvents, event => [{ id: event.key, label: event.item.title || 'Untitled', item: event.item }], 5),
    topGenres: rankedCounts(monthEvents, event => event.genres.map(genre => ({ id: genre.toLowerCase(), label: genre })), 5),
    topSources: rankedCounts(monthEvents, event => [{ id: event.item.source, label: event.item.source }], 5),
    newSeries: newSeries.map(event => event.item),
    previousMonthEpisodes: previousEvents.length,
    episodeChange: monthEvents.length - previousEvents.length,
  };
}

export function formatWatchDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

export function statusBreakdown(stats) {
  return Object.entries(stats?.shelf?.statuses || {}).map(([id, count]) => ({
    id,
    label: personalStatusLabel(id) || id,
    count,
  }));
}
