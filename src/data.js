import { DOMParser as InertDOMParser } from 'linkedom/worker';
import { findGenre, genreSlug, normalizeRating, findRatingInText, yearFromText, isNsfw as titleIsNsfw } from './content.js';
import { RELEASES_API_URL, releaseFromApi } from './update.js';

/** Independent source adapters. Titles, episodes and video servers come from the sites. */
export const SOURCES = {
  sogo: { id:'sogo', name:'AnimeSogo', base:'https://animesogo.to', homepage:'https://animesogo.to/home', category:'Anime', language:'Sub & dub', accent:'#bfe88d', description:'Anime series, movies and more.' },
  suge: { id:'suge', name:'AnimeSuge', base:'https://animesuge.cz', category:'Anime', language:'Sub & dub', accent:'#91d7c2', description:'Anime series and movies.' },
  anikoto: { id:'anikoto', name:'Anikoto', base:'https://anikototv.to', homepage:'https://anikototv.to/home', category:'Anime', language:'Sub & dub', accent:'#a9c7fc', description:'Anime series, specials and films.' },
  rulz: { id:'rulz', name:'Animerulz', base:'https://animerulz.com.in', category:'Anime', language:'Sub & dub', accent:'#f4bd98', description:'Anime episodes and series.' },
  waves: { id:'waves', name:'Aniwaves', base:'https://aniwaves.ru', homepage:'https://aniwaves.ru/home', category:'Anime', language:'Sub & dub', accent:'#bcb1f3', description:'Anime series and movies.' },
  bash: { id:'bash', name:'AnimeBash', base:'https://animebash.in', homepage:'https://animebash.in/home', category:'Anime', language:'Sub & dub', accent:'#89d8c9', description:'Anime catalog with multiple player links.' },
  xin: { id:'xin', name:'AnimeXin', base:'https://animexin.dev', category:'Donghua', language:'English & Indonesian subs', accent:'#dbb8f2', description:'Donghua and animated series.' },
  narul: { id:'narul', name:'NarulDonghua', base:'https://naruldonghua.com', category:'Donghua', language:'Subtitled', accent:'#ead09b', description:'Chinese animation and ongoing series.' },
  stream: { id:'stream', name:'DonghuaStream', base:'https://donghuastream.org', category:'Donghua', language:'Subtitled', accent:'#99d6d5', description:'Donghua series and episodes.' },
  world: { id:'world', name:'DonghuaWorld', base:'https://donghuaworld.com', category:'Donghua', language:'Subtitled', accent:'#dfb5df', description:'Chinese animation and series.' },
};
const cache = new Map();
const inflight = new Map();
let cacheGeneration = 0;
let nextRequest = 0;
const pending = new Map();

