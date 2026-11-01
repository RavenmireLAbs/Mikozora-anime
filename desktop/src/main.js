// Mikozora for Windows — Electron main process.
//
// The same web UI that ships in the Android WebView is served here from a
// private mikozora://app origin (the desktop counterpart of Android's
// https://app.moku.local). Artwork goes through the same allowlisted image
// proxy, page fetches through the MokuBridge-compatible IPC bridge in
// bridge.js, and everything the UI stores (library, progress, backups)
// keeps the exact Android formats — an Android backup file imports as-is.
import { app, BrowserWindow, Menu, protocol, shell, ipcMain } from 'electron';
import { join, extname, normalize } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { allowedSource, allowedProjectRelease } from './lib/allowlist.js';
import { get as httpGet } from './lib/http.js';
import { backgroundFor } from './lib/appearance.js';
import { registerBridge } from './bridge.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const APP_ORIGIN = 'mikozora://app';

// Must be registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'mikozora', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// --- tiny settings store (appearance + window bounds) in userData ---
let store = { get: (key, fallback) => fallback, set() {}, flush() {} };
function createStore() {
  const file = join(app.getPath('userData'), 'settings.json');
  let values = {};
  try { values = JSON.parse(readFileSync(file, 'utf8')) || {}; } catch { /* first run */ }
  let timer = null;
  const save = () => { try { writeFileSync(file, JSON.stringify(values), 'utf8'); } catch { /* read-only profile */ } };
  return {
    get: (key, fallback) => (key in values ? values[key] : fallback),
    set(key, value) { values[key] = value; clearTimeout(timer); timer = setTimeout(save, 150); },
    flush: save,
  };
}

// --- mikozora:// handler: bundled web UI + artwork proxy ---
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.json': 'application/json', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// Bounded artwork cache (Android keeps an equivalent LRU in MainActivity).
const imageCache = new Map();
let imageCacheBytes = 0;
const IMAGE_CACHE_LIMIT = 32 * 1024 * 1024;
function cacheImage(key, entry) {
  if (imageCache.has(key)) { imageCacheBytes -= imageCache.get(key).data.length; imageCache.delete(key); }
  imageCache.set(key, entry);
  imageCacheBytes += entry.data.length;
  while (imageCacheBytes > IMAGE_CACHE_LIMIT && imageCache.size > 1) {
    const oldest = imageCache.keys().next().value;
    imageCacheBytes -= imageCache.get(oldest).data.length;
    imageCache.delete(oldest);
  }
}

function webRoot() { return join(app.getAppPath(), 'web'); }

async function handleAppRequest(request) {
  try {
    const url = new URL(request.url);
    if (url.pathname === '/api/image') {
      const target = url.searchParams.get('url') || '';
      const cached = imageCache.get(target);
      if (cached) {
        imageCache.delete(target);
        imageCache.set(target, cached);
        return new Response(cached.data, { headers: { 'content-type': cached.type, 'cache-control': 'private, max-age=3600' } });
      }
      const { data, type } = await httpGet(target, false);
      cacheImage(target, { data, type });
      return new Response(data, { headers: { 'content-type': type, 'cache-control': 'private, max-age=3600' } });
    }
    const path = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const root = normalize(webRoot());
    const file = normalize(join(root, '.' + path));
    if (!file.startsWith(root)) return new Response('Not found', { status: 404 });
    const data = await readFile(file);
    return new Response(data, { headers: { 'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream' } });
  } catch { return new Response('Not found', { status: 404 }); }
}

function openExternalAllowed(url) {
  if (allowedSource(url) || allowedProjectRelease(url)) shell.openExternal(url).catch(() => {});
}

let win = null;
function createWindow() {
  const bounds = store.get('windowBounds', {});
  const sane = (n, min, max) => (Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : undefined);
  win = new BrowserWindow({
    width: sane(bounds.width, 380, 3840) ?? 1280,
    height: sane(bounds.height, 560, 2160) ?? 800,
    x: sane(bounds.x, -10000, 10000),
    y: sane(bounds.y, -10000, 10000),
    minWidth: 360,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: backgroundFor(store.get('appearance')),
    icon: join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  if (bounds.maximized) win.maximize();

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    store.set('windowBounds', { ...win.getNormalBounds(), maximized: win.isMaximized() });
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('close', () => { saveBounds(); store.flush(); });
  win.on('closed', () => { win = null; });

  // The top-level page may only ever be the app itself; anything else a
  // page tries to open goes to the real browser if it passes the same
  // allowlist Android enforces, and is dropped otherwise. (Player embeds
  // navigate inside their own iframes and are unaffected.)
  win.webContents.setWindowOpenHandler(({ url }) => { openExternalAllowed(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) { event.preventDefault(); openExternalAllowed(url); }
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(APP_ORIGIN + '/');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  Menu.setApplicationMenu(null);
  app.whenReady().then(() => {
    store = createStore();
    protocol.handle('mikozora', handleAppRequest);
    registerBridge(ipcMain, () => win, store);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
