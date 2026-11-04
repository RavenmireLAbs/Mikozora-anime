// Local library import/export. Mikozora's own portable JSON preserves the
// exact source identity; MAL/AniList-style files often contain only a title,
// status, score and episode count. Those rows are never silently attached to
// a guessed source listing: the preview keeps them unmatched until the user
// chooses a source result, and an import only ever adds watched episodes.
import { FAVOURITES_ID, normalizeCollections, titleKey } from './collections.js';
import { normalizeLibraryMeta, setLibraryMeta } from './library-meta.js';
import { normalizeProgress } from './progress.js';
import { chronologicalEpisodes } from './episode-tools.js';
import { genreList, yearOf } from './content.js';

export const LIBRARY_PORTABILITY_KEY = 'moku.libraryPortability.v1';
export const PORTABLE_LIBRARY_FORMAT = 'mikozora-library';
export const PORTABLE_LIBRARY_VERSION = 1;
const SOURCE_IDS = new Set(['sogo', 'suge', 'anikoto', 'rulz', 'waves', 'bash', 'xin', 'narul', 'stream', 'world']);
const SOURCE_HOSTS = new Map([
  ['animesogo.to', 'sogo'],
  ['animesuge.cz', 'suge'],
  ['animesuge.to', 'suge'],
  ['anikototv.to', 'anikoto'],
  ['animerulz.com.in', 'rulz'],
  ['aniwaves.ru', 'waves'],
  ['animebash.in', 'bash'],
  ['animexin.dev', 'xin'],
  ['naruldonghua.com', 'narul'],
  ['donghuastream.org', 'stream'],
  ['donghuaworld.com', 'world'],
]);
const MAX_ENTRIES = 5000;
const MAX_EPISODES = 2000;

function cleanText(value, max = 500) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 3000) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch { return ''; }
}

function sourceFromUrl(url) {
  try { return SOURCE_HOSTS.get(new URL(url).hostname.toLowerCase()) || ''; }
  catch { return ''; }
}

export function normalizedPortableTitle(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function externalStatusFor(personalStatus, system = 'anilist') {
  const map = system === 'mal'
    ? { plan: 'Plan to Watch', watching: 'Watching', paused: 'On-Hold', completed: 'Completed', dropped: 'Dropped' }
    : { plan: 'PLANNING', watching: 'CURRENT', paused: 'PAUSED', completed: 'COMPLETED', dropped: 'DROPPED' };
  return map[personalStatus] || '';
}

export function personalStatusFromExternal(value) {
  const text = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (['plan', 'planning', 'plan-to-watch', 'planned', 'want-to-watch'].includes(text)) return 'plan';
  if (['watching', 'current', 'in-progress'].includes(text)) return 'watching';
  if (['paused', 'pause', 'on-hold', 'onhold', 'hold'].includes(text)) return 'paused';
  if (['completed', 'complete', 'finished'].includes(text)) return 'completed';
  if (['dropped', 'drop'].includes(text)) return 'dropped';
  return '';
}

function ratingFrom(raw) {
  const direct = Number(raw?.rating);
  if (Number.isFinite(direct) && direct > 0 && direct <= 5) return Math.trunc(direct);
  const score10 = Number(raw?.score10 ?? raw?.score);
  if (Number.isFinite(score10) && score10 > 5 && score10 <= 10) return Math.max(1, Math.min(5, Math.round(score10 / 2)));
  if (Number.isFinite(score10) && score10 > 0 && score10 <= 5 && raw?.score10 == null && raw?.score == null) return Math.trunc(score10);
  if (Number.isFinite(score10) && score10 > 10 && score10 <= 100) return Math.max(1, Math.min(5, Math.round(score10 / 20)));
  if (Number.isFinite(score10) && score10 > 0 && score10 <= 5) return Math.trunc(score10);
  return 0;
}

function cleanGenres(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[|,]/);
  return [...new Set(raw.map(entry => cleanText(entry, 40)).filter(Boolean))].slice(0, 20);
}

function cleanEpisodes(value) {
  const seen = new Set();
  const out = [];
  for (const episode of Array.isArray(value) ? value : []) {
    const url = cleanUrl(typeof episode === 'string' ? episode : episode?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ number: cleanText(episode?.number ?? '', 40), url, title: cleanText(episode?.title || '', 200), ids: cleanText(episode?.ids || '', 1000) });
    if (out.length >= MAX_EPISODES) break;
  }
  return out;
}

