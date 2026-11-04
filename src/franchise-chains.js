// Franchise Chains & Marathon Mode.
//
// A chain is a user-confirmed viewing order across separate source listings:
// Season 1, Season 2, a movie, specials, and so on. It is intentionally a
// separate relationship layer from confirmed source-version links. Chain
// membership never changes a title's source|URL identity and never shares
// watched episode numbers between different seasons or entries. Confirmed
// source-version links may still describe alternate listings of the *same*
// chain entry; Marathon Mode reads those links only through the caller-
// supplied related-key map, exactly like the catch-up planner.
import { titleKey } from './collections.js';
import {
  cleanSourceMatchItem,
  normalizeTitleForMatch,
  scoreTitleMatch,
  sourceTitleKey,
  titleMatchProfile,
} from './source-match.js';
import {
  normalizeProgress,
  titleProgress,
  watchedUrlSetForEpisodes,
} from './progress.js';
import { chronologicalEpisodes, firstUnwatchedEpisode } from './episode-tools.js';
import { normalizeLibraryMeta } from './library-meta.js';

export const FRANCHISE_CHAINS_KEY = 'moku.franchiseChains.v1';
export const FRANCHISE_CHAINS_VERSION = 1;
export const FRANCHISE_CANDIDATE_THRESHOLD = 55;
export const MAX_FRANCHISE_CHAINS = 200;
export const MAX_FRANCHISE_ENTRIES = 100;

const MAX_DISMISSED_SUGGESTIONS = 200;
const CHAIN_ID_PATTERN = /^[A-Za-z0-9_-]{1,96}$/;
const FRANCHISE_ENTRY_KINDS = new Set(['series', 'season', 'part', 'movie', 'special', 'entry']);

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value, max = 300) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function timestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function setOwn(target, key, value) {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
  } else {
    target[key] = value;
  }
}

function hashText(value) {
  const text = String(value || '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function franchiseChainId(value) {
  const id = cleanText(value, 96);
  if (!CHAIN_ID_PATTERN.test(id) || id === '__proto__' || id === 'constructor' || id === 'prototype') return '';
  return id;
}

function generatedChainId(name, keys, now, existing = {}) {
  const base = `chain-${hashText(`${timestamp(now)}\n${name}\n${keys.join('\n')}`)}`;
  if (!existing[base]) return base;
  let suffix = 2;
  while (existing[`${base}-${suffix}`]) suffix++;
  return `${base}-${suffix}`;
}

function titleFromUrl(url) {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop() || 'Franchise entry';
    const title = decodeURIComponent(segment).replace(/[-_]+/g, ' ').trim();
    return title ? title.replace(/\b\w/g, char => char.toUpperCase()) : 'Franchise entry';
  } catch {
    return 'Franchise entry';
  }
}

function itemFromKey(key) {
  const cleanKey = sourceTitleKey(key);
  if (!cleanKey) return null;
  const separator = cleanKey.indexOf('|');
  const source = cleanKey.slice(0, separator);
  const url = cleanKey.slice(separator + 1);
  return { source, url, title: titleFromUrl(url) };
}

function cleanChainItem(candidate, suppliedKey = '') {
  const clean = cleanSourceMatchItem(candidate);
  if (clean) return clean;
  const fallback = itemFromKey(suppliedKey || candidate);
  return fallback ? cleanSourceMatchItem(fallback) : null;
}

function categoryFor(item, categoryOf) {
  if (typeof categoryOf !== 'function') return '';
  const direct = cleanText(categoryOf(item), 40);
  if (direct) return direct;
  return cleanText(categoryOf(item?.source), 40);
}

/** The franchise-level base title: season/part markers removed, plus a
 * trailing format word removed when the listing itself is a movie/special. */
export function franchiseBaseTitle(item) {
  const profile = titleMatchProfile(item);
  const tokens = profile.base.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && profile.type === 'movie') {
    if (tokens.at(-1) === 'movie' && tokens.at(-2) === 'the') tokens.splice(-2);
    else if (['movie', 'film', 'gekijouban'].includes(tokens.at(-1))) tokens.pop();
  }
  if (tokens.length > 1 && profile.type === 'special') {
    while (tokens.length > 1 && ['special', 'specials', 'ova', 'oad'].includes(tokens.at(-1))) tokens.pop();
  }
  return tokens.join(' ');
}

function effectiveSeason(profile) {
  if (profile.season) return profile.season;
  return 1;
}

function effectivePart(profile) {
  if (profile.part) return profile.part;
  return profile.type === 'movie' || profile.type === 'special' ? 0 : 1;
}

/** A coarse “which franchise entry is this?” signature used only to avoid
 * putting two source listings of the same season into one suggested chain. */
export function franchiseEntrySignature(item) {
  const profile = titleMatchProfile(item);
  const type = profile.type || 'series';
  return [franchiseBaseTitle(item), effectiveSeason(profile), effectivePart(profile), type].join('|');
}

export function franchiseEntryKind(item) {
  const profile = titleMatchProfile(item);
  if (profile.type === 'movie') return 'movie';
  if (profile.type === 'special') return 'special';
  if (profile.season && profile.part) return 'part';
  if (profile.season) return 'season';
  if (profile.part) return 'part';
  if (profile.type === 'series') return 'series';
  return 'entry';
}