// Java sends bounded chunks to avoid the WebView/Binder message-size limit.
if (typeof window !== 'undefined') {
  window.__mokuNativeChunk = (id, chunk, done, error) => {
    const entry = pending.get(String(id));
    if (!entry) return;
    if (error) { clearTimeout(entry.timer); pending.delete(String(id)); entry.reject(new Error(error)); return; }
    entry.parts.push(chunk || '');
    if (done) { clearTimeout(entry.timer); pending.delete(String(id)); entry.resolve(entry.parts.join('')); }
  };
}
export function isAndroid() { return typeof window !== 'undefined' && !!window.MokuBridge; }
function bridgeCall(method, ...args) {
  return new Promise((resolve, reject) => {
    if (!isAndroid() || typeof window.MokuBridge[method] !== 'function') { reject(new Error('Downloads are available in the Android app.')); return; }
    const id = String(++nextRequest);
    const timeout = (method === 'chooseDownloadFolder' || method === 'saveBackupFile' || method === 'openBackupFile') ? 300000 : method === 'downloadOptions' ? 90000 : method === 'request' ? 120000 : 30000;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The app took too long to respond.')); }, timeout);
    pending.set(id, { resolve, reject, timer, parts: [] });
    try { window.MokuBridge[method](id, ...args); }
    catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
  });
}
const bridgeRequest = url => bridgeCall('request', url);
export function hasEpisodeUpdates() { return isAndroid() && typeof window.MokuBridge.episodeUpdates === 'function'; }
export async function syncEpisodeTitles(items, onOpen=false) { return JSON.parse(await bridgeCall('syncEpisodeTitles', JSON.stringify(items), !!onOpen)); }
export async function getEpisodeUpdates() { return JSON.parse(await bridgeCall('episodeUpdates')); }
export async function checkEpisodes() { return JSON.parse(await bridgeCall('checkEpisodes')); }
export async function setEpisodeAutomatic(enabled) { return JSON.parse(await bridgeCall('setEpisodeAutomatic', !!enabled)); }
export async function setEpisodeAlerts(enabled) { return JSON.parse(await bridgeCall('setEpisodeAlerts', !!enabled)); }
export async function markEpisodeRead(id='all') { return JSON.parse(await bridgeCall('markEpisodeRead', id)); }
export async function getDownloads() { return JSON.parse(await bridgeCall('downloads')); }
export async function getDownloadOptions(item, episode, language = 'english') {
  return JSON.parse(await bridgeCall('downloadOptions', JSON.stringify({ item: { source:item.source }, episode: { url:episode.url, ids:episode.ids || '' }, language })));
}
export async function enqueueDownloads(episodes, language = 'english', server = 'auto', quality = 'best') {
  return JSON.parse(await bridgeCall('enqueueDownloads', JSON.stringify({ episodes, language, server, quality })));
}
export async function removeDownload(id) { return bridgeCall('removeDownload', id); }
export async function getExportSettings() { return JSON.parse(await bridgeCall('exportSettings')); }
export async function chooseDownloadFolder() { return JSON.parse(await bridgeCall('chooseDownloadFolder')); }
export async function clearDownloadFolder() { return JSON.parse(await bridgeCall('clearDownloadFolder')); }
export async function exportDownload(id) { return JSON.parse(await bridgeCall('exportDownload', id)); }
// Backup file pickers (Settings): resolves {saved:true}, {canceled:true} or
// {text} from the native side; see backup.js for the file format itself.
export async function exportBackupToFile(name, text) { return JSON.parse(await bridgeCall('saveBackupFile', name, text)); }
export async function readBackupFromFile() { return JSON.parse(await bridgeCall('openBackupFile')); }
export function openExport(id) {
  if (!isAndroid() || typeof window.MokuBridge.openExport !== 'function') throw new Error('Open the exported file in the Android app.');
  window.MokuBridge.openExport(id);
}
export function openDownload(id) {
  if (!isAndroid() || typeof window.MokuBridge.openDownload !== 'function') throw new Error('Offline playback is available in the Android app.');
  window.MokuBridge.openDownload(id);
}
async function getText(url, cacheMs = 60000) {
  const old = cache.get(url);
  if (old && old.until > Date.now()) return old.body;
  if (inflight.has(url)) return inflight.get(url);
  const generation = cacheGeneration;
  const request = (async () => {
    let body;
    if (isAndroid()) body = await bridgeRequest(url);
    else {
      const response = await fetch(`/api/raw?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error((await response.text()) || `Source returned ${response.status}`);
      body = await response.text();
    }
    if (generation === cacheGeneration) cache.set(url, { body, until: Date.now() + cacheMs });
    return body;
  })();
  inflight.set(url, request);
  try { return await request; }
  finally { if (inflight.get(url) === request) inflight.delete(url); }
}
export function clearNetworkCache() { cacheGeneration++; cache.clear(); inflight.clear(); }
// Ask GitHub for the newest published release (the in-app update checker).
// Rides the same document fetch path as source pages; api.github.com is on
// the native document-host allowlist for exactly this call.
export async function fetchLatestRelease() {
  const info = releaseFromApi(JSON.parse(await getText(RELEASES_API_URL, 0)));
  if (!info) throw new Error('GitHub did not return a recognizable release.');
  return info;
}
export function imageUrl(url) {
  if (!url) return '';
  // Images are proxied with the source Referer. AnimeXin otherwise blocks hotlinks.
  return `${isAndroid() ? 'https://app.moku.local' : ''}/api/image?url=${encodeURIComponent(url)}`;
}
// Parse source HTML in a pure-JS, inert DOM: no scripts, event handlers, iframes or image requests execute.
const doc = (html) => new InertDOMParser().parseFromString(html, 'text/html');
const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const attr = (el, name) => el?.getAttribute(name) || '';
function absolute(value, base) {
  if (!value) return '';
  try { const u = new URL(value, base); return u.protocol === 'https:' ? u.href : ''; }
  catch { return ''; }
}
function normSogo(url) {
  try {
    const u = new URL(url, SOURCES.sogo.base);
    if (u.hostname !== 'animesogo.to' || !u.pathname.startsWith('/watch/')) return '';
    return `${SOURCES.sogo.base}${u.pathname.replace(/\/ep-[^/]+\/?$/i, '').replace(/\/$/, '')}`;
  } catch { return ''; }
}
function normXin(url) {
  try { const u = new URL(url, SOURCES.xin.base); return u.hostname === 'animexin.dev' ? u.origin + u.pathname : ''; }
  catch { return ''; }
}
function distinct(items) {
  const set = new Set();
  return items.filter(x => x?.url && x.title && !set.has(x.url) && set.add(x.url));
}
// Listing cards carry less metadata than detail pages, but some sources include
// genre links, a release year or an age-rating token in the card meta. Extract
// only what is actually there; unknown values stay absent rather than guessed.
function uniqueText(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}
function cardGenres(scope) {
  if (!scope) return [];
  return uniqueText([...scope.querySelectorAll('a[href*="/genre/"], a[href*="/genres/"], .genxed a, .genres a')].map(text)).filter(name => name.length <= 40);
}
function enrichCard(item, scope) {
  // Join descendant text too: sibling spans can concatenate ("2024"+"18+") and hide both values.
  const meta = scope ? [...scope.querySelectorAll('.meta, .fdi, .fdi-item, .item-status, .bt, .year, .rating, .age-rating')].flatMap(el => [text(el), ...[...el.querySelectorAll('*')].map(text)]).join(' ') : '';
  const genres = cardGenres(scope);
  const year = yearFromText(meta);
  const rating = findRatingInText(meta);
  const result = {...item};
  if (genres.length) result.genres = genres;
  if (year) result.year = year;
  if (rating) result.rating = rating.label;
  if (titleIsNsfw(result)) result.nsfw = true;
  return result;
}
// Age ratings live under several label wordings. A "Rating" that turns out to be a
// numeric score is rejected by normalizeRating, so scores never pose as age ratings.
function ratingInDocument(document, getter) {
  for (const label of ['Age rating','Age Rating','Rated','Rating']) {
    const rating = normalizeRating(getter(document, label));
    if (rating) return rating.label;
  }
  const meta = [...document.querySelectorAll('.bl-meta, .bmeta, .spe, .fdi')].map(text).join(' ');
  return findRatingInText(meta)?.label || '';
}
// Finish a detail record: derive its release year, keep only a normalized rating
// label, and flag it NSFW when its own rating/genres say so.
function withContent(result) {
  const year = yearFromText(result.aired || '') || result.year;
  if (year) result.year = Number(year); else delete result.year;
  const rating = normalizeRating(result.rating);
  if (rating) result.rating = rating.label; else delete result.rating;
  if (titleIsNsfw(result)) result.nsfw = true; else delete result.nsfw;
  return result;
}
function parseSogoCards(document) {
  return distinct([...document.querySelectorAll('div.ani.items > div.item, #recent-update .ani.items > div.item')].map(item => {
    const a = item.querySelector('a.name[href], a.poster[href]');
    const image = item.querySelector('a.poster img, img');
    return enrichCard({ source: 'sogo', url: normSogo(attr(a, 'href')), title: text(item.querySelector('a.name')) || attr(image, 'alt'), image: absolute(attr(image, 'data-src') || attr(image, 'src'), SOURCES.sogo.base), type: text(item.querySelector('.type')) || 'Anime', badge: text(item.querySelector('.ep-status.sub')) ? `EP ${text(item.querySelector('.ep-status.sub'))}` : 'SUB', status: '' }, item);
  }));
}
function parseXinCards(document) {
  return distinct([...document.querySelectorAll('.postbody .listupd article.bs')].map(item => {
    const a = item.querySelector('a[href]'), image = item.querySelector('img');
    return enrichCard({ source: 'xin', url: normXin(attr(a, 'href')), title: attr(a, 'title') || text(item.querySelector('.tt h2')) || text(item.querySelector('.tt')), image: absolute(attr(image, 'data-src') || attr(image, 'src'), SOURCES.xin.base), type: text(item.querySelector('.typez')) || 'Donghua', badge: text(item.querySelector('.sb')) || 'SUB', status: text(item.querySelector('.epx')) }, item);
  }));
}
export async function getFeatured() {
  const document = doc(await getText(`${SOURCES.sogo.base}/home`));
  const slides = [...document.querySelectorAll('.swiper-slide.item')].map(item => {
    const link = item.querySelector('a[href*="/watch/"]');
    const style = attr(item, 'style');
    const bg = style.match(/url\(['"]?([^'")]+)['"]?\)/i)?.[1] || '';
    return { source: 'sogo', url: normSogo(attr(link, 'href')), title: text(item.querySelector('.title')), banner: absolute(bg, SOURCES.sogo.base), genres: text(item.querySelector('.genre')) };
  });
  return slides.filter(x => x.url && x.title && x.banner);
}
// The source's own weekly leaderboards, not its recently updated episode feed.
export async function getTrending(source) {
  if (source === 'sogo') {
    const document = doc(await getText(`${SOURCES.sogo.base}/home`));
    const items = [...document.querySelectorAll('#top-anime .tab-content[data-name="week"] a.item[href]')].map((link, i) => {
      const style = attr(link.querySelector('.poster [style]'), 'style');
      const bg = style.match(/url\(['"]?([^'")]+)['"]?\)/i)?.[1] || '';
      return enrichCard({ source:'sogo', url:normSogo(attr(link, 'href')), title:text(link.querySelector('.name')), image:absolute(bg, SOURCES.sogo.base), type:'Anime', rank:i + 1 }, link);
    });
    return distinct(items);
  }
  if (source === 'xin') {
    const document = doc(await getText(`${SOURCES.xin.base}/`));
    const items = [...document.querySelectorAll('.wpop-weekly li')].map((item, i) => {
      const link = item.querySelector('h4 a.series[href], .imgseries a.series[href]');
      const image = item.querySelector('.imgseries img');
      const rank = Number(text(item.querySelector('.ctr'))) || i + 1;
      return enrichCard({ source:'xin', url:normXin(attr(link, 'href')), title:text(item.querySelector('h4 a')) || attr(image, 'alt'), image:absolute(attr(image, 'data-src') || attr(image, 'src'), SOURCES.xin.base), type:'Donghua', rank }, item);
    });
    return distinct(items);
  }
  throw new Error('Unknown source');
}
export async function getDiscoverAnime() {
  const document = doc(await getText(`${SOURCES.sogo.base}/filter?sort=most-viewed&page=1`));
  return parseSogoCards(document);
}
const SOGO_STATUS = { ongoing:'currently-airing', completed:'finished-airing', upcoming:'not-yet-aired' };
const XIN_STATUS = new Set(['ongoing','completed','upcoming']);
// New sites retain their own canonical IDs and URLs; existing Sogo/Xin IDs never change.
const WATCH_SOURCES = new Set(['suge','anikoto','waves']);
const WORDPRESS_SOURCES = new Set(['rulz','narul','stream','world']);
function sourceUrl(value, source, series = false) {
  if (!value || !String(value).trim() || String(value).startsWith('#')) return '';
  try {
    const base = SOURCES[source]?.base;
    if (!base) return '';
    const u = new URL(value, base);
    const site = new URL(base);
    if (u.protocol !== 'https:' || u.hostname !== site.hostname || u.username || u.password || (u.port && u.port !== '443')) return '';
    let path = u.pathname;
    if (series && WATCH_SOURCES.has(source)) path = path.replace(/\/ep-[^/]+\/?$/i, '').replace(/\/$/, '');
    if (series && source === 'bash') {
      const match = path.match(/^\/anime\/(\d+)(?:\/\d+)?\/?$/);
      if (!match) return '';
      path = `/anime/${match[1]}`;
    }
    return `${base}${path}`;
  } catch { return ''; }
}
function sourceImage(value, source) {
  if (!value) return '';
  try {
    let u = new URL(value || '', SOURCES[source].base);
    // Photon paths from these sites are image resize proxies. Convert only the
    // configured site's own uploads, not arbitrary URLs, back to the origin.
    if (/^i[0-3]\.wp\.com$/.test(u.hostname)) {
      const original = u.pathname.replace(/^\//, '');
      const originHost = new URL(SOURCES[source].base).hostname;
      if (!original.toLowerCase().startsWith(`${originHost}/wp-content/`)) return '';
      u = new URL(`https://${original}`);
    }
    return u.protocol === 'https:' ? u.href : '';
  } catch { return ''; }
}
function parseWatchCards(document, source) {
  const selector = source === 'suge' ? '.item-top a.poster[href*="/anime/"]' : '.ani.items > .item';
  const items = [...document.querySelectorAll(selector)].map(el => {
    const card = source === 'suge' ? el.parentNode?.parentNode : el;
    const link = source === 'suge' ? el : card?.querySelector('a.name[href], .poster a[href]');
    const image = card?.querySelector('img');
    const title = source === 'suge' ? text(card?.querySelector('.item-bottom .name a')) || attr(image,'alt') : text(card?.querySelector('a.name')) || attr(image,'alt');
    const number = text(card?.querySelector(source === 'suge' ? '.dub-sub-total .sub' : '.ep-status.sub'));
    return enrichCard({ source, url:sourceUrl(attr(link,'href'),source,true), title, image:sourceImage(attr(image,'data-src') || attr(image,'src'),source), type:text(card?.querySelector(source==='suge'?'.item-status .type':'.meta .right')) || 'Anime', badge:number?`EP ${number}`:'SUB', status:'' }, card);
  });
  return distinct(items);
}
function parseWpCards(document, source) {
  return distinct([...document.querySelectorAll('.postbody .listupd article.bs')].map(card => {
    const link=card.querySelector('a[href]'), image=card.querySelector('img');
    return enrichCard({ source, url:sourceUrl(attr(link,'href'),source,true), title:attr(link,'title') || text(card.querySelector('.tt h2')) || text(card.querySelector('.tt')), image:sourceImage(attr(image,'data-src') || attr(image,'data-lazy-src') || attr(image,'src'),source), type:text(card.querySelector('.typez')) || SOURCES[source].category, badge:text(card.querySelector('.sb')) || 'SUB', status:text(card.querySelector('.epx')) }, card);
  }));
}
function bashCard(row) {
  const id=String(row?.id || '');
  if (!/^\d{1,10}$/.test(id)) return null;
  const item={ source:'bash', url:`${SOURCES.bash.base}/anime/${id}`, title:row.title?.english || row.title?.romaji || '', image:sourceImage(row.coverImage?.large || row.coverImage?.extraLarge || row.coverImage?.medium || '', 'bash'), type:row.format || 'Anime', badge:'SUB & DUB', status:row.status || '' };
  // AnimeBash mirrors AniList fields when it returns them; keep only real values.
  const genres=uniqueText(Array.isArray(row.genres)?row.genres:[]);
  if (genres.length) item.genres=genres;
  const year=Number(row.seasonYear) || Number(row.startDate?.year) || 0;
  if (year>=1900 && year<=2099) item.year=year;
  if (row.isAdult===true || titleIsNsfw(item)) item.nsfw=true;
  return item;
}
// Genre and year are applied through each source's own listing where one exists,
// like status. A single genre uses the same /genre/ listing the source itself
// links to from its detail pages; combined or year-only filtering uses the watch
// sources' /filter route. WordPress sources expose a genre parameter on their
// anime list but no year listing, so a year request is reported, never faked.
function watchCatalogUrl(base, source, { search, page, status, genre, year }) {
  if (search) return `${base}/filter?keyword=${encodeURIComponent(search)}&page=${page}${source==='sogo'?'&vrf=':''}`;
  if (genre && !year && status==='all') return `${base}/genre/${genre}?page=${page}`;
  if (genre || year) {
    const params=[];
    if (genre) params.push(`genre%5B%5D=${encodeURIComponent(genre)}`);
    if (year) params.push(`year%5B%5D=${year}`);
    if (status!=='all') params.push(`status%5B%5D=${source==='waves'?(status==='ongoing'?'0':'1'):SOGO_STATUS[status]}`);
    return `${base}/filter?${params.join('&')}&page=${page}`;
  }
  if (source==='waves') return status!=='all' ? `${base}/filter?status%5B%5D=${status==='ongoing'?'0':'1'}&page=${page}` : `${base}/updated/page/${page}`;
  return status!=='all' ? `${base}/status/${SOGO_STATUS[status]}?page=${page}` : `${base}/latest-updated?page=${page}`;
}
async function extraCatalog(source, { search, page, status, genre = '', genreName = '', year = '' }) {
  const base=SOURCES[source].base;
  if (source==='bash') {
    const statusValue={ongoing:'RELEASING',completed:'FINISHED',upcoming:'NOT_YET_RELEASED'}[status];
    const url=`${base}/api/search?limit=24&offset=${(page-1)*24}${search?`&q=${encodeURIComponent(search)}`:''}${statusValue?`&status=${statusValue}`:''}${genreName?`&genre=${encodeURIComponent(genreName)}`:''}${year?`&year=${year}`:''}`;
    const json=JSON.parse(await getText(url));
    if (!Array.isArray(json.media)) throw new Error('AnimeBash did not return its catalog.');
    return {items:distinct(json.media.map(bashCard)),hasMore:!!json.pageInfo?.hasNextPage};
  }
  if (WATCH_SOURCES.has(source)) {
    if (source==='waves' && status==='upcoming') throw new Error('Aniwaves does not offer this status filter.');
    const url=watchCatalogUrl(base, source, { search, page, status, genre, year });
    const document=doc(await getText(url));
    return {items:parseWatchCards(document,source),hasMore:!!document.querySelector('.pagination li.active ~ li a[href]')};
  }
  if (WORDPRESS_SOURCES.has(source)) {
    if (year) throw new Error(`${SOURCES[source].name} does not offer a year filter.`);
    const url=search?`${base}/${page>1?`page/${page}/`:''}?s=${encodeURIComponent(search)}`:`${base}/anime/?page=${page}&order=update${status!=='all'?`&status=${status}`:''}${genre?`&genre%5B%5D=${encodeURIComponent(genre)}`:''}`;
    const document=doc(await getText(url));
    return {items:parseWpCards(document,source),hasMore:!!document.querySelector('.pagination a.next, .hpage a.r, .postbody a.r[href], .nav-links a.next')};
  }
  throw new Error('Unknown source');
}
function extraMeta(document, label) {
  const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const prefix=new RegExp('^'+escaped+'\\s*:\\s*','i');
  for (const node of document.querySelectorAll('.bmeta .meta > div, .data > .meta > div, .spe > span')) {
    const value=text(node);
    if (prefix.test(value)) return value.replace(prefix,'').trim();
  }
  return '';
}
async function extraDetail(item) {
  const source=item.source, base=SOURCES[source].base;
  const series=sourceUrl(item.url,source,true);
  if (!series) throw new Error('This title has an invalid source URL.');
  if (source==='bash') {
    const id=series.match(/\/anime\/(\d+)$/)?.[1];
    const [detail,watch]=await Promise.all([
      getText(`${base}/api/anime/${id}`).then(JSON.parse),
      getText(`${base}/api/watch/${id}`).then(JSON.parse)
    ]);
    if (!detail || !detail.title || !watch || typeof watch!=='object') throw new Error('AnimeBash did not return this series and its episodes.');
    // The site's player sorts its episode metadata and assigns sequential watch numbers.
    const sorted=[...(Array.isArray(watch.episodes)?watch.episodes:[])].sort((a,b)=>(Number(a.number)||0)-(Number(b.number)||0));
    // AnimeBash itself falls back to its reported aired count when its episode
    // metadata list is empty. Do not extrapolate when it supplies a partial list.
    const reported=detail.nextAiringEpisode?.episode ? Number(detail.nextAiringEpisode.episode)-1 : detail.status==='NOT_YET_RELEASED' ? 0 : Number(detail.episodes)||0;
    const count=Number.isFinite(reported) ? Math.max(0,Math.min(5000,Math.floor(reported))) : 0;
    const rows=sorted.length ? sorted : Array.from({length:count},(_,i)=>({number:i+1}));
    const episodes=rows.map((ep,i)=>({number:String(i+1),title:ep.title || `Episode ${i+1}`,url:`${base}/anime/${id}/${i+1}`,date:ep.airDate || '',sub:true,dub:true}));
    const release=detail.startDate ? [detail.startDate.year,detail.startDate.month,detail.startDate.day].filter(Boolean).join('-') : '';
    return withContent({...item,title:detail.title.english || detail.title.romaji || item.title,image:sourceImage(detail.coverImage?.extraLarge || detail.coverImage?.large || item.image,source),banner:sourceImage(detail.bannerImage || '',source),synopsis:detail.description || '',genres:Array.isArray(detail.genres)?detail.genres:[],status:({RELEASING:'Currently airing',FINISHED:'Finished',NOT_YET_RELEASED:'Upcoming',CANCELLED:'Cancelled',HIATUS:'Hiatus'})[detail.status] || detail.status || '',aired:release,episodeCount:String(detail.episodes || ''),type:detail.format || item.type,episodes,...(detail.isAdult===true?{nsfw:true}:{})});
  }
  const document=doc(await getText(series));
  if (WATCH_SOURCES.has(source)) {
    const pageId=attr(document.querySelector('.watch-wrap[data-id], #watch-main[data-id]'),'data-id');
    if (!/^\d+$/.test(pageId)) throw new Error(`${SOURCES[source].name} did not include a series ID.`);
    const response=JSON.parse(await getText(`${base}/ajax/episode/list/${pageId}?vrf=`));
    if (response.status!==200 || typeof response.result!=='string') throw new Error(`${SOURCES[source].name} did not return the episode list.`);
    const episodeDocument=doc(response.result);
    const episodes=[...episodeDocument.querySelectorAll('a[data-num][data-ids]')].map((el,i)=>{
      const raw=attr(el,'data-num'), slug=attr(el,'data-slug') || raw;
      const number=/^\d+(?:\.\d+)?$/.test(raw)?raw:(/^\d+(?:\.\d+)?$/.test(slug)?slug:String(i+1));
      const direct=source==='waves'?sourceUrl(attr(el,'href'),source):'';
      return {number,title:`Episode ${number}`,url:direct || `${series}/ep-${encodeURIComponent(slug)}`,ids:attr(el,'data-ids'),sub:attr(el,'data-sub')==='1',dub:attr(el,'data-dub')==='1',date:attr(el,'data-aired')?.slice(0,10) || ''};
    }).filter(x=>x.ids && x.url);
    const image=document.querySelector('#w-info .poster img, .watch-wrap .poster img, [itemprop="image"]');
    const playerStyle=attr(document.querySelector('#player'),'style');
    const background=playerStyle.match(/url\(['"]?([^'")]+)['"]?\)/i)?.[1] || '';
    const synopsis=text(document.querySelector('#w-info .synopsis .content, .watch-wrap .description .full > div, .watch-wrap .description .short > div'));
    const genres=[...document.querySelectorAll('#w-info .bmeta a[href*="/genre/"], .watch-wrap .data .meta a[href*="/genre/"]')].map(text);
    return withContent({...item,title:text(document.querySelector('h1.title')) || item.title,image:sourceImage(attr(image,'data-src') || attr(image,'src'),source) || item.image,banner:sourceImage(background,source),synopsis,genres,status:extraMeta(document,'Status'),aired:extraMeta(document,'Date aired') || extraMeta(document,'Aired'),episodeCount:extraMeta(document,'Episodes'),type:extraMeta(document,'Type') || item.type,rating:ratingInDocument(document,extraMeta),episodes});
  }
  if (WORDPRESS_SOURCES.has(source)) {
    const image=document.querySelector('.thumbook .thumb img');
    const paragraphs=[...document.querySelectorAll('.synp .entry-content p')].map(text).filter(p=>p && p.toLowerCase()!=='english');
    const eps=[...document.querySelectorAll('.eplister li a[href], .ep-item[data-number][href]')];
    const episodes=eps.map((el,i)=>{
      const displayed=text(el.querySelector('.epl-num')) || attr(el,'data-number');
      const number=parseEpisodeNumber(displayed || text(el),String(i+1));
      return {number,title:text(el.querySelector('.epl-title')) || `Episode ${number}`,url:sourceUrl(attr(el,'href'),source),date:text(el.querySelector('.epl-date')),sub:true,dub:false};
    }).filter(x=>x.url);
    return withContent({...item,title:text(document.querySelector('h1.entry-title, h1[itemprop="name"]')) || item.title,image:sourceImage(attr(image,'data-src') || attr(image,'data-lazy-src') || attr(image,'src'),source) || item.image,banner:sourceImage(attr(document.querySelector('.bigcover img'),'data-src') || attr(document.querySelector('.bigcover img'),'src'),source),synopsis:paragraphs[0] || text(document.querySelector('.synp .entry-content')),genres:[...document.querySelectorAll('.genxed a')].map(text),status:extraMeta(document,'Status'),aired:extraMeta(document,'Released'),episodeCount:extraMeta(document,'Episodes'),type:extraMeta(document,'Type') || item.type,rating:ratingInDocument(document,extraMeta),episodes});
  }
  throw new Error('Unknown source');
}
async function extraWatchServers(source, episode) {
  const base=SOURCES[source].base;
  const ids=episode.ids || '';
  if (!ids || ids.length>1000) throw new Error('This episode has no server information.');
  let listUrl;
  if (source==='waves') {
    // Aniwaves supplies two query parameters as data-ids; validate before splitting.
    const parts=ids.match(/^(\d+)&eps=(\d+(?:\.\d+)?)$/);
    if (!parts) throw new Error('Aniwaves did not provide valid episode server information.');
    listUrl=`${base}/ajax/server/list?servers=${parts[1]}&eps=${parts[2]}`;
  } else listUrl=`${base}/ajax/server/list?servers=${encodeURIComponent(ids)}`;
  const json=JSON.parse(await getText(listUrl,30000));
  if (json.status!==200 || typeof json.result!=='string') throw new Error(`${SOURCES[source].name} did not return its servers.`);
  const document=doc(json.result);
  const options=[...document.querySelectorAll('.type[data-type]')].flatMap(group=>[...group.querySelectorAll('[data-link-id]')].map(el=>({name:`${text(el.querySelector('span')) || text(el) || 'Server'} · ${(attr(group,'data-type') || 'sub').toUpperCase()}`,id:attr(el,'data-link-id')})));
  const results=await Promise.allSettled(options.slice(0,20).map(async option=>{
    const url=source==='waves'?`${base}/ajax/sources?id=${encodeURIComponent(option.id)}&asi=0&autoPlay=0`:`${base}/ajax/server?get=${encodeURIComponent(option.id)}`;
    const data=JSON.parse(await getText(url,30000));
    return {name:option.name,url:safeEmbed(data?.result?.url)};
  }));
  return results.filter(x=>x.status==='fulfilled' && x.value.url).map(x=>x.value);
}
async function bashServers(episode) {
  const url=sourceUrl(episode.url,'bash');
  const match=url.match(/^https:\/\/animebash\.in\/anime\/(\d+)\/(\d+)$/);
  if (!match) throw new Error('AnimeBash did not provide a valid episode.');
  const json=JSON.parse(await getText(`${SOURCES.bash.base}/api/watch/${match[1]}/${match[2]}`,30000));
  const results=[];
  for (const type of ['sub','dub']) for (const [name,raw] of Object.entries(json?.[type] || {}).slice(0,16)) {
    const url=safeEmbed(typeof raw==='string'?raw:'');
    if (url && !results.some(x=>x.url===url && x.name===`${name} · ${type.toUpperCase()}`)) results.push({name:`${name} · ${type.toUpperCase()}`,url});
  }
  return results;
}

export async function getCatalog(source, { query = '', page = 1, status = 'all', genre = '', year = '' } = {}) {
  const search = query.trim();
  const genreName = genre ? findGenre(genre) : '';
  if (genre && !genreName) throw new Error('Unknown genre');
  const genreValue = genreName ? genreSlug(genreName) : '';
  const yearValue = year === '' || year == null ? '' : String(year);
  if (yearValue && !/^(?:19|20)\d{2}$/.test(yearValue)) throw new Error('Unknown year');
  // Source keyword searches ignore their listing filters; never pretend they filtered.
  if (search && (status !== 'all' || genreValue || yearValue)) throw new Error('Clear the search to browse by status, genre or year.');
  if (status !== 'all' && !Object.prototype.hasOwnProperty.call(SOGO_STATUS, status)) throw new Error('Unknown status');
  if (WATCH_SOURCES.has(source) || WORDPRESS_SOURCES.has(source) || source === 'bash') return extraCatalog(source, { search, page, status, genre:genreValue, genreName, year:yearValue });
  if (source === 'sogo') {
    const url = watchCatalogUrl(SOURCES.sogo.base, 'sogo', { search, page, status, genre:genreValue, year:yearValue });
    const document = doc(await getText(url));
    const items = parseSogoCards(document);
    const hasMore = !!document.querySelector('.pagination li.active ~ li a[href]');
    return { items, hasMore };
  }
  if (source === 'xin') {
    if (yearValue) throw new Error('AnimeXin does not offer a year filter.');
    const url = search
      ? `${SOURCES.xin.base}/${page > 1 ? `page/${page}/` : ''}?s=${encodeURIComponent(search)}`
      : `${SOURCES.xin.base}/anime/?page=${page}&order=update${XIN_STATUS.has(status) ? `&status=${status}` : ''}${genreValue ? `&genre%5B%5D=${encodeURIComponent(genreValue)}` : ''}`;
    const document = doc(await getText(url));
    const items = parseXinCards(document);
    const hasMore = !!document.querySelector('.pagination a.next, .hpage a.r');
    return { items, hasMore };
  }
  throw new Error('Unknown source');
}

function metaValue(document, label) {
  // Match the entire label: Xin's "Released on" is the post date, not "Released".
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefix = new RegExp('^' + escaped + '\\s*:\\s*', 'i');
  for (const el of document.querySelectorAll('.bl-meta > .meta > div, .spe > span')) {
    const value = text(el);
    if (prefix.test(value)) return value.replace(prefix, '').trim();
  }
  return '';
}
function parseEpisodeNumber(str, fallback = '') {
  return (str || '').match(/(?:episode|eps?)\s*([\d.]+)/i)?.[1] || (str || '').match(/\b\d+(?:\.\d+)?\b/)?.[0] || fallback;
}
export async function getDetail(item) {
  if (WATCH_SOURCES.has(item.source) || WORDPRESS_SOURCES.has(item.source) || item.source === 'bash') return extraDetail(item);
  const html = await getText(item.url);
  const document = doc(html);
  if (item.source === 'sogo') {
    const baseUrl = normSogo(item.url);
    const pageId = attr(document.querySelector('#watch-page'), 'data-id');
    if (!pageId) throw new Error('The AnimeSogo page did not include a series ID.');
    const title = text(document.querySelector('#w-info h1.title')) || item.title;
    const image = absolute(attr(document.querySelector('#w-info .poster img'), 'src'), SOURCES.sogo.base) || item.image;
    const style = attr(document.querySelector('#player .backdrop'), 'style');
    const banner = absolute(style.match(/url\(['"]?([^'")]+)['"]?\)/i)?.[1] || '', SOURCES.sogo.base);
    const synopsis = text(document.querySelector('#w-info .synopsis .content'));
    const genres = [...document.querySelectorAll('#w-info .bl-meta a[href*="/genre/"]')].map(text);
    const response = JSON.parse(await getText(`${SOURCES.sogo.base}/ajax/episode/list/${encodeURIComponent(pageId)}?vrf=`));
    if (response.status !== 200 || typeof response.result !== 'string') throw new Error('AnimeSogo did not return the episode list.');
    const episodeDocument = doc(response.result);
    const episodes = [...episodeDocument.querySelectorAll('ul.episodes > li > a[data-num]')].map((el, i) => {
      const number = attr(el, 'data-num') || String(i + 1);
      return { number, title: `Episode ${number}`, url: `${baseUrl}/ep-${encodeURIComponent(number)}`, ids: attr(el, 'data-ids'), sub: attr(el, 'data-sub') === '1', dub: attr(el, 'data-dub') === '1', date: '' };
    });
    return withContent({ ...item, title, image, banner, synopsis, genres, status: metaValue(document, 'Status'), aired: metaValue(document, 'Date aired'), episodeCount: metaValue(document, 'Episodes'), type: metaValue(document, 'Type') || item.type, rating: ratingInDocument(document, metaValue), episodes });
  }
  const title = text(document.querySelector('h1.entry-title, h1[itemprop="name"]')) || item.title;
  const image = absolute(attr(document.querySelector('.thumbook .thumb img'), 'src'), SOURCES.xin.base) || item.image;
  const banner = absolute(attr(document.querySelector('.bigcover img'), 'src'), SOURCES.xin.base);
  const paragraphs = [...document.querySelectorAll('.synp .entry-content p')].map(text).filter(p => p && p.toLowerCase() !== 'english');
  const synopsis = paragraphs[0] || text(document.querySelector('.synp .entry-content'));
  const genres = [...document.querySelectorAll('.genxed a')].map(text);
  const episodes = [...document.querySelectorAll('.eplister li a[href]')].map((el, i) => {
    const number = text(el.querySelector('.epl-num')) || parseEpisodeNumber(text(el), String(i + 1));
    return { number, title: text(el.querySelector('.epl-title')) || `Episode ${number}`, url: normXin(attr(el, 'href')), date: text(el.querySelector('.epl-date')), sub: true, dub: false };
  }).filter(e => e.url);
  return withContent({ ...item, title, image, banner, synopsis, genres, status: metaValue(document, 'Status'), aired: metaValue(document, 'Released'), episodeCount: metaValue(document, 'Episodes'), type: metaValue(document, 'Type') || item.type, rating: ratingInDocument(document, metaValue), episodes });
}
function safeEmbed(url, base) {
  try {
    if (!url || /^(?:javascript|data|file|intent):/i.test(url.trim())) return '';
    const u = base ? new URL(url.trim(), base) : new URL(url.trim());
    if (base && u.protocol === 'http:') u.protocol = 'https:'; // Show an HTTPS-upgraded mirror where possible.
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) return '';
    return u.href;
  } catch { return ''; }
}
function base64Decode(value) {
  try {
    const raw = atob(value.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder('utf-8').decode(Uint8Array.from(raw, c => c.charCodeAt(0)));
  } catch { return ''; }
}
export async function getServers(source, episode) {
  if (WATCH_SOURCES.has(source)) return extraWatchServers(source, episode);
  if (source === 'bash') return bashServers(episode);
  if (source === 'sogo') {
    if (!episode.ids) throw new Error('This episode has no server information. Try opening it on AnimeSogo.');
    const json = JSON.parse(await getText(`${SOURCES.sogo.base}/ajax/server/list?servers=${encodeURIComponent(episode.ids)}`, 30000));
    const d = doc(json.result || '');
    const options = [...d.querySelectorAll('.type')].flatMap(group => {
      const language = attr(group, 'data-type').toUpperCase() || text(group.querySelector('label')) || 'SUB';
      return [...group.querySelectorAll('a.server[data-link-id]')].map(a => ({ name: `${text(a.querySelector('span')) || 'Server'} · ${language}`, id: attr(a, 'data-link-id') }));
    });
    const resolved = await Promise.allSettled(options.slice(0, 16).map(async option => {
      const data = JSON.parse(await getText(`${SOURCES.sogo.base}/ajax/server?get=${encodeURIComponent(option.id)}`, 30000));
      return { name: option.name, url: safeEmbed(data?.result?.url) };
    }));
    return resolved.filter(x => x.status === 'fulfilled' && x.value.url).map(x => x.value);
  }
  const d = doc(await getText(episode.url, 30000));
  const choices = [];
  const add = (name, candidate) => {
    // WordPress embeds may be protocol-relative (//ok.ru/...) or relative to the episode.
    // Preserve every labeled mirror but never pass scripts, local hosts or HTTP to the player.
    const url = safeEmbed(candidate, episode.url);
    if (url && !choices.some(x => x.url === url && x.name === name)) choices.push({ name: name || 'Server', url });
  };
  for (const option of d.querySelectorAll('select.mirror option[value]')) {
    const value = attr(option, 'value').trim();
    if (!value) continue;
    const decoded = /^(?:https?:)?\/\//i.test(value) ? value : base64Decode(value);
    if (!decoded) continue;
    if (/^(?:https?:)?\/\//i.test(decoded.trim())) { add(text(option), decoded.trim()); continue; }
    const embed = doc(decoded);
    for (const node of embed.querySelectorAll('iframe[src], iframe[data-src], iframe[data-lazy-src], video[src], video source[src], embed[src]')) {
      add(text(option), attr(node, 'src') || attr(node, 'data-src') || attr(node, 'data-lazy-src'));
    }
  }
  for (const option of d.querySelectorAll('[data-hash]')) {
    const decoded = base64Decode(attr(option, 'data-hash'));
    if (!decoded) continue;
    const embed = doc(decoded);
    for (const node of embed.querySelectorAll('iframe[src], iframe[data-src], video[src], video source[src], embed[src]'))
      add(text(option), attr(node, 'src') || attr(node, 'data-src'));
  }
  const defaultNode = d.querySelector('#pembed iframe');
  const defaultSrc = attr(defaultNode, 'data-litespeed-src') || attr(defaultNode, 'data-src') || attr(defaultNode, 'data-lazy-src') || attr(defaultNode, 'src');
  const fallback = safeEmbed(defaultSrc, episode.url);
  if (fallback && !choices.some(x => x.url === fallback)) choices.unshift({ name: 'Default server', url: fallback });
  return choices;
}
