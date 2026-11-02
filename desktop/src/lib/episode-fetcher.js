// Windows port of Android's EpisodeFetcher.java.
//
// Fetches only source-provided episode listings (never players, never
// invented episodes) through the allowlisted desktop HTTP port, and shapes
// them as { key, number, title, url, numeric } exactly like the Java code.
import { parseHTML } from 'linkedom';
import { matchesSource, sourceBase } from './allowlist.js';
import { getEpisodeListText } from './http.js';

const NUMBER = /^\d{1,7}(?:\.\d{1,3})?$/;
const NUMBER_IN_TEXT = /(?:episode|eps?)\s*([0-9]+(?:\.[0-9]+)?)/i;
const FIRST_NUMBER = /\b([0-9]+(?:\.[0-9]+)?)\b/;
const LIMIT = 10000;

// The parsers below read raw attributes and resolve URLs manually (like
// the Jsoup originals reading attr("href")), so no document base is needed.
const doc = (html) => parseHTML(String(html || '')).document;

const text = (el) => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '');
const attr = (el, name) => (el ? String(el.getAttribute(name) || '') : '');

// Mirrors BigDecimal.stripTrailingZeros().toPlainString() for the bounded
// NUMBER shape: canonical("007.50") === "7.5", canonical("12.0") === "12".
export function canonical(value) {
  const s = value == null ? '' : String(value).trim();
  if (!NUMBER.test(s)) return '';
  const [wholeRaw, fracRaw = ''] = s.split('.');
  const whole = wholeRaw.replace(/^0+(?=\d)/, '');
  const frac = fracRaw.replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

function extractNumber(raw) {
  if (raw == null) return '';
  const a = NUMBER_IN_TEXT.exec(String(raw));
  if (a) return canonical(a[1]);
  const b = FIRST_NUMBER.exec(String(raw));
  return canonical(b ? b[1] : '');
}

// java.net.URLEncoder (UTF-8) followed by the Java code's '+' -> '%20'.
function encode(s) {
  return encodeURIComponent(String(s))
    .replace(/!/g, '%21').replace(/'/g, '%27')
    .replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/~/g, '%7E');
}

function episodeUrl(source, series, raw) {
  try {
    if (raw == null || raw === '' || raw.length > 2500) return '';
    const u = new URL(String(raw).trim(), series);
    const normalized = `${u.protocol}//${u.host}${u.pathname}`;
    return matchesSource(source, normalized) ? normalized : '';
  } catch { return ''; }
}

function add(out, number, title, url) {
  if (!url) return;
  const key = number === '' ? `url:${url}` : `number:${number}`;
  if (key.length > 2700 || out.has(key)) return;
  let n = 0;
  if (number !== '') { const parsed = Number(number); if (Number.isFinite(parsed)) n = parsed; }
  const cleanTitle = String(title || '');
  out.set(key, {
    key,
    number,
    title: cleanTitle.length > 300 ? cleanTitle.slice(0, 300) : cleanTitle,
    url,
    numeric: n,
  });
}

function isUpcoming(page) {
  for (const e of page.querySelectorAll('.spe > span, .meta > div, [itemprop=status]')) {
    const s = text(e).toLowerCase();
    if (s.includes('status') && (s.includes('upcoming') || s.includes('not yet aired')
      || s.includes('not yet released') || s.includes('not_yet_released') || s.includes('coming soon'))) {
      return true;
    }
  }
  return false;
}

function isFuture(row, nowMs) {
  const utc = String(row?.airDateUtc || '');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*$/.test(utc)) {
    const when = Date.parse(`${utc.slice(0, 19)}Z`);
    if (Number.isFinite(when)) return when > nowMs;
  }
  const date = String(row?.airDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return date > new Date(nowMs).toISOString().slice(0, 10);
}

async function bash(series, base, getText, nowMs) {
  const match = /^\/anime\/([0-9]{1,10})\/?$/.exec(new URL(series).pathname);
  if (!match) throw new Error('Invalid AnimeBash series');
  const id = match[1];
  const detail = JSON.parse(await getText(`${base}/api/anime/${id}`));
  const watch = JSON.parse(await getText(`${base}/api/watch/${id}`));
  const episodes = Array.isArray(watch?.episodes) ? watch.episodes : null;
  if (!detail?.title || typeof detail.title !== 'object') throw new Error('AnimeBash did not return the series');
  // Only a real, source-provided list counts as available links. Empty
  // upcoming series are a valid baseline; reported totals alone do not
  // prove availability.
  if (!episodes || episodes.length === 0) {
    if (detail.status === 'NOT_YET_RELEASED') return [];
    throw new Error('AnimeBash did not provide episode links');
  }
  const sorted = episodes.slice(0, LIMIT).filter((ep) => ep && typeof ep === 'object');
  if (!sorted.length) throw new Error('AnimeBash episode list is invalid');
  sorted.sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
  const out = new Map();
  sorted.forEach((row, i) => {
    // TVDB metadata can include episodes that have not aired yet. Preserve
    // the site's sequential watch number but never announce a future row.
    if (isFuture(row, nowMs)) return;
    const number = String(i + 1);
    let title = String(row.title || '').trim();
    if (title === '' || title === 'null') title = `Episode ${number}`;
    add(out, number, title, `${base}/anime/${id}/${number}`);
  });
  return [...out.values()];
}

export async function fetchEpisodes(source, series, getText = getEpisodeListText, now = Date.now) {
  if (!matchesSource(source, series)) throw new Error('Invalid series source');
  const base = sourceBase(source);
  if (source === 'bash') return bash(series, base, getText, now());

  const page = doc(await getText(series));

  if (source === 'sogo' || source === 'suge' || source === 'anikoto' || source === 'waves') {
    const idElement = source === 'sogo'
      ? page.querySelector('#watch-page[data-id]')
      : page.querySelector('.watch-wrap[data-id], #watch-main[data-id]');
    const pageId = attr(idElement, 'data-id').trim();
    if (!/^[0-9]{1,15}$/.test(pageId)) throw new Error('Series episode list is unavailable');
    const json = JSON.parse(await getText(`${base}/ajax/episode/list/${pageId}?vrf=`));
    if (Number(json?.status) !== 200 || typeof json?.result !== 'string') {
      throw new Error('Source did not return an episode list');
    }
    const eps = doc(json.result);
    const links = source === 'sogo'
      ? eps.querySelectorAll('ul.episodes > li > a[data-num]')
      : eps.querySelectorAll('a[data-num][data-ids]');
    if (!links.length) {
      if (isUpcoming(page)) return [];
      throw new Error('Source episode list is empty or unavailable');
    }
    const out = new Map();
    let i = 0;
    for (const e of links) {
      if (i++ >= LIMIT) break;
      const raw = attr(e, 'data-num').trim();
      let slug = attr(e, 'data-slug').trim();
      if (slug === '') slug = raw;
      let number = canonical(raw);
      if (number === '') number = canonical(slug);
      let url = source === 'waves' ? episodeUrl(source, series, attr(e, 'href')) : '';
      if (url === '' && slug !== '') {
        url = episodeUrl(source, series, `${series.replace(/\/+$/, '')}/ep-${encode(slug)}`);
      }
      add(out, number, `Episode ${number === '' ? raw : number}`, url);
    }
    if (out.size === 0) throw new Error('Source episode links are unavailable');
    return [...out.values()];
  }

  if (source === 'xin' || source === 'rulz' || source === 'narul' || source === 'stream' || source === 'world') {
    const links = page.querySelectorAll('.eplister li a[href], .ep-item[data-number][href]');
    if (!links.length) {
      if (isUpcoming(page)) return [];
      throw new Error('Source episode list is empty or unavailable');
    }
    const out = new Map();
    let count = 0;
    for (const e of links) {
      if (count++ >= LIMIT) break;
      const numberElement = e.querySelector('.epl-num');
      const titleElement = e.querySelector('.epl-title');
      let raw = numberElement ? text(numberElement) : attr(e, 'data-number');
      if (raw === '') raw = text(e);
      const number = extractNumber(raw);
      let title = titleElement ? text(titleElement) : '';
      if (title === '') title = number === '' ? 'New episode' : `Episode ${number}`;
      add(out, number, title, episodeUrl(source, series, attr(e, 'href')));
    }
    if (out.size === 0) throw new Error('Source episode links are unavailable');
    return [...out.values()];
  }

  throw new Error('Unsupported series source');
}