function contextualEntryLabel(item, allItems = []) {
  const profile = titleMatchProfile(item);
  if (profile.type === 'movie') return 'Movie';
  if (profile.type === 'special') return /\bova\b/i.test(item?.title || '') ? 'OVA' : 'Special';
  const profiles = (Array.isArray(allItems) ? allItems : []).map(entry => titleMatchProfile(entry));
  const season = profile.season || (profiles.some(entry => entry.season > 1 || (entry.season === 1 && entry.key !== profile.key)) ? 1 : 0);
  const sameSeasonHasLaterPart = profiles.some(entry => (entry.season || 1) === (season || 1) && entry.part > 1);
  const part = profile.part || (sameSeasonHasLaterPart ? 1 : 0);
  if (season && part) return `Season ${season} · Part ${part}`;
  if (season) return `Season ${season}`;
  if (part) return `Part ${part}`;
  return profile.type === 'series' || profile.episodeCount !== 1 ? 'Series' : 'Entry';
}

export function franchiseEntryLabel(item, allItems = []) {
  return contextualEntryLabel(item, allItems);
}

function stripDisplayMarkers(title, item) {
  let text = cleanText(title, 300);
  const profile = titleMatchProfile(item || { title: text });
  text = text
    .replace(/\bSeason\s+(?:\d{1,2}|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/gi, ' ')
    .replace(/\b(?:\d{1,2}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+Season\b/gi, ' ')
    .replace(/\b(?:Part|Cour)\s+(?:\d{1,2}|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/gi, ' ')
    .replace(/\b(?:\d{1,2}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:Part|Cour)\b/gi, ' ');
  if (profile.type === 'movie') text = text.replace(/(?:\s*[-:–—]\s*)?(?:The\s+)?(?:Movie|Film)\s*$/i, ' ');
  if (profile.type === 'special') text = text.replace(/(?:\s*[-:–—]\s*)?(?:Specials?|OVA|OAD)\s*$/i, ' ');
  if (profile.season > 1) {
    text = text.replace(/(?:\s*[-:–—]\s*)?(?:S\s*)?\d{1,2}\s*$/i, ' ');
    text = text.replace(/(?:\s*[-:–—]\s*)?(?:II|III|IV|V|VI|VII|VIII|IX|X)\s*$/i, ' ');
  }
  return cleanText(text.replace(/\s*[-:–—]\s*$/g, ' '), 160);
}

function titleCaseBase(base) {
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'the', 'to']);
  return String(base || '').split(/\s+/).filter(Boolean)
    .map((word, index) => index > 0 && small.has(word) ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

/** Default chain name derived from the first title in suggested order. */
export function suggestedChainName(itemsOrItem) {
  const items = Array.isArray(itemsOrItem) ? itemsOrItem : [itemsOrItem];
  const cleanItems = items.map(item => cleanSourceMatchItem(item)).filter(Boolean);
  if (!cleanItems.length) return 'Franchise chain';
  const first = sortFranchiseItems(cleanItems)[0];
  return stripDisplayMarkers(first.title, first) || titleCaseBase(franchiseBaseTitle(first)) || cleanText(first.title, 160) || 'Franchise chain';
}

function cleanChainEntry(raw, allRawItems = []) {
  const input = plainObject(raw) ? raw : {};
  const candidate = plainObject(input.item) ? input.item : input;
  const suppliedKey = sourceTitleKey(input.key || input.titleKey || '');
  const item = cleanChainItem(candidate, suppliedKey);
  if (!item) return null;
  const key = sourceTitleKey(item);
  const kind = FRANCHISE_ENTRY_KINDS.has(input.kind) ? input.kind : franchiseEntryKind(item);
  const allItems = (Array.isArray(allRawItems) ? allRawItems : [])
    .map(entry => cleanChainItem(plainObject(entry?.item) ? entry.item : entry, entry?.key || ''))
    .filter(Boolean);
  const label = cleanText(input.label, 80) || contextualEntryLabel(item, allItems.length ? allItems : [item]);
  const addedAt = timestamp(input.addedAt);
  return {
    key,
    item,
    kind,
    label,
    ...(addedAt ? { addedAt } : {}),
  };
}

function cleanChainEntries(rawEntries, now = 0) {
  const raw = Array.isArray(rawEntries) ? rawEntries : [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const clean = cleanChainEntry(entry, raw);
    if (!clean || seen.has(clean.key)) continue;
    seen.add(clean.key);
    out.push(now && !clean.addedAt ? { ...clean, addedAt: timestamp(now) } : clean);
    if (out.length >= MAX_FRANCHISE_ENTRIES) break;
  }
  return out;
}

function suggestionId(keys, chainId = '') {
  const cleanKeys = [...new Set((Array.isArray(keys) ? keys : []).map(sourceTitleKey).filter(Boolean))].sort();
  return cleanKeys.length ? `suggestion-${hashText(`${chainId}\n${cleanKeys.join('\n')}`)}` : '';
}

function normalizeDismissed(value) {
  const input = plainObject(value) ? value : {};
  const records = [];
  for (const [rawId, rawRecord] of Object.entries(input)) {
    const record = plainObject(rawRecord) ? rawRecord : {};
    const keys = [...new Set((Array.isArray(record.keys) ? record.keys : [])
      .map(sourceTitleKey).filter(Boolean))].sort().slice(0, MAX_FRANCHISE_ENTRIES);
    if (!keys.length) continue;
    const chainId = franchiseChainId(record.chainId || '');
    const id = franchiseChainId(rawId) || suggestionId(keys, chainId);
    if (!id) continue;
    records.push([id, {
      keys,
      ...(chainId ? { chainId } : {}),
      updatedAt: timestamp(record.updatedAt),
    }]);
  }
  records.sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0) || a[0].localeCompare(b[0]));
  const out = {};
  for (const [id, record] of records.slice(0, MAX_DISMISSED_SUGGESTIONS).sort((a, b) => a[0].localeCompare(b[0]))) {
    setOwn(out, id, record);
  }
  return out;
}

function rawChainRecords(value) {
  if (Array.isArray(value)) return value.map(chain => [chain, '']);
  if (plainObject(value?.chains)) return Object.entries(value.chains).map(([id, chain]) => [chain, id]);
  if (Array.isArray(value?.chains)) return value.chains.map(chain => [chain, '']);
  if (plainObject(value)) return Object.entries(value).map(([id, chain]) => [chain, id]);
  return [];
}

/**
 * Normalize the franchise-chain store. A title belongs to at most one chain;
 * when damaged/imported data repeats a title, the most recently updated chain
 * keeps it. That one-chain rule is what makes the next marathon entry
 * unambiguous.
 */
export function normalizeFranchiseChains(value) {
  const byId = new Map();
  for (const [rawChain, suppliedId] of rawChainRecords(value)) {
    if (!plainObject(rawChain)) continue;
    const entries = cleanChainEntries(rawChain.entries || rawChain.items || rawChain.titles || []);
    if (!entries.length) continue;
    const keys = entries.map(entry => entry.key);
    const createdAt = timestamp(rawChain.createdAt);
    const updatedAt = timestamp(rawChain.updatedAt) || createdAt;
    const name = cleanText(rawChain.name, 120) || suggestedChainName(entries.map(entry => entry.item));
    const id = franchiseChainId(rawChain.id || suppliedId) || generatedChainId(name, keys, updatedAt || createdAt || 1, Object.fromEntries(byId));
    const chain = {
      id,
      name,
      entries,
      ...(createdAt ? { createdAt } : {}),
      updatedAt,
    };
    const previous = byId.get(id);
    if (!previous || chain.updatedAt >= previous.updatedAt) byId.set(id, chain);
  }

  const ordered = [...byId.values()]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || a.id.localeCompare(b.id))
    .slice(0, MAX_FRANCHISE_CHAINS);
  const claimed = new Set();
  const chains = {};
  for (const chain of ordered) {
    const entries = chain.entries.filter(entry => {
      if (claimed.has(entry.key)) return false;
      claimed.add(entry.key);
      return true;
    });
    if (!entries.length) continue;
    setOwn(chains, chain.id, { ...chain, entries });
  }
  const sortedChains = {};
  for (const id of Object.keys(chains).sort()) setOwn(sortedChains, id, chains[id]);
  return {
    version: FRANCHISE_CHAINS_VERSION,
    chains: sortedChains,
    dismissed: normalizeDismissed(plainObject(value?.dismissed) ? value.dismissed : value?.dismissedSuggestions),
  };
}

