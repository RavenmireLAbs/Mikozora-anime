// Search history/saved searches and the local index behind Command Centre.
// Commands are built only from data already loaded on this device; running a
// command never searches the web or changes anything until the shared UI
// dispatches the selected action.
import { titleKey } from './collections.js';

export const SEARCH_CENTRE_KEY = 'moku.searchCentre.v1';
const MAX_HISTORY = 30;
const MAX_SAVED = 50;
const MAX_COMMANDS = 1500;

function cleanText(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function hashText(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

export function searchEntryId(query, source = 'all') {
  const slug = cleanText(query, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'search';
  return `${slug}-${hashText(`${source}\n${cleanText(query, 240).toLowerCase()}`)}`;
}

function cleanSearchEntry(value) {
  const query = cleanText(value?.query, 240);
  if (!query) return null;
  const source = cleanText(value?.source || 'all', 30).toLowerCase() || 'all';
  return {
    id: cleanText(value?.id, 100) || searchEntryId(query, source),
    query,
    source,
    name: cleanText(value?.name || query, 120),
    updatedAt: Number.isFinite(Number(value?.updatedAt)) ? Number(value.updatedAt) : 0,
    createdAt: Number.isFinite(Number(value?.createdAt)) ? Number(value.createdAt) : 0,
  };
}

export function normalizeSearchCentre(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const dedupe = entries => {
    const seen = new Set();
    return entries.filter(entry => {
      const key = `${entry.source}\n${entry.query.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const history = dedupe((Array.isArray(input.history) ? input.history : []).map(cleanSearchEntry).filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt)).slice(0, MAX_HISTORY);
  const saved = dedupe((Array.isArray(input.saved) ? input.saved : []).map(cleanSearchEntry).filter(Boolean)
    .sort((a, b) => (b.createdAt || b.updatedAt) - (a.createdAt || a.updatedAt))).slice(0, MAX_SAVED);
  return { history, saved };
}

export function readSearchCentre(storage) {
  try { return normalizeSearchCentre(JSON.parse(storage?.getItem?.(SEARCH_CENTRE_KEY) || 'null')); }
  catch { return { history: [], saved: [] }; }
}

export function saveSearchCentre(storage, value) {
  const normalized = normalizeSearchCentre(value);
  try { storage?.setItem?.(SEARCH_CENTRE_KEY, JSON.stringify(normalized)); } catch { /* best effort */ }
  return normalized;
}

export function recordSearch(state, query, source = 'all', now = Date.now()) {
  const clean = normalizeSearchCentre(state);
  const entry = cleanSearchEntry({ query, source, updatedAt: now, createdAt: now });
  if (!entry) return clean;
  return normalizeSearchCentre({ ...clean, history: [entry, ...clean.history] });
}

export function saveSearch(state, query, source = 'all', now = Date.now(), name = '') {
  const clean = normalizeSearchCentre(state);
  const entry = cleanSearchEntry({ query, source, name: name || query, updatedAt: now, createdAt: now });
  if (!entry) return clean;
  return normalizeSearchCentre({ ...clean, saved: [entry, ...clean.saved] });
}

export function removeSavedSearch(state, id) {
  const clean = normalizeSearchCentre(state);
  return { ...clean, saved: clean.saved.filter(entry => entry.id !== id) };
}

export function clearSearchHistory(state) {
  return { ...normalizeSearchCentre(state), history: [] };
}

function validItem(item) {
  return !!(item?.source && item?.url && item?.title);
}

function commandText(item, episode) {
  return [item?.title, item?.source, item?.type, episode?.number ? `episode ${episode.number}` : '', episode?.title].filter(Boolean).join(' ');
}

export function buildCommandIndex({
  actions = [],
  library = [],
  history = [],
  progress = [],
  downloads = [],
  updates = [],
  planner = [],
} = {}) {
  const commands = [];
  const seen = new Set();
  const add = command => {
    if (!command?.id || !command?.title || seen.has(command.id) || commands.length >= MAX_COMMANDS) return;
    seen.add(command.id);
    commands.push({
      id: cleanText(command.id, 240),
      kind: cleanText(command.kind || 'action', 40),
      title: cleanText(command.title, 300),
      subtitle: cleanText(command.subtitle, 300),
      keywords: cleanText(command.keywords || command.title, 600),
      item: validItem(command.item) ? command.item : null,
      episode: command.episode?.url ? command.episode : null,
      page: cleanText(command.page, 40),
      actionId: cleanText(command.actionId, 100),
      downloadId: cleanText(command.downloadId, 80),
      updateId: cleanText(command.updateId, 120),
    });
  };

  for (const action of Array.isArray(actions) ? actions : []) add({ ...action, kind: action.kind || 'action' });

  const titleContexts = new Map();
  const rememberTitle = (item, context) => {
    if (!validItem(item)) return;
    const key = titleKey(item);
    const current = titleContexts.get(key) || { item, contexts: [] };
    if (!current.contexts.includes(context)) current.contexts.push(context);
    titleContexts.set(key, current);
  };
  for (const item of library) rememberTitle(item, 'Library');
  for (const entry of progress) rememberTitle(entry?.item, 'Progress');
  for (const entry of history) rememberTitle(entry?.item, 'History');
  for (const { item, contexts } of titleContexts.values()) {
    add({
      id: `title:${titleKey(item)}`,
      kind: 'title',
      title: item.title,
      subtitle: contexts.join(' · '),
      keywords: commandText(item),
      item,
    });
  }

  for (const entry of Array.isArray(planner) ? planner : []) {
    if (!validItem(entry?.item) || !entry?.episode?.url) continue;
    add({
      id: `planner:${titleKey(entry.item)}:${entry.episode.url}`,
      kind: 'planner-episode',
      title: `${entry.item.title} · Episode ${entry.episode.number || ''}`.trim(),
      subtitle: `Planner · ${entry.behindCount || 1} behind`,
      keywords: `${commandText(entry.item, entry.episode)} planner up next catch up`,
      item: entry.item,
      episode: entry.episode,
    });
  }

  for (const download of Array.isArray(downloads) ? downloads : []) {
    if (!validItem(download?.item) || !download?.episode?.url || !download?.id) continue;
    add({
      id: `download:${download.id}`,
      kind: 'download',
      title: `${download.item.title} · Episode ${download.episode.number || ''}`.trim(),
      subtitle: `Downloads · ${download.status || 'saved'}`,
      keywords: `${commandText(download.item, download.episode)} download offline ${download.status || ''}`,
      item: download.item,
      episode: download.episode,
      downloadId: download.id,
      page: 'downloads',
    });
  }

  for (const entry of Array.isArray(updates) ? updates : []) {
    const item = entry?.item;
    const episode = entry?.episode;
    if (!validItem(item) || !episode?.url) continue;
    add({
      id: `update:${entry.id || `${titleKey(item)}:${episode.url}`}`,
      kind: 'update',
      title: `${item.title} · Episode ${episode.number || ''}`.trim(),
      subtitle: entry.read ? 'Release Radar · read' : 'Release Radar · new episode',
      keywords: `${commandText(item, episode)} updates radar new episode`,
      item,
      episode,
      updateId: entry.id || '',
      page: 'updates',
    });
  }

  return commands;
}

function normalizeForSearch(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function searchCommands(commands, query, limit = 12) {
  const clean = (Array.isArray(commands) ? commands : []).filter(command => command?.id && command?.title);
  const max = Math.max(1, Math.min(50, Math.trunc(Number(limit) || 12)));
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return clean.slice(0, max);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return clean.map((command, index) => {
    const title = normalizeForSearch(command.title);
    const haystack = normalizeForSearch(`${command.title} ${command.subtitle || ''} ${command.keywords || ''}`);
    if (!tokens.every(token => haystack.includes(token))) return null;
    let score = 0;
    if (title === normalizedQuery) score += 100;
    else if (title.startsWith(normalizedQuery)) score += 60;
    else if (title.includes(normalizedQuery)) score += 35;
    for (const token of tokens) {
      if (title.startsWith(token)) score += 8;
      else if (title.includes(token)) score += 4;
      else score += 1;
    }
    if (command.kind === 'action') score += 2;
    return { command, score, index };
  }).filter(Boolean)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, max)
    .map(entry => entry.command);
}