export function cleanPortableEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw.item && typeof raw.item === 'object' ? raw.item : raw;
  const url = cleanUrl(item.url || raw.url || raw.siteUrl || raw.link);
  let source = cleanText(item.source || raw.source || raw.mikozoraSource, 30).toLowerCase();
  if (!SOURCE_IDS.has(source)) source = sourceFromUrl(url);
  const title = cleanText(item.title || raw.title || raw.name || raw.seriesTitle || raw.media?.title?.romaji || raw.media?.title?.english || raw.media?.title?.native, 500);
  if (!title && !url) return null;
  const year = Number(raw.year || item.year || yearOf(item));
  const watchedEpisodes = Math.max(0, Math.min(100000, Math.trunc(Number(raw.watchedEpisodes ?? raw.progress ?? raw.myWatchedEpisodes) || 0)));
  const totalEpisodes = Math.max(0, Math.min(100000, Math.trunc(Number(raw.totalEpisodes ?? raw.total ?? raw.media?.episodes) || 0)));
  const collections = [...new Set((Array.isArray(raw.collections) ? raw.collections : String(raw.collections || '').split(/[|;]/))
    .map(entry => cleanText(typeof entry === 'string' ? entry : entry?.name, 40)).filter(Boolean))].slice(0, 20);
  return {
    source: SOURCE_IDS.has(source) ? source : '',
    url,
    title: title || 'Untitled',
    image: cleanUrl(item.image || raw.image || raw.coverImage?.large || raw.media?.coverImage?.large),
    type: cleanText(item.type || raw.type || raw.media?.format, 80),
    badge: cleanText(item.badge || raw.badge, 80),
    sourceStatus: cleanText(raw.sourceStatus || item.status || '', 120),
    genres: cleanGenres(raw.genres || item.genres || raw.media?.genres),
    year: Number.isFinite(year) && year >= 1900 && year <= 2100 ? Math.trunc(year) : 0,
    personalStatus: personalStatusFromExternal(raw.personalStatus || raw.status || raw.myStatus || raw.listStatus),
    rating: ratingFrom(raw),
    note: cleanText(raw.note || raw.notes || raw.comments || raw.myComments, 600),
    collections,
    watchedEpisodes,
    totalEpisodes,
    episodes: cleanEpisodes(raw.episodes),
    watched: [...new Set((Array.isArray(raw.watched) ? raw.watched : []).map(cleanUrl).filter(Boolean))].slice(0, MAX_EPISODES),
    externalIds: {
      mal: Math.max(0, Math.trunc(Number(raw.malId || raw.seriesAnimedbId || raw.media?.idMal) || 0)),
      anilist: Math.max(0, Math.trunc(Number(raw.anilistId || raw.media?.id) || 0)),
    },
  };
}

export function portableEntryKey(entry) {
  return entry?.source && entry?.url ? titleKey(entry) : '';
}

function itemFromEntry(entry) {
  const item = {
    source: entry.source,
    url: entry.url,
    title: entry.title,
    image: entry.image || '',
    type: entry.type || '',
    badge: entry.badge || '',
    status: entry.sourceStatus || '',
  };
  if (entry.genres?.length) item.genres = entry.genres;
  if (entry.year) item.year = entry.year;
  return item;
}

