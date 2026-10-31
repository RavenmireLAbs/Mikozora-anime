import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Development-only bridge. The Android build performs these requests on-device;
// it does not depend on this server.
const documents = new Set(['animesogo.to', 'animesuge.cz', 'anikototv.to', 'animerulz.com.in', 'aniwaves.ru', 'animebash.in', 'animexin.dev', 'naruldonghua.com', 'donghuastream.org', 'donghuaworld.com']);
const hosts = new Set([...documents, 'static.aniwaves.ru', 'cdn.anipixcdn.co', 'image.tmdb.org', 'media.themoviedb.org', 's4.anilist.co', 's3.anilist.co']);
const cache = new Map();
const ua = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
function checked(url, onlyDocs) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !(onlyDocs ? documents : hosts).has(u.hostname)) throw new Error('Unsupported source host');
  return u;
}
async function remote(u, isDoc, redirects = 0) {
  if (redirects > 4) throw new Error('Too many redirects');
  checked(u.href, isDoc);
  const referer = documents.has(u.hostname) ? `${u.origin}/` : u.hostname === 'static.aniwaves.ru' ? 'https://aniwaves.ru/' : 'https://animesogo.to/';
  const response = await fetch(u, {
    redirect: 'manual', signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': ua, 'Referer': referer, 'X-Requested-With': 'XMLHttpRequest', 'Accept': isDoc ? 'text/html,application/json,*/*;q=0.8' : 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' }
  });
  if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
    return remote(new URL(response.headers.get('location'), u), isDoc, redirects + 1);
  }
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const max = isDoc ? 5 * 1024 * 1024 : 8 * 1024 * 1024;
  if (data.length > max) throw new Error('Source response too large');
  const type = response.headers.get('content-type') || (isDoc ? 'text/plain' : 'application/octet-stream');
  if (!isDoc && !type.startsWith('image/')) throw new Error('Not an image');
  return { data, type };
}
function sourceProxy() {
  return { name: 'moku-source-proxy', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const path = new URL(req.url, 'http://local');
      if (path.pathname !== '/api/raw' && path.pathname !== '/api/image') return next();
      const isDoc = path.pathname === '/api/raw';
      if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
      try {
        const u = checked(path.searchParams.get('url') || '', isDoc);
        const key = `${isDoc ? 'doc' : 'image'}:${u.href}`;
        let value = cache.get(key);
        if (!value || value.expiry < Date.now()) {
          value = { ...(await remote(u, isDoc)), expiry: Date.now() + (isDoc ? 60_000 : 600_000) };
          if (cache.size > 400) cache.delete(cache.keys().next().value);
          cache.set(key, value);
        }
        res.writeHead(200, { 'Content-Type': value.type, 'Cache-Control': isDoc ? 'no-store' : 'public, max-age=600', 'X-Content-Type-Options': 'nosniff' });
        res.end(value.data);
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(e.message || 'Source unavailable');
      }
    });
  }};
}
export default defineConfig({
  base: './',
  plugins: [react(), sourceProxy()],
  optimizeDeps: { entries: ['index.html'] },
  server: { host: '0.0.0.0', allowedHosts: true, watch: { ignored: ['**/android/**'] } },
  build: { outDir: 'dist', emptyOutDir: true }
});
