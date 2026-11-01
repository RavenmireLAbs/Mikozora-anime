// Allowlisted HTTP for the desktop shell — port of Network.get():
// manual redirects with every hop re-validated against the allowlist,
// bounded response sizes, and the same headers Android sends.
import { checkUrl, refererFor, UA } from './allowlist.js';

async function fetchChecked(raw, document, timeoutMs) {
  let current = checkUrl(raw, document);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const res = await fetch(current, {
      redirect: 'manual',
      // Android bounds connect at 20s and each read at 25s; one overall
      // deadline is the fetch equivalent and is at least as strict.
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': UA,
        'Referer': refererFor(current),
        'X-Requested-With': 'XMLHttpRequest',
        'Accept-Encoding': 'identity',
        'Accept': document ? 'text/html,application/json,*/*;q=0.8' : 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      try { await res.body?.cancel(); } catch { /* already drained */ }
      if (!location) throw new Error('Source returned an invalid redirect');
      current = checkUrl(new URL(location, current).href, document);
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`Source returned HTTP ${res.status}`);
    return res;
  }
  throw new Error('Too many redirects');
}

async function readCapped(res, limit) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new Error('Source response is too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// Returns { data: Buffer, type } like Network.Result.
export async function get(raw, document, timeoutMs = 30000) {
  const res = await fetchChecked(raw, document, timeoutMs);
  const headerType = res.headers.get('content-type');
  const type = headerType || (document ? 'text/plain' : 'application/octet-stream');
  if (!document && !type.toLowerCase().startsWith('image/')) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    throw new Error('Source did not return an image');
  }
  const data = await readCapped(res, document ? 5 * 1024 * 1024 : 8 * 1024 * 1024);
  return { data, type: type.split(';')[0] };
}

export async function getText(raw, timeoutMs) {
  const { data } = await get(raw, true, timeoutMs);
  return data.toString('utf8');
}

// Shorter source-list timeout keeps background checks bounded (Network.getEpisodeList).
export function getEpisodeListText(raw) {
  return getText(raw, 15000);
}