export function buildPortableLibrary({ library = [], collections = [], libraryMeta = {}, progress = [], exportedAt = Date.now() } = {}) {
  const cleanCollections = normalizeCollections(collections);
  const meta = normalizeLibraryMeta(libraryMeta);
  const progressMap = new Map(normalizeProgress(progress).map(entry => [entry.key, entry]));
  const memberships = new Map();
  for (const collection of cleanCollections) {
    for (const key of collection.items) {
      if (!memberships.has(key)) memberships.set(key, []);
      memberships.get(key).push(collection.name);
    }
  }
  const seen = new Set();
  const entries = [];
  for (const item of Array.isArray(library) ? library : []) {
    if (!item?.source || !item?.url || seen.has(titleKey(item))) continue;
    const key = titleKey(item);
    seen.add(key);
    const record = meta[key] || {};
    const snapshot = progressMap.get(key);
    entries.push({
      source: item.source,
      url: item.url,
      title: item.title || 'Untitled',
      image: item.image || '',
      type: item.type || '',
      badge: item.badge || '',
      sourceStatus: item.status || '',
      genres: genreList(item),
      year: yearOf(item) || 0,
      personalStatus: record.status || '',
      rating: record.rating || 0,
      note: record.note || '',
      collections: memberships.get(key) || [],
      watchedEpisodes: snapshot?.watched?.length || 0,
      totalEpisodes: snapshot?.episodes?.length || 0,
      episodes: snapshot?.episodes || [],
      watched: snapshot?.watched || [],
    });
  }
  return { format: PORTABLE_LIBRARY_FORMAT, version: PORTABLE_LIBRARY_VERSION, exportedAt: new Date(exportedAt).toISOString(), entries };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildLibraryCsv(context = {}) {
  const portable = buildPortableLibrary(context);
  const columns = ['source', 'title', 'url', 'type', 'year', 'genres', 'source_status', 'personal_status', 'rating_5', 'score_10', 'watched_episodes', 'total_episodes', 'collections', 'note'];
  const lines = [columns.join(',')];
  for (const entry of portable.entries) {
    lines.push([
      entry.source, entry.title, entry.url, entry.type, entry.year || '', (entry.genres || []).join('|'),
      entry.sourceStatus, entry.personalStatus, entry.rating || '', entry.rating ? entry.rating * 2 : '',
      entry.watchedEpisodes || '', entry.totalEpisodes || '', (entry.collections || []).join('|'), entry.note,
    ].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function escapeXml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function unescapeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replaceAll('&amp;', '&');
}

export function buildMalXml(context = {}) {
  const portable = buildPortableLibrary(context);
  const rows = portable.entries.map(entry => {
    const marker = `[Mikozora ${entry.source}|${entry.url}]`;
    const comments = [entry.note, marker].filter(Boolean).join(' ');
    return `  <anime>\n    <series_animedb_id>0</series_animedb_id>\n    <series_title>${escapeXml(entry.title)}</series_title>\n    <my_watched_episodes>${entry.watchedEpisodes || 0}</my_watched_episodes>\n    <my_score>${entry.rating ? entry.rating * 2 : 0}</my_score>\n    <my_status>${escapeXml(externalStatusFor(entry.personalStatus, 'mal') || 'Plan to Watch')}</my_status>\n    <my_comments>${escapeXml(comments)}</my_comments>\n  </anime>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<myanimelist>\n${rows.join('\n')}\n</myanimelist>\n`;
}

export function buildAniListJson(context = {}) {
  const portable = buildPortableLibrary(context);
  const byStatus = new Map();
  for (const entry of portable.entries) {
    const status = externalStatusFor(entry.personalStatus, 'anilist') || 'PLANNING';
    if (!byStatus.has(status)) byStatus.set(status, []);
    byStatus.get(status).push({
      status,
      score: entry.rating ? entry.rating * 2 : 0,
      progress: entry.watchedEpisodes || 0,
      notes: entry.note || '',
      media: {
        title: { romaji: entry.title, english: entry.title },
        format: entry.type || '',
        episodes: entry.totalEpisodes || null,
        genres: entry.genres || [],
        seasonYear: entry.year || null,
      },
      mikozoraSource: entry.source,
      mikozoraUrl: entry.url,
      collections: entry.collections || [],
    });
  }
  return JSON.stringify({
    format: 'mikozora-anilist-style',
    version: 1,
    exportedAt: portable.exportedAt,
    lists: [...byStatus.entries()].map(([status, entries]) => ({ status, entries })),
  }, null, 2);
}

function parseDelimited(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const delimiter = String(text).slice(0, 4096).includes('\t') && !String(text).slice(0, 4096).includes(',') ? '\t' : ',';
  const pushCell = () => { row.push(cell); cell = ''; };
  const pushRow = () => { pushCell(); if (row.some(value => String(value).trim())) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell) quoted = true;
    else if (char === delimiter) pushCell();
    else if (char === '\n') pushRow();
    else if (char !== '\r') cell += char;
    if (rows.length > MAX_ENTRIES + 1) break;
  }
  if (cell || row.length) pushRow();
  if (!rows.length) return [];
  const headers = rows[0].map(header => String(header || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''));
  const aliases = {
    title: 'title', name: 'title', series_title: 'title', anime_title: 'title', romaji: 'title', english: 'title',
    source: 'source', mikozora_source: 'source', url: 'url', link: 'url', site_url: 'url', mikozora_url: 'url',
    status: 'status', list_status: 'status', my_status: 'status', personal_status: 'personalStatus',
    rating: 'rating', rating_5: 'rating', score: 'score', score_10: 'score10', my_score: 'score',
    progress: 'watchedEpisodes', watched_episodes: 'watchedEpisodes', my_watched_episodes: 'watchedEpisodes', episodes_watched: 'watchedEpisodes',
    total_episodes: 'totalEpisodes', episodes: 'totalEpisodes', note: 'note', notes: 'note', comments: 'note', my_comments: 'note',
    collections: 'collections', type: 'type', format: 'type', year: 'year', season_year: 'year', genres: 'genres', image: 'image',
  };
  return rows.slice(1).map(values => {
    const raw = {};
    headers.forEach((header, index) => { if (aliases[header]) raw[aliases[header]] = values[index] ?? ''; });
    return cleanPortableEntry(raw);
  }).filter(Boolean);
}

function parseMalXml(text) {
  const blocks = [...String(text).matchAll(/<anime\b[^>]*>([\s\S]*?)<\/anime>/gi)].slice(0, MAX_ENTRIES);
  const tag = (block, name) => unescapeXml(block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '').trim();
  return blocks.map(([, block]) => {
    const comments = tag(block, 'my_comments');
    const marker = comments.match(/\[Mikozora\s+([a-z]+)\|(https:\/\/[^\]]+)\]/i);
    return cleanPortableEntry({
      source: marker?.[1] || '',
      url: marker?.[2] || '',
      title: tag(block, 'series_title'),
      malId: tag(block, 'series_animedb_id'),
      watchedEpisodes: tag(block, 'my_watched_episodes'),
      score: tag(block, 'my_score'),
      status: tag(block, 'my_status'),
      note: comments.replace(/\[Mikozora\s+[a-z]+\|https:\/\/[^\]]+\]/i, '').trim(),
    });
  }).filter(Boolean);
}

function collectJsonEntries(value, out = [], depth = 0) {
  if (!value || depth > 12 || out.length >= MAX_ENTRIES) return out;
  if (Array.isArray(value)) {
    for (const entry of value) collectJsonEntries(entry, out, depth + 1);
    return out;
  }
  if (typeof value !== 'object') return out;
  const looksLikeEntry = value.title || value.name || value.url || value.media?.title || value.series_title;
  const hasListData = value.status || value.personalStatus || value.progress != null || value.score != null || value.rating != null || value.watchedEpisodes != null;
  if (looksLikeEntry && (hasListData || value.source || value.mikozoraSource)) {
    const clean = cleanPortableEntry({ ...value, url: value.mikozoraUrl || value.url, title: value.title || value.media?.title?.romaji || value.media?.title?.english || value.media?.title?.native });
    if (clean) out.push(clean);
  }
  for (const child of Object.values(value)) collectJsonEntries(child, out, depth + 1);
  return out;
}

export function parsePortableLibrary(text, filename = '') {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) throw new Error('That library file is empty.');
  if (raw.length > 8 * 1024 * 1024) throw new Error('That library file is too large.');
  let format = 'csv';
  let entries = [];
  if (raw.startsWith('{') || raw.startsWith('[')) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error('That JSON library file looks damaged.'); }
    format = parsed?.format === PORTABLE_LIBRARY_FORMAT ? 'mikozora-json' : parsed?.format === 'mikozora-anilist-style' || parsed?.data ? 'anilist-json' : 'json';
    entries = collectJsonEntries(parsed?.entries || parsed);
  } else if (/^\s*<\?xml|<myanimelist\b|<anime\b/i.test(raw) || /\.xml$/i.test(filename)) {
    format = 'mal-xml';
    entries = parseMalXml(raw);
  } else {
    entries = parseDelimited(raw);
  }
  entries = entries.filter(Boolean).slice(0, MAX_ENTRIES);
  if (!entries.length) throw new Error('No recognizable library entries were found in that file.');
  return { format, entries };
}