export function readFranchiseChains(storage) {
  try { return normalizeFranchiseChains(JSON.parse(storage?.getItem?.(FRANCHISE_CHAINS_KEY) || 'null')); }
  catch { return normalizeFranchiseChains(null); }
}

export function saveFranchiseChains(storage, value) {
  const normalized = normalizeFranchiseChains(value);
  try {
    storage?.setItem?.(FRANCHISE_CHAINS_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function franchiseChainList(state) {
  return Object.values(normalizeFranchiseChains(state).chains)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || a.name.localeCompare(b.name));
}

export function chainForTitle(state, itemOrKey) {
  const key = sourceTitleKey(itemOrKey);
  if (!key) return null;
  return franchiseChainList(state).find(chain => chain.entries.some(entry => entry.key === key)) || null;
}

export function franchiseChainByTitleKey(state) {
  const out = {};
  for (const chain of franchiseChainList(state)) {
    for (const entry of chain.entries) setOwn(out, entry.key, chain);
  }
  return out;
}

function chainInputEntries(input, now) {
  const raw = Array.isArray(input?.entries) ? input.entries
    : Array.isArray(input?.items) ? input.items
      : Array.isArray(input) ? input : [];
  return cleanChainEntries(raw, timestamp(now) || Date.now());
}

function removeKeysFromOtherChains(chains, keepChainId, keys, now) {
  const moving = new Set(keys);
  const out = {};
  for (const [id, chain] of Object.entries(chains)) {
    if (id === keepChainId) continue;
    const entries = chain.entries.filter(entry => !moving.has(entry.key));
    if (!entries.length) continue;
    setOwn(out, id, entries.length === chain.entries.length ? chain : { ...chain, entries, updatedAt: timestamp(now) || Date.now() });
  }
  return out;
}

/** Create a chain. Titles already in another chain are moved, never copied. */
export function createFranchiseChain(state, input = {}, now = Date.now()) {
  const clean = normalizeFranchiseChains(state);
  const occurredAt = timestamp(now) || Date.now();
  const entries = chainInputEntries(input, occurredAt);
  if (!entries.length) return clean;
  const name = cleanText(input.name, 120) || suggestedChainName(entries.map(entry => entry.item));
  let id = franchiseChainId(input.id || '');
  if (!id || clean.chains[id]) id = generatedChainId(name, entries.map(entry => entry.key), occurredAt, clean.chains);
  const chains = removeKeysFromOtherChains(clean.chains, id, entries.map(entry => entry.key), occurredAt);
  setOwn(chains, id, {
    id,
    name,
    entries,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
  return normalizeFranchiseChains({ ...clean, chains });
}

/** Replace a chain's name and/or ordered entries. Moving semantics match create. */
export function updateFranchiseChain(state, chainId, patch = {}, now = Date.now()) {
  const clean = normalizeFranchiseChains(state);
  const id = franchiseChainId(chainId || patch.id || '');
  const existing = id ? clean.chains[id] : null;
  if (!existing) return clean;
  const occurredAt = timestamp(now) || Date.now();
  const hasEntries = Array.isArray(patch.entries) || Array.isArray(patch.items);
  const entries = hasEntries ? chainInputEntries(patch, occurredAt) : existing.entries;
  if (!entries.length) {
    const chains = { ...clean.chains };
    delete chains[id];
    return normalizeFranchiseChains({ ...clean, chains });
  }
  const chains = removeKeysFromOtherChains(clean.chains, id, entries.map(entry => entry.key), occurredAt);
  setOwn(chains, id, {
    ...existing,
    name: cleanText(patch.name, 120) || existing.name,
    entries,
    updatedAt: occurredAt,
  });
  return normalizeFranchiseChains({ ...clean, chains });
}

export function deleteFranchiseChain(state, chainId) {
  const clean = normalizeFranchiseChains(state);
  const id = franchiseChainId(chainId || '');
  if (!id || !clean.chains[id]) return clean;
  const chains = { ...clean.chains };
  delete chains[id];
  return normalizeFranchiseChains({ ...clean, chains });
}

export function moveFranchiseEntry(state, chainId, itemOrKey, delta, now = Date.now()) {
  const clean = normalizeFranchiseChains(state);
  const id = franchiseChainId(chainId || '');
  const chain = id ? clean.chains[id] : null;
  const key = sourceTitleKey(itemOrKey);
  if (!chain || !key) return clean;
  const from = chain.entries.findIndex(entry => entry.key === key);
  const amount = Math.trunc(Number(delta) || 0);
  const to = Math.max(0, Math.min(chain.entries.length - 1, from + amount));
  if (from < 0 || !amount || to === from) return clean;
  const entries = [...chain.entries];
  const [entry] = entries.splice(from, 1);
  entries.splice(to, 0, entry);
  return updateFranchiseChain(clean, id, { entries }, now);
}

export function franchiseSuggestionId(suggestionOrKeys, chainId = '') {
  if (plainObject(suggestionOrKeys)) {
    const supplied = franchiseChainId(suggestionOrKeys.id || '');
    if (supplied) return supplied;
    const keys = (suggestionOrKeys.items || suggestionOrKeys.candidateItems || suggestionOrKeys.keys || [])
      .map(entry => sourceTitleKey(entry?.item || entry)).filter(Boolean);
    return suggestionId(keys, chainId || suggestionOrKeys.chainId || '');
  }
  return suggestionId(suggestionOrKeys, chainId);
}

export function dismissFranchiseSuggestion(state, suggestion, now = Date.now()) {
  const clean = normalizeFranchiseChains(state);
  const rawItems = Array.isArray(suggestion) ? suggestion
    : (suggestion?.candidateItems || suggestion?.items || suggestion?.keys || []);
  const keys = [...new Set(rawItems.map(entry => sourceTitleKey(entry?.item || entry)).filter(Boolean))].sort();
  const chainId = franchiseChainId(suggestion?.chainId || '');
  const id = franchiseSuggestionId(suggestion, chainId) || suggestionId(keys, chainId);
  if (!id || !keys.length) return clean;
  return normalizeFranchiseChains({
    ...clean,
    dismissed: {
      ...clean.dismissed,
      [id]: { keys, ...(chainId ? { chainId } : {}), updatedAt: timestamp(now) || Date.now() },
    },
  });
}

function typeRank(profile) {
  if (profile.type === 'series' || !profile.type) return 0;
  if (profile.type === 'special') return 1;
  if (profile.type === 'movie') return 2;
  return 3;
}

/** Best-effort display order for a proposed chain. User order always wins
 * after a chain is saved; this is only the starting point in the editor. */
export function sortFranchiseItems(items) {
  const records = (Array.isArray(items) ? items : [])
    .map((item, index) => ({ item: cleanSourceMatchItem(item?.item || item), index }))
    .filter(entry => entry.item)
    .map(entry => ({ ...entry, profile: titleMatchProfile(entry.item) }));
  const seriesYears = records
    .filter(entry => entry.profile.type !== 'movie' && entry.profile.type !== 'special')
    .map(entry => ({ season: effectiveSeason(entry.profile), year: entry.profile.year || 0 }))
    .filter(entry => entry.year);
  const sortSeason = profile => {
    if (profile.season || (profile.type !== 'movie' && profile.type !== 'special')) return effectiveSeason(profile);
    if (!profile.year || !seriesYears.length) return 1;
    const seasonsAlreadyReleased = seriesYears
      .filter(entry => entry.year <= profile.year)
      .map(entry => entry.season);
    return seasonsAlreadyReleased.length ? Math.max(...seasonsAlreadyReleased) : 1;
  };
  const sortPart = profile => {
    if (profile.part) return profile.part;
    if (profile.type !== 'movie' && profile.type !== 'special') return 1;
    if (profile.year && seriesYears.length && profile.year < Math.min(...seriesYears.map(entry => entry.year))) return 0;
    return 99;
  };
  return records
    .sort((a, b) => sortSeason(a.profile) - sortSeason(b.profile)
      || sortPart(a.profile) - sortPart(b.profile)
      || (a.profile.year || 9999) - (b.profile.year || 9999)
      || typeRank(a.profile) - typeRank(b.profile)
      || a.profile.title.localeCompare(b.profile.title)
      || a.index - b.index)
    .map(entry => entry.item);
}

function sameEntryEvidence(first, second, options = {}) {
  const a = titleMatchProfile(first);
  const b = titleMatchProfile(second);
  if (a.key && a.key === b.key) return true;
  if (!a.normalized || !b.normalized) return false;
  if (franchiseBaseTitle(first) !== franchiseBaseTitle(second)) return false;
  if (a.season && b.season && a.season !== b.season) return false;
  if (a.part && b.part && a.part !== b.part) return false;
  if ((a.season > 1 && !b.season) || (b.season > 1 && !a.season)) return false;
  if ((a.part > 1 && !b.part) || (b.part > 1 && !a.part)) return false;
  if (a.type && b.type && a.type !== b.type) return false;
  if (franchiseEntrySignature(first) !== franchiseEntrySignature(second)) return false;
  const sameShow = scoreTitleMatch(first, second, options);
  return a.normalized === b.normalized || (!sameShow.hardConflict && sameShow.score >= 65);
}

/**
 * Score a possible *different franchise entry*, not the same show. The
 * same-show scorer deliberately caps different seasons; this scorer does the
 * opposite while still refusing to call likely duplicate listings separate.
 */
export function scoreFranchiseCandidate(seed, candidate, options = {}) {
  const first = cleanSourceMatchItem(seed);
  const second = cleanSourceMatchItem(candidate);
  if (!first || !second) return { score: 0, confidence: 'Low', reasons: ['A title is missing'], sameEntry: false };
  const a = titleMatchProfile(first);
  const b = titleMatchProfile(second);
  if (a.key && a.key === b.key) return { score: 0, confidence: 'Low', reasons: ['Same source listing'], sameEntry: true };

  const categoryA = categoryFor(first, options.categoryOf);
  const categoryB = categoryFor(second, options.categoryOf);
  if (categoryA && categoryB && categoryA.toLowerCase() !== categoryB.toLowerCase()) {
    return { score: 0, confidence: 'Low', reasons: ['Anime and Donghua categories differ'], sameEntry: false };
  }

  const baseA = franchiseBaseTitle(first);
  const baseB = franchiseBaseTitle(second);
  const reasons = [];
  let score = 0;
  if (baseA && baseA === baseB) {
    score += 58;
    reasons.push('Same franchise base title');
  } else if (baseA && baseB && (baseA.startsWith(`${baseB} `) || baseB.startsWith(`${baseA} `))) {
    score += 34;
    reasons.push('One franchise title extends the other');
  } else {
    return { score: 0, confidence: 'Low', reasons: ['Base titles differ'], sameEntry: false };
  }

  const sameEntry = sameEntryEvidence(first, second, options);
  const seasonDiffers = effectiveSeason(a) !== effectiveSeason(b)
    && !((!a.season && b.season === 1) || (!b.season && a.season === 1));
  const partDiffers = effectivePart(a) !== effectivePart(b)
    && !((!a.part && b.part === 1) || (!b.part && a.part === 1));
  const typeDiffers = !!(a.type && b.type && a.type !== b.type);
  if (seasonDiffers) { score += 22; reasons.push('Different season'); }
  if (partDiffers) { score += 18; reasons.push('Different part'); }
  if (typeDiffers) { score += 16; reasons.push('Different format in the franchise'); }
  if (!seasonDiffers && !partDiffers && !typeDiffers && baseA === baseB) {
    if (a.normalized !== b.normalized) { score += 5; reasons.push('Related title wording'); }
  }

  const sharedGenres = a.genres.filter(genre => b.genres.includes(genre));
  if (sharedGenres.length) { score += Math.min(8, sharedGenres.length * 3); reasons.push('Genres overlap'); }
  if (categoryA && categoryB) score += 3;
  if (a.year && b.year && Math.abs(a.year - b.year) <= 20) score += 2;
  if (sameEntry) {
    score = Math.min(score, 34);
    reasons.push('Looks like the same entry on another listing');
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    confidence: score >= 82 ? 'High' : score >= 68 ? 'Likely' : score >= FRANCHISE_CANDIDATE_THRESHOLD ? 'Possible' : 'Low',
    reasons: [...new Set(reasons)].slice(0, 5),
    sameEntry,
  };
}

/** Rank other listings that could be reviewed as entries around one title. */
export function rankFranchiseCandidates(seed, items, options = {}) {
  const cleanSeed = cleanSourceMatchItem(seed);
  if (!cleanSeed) return [];
  const excluded = new Set((Array.isArray(options.excludeKeys) ? options.excludeKeys : [])
    .map(sourceTitleKey).filter(Boolean));
  excluded.add(sourceTitleKey(cleanSeed));
  const byKey = new Map();
  for (const raw of Array.isArray(items) ? items : []) {
    const item = cleanSourceMatchItem(raw?.item || raw);
    const key = sourceTitleKey(item);
    if (!item || !key || excluded.has(key) || byKey.has(key)) continue;
    byKey.set(key, item);
  }
  const ranked = [...byKey.values()]
    .map((item, index) => ({ item, index, ...scoreFranchiseCandidate(cleanSeed, item, options) }))
    .filter(entry => !entry.sameEntry && entry.score >= (options.threshold ?? FRANCHISE_CANDIDATE_THRESHOLD))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen = [];
  const chosenSignatures = new Set();
  for (const entry of ranked) {
    const signature = franchiseEntrySignature(entry.item);
    if (chosenSignatures.has(signature)) continue;
    chosenSignatures.add(signature);
    chosen.push({ item: entry.item, score: entry.score, confidence: entry.confidence, reasons: entry.reasons });
  }
  const order = new Map(sortFranchiseItems([cleanSeed, ...chosen.map(entry => entry.item)]).map((item, index) => [sourceTitleKey(item), index]));
  chosen.sort((a, b) => (order.get(sourceTitleKey(a.item)) ?? 999) - (order.get(sourceTitleKey(b.item)) ?? 999) || b.score - a.score);
  const limit = Math.max(1, Math.min(50, Math.trunc(Number(options.limit) || 8)));
  return chosen.slice(0, limit);
}

export function franchiseSearchQueries(item, max = 3) {
  const clean = cleanSourceMatchItem(item);
  if (!clean) return [];
  const profile = titleMatchProfile(clean);
  const candidates = [suggestedChainName(clean), profile.base, franchiseBaseTitle(clean), clean.title];
  return [...new Map(candidates
    .map(candidate => cleanText(candidate, 240))
    .filter(Boolean)
    .map(candidate => [normalizeTitleForMatch(candidate), candidate])).values()]
    .slice(0, Math.max(1, Math.trunc(Number(max) || 3)));
}

function semanticSuggestionId(items, chainId = '', category = '') {
  const signatures = [...new Set((Array.isArray(items) ? items : []).map(franchiseEntrySignature).filter(Boolean))].sort();
  return signatures.length ? `suggestion-${hashText(`${chainId}\n${category}\n${signatures.join('\n')}`)}` : '';
}

function distinctEntryClusters(items, options = {}) {
  const clusters = [];
  for (const item of items) {
    const existing = clusters.find(cluster => sameEntryEvidence(cluster[0], item, options));
    if (existing) existing.push(item);
    else clusters.push([item]);
  }
  return clusters.map(cluster => cluster[0]);
}

/**
 * Conservative suggestions from titles Mikozora already knows locally. A
 * suggestion is never a chain: the UI opens it in the editor for the user to
 * review names, entries and order before anything is saved.
 */
export function suggestFranchiseChains(items, state, options = {}) {
  const cleanState = normalizeFranchiseChains(state);
  const byTitle = franchiseChainByTitleKey(cleanState);
  const known = new Map();
  for (const raw of Array.isArray(items) ? items : []) {
    const item = cleanSourceMatchItem(raw?.item || raw);
    const key = sourceTitleKey(item);
    if (!item || !key || known.has(key)) continue;
    if (options.hideNsfw && titleMatchProfile(item).adult) continue;
    known.set(key, item);
  }

  const groups = new Map();
  for (const item of known.values()) {
    const base = franchiseBaseTitle(item);
    if (!base) continue;
    const category = categoryFor(item, options.categoryOf).toLowerCase();
    const groupKey = `${category}\n${base}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(item);
  }

  const suggestions = [];
  for (const [groupKey, group] of groups.entries()) {
    const groupCategory = groupKey.split('\n')[0] || '';
    if (group.length < 2) continue;
    const representatives = distinctEntryClusters(group, options);
    if (representatives.length < 2 && !representatives.some(item => byTitle[sourceTitleKey(item)])) continue;
    const chainIds = [...new Set(representatives.map(item => byTitle[sourceTitleKey(item)]?.id).filter(Boolean))];
    if (chainIds.length > 1) continue;

    const signatures = new Set(representatives.map(franchiseEntrySignature));
    if (signatures.size < 2) continue;
    const hasSequenceEvidence = representatives.some(item => {
      const profile = titleMatchProfile(item);
      return profile.season > 1 || profile.part > 1 || profile.type === 'movie' || profile.type === 'special';
    }) || new Set(representatives.map(item => effectiveSeason(titleMatchProfile(item)))).size > 1
      || new Set(representatives.map(item => effectivePart(titleMatchProfile(item)))).size > 1;
    if (!hasSequenceEvidence) continue;

    if (!chainIds.length) {
      if (representatives.length < 2) continue;
      const ordered = sortFranchiseItems(representatives);
      const id = semanticSuggestionId(ordered, '', groupCategory);
      if (!id || cleanState.dismissed[id]) continue;
      const scores = ordered.slice(1).map(item => scoreFranchiseCandidate(ordered[0], item, options).score);
      suggestions.push({
        id,
        kind: 'create',
        name: suggestedChainName(ordered),
        items: ordered,
        candidateItems: ordered,
        score: scores.length ? Math.min(...scores) : 80,
        reasons: ['Same base title', 'Different season, part or format'],
      });
      continue;
    }

    const chain = cleanState.chains[chainIds[0]];
    if (!chain) continue;
    const existingKeys = new Set(chain.entries.map(entry => entry.key));
    const candidates = representatives.filter(item => !existingKeys.has(sourceTitleKey(item)));
    if (!candidates.length) continue;
    const id = semanticSuggestionId(candidates, chain.id, groupCategory);
    if (!id || cleanState.dismissed[id]) continue;
    const existingItems = chain.entries.map(entry => known.get(entry.key) || entry.item);
    const proposed = [...existingItems, ...sortFranchiseItems(candidates)];
    suggestions.push({
      id,
      kind: 'add',
      chainId: chain.id,
      name: chain.name,
      items: proposed,
      candidateItems: sortFranchiseItems(candidates),
      score: 82,
      reasons: ['Matches an existing chain base title', 'Review its place in the order'],
    });
  }

  suggestions.sort((a, b) => b.score - a.score || b.items.length - a.items.length || a.name.localeCompare(b.name));
  const limit = Math.max(1, Math.min(50, Math.trunc(Number(options.limit) || 12)));
  return suggestions.slice(0, limit);
}

function relatedKeyList(key, relatedKeysByTitle) {
  const out = new Set([key]);
  const raw = plainObject(relatedKeysByTitle) ? relatedKeysByTitle[key] : null;
  if (Array.isArray(raw) || raw instanceof Set) {
    for (const value of raw) {
      const clean = sourceTitleKey(value);
      if (clean) out.add(clean);
    }
  } else if (raw) {
    const clean = sourceTitleKey(raw);
    if (clean) out.add(clean);
  }
  return [...out];
}

function historyTimesByKey(history) {
  const out = new Map();
  for (const entry of Array.isArray(history) ? history : []) {
    const key = sourceTitleKey(entry?.item);
    if (!key) continue;
    out.set(key, Math.max(out.get(key) || 0, timestamp(entry?.time)));
  }
  return out;
}

function buildEntryView(entry, index, context) {
  const knownItem = context.knownByKey.get(entry.key);
  const item = cleanSourceMatchItem({ ...entry.item, ...(knownItem || {}) }) || entry.item;
  const relatedKeys = relatedKeyList(entry.key, context.relatedKeysByTitle);
  const snapshots = relatedKeys
    .map(key => context.progressByKey.get(key))
    .filter(snapshot => snapshot?.episodes?.length)
    .sort((a, b) => {
      const aDirect = a.key === entry.key ? 0 : 1;
      const bDirect = b.key === entry.key ? 0 : 1;
      return aDirect - bDirect || (b.updatedAt || 0) - (a.updatedAt || 0) || b.episodes.length - a.episodes.length;
    });
  const snapshot = snapshots[0] || null;
  const personal = context.libraryMeta[entry.key] || (snapshot ? context.libraryMeta[snapshot.key] : null) || {};
  let watchedCount = 0;
  let total = null;
  let episodes = [];
  let watched = new Set();
  let nextEpisode = null;
  let upNextEpisodes = [];
  let playItem = item;

  if (snapshot) {
    playItem = cleanSourceMatchItem({ ...item, ...snapshot.item }) || snapshot.item || item;
    episodes = chronologicalEpisodes(snapshot.episodes || []);
    watched = watchedUrlSetForEpisodes(context.progress, context.history, playItem, episodes, relatedKeys);
    watchedCount = episodes.filter(episode => watched.has(episode.url)).length;
    total = episodes.length || null;
    nextEpisode = firstUnwatchedEpisode(episodes, watched);
    upNextEpisodes = episodes.filter(episode => !watched.has(episode.url));
  } else {
    const progress = titleProgress(context.progress, context.history, item, relatedKeys);
    watchedCount = progress.watchedCount || 0;
    total = progress.total ?? null;
    watched = progress.watched || new Set();
  }

  const reportedTotal = titleMatchProfile(item).episodeCount || null;
  const completed = personal.status === 'completed' || (!!total && watchedCount >= total);
  const state = completed ? 'completed' : watchedCount > 0 ? 'in-progress' : 'not-started';
  const lastWatchedAt = Math.max(
    0,
    ...relatedKeys.map(key => Math.max(timestamp(context.progressByKey.get(key)?.updatedAt), context.historyTimes.get(key) || 0)),
  );
  return {
    ...entry,
    index,
    item,
    playItem,
    relatedKeys,
    personalStatus: personal.status || '',
    personalRating: Number(personal.rating) || 0,
    state,
    completed,
    started: watchedCount > 0,
    watchedCount,
    total,
    reportedTotal,
    percent: total ? Math.min(1, watchedCount / total) : completed ? 1 : null,
    hasSnapshot: !!snapshot,
    episodes,
    watched,
    nextEpisode,
    upNextEpisodes,
    behindCount: total ? Math.max(0, total - watchedCount) : null,
    lastWatchedAt,
    updatedAt: Math.max(lastWatchedAt, timestamp(personal.updatedAt)),
  };
}

/** Build display-ready chain views with whole-franchise progress. */
export function buildFranchiseChainViews(state, {
  knownItems = [],
  progress = [],
  history = [],
  libraryMeta = {},
  relatedKeysByTitle = {},
} = {}) {
  const cleanState = normalizeFranchiseChains(state);
  const cleanProgress = normalizeProgress(progress);
  const knownByKey = new Map();
  for (const raw of Array.isArray(knownItems) ? knownItems : []) {
    const item = cleanSourceMatchItem(raw?.item || raw);
    const key = sourceTitleKey(item);
    if (item && key && !knownByKey.has(key)) knownByKey.set(key, item);
  }
  for (const chain of Object.values(cleanState.chains)) {
    for (const entry of chain.entries) if (!knownByKey.has(entry.key)) knownByKey.set(entry.key, entry.item);
  }
  const context = {
    knownByKey,
    progress: cleanProgress,
    progressByKey: new Map(cleanProgress.map(entry => [entry.key || titleKey(entry.item), entry])),
    history: Array.isArray(history) ? history : [],
    historyTimes: historyTimesByKey(history),
    libraryMeta: normalizeLibraryMeta(libraryMeta),
    relatedKeysByTitle,
  };

  const views = Object.values(cleanState.chains).map(chain => {
    const entries = chain.entries.map((entry, index) => buildEntryView(entry, index, context));
    const currentEntry = entries.find(entry => !entry.completed) || null;
    const currentIndex = currentEntry ? currentEntry.index : -1;
    const knownEntries = entries.filter(entry => entry.total);
    const knownWatchedEpisodes = knownEntries.reduce((sum, entry) => sum + Math.min(entry.watchedCount, entry.total), 0);
    const knownTotalEpisodes = knownEntries.reduce((sum, entry) => sum + entry.total, 0);
    const watchedEpisodes = entries.reduce((sum, entry) => sum + entry.watchedCount, 0);
    const entriesCompleted = entries.filter(entry => entry.completed).length;
    const entriesStarted = entries.filter(entry => entry.started || entry.completed).length;
    const status = entries.length && entriesCompleted === entries.length ? 'completed'
      : entriesStarted ? 'in-progress' : 'not-started';
    const percent = status === 'completed' ? 1
      : knownTotalEpisodes ? Math.min(1, knownWatchedEpisodes / knownTotalEpisodes) : null;
    const nextAction = !currentEntry ? null
      : currentEntry.nextEpisode ? {
          kind: 'play',
          item: currentEntry.playItem,
          episode: currentEntry.nextEpisode,
          episodes: currentEntry.episodes,
          entry: currentEntry,
          label: `Play ${currentEntry.label} · Episode ${currentEntry.nextEpisode.number}`,
        }
        : {
            kind: 'open',
            item: currentEntry.item,
            episode: null,
            episodes: [],
            entry: currentEntry,
            label: currentEntry.watchedCount ? `Open ${currentEntry.label} to load episodes` : `Start ${currentEntry.label}`,
          };
    const lastWatchedAt = Math.max(0, ...entries.map(entry => entry.lastWatchedAt || 0));
    return {
      ...chain,
      entries,
      status,
      currentEntry,
      currentIndex,
      previousEntry: currentIndex > 0 ? entries[currentIndex - 1] : null,
      followingEntry: currentIndex >= 0 && currentIndex + 1 < entries.length ? entries[currentIndex + 1] : null,
      handoff: currentIndex > 0 && entries.slice(0, currentIndex).every(entry => entry.completed),
      nextAction,
      watchedEpisodes,
      knownWatchedEpisodes,
      knownTotalEpisodes,
      knownEpisodesBehind: Math.max(0, knownTotalEpisodes - knownWatchedEpisodes),
      entriesCompleted,
      entriesStarted,
      percent,
      lastWatchedAt,
      covers: entries.map(entry => entry.item).filter(item => item.image).slice(0, 4),
      needsSnapshot: !!currentEntry && !currentEntry.hasSnapshot,
      outOfOrderStarted: currentIndex >= 0 ? entries.slice(currentIndex + 1).filter(entry => entry.started && !entry.completed).length : 0,
    };
  });

  const rank = view => view.status === 'in-progress' ? 0 : view.status === 'not-started' ? 1 : 2;
  views.sort((a, b) => rank(a) - rank(b)
    || (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0)
    || (b.updatedAt || 0) - (a.updatedAt || 0)
    || a.name.localeCompare(b.name));
  return views;
}

export function franchiseChainForTitleView(views, itemOrKey) {
  const key = sourceTitleKey(itemOrKey);
  if (!key) return null;
  return (Array.isArray(views) ? views : []).find(view => view.entries.some(entry => entry.key === key)) || null;
}

/** Episodes for one sitting, in confirmed chain order. The session stops at
 * the first entry whose episode list Mikozora has not snapshotted yet. */
export function buildMarathonSession(chainView, { episodeGoal = 6 } = {}) {
  const goal = Math.max(1, Math.min(50, Math.trunc(Number(episodeGoal) || 6)));
  if (!chainView?.currentEntry) return [];
  const session = [];
  for (const entry of chainView.entries.slice(chainView.currentIndex)) {
    if (session.length >= goal) break;
    if (entry.completed) continue;
    if (!entry.hasSnapshot || !entry.upNextEpisodes?.length) break;
    for (const episode of entry.upNextEpisodes) {
      if (session.length >= goal) break;
      session.push({
        chainId: chainView.id,
        chainName: chainView.name,
        entryKey: entry.key,
        entryLabel: entry.label,
        item: entry.playItem,
        episode,
        episodes: entry.episodes,
      });
    }
    if (session.length < goal && entry.upNextEpisodes.length && entry !== chainView.entries.at(-1)) {
      // Continue only when this entry's remaining snapshot episodes were all
      // consumed. That is true here unless the goal stopped the inner loop.
      const consumed = session.filter(step => step.entryKey === entry.key).length;
      if (consumed < entry.upNextEpisodes.length) break;
    }
  }
  return session;
}

export function franchiseChainSummary(views) {
  const clean = Array.isArray(views) ? views : [];
  return {
    chains: clean.length,
    entries: clean.reduce((sum, view) => sum + (view.entries?.length || 0), 0),
    inProgress: clean.filter(view => view.status === 'in-progress').length,
    completed: clean.filter(view => view.status === 'completed').length,
    notStarted: clean.filter(view => view.status === 'not-started').length,
    watchedEpisodes: clean.reduce((sum, view) => sum + (Number(view.watchedEpisodes) || 0), 0),
    knownTotalEpisodes: clean.reduce((sum, view) => sum + (Number(view.knownTotalEpisodes) || 0), 0),
    knownEpisodesBehind: clean.reduce((sum, view) => sum + (Number(view.knownEpisodesBehind) || 0), 0),
    handoffs: clean.filter(view => view.handoff && view.currentEntry && !view.currentEntry.started).length,
  };
}
