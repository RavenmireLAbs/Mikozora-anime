// Bounded, HTTPS-only requests to third-party video hosts — port of
// Android's SafeHttp.java / the media upstream checks in OfflineStore.java.
// Hosts must be syntactically public HTTPS hostnames and resolve only to
// public addresses. Every redirect hop is checked again.
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { UA, isHttps } from './allowlist.js';

const MEDIAFIRE_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
const DNS_CACHE_MS = 60_000;
const dnsCache = new Map();

function ipv4Int(address) {
  const parts = String(address).split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function inCidr(value, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (ipv4Int(base) & mask);
}

function isPublicIpv4(address) {
  const value = ipv4Int(address);
  if (value == null) return false;
  const blocked = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['192.175.48.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4],
  ];
  return !blocked.some(([base, bits]) => inCidr(value, base, bits));
}

function expandIpv6(address) {
  let text = String(address).toLowerCase();
  if (text.includes('.')) {
    const cut = text.lastIndexOf(':');
    const value = ipv4Int(text.slice(cut + 1));
    if (cut < 0 || value == null) return null;
    text = `${text.slice(0, cut + 1)}${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const groups = [...left, ...Array(missing).fill('0'), ...right].map((g) => parseInt(g || '0', 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

export function isPublicAddress(address) {
  const kind = isIP(String(address || ''));
  if (kind === 4) return isPublicIpv4(address);
  if (kind !== 6) return false;
  const g = expandIpv6(address);
  if (!g) return false;
  // IPv4-mapped addresses inherit the IPv4 decision.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return isPublicIpv4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  }
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x0100 && (g[1] & 0xffc0) === 0) return false; // 100::/64 discard
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2001 && g[1] === 0x0002 && g[2] === 0) return false; // benchmarking
  if (g[0] === 0x2001 && (g[1] & 0xfff0) === 0x0010) return false; // ORCHID
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo
  if (g[0] === 0x0064 && g[1] === 0xff9b) return false; // NAT64 well-known
  if ((g[0] & 0xff00) !== 0x2000 && (g[0] & 0xe000) !== 0x2000) return false; // require global unicast
  return true;
}

async function assertPublicHost(host, lookupFn, useCache) {
  const key = host.toLowerCase();
  const cached = useCache ? dnsCache.get(key) : null;
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = (async () => {
    let rows;
    try {
      rows = await lookupFn(key, { all: true, verbatim: true });
    } catch {
      throw new Error('Video host could not be reached');
    }
    const list = Array.isArray(rows) ? rows : [rows];
    if (!list.length || list.some((row) => !isPublicAddress(row?.address || row))) {
      throw new Error('Private video host is not allowed');
    }
  })();
  if (useCache) {
    dnsCache.set(key, { expires: Date.now() + DNS_CACHE_MS, promise });
    promise.catch(() => { if (dnsCache.get(key)?.promise === promise) dnsCache.delete(key); });
  }
  return promise;
}

export async function publicUrl(raw, options = {}) {
  if (!isHttps(raw)) throw new Error('Unsupported video URL');
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.home.arpa')) {
    throw new Error('Private video host is not allowed');
  }
  // A custom lookup is uncached in tests; production DNS results are cached
  // briefly so segment downloads do not stampede the resolver.
  await assertPublicHost(host, options.lookup || dnsLookup, !options.lookup);
  return url;
}

function combinedSignal(signal, timeoutMs) {
  const signals = [];
  if (signal) signals.push(signal);
  if (timeoutMs && timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
  if (!signals.length) return undefined;
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

export async function safeFetch(raw, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  let current = await publicUrl(raw, options);
  const signal = combinedSignal(options.signal, options.timeoutMs);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const host = current.hostname.toLowerCase();
    const headers = {
      'User-Agent': host === 'mediafire.com' || host === 'www.mediafire.com' ? MEDIAFIRE_UA : UA,
      'Accept': options.accept || 'text/html,application/json,application/vnd.apple.mpegurl,text/vtt,*/*;q=0.8',
      'Accept-Encoding': 'identity',
      'X-Requested-With': 'XMLHttpRequest',
      ...(options.headers || {}),
    };
    if (options.referer && isHttps(options.referer)) {
      headers.Referer = options.referer;
      try { headers.Origin = new URL(options.referer).origin; } catch { /* checked above */ }
    }
    const response = await fetchImpl(current, { redirect: 'manual', signal, headers });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers?.get?.('location');
      try { await response.body?.cancel(); } catch { /* already drained */ }
      if (!location) throw new Error('Invalid video-host redirect');
      current = await publicUrl(new URL(location, current).href, options);
      continue;
    }
    const accepted = typeof options.allowStatus === 'function'
      ? options.allowStatus(response.status)
      : response.status >= 200 && response.status < 300;
    if (!accepted) {
      try { await response.body?.cancel(); } catch { /* ignore */ }
      throw new Error(`Video host returned HTTP ${response.status}`);
    }
    return { response, url: current };
  }
  throw new Error('Too many video-host redirects');
}

export async function safeGet(raw, referer, limit = 2 * 1024 * 1024, options = {}) {
  const { response } = await safeFetch(raw, { ...options, referer, timeoutMs: options.timeoutMs ?? 30000 });
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new Error('Video-host response is too large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function safeText(raw, referer, limit = 2 * 1024 * 1024, options = {}) {
  return (await safeGet(raw, referer, limit, options)).toString('utf8');
}