function hashText(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

function collectionIdForName(name, existing) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'imported';
  let id = `imported-${slug}`;
  if (existing.some(collection => collection.id === id && collection.name.toLowerCase() !== name.toLowerCase())) id = `${id}-${hashText(name.toLowerCase())}`;
  return id;
}

export function attachPortabilityMatch(entries, index, item) {
  const list = (Array.isArray(entries) ? entries : []).map(cleanPortableEntry);
  const entryIndex = Number(index);
  const original = Number.isInteger(entryIndex) ? list[entryIndex] : null;
  if (!original || portableEntryKey(original) || !item?.source || !item?.url || !item?.title) return list.filter(Boolean);
  const genres = genreList(item);
  list[entryIndex] = cleanPortableEntry({
    ...original,
    source: item.source,
    url: item.url,
    title: item.title,
    image: item.image || original.image,
    type: item.type || original.type,
    badge: item.badge || original.badge,
    sourceStatus: item.status || original.sourceStatus,
    genres: genres.length ? genres : original.genres,
    year: yearOf(item) || original.year,
    malId: original.externalIds?.mal || 0,
    anilistId: original.externalIds?.anilist || 0,
  });
  return list;
}

export function buildPortabilityPreview({ entries = [], library = [], collections = [], libraryMeta = {}, progress = [] } = {}) {
  const cleanEntries = [];
  (Array.isArray(entries) ? entries : []).forEach((raw, entryIndex) => {
    const entry = cleanPortableEntry(raw);
    if (entry) cleanEntries.push({ entry, entryIndex });
  });
  const libraryMap = new Map((Array.isArray(library) ? library : []).filter(item => item?.source && item?.url).map(item => [titleKey(item), item]));
  const libraryTitles = new Map([...libraryMap.values()].map(item => [normalizedPortableTitle(item.title), item]));
  const progressKeys = new Set(normalizeProgress(progress).map(entry => entry.key));
  const meta = normalizeLibraryMeta(libraryMeta);
  const seenExact = new Set();
  const result = { exactNew: [], exactExisting: [], possibleDuplicates: [], unmatched: [], unmatchedEntries: [], invalid: [] };
  for (const { entry, entryIndex } of cleanEntries) {
    const key = portableEntryKey(entry);
    if (!entry.title || (entry.url && !key)) { result.invalid.push(entry); continue; }
    if (!key) {
      result.unmatched.push(entry);
      result.unmatchedEntries.push({ entry, entryIndex });
      continue;
    }
    if (seenExact.has(key)) { result.invalid.push(entry); continue; }
    seenExact.add(key);
    const existing = libraryMap.get(key);
    if (existing) result.exactExisting.push({ entry, key, existing, hasProgress: progressKeys.has(key), hasMeta: !!meta[key] });
    else {
      const titleMatch = libraryTitles.get(normalizedPortableTitle(entry.title));
      const wrapped = { entry, key, hasProgress: progressKeys.has(key), hasMeta: !!meta[key] };
      if (titleMatch) result.possibleDuplicates.push({ ...wrapped, possibleMatch: titleMatch });
      else result.exactNew.push(wrapped);
    }
  }
  const exactEntries = [...result.exactNew, ...result.exactExisting, ...result.possibleDuplicates];
  return {
    ...result,
    exactEntries,
    summary: {
      total: cleanEntries.length,
      exact: exactEntries.length,
      newTitles: result.exactNew.length + result.possibleDuplicates.length,
      existingTitles: result.exactExisting.length,
      possibleDuplicates: result.possibleDuplicates.length,
      unmatched: result.unmatched.length,
      invalid: result.invalid.length,
    },
  };
}

