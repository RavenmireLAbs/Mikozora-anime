// URL policy for the desktop shell — a faithful port of Network.java.
// The app may fetch only the configured source sites (documents and
// artwork), and may open externally only source links plus this project's
// own GitHub release links. Keep these lists in sync with Network.java.

// Same user agent as Android: the source adapters' parsing is written
// against the markup this UA receives.
export const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

// Source document hosts, plus api.github.com for the in-app update checker.
const DOCUMENT_HOSTS = new Set([
  'animesogo.to', 'animesuge.cz', 'anikototv.to', 'animerulz.com.in', 'aniwaves.ru',
  'animebash.in', 'animexin.dev', 'naruldonghua.com', 'donghuastream.org', 'donghuaworld.com',
  'api.github.com',
]);
const IMAGE_HOSTS = new Set([
  'animesogo.to', 'animesuge.cz', 'anikototv.to', 'animerulz.com.in', 'aniwaves.ru',
  'static.aniwaves.ru', 'animebash.in', 'animexin.dev', 'naruldonghua.com',
  'donghuastream.org', 'donghuaworld.com', 'cdn.anipixcdn.co', 'image.tmdb.org',
  'media.themoviedb.org', 's4.anilist.co', 's3.anilist.co',
]);

export function checkUrl(raw, document) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('Invalid source URL'); }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')
      || !(document ? DOCUMENT_HOSTS : IMAGE_HOSTS).has(u.hostname.toLowerCase())) {
    throw new Error('Unsupported source host');
  }
  return u;
}

export function allowedSource(raw) {
  try { checkUrl(raw, true); return true; } catch { return false; }
}

// The in-app update checker opens this project's GitHub release page and
// installer asset in the browser. GitHub is not a content source, so keep
// the exception scoped to exactly those release links.
export function allowedProjectRelease(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password
      && (!u.port || u.port === '443')
      && u.hostname.toLowerCase() === 'github.com'
      && u.pathname.startsWith('/RavenmireLAbs/Mikozora-anime/releases/');
  } catch { return false; }
}

export function isHttps(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443')
      && host !== '' && host !== 'localhost' && !host.endsWith('.localhost') && !host.endsWith('.local')
      && host.includes('.') && !/^[0-9.]+$/.test(host) && !host.includes(':');
  } catch { return false; }
}

// Exact host-to-source mapping is also used to validate offline selections.
const SOURCE_BASES = {
  sogo: 'https://animesogo.to',
  suge: 'https://animesuge.cz',
  anikoto: 'https://anikototv.to',
  rulz: 'https://animerulz.com.in',
  waves: 'https://aniwaves.ru',
  bash: 'https://animebash.in',
  xin: 'https://animexin.dev',
  narul: 'https://naruldonghua.com',
  stream: 'https://donghuastream.org',
  world: 'https://donghuaworld.com',
};
export function sourceBase(source) {
  return SOURCE_BASES[source] || '';
}

const SOURCE_NAMES = {
  sogo: 'AnimeSogo', suge: 'AnimeSuge', anikoto: 'Anikoto', rulz: 'Animerulz',
  waves: 'Aniwaves', bash: 'AnimeBash', xin: 'AnimeXin', narul: 'NarulDonghua',
  stream: 'DonghuaStream', world: 'DonghuaWorld',
};
export function sourceName(source) {
  return SOURCE_NAMES[source] || 'Source';
}

export function matchesSource(source, raw) {
  try {
    const base = sourceBase(source);
    if (!base) return false;
    const u = checkUrl(raw, true);
    return u.hostname.toLowerCase() === new URL(base).hostname.toLowerCase();
  } catch { return false; }
}

// Referer rule from Network.get(): a document host refers to itself, the
// Aniwaves static host to its main site, everything else to AnimeSogo.
export function refererFor(url) {
  const host = url.hostname.toLowerCase();
  if (DOCUMENT_HOSTS.has(host)) return `https://${host}/`;
  if (host === 'static.aniwaves.ru') return 'https://aniwaves.ru/';
  return 'https://animesogo.to/';
}
