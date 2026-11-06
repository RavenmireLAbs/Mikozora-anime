// Fetch and parse helpers. In the Android WebView a native bridge fetches
// pages (bypassing CORS); in a plain browser a CORS proxy fallback is used.

const isAndroidApp = typeof window !== 'undefined' && !!window.MokuBridge;

function bridgeCall(method, ...args) {
  return new Promise((resolve, reject) => {
    if (!isAndroidApp || typeof window.MokuBridge[method] !== 'function') {
      reject(new Error('Native bridge unavailable.'));
      return;
    }
    const id = String(Date.now() + Math.floor(Math.random() * 100000));
    const timer = setTimeout(() => {
      delete pending[id];
      reject(new Error('The app took too long to respond.'));
    }, 60000);
    pending[id] = { resolve, reject, timer, parts: [] };
    try { window.MokuBridge[method](id, ...args); }
    catch (e) { clearTimeout(timer); delete pending[id]; reject(e); }
  });
}

const pending = {};

if (typeof window !== 'undefined') {
  window.__mokuNativeChunk = (id, chunk, done, error) => {
    const entry = pending[String(id)];
    if (!entry) return;
    if (error) { clearTimeout(entry.timer); delete pending[String(id)]; entry.reject(new Error(error)); return; }
    entry.parts.push(chunk || '');
    if (done) { clearTimeout(entry.timer); delete pending[String(id)]; entry.resolve(entry.parts.join('')); }
  };
}

export { isAndroidApp };

export async function fetchHtml(url) {
  if (isAndroidApp && typeof window.MokuBridge.request === 'function') {
    return await bridgeCall('request', url);
  }
  // Browser fallback: direct fetch, then CORS proxy.
  try {
    const res = await fetch(url, { headers: { 'Accept': 'text/html,application/xhtml+xml' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } catch (e) {
    const proxies = [
      (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    ];
    for (const makeProxy of proxies) {
      try {
        const res = await fetch(makeProxy(url));
        if (!res.ok) continue;
        return await res.text();
      } catch { /* try next */ }
    }
    throw e;
  }
}

export function parseHtml(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

export function absoluteUrl(url, base) {
  if (!url) return '';
  try { return new URL(url, base).href; } catch { return url; }
}

export function originOf(url) {
  try { return new URL(url).origin; } catch { return ''; }
}

// Extract a 4-digit year from text.
export function extractYear(text) {
  const m = text.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  return m ? parseInt(m[1], 10) : null;
}

// Extract an IMDb-style rating from text.
export function extractRating(text) {
  const m = text.match(/IMDb:\s*([\d.]+)/i) || text.match(/★\s*([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

// Simple debounce.
export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