export function normalizePortabilityState(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const pendingProgress = {};
  for (const [key, raw] of Object.entries(input.pendingProgress && typeof input.pendingProgress === 'object' ? input.pendingProgress : {})) {
    if (typeof key !== 'string' || !key.includes('|') || key.length > 700) continue;
    const count = Math.max(0, Math.min(100000, Math.trunc(Number(raw?.count) || 0)));
    if (!count) continue;
    pendingProgress[key] = {
      count,
      total: Math.max(0, Math.min(100000, Math.trunc(Number(raw?.total) || 0))),
      updatedAt: Number.isFinite(Number(raw?.updatedAt)) ? Number(raw.updatedAt) : 0,
    };
  }
  return { pendingProgress: Object.fromEntries(Object.entries(pendingProgress).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 1000)) };
}

export function readPortabilityState(storage) {
  try { return normalizePortabilityState(JSON.parse(storage?.getItem?.(LIBRARY_PORTABILITY_KEY) || 'null')); }
  catch { return { pendingProgress: {} }; }
}

export function savePortabilityState(storage, value) {
  const normalized = normalizePortabilityState(value);
  try { storage?.setItem?.(LIBRARY_PORTABILITY_KEY, JSON.stringify(normalized)); } catch { /* best effort */ }
  return normalized;
}

export function pendingProgressFor(state, itemOrKey) {
  const key = typeof itemOrKey === 'string' ? itemOrKey : (itemOrKey?.source && itemOrKey?.url ? titleKey(itemOrKey) : '');
  return key ? normalizePortabilityState(state).pendingProgress[key] || null : null;
}

export function clearPendingProgress(state, itemOrKey) {
  const clean = normalizePortabilityState(state);
  const key = typeof itemOrKey === 'string' ? itemOrKey : (itemOrKey?.source && itemOrKey?.url ? titleKey(itemOrKey) : '');
  if (key) delete clean.pendingProgress[key];
  return clean;
}

export function applyPortabilityPreview({
  preview,
  library = [],
  collections = [],
  libraryMeta = {},
  progress = [],
  portability = {},
  now = Date.now(),
} = {}) {
  const exact = Array.isArray(preview?.exactEntries) ? preview.exactEntries : [];
  const existingByKey = new Map((Array.isArray(library) ? library : []).filter(item => item?.source && item?.url).map(item => [titleKey(item), item]));
  const newItems = [];
  let nextCollections = normalizeCollections(collections);
  let nextMeta = normalizeLibraryMeta(libraryMeta);
  const progressMap = new Map(normalizeProgress(progress).map(entry => [entry.key, { ...entry, watched: [...entry.watched], episodes: [...entry.episodes] }]));
  let nextPortability = normalizePortabilityState(portability);
  const applied = { added: 0, updated: 0, collectionsCreated: 0, progressSnapshots: 0, pendingProgress: 0 };

  const ensureCollection = (name) => {
    const cleanName = cleanText(name, 40);
    if (!cleanName) return null;
    let collection = nextCollections.find(entry => entry.name.toLowerCase() === cleanName.toLowerCase());
    if (!collection) {
      collection = { id: collectionIdForName(cleanName, nextCollections), name: cleanName, items: [] };
      nextCollections = [...nextCollections, collection];
      applied.collectionsCreated++;
    }
    return collection;
  };

  for (const wrapped of exact) {
    const entry = cleanPortableEntry(wrapped.entry || wrapped);
    const key = portableEntryKey(entry);
    if (!entry || !key) continue;
    const item = existingByKey.get(key) || itemFromEntry(entry);
    if (existingByKey.has(key)) applied.updated++;
    else { newItems.push(item); existingByKey.set(key, item); applied.added++; }

    for (const name of entry.collections || []) {
      const collection = ensureCollection(name);
      if (collection && !collection.items.includes(key)) collection.items = [key, ...collection.items];
    }

    const patch = {};
    if (entry.personalStatus) patch.status = entry.personalStatus;
    if (entry.rating) patch.rating = entry.rating;
    if (entry.note) patch.note = entry.note;
    if (Object.keys(patch).length) nextMeta = setLibraryMeta(nextMeta, key, patch, now);

    const previous = progressMap.get(key);
    const episodeMap = new Map([...(previous?.episodes || []), ...(entry.episodes || [])].filter(episode => episode?.url).map(episode => [episode.url, episode]));
    let episodes = chronologicalEpisodes([...episodeMap.values()]);
    const watched = new Set([...(previous?.watched || []), ...(entry.watched || [])]);
    if (entry.watchedEpisodes > watched.size && episodes.length) {
      for (const episode of episodes.slice(0, entry.watchedEpisodes)) watched.add(episode.url);
    }
    if (episodes.length || watched.size) {
      progressMap.set(key, { key, item, episodes, watched: [...watched], updatedAt: now });
      applied.progressSnapshots++;
      if (entry.watchedEpisodes <= watched.size) nextPortability = clearPendingProgress(nextPortability, key);
    }
    if (entry.watchedEpisodes > watched.size && !episodes.length) {
      const old = nextPortability.pendingProgress[key];
      nextPortability.pendingProgress[key] = {
        count: Math.max(old?.count || 0, entry.watchedEpisodes),
        total: entry.totalEpisodes || old?.total || 0,
        updatedAt: now,
      };
      applied.pendingProgress++;
    }
  }

  return {
    library: [...newItems, ...(Array.isArray(library) ? library : []).filter(item => item?.source && item?.url)],
    collections: normalizeCollections(nextCollections),
    libraryMeta: nextMeta,
    progress: normalizeProgress([...progressMap.values()]),
    portability: normalizePortabilityState(nextPortability),
    applied,
  };
}

function wrapCardText(text, maxChars = 30, maxLines = 2) {
  const words = cleanText(text, 180).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line ? `${line} ${word}` : word).length > maxChars) {
      if (line) lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/…?$/, '…')}`;
  return lines.length ? lines : ['Mikozora'];
}

export function buildShareCardSvg({ eyebrow = 'MIKOZORA', title = 'My watching', subtitle = '', stats = [], footer = 'Generated locally by Mikozora' } = {}) {
  const titleLines = wrapCardText(title, 28, 2);
  const cleanStats = (Array.isArray(stats) ? stats : []).slice(0, 4).map(stat => ({ label: cleanText(stat?.label, 40), value: cleanText(stat?.value, 60) }));
  const statSvg = cleanStats.map((stat, index) => {
    const x = 72 + index * 264;
    return `<g><rect x="${x}" y="392" width="240" height="122" rx="22" fill="#1b251c" stroke="#3a4a3a"/><text x="${x + 22}" y="430" fill="#91a58d" font-family="Arial, sans-serif" font-size="17" font-weight="700" letter-spacing="2">${escapeXml(stat.label.toUpperCase())}</text><text x="${x + 22}" y="478" fill="#f2f6ee" font-family="Arial, sans-serif" font-size="34" font-weight="800">${escapeXml(stat.value)}</text></g>`;
  }).join('');
  const titleSvg = titleLines.map((line, index) => `<text x="72" y="${190 + index * 68}" fill="#f5f8f1" font-family="Arial, sans-serif" font-size="58" font-weight="900">${escapeXml(line)}</text>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escapeXml(title)}">\n  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22301f"/><stop offset="0.58" stop-color="#121813"/><stop offset="1" stop-color="#0d120e"/></linearGradient></defs>\n  <rect width="1200" height="630" fill="url(#bg)"/>\n  <circle cx="1080" cy="62" r="170" fill="#c8ee99" opacity="0.10"/>\n  <text x="72" y="92" fill="#c8ee99" font-family="Arial, sans-serif" font-size="22" font-weight="800" letter-spacing="5">${escapeXml(cleanText(eyebrow, 60).toUpperCase())}</text>\n  ${titleSvg}\n  <text x="74" y="${titleLines.length > 1 ? 332 : 268}" fill="#aebba9" font-family="Arial, sans-serif" font-size="27">${escapeXml(cleanText(subtitle, 120))}</text>\n  ${statSvg}\n  <text x="72" y="574" fill="#7f907c" font-family="Arial, sans-serif" font-size="19">${escapeXml(cleanText(footer, 120))}</text>\n  <text x="1068" y="574" text-anchor="end" fill="#c8ee99" font-family="Arial, sans-serif" font-size="25" font-weight="900">Mikozora</text>\n</svg>\n`;
}

export function portableFileName(kind, date = new Date()) {
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  if (kind === 'csv') return `mikozora-library-${stamp}.csv`;
  if (kind === 'mal') return `mikozora-library-mal-${stamp}.xml`;
  if (kind === 'anilist') return `mikozora-library-anilist-${stamp}.json`;
  if (kind === 'wrapped-card') return `mikozora-wrapped-${stamp}.svg`;
  if (kind === 'series-card') return `mikozora-series-${stamp}.svg`;
  return `mikozora-library-${stamp}.json`;
}

export { FAVOURITES_ID };
