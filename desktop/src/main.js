// Mikozora for Windows — Electron main process.
//
// The same web UI that ships in the Android WebView is served here from a
// private mikozora://app origin (the desktop counterpart of Android's
// https://app.moku.local). Artwork goes through the same allowlisted image
// proxy, page fetches through the MokuBridge-compatible IPC bridge in
// bridge.js, and everything the UI stores (library, progress, backups)
// keeps the exact Android formats — an Android backup file imports as-is.
import { app, BrowserWindow, Menu, Tray, Notification, nativeImage, protocol, shell, ipcMain, session } from 'electron';
import { join, extname, normalize } from 'node:path';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { allowedSource, allowedProjectRelease } from './lib/allowlist.js';
import { get as httpGet } from './lib/http.js';
import { backgroundFor } from './lib/appearance.js';
import { cleanUserAgent, playerEmbedHeaders } from './lib/player-network.js';
import { registerBridge } from './bridge.js';
import { DownloadService } from './lib/download-service.js';
import { EpisodeStore } from './lib/episode-store.js';
import { EpisodeService } from './lib/episode-service.js';
import { createFfmpegProcessor } from './lib/ffmpeg.js';
import ffmpegStaticPath from 'ffmpeg-static';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const APP_ORIGIN = 'mikozora://app';

// Windows toasts are attributed through the AppUserModelId; keep it in
// step with electron-builder's appId so notifications show as Mikozora.
if (process.platform === 'win32') app.setAppUserModelId('app.mikozora.desktop');

// Must be registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'mikozora', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// --- tiny settings store (appearance + window bounds) in userData ---
let store = { get: (key, fallback) => fallback, set() {}, flush() {} };
let downloadService = null;
let episodeService = null;
let tray = null;
let quitting = false;
let episodeNotification = null;

function bundledFfmpegPath() {
  const raw = typeof ffmpegStaticPath === 'string' ? ffmpegStaticPath : '';
  return raw ? raw.replace(/app\.asar(?=$|[\\/])/, 'app.asar.unpacked') : '';
}
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

// Set over IPC immediately before the web player opens. This is the origin
// of the source page that supplied the currently selected embed.
let currentPlayerReferer = '';

function installPlayerNetwork() {
  const ses = session.defaultSession;
  const browserUserAgent = cleanUserAgent(typeof ses.getUserAgent === 'function' ? ses.getUserAgent() : '');
  if (browserUserAgent && typeof ses.setUserAgent === 'function') ses.setUserAgent(browserUserAgent);
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://*/*'] }, (details, callback) => {
    callback({ cancel: false, requestHeaders: playerEmbedHeaders(details, currentPlayerReferer) });
  });
}

function parseRange(header, size) {
  if (!header) return { start: 0, end: size - 1, status: 200 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!suffix) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end, status: 206 };
}

async function handleDownloadRequest(request, url, id, subtitleIndex) {
  const token = url.searchParams.get('token') || '';
  if (!downloadService || !downloadService.validPlaybackToken(id, token)) {
    return new Response('Not found', { status: 404 });
  }
  const source = await downloadService.playableSource(id);
  if (!source) return new Response('Not found', { status: 404 });

  // Mark the file in use before any further filesystem awaits so folder
  // cleanup cannot delete a private copy in the gap before streaming starts.
  downloadService.beginPlaybackUse(id);
  let ended = false;
  const endUse = () => {
    if (!ended) { ended = true; downloadService.endPlaybackUse(id); }
  };

  if (subtitleIndex != null) {
    try {
      const text = await downloadService.subtitleContent(id, Number(subtitleIndex)).catch(() => null);
      if (text == null) return new Response('Not found', { status: 404 });
      return new Response(text, {
        headers: { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'private, no-store' },
      });
    } finally {
      endUse();
    }
  }

  let info;
  try {
    info = await stat(source.file);
  } catch (error) {
    endUse();
    throw error;
  }
  const range = parseRange(request.headers.get('range'), info.size);
  if (!range) {
    endUse();
    return new Response(null, {
      status: 416,
      headers: { 'content-range': `bytes */${info.size}`, 'accept-ranges': 'bytes' },
    });
  }
  const nodeStream = createReadStream(source.file, { start: range.start, end: range.end });
  nodeStream.once('close', endUse);
  nodeStream.once('error', endUse);
  const headers = {
    'content-type': 'video/mp4',
    'content-length': String(range.end - range.start + 1),
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-store',
  };
  if (range.status === 206) headers['content-range'] = `bytes ${range.start}-${range.end}/${info.size}`;
  return new Response(Readable.toWeb(nodeStream), { status: range.status, headers });
}

async function handleAppRequest(request) {
  try {
    const url = new URL(request.url);
    const download = /^\/api\/download\/([a-f0-9]{32})\/(?:(video)|subtitle\/(\d{1,3}))$/.exec(url.pathname);
    if (download) return handleDownloadRequest(request, url, download[1], download[2] ? null : download[3]);
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

// --- system tray + episode-update notifications ---
function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function sendOpenUpdates() {
  if (!win || win.isDestroyed()) return;
  const send = () => { if (win && !win.isDestroyed()) win.webContents.send('moku:open-updates'); };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

function syncTray(state) {
  const wanted = !!state?.automatic;
  if (wanted && !tray) {
    try {
      const image = nativeImage.createFromPath(join(__dirname, '..', 'build', 'icon.png'));
      tray = new Tray(image.isEmpty() ? image : image.resize({ width: 16, height: 16 }));
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open Mikozora', click: () => showWindow() },
        { label: 'Check for new episodes now', click: () => { episodeService?.checkNow().catch(() => {}); } },
        { type: 'separator' },
        { label: 'Quit Mikozora', click: () => { quitting = true; app.quit(); } },
      ]));
      tray.on('double-click', () => showWindow());
    } catch { tray = null; }
  } else if (!wanted && tray) {
    tray.destroy();
    tray = null;
  }
  if (tray) {
    const unread = Number(state?.unreadCount) || 0;
    tray.setToolTip(unread ? `Mikozora — ${unread} new episode${unread === 1 ? '' : 's'}` : 'Mikozora');
  }
}

function notifyEpisodes(content, { alert } = {}) {
  if (episodeNotification) { episodeNotification.close(); episodeNotification = null; }
  if (!content || !Notification.isSupported()) return;
  const notification = new Notification({
    title: content.title,
    body: content.body,
    silent: !alert,
    icon: join(__dirname, '..', 'build', 'icon.png'),
  });
  notification.on('click', () => { showWindow(); sendOpenUpdates(); notification.close(); });
  notification.on('close', () => { if (episodeNotification === notification) episodeNotification = null; });
  episodeNotification = notification;
  notification.show();
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
  win.on('close', (event) => {
    saveBounds();
    store.flush();
    // With automatic episode checks on, closing the window parks Mikozora
    // in the system tray so background checks and alerts keep working,
    // like Android's scheduled checks. Quit from the tray menu exits.
    if (!quitting && episodeService?.automaticEnabled()) {
      syncTray(episodeService.state());
      if (tray) { event.preventDefault(); win.hide(); }
    }
  });
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
  app.on('second-instance', () => showWindow());
  Menu.setApplicationMenu(null);
  app.whenReady().then(() => {
    store = createStore();
    installPlayerNetwork();
    downloadService = new DownloadService({
      baseDir: join(app.getPath('userData'), 'downloads'),
      store,
      mediaProcessor: createFfmpegProcessor(bundledFfmpegPath()),
    });
    downloadService.init().catch(() => {});
    episodeService = new EpisodeService({
      store: new EpisodeStore({ file: join(app.getPath('userData'), 'episode-updates.json') }),
      notify: notifyEpisodes,
      onStateChanged: (state) => {
        syncTray(state);
        if (win && !win.isDestroyed()) win.webContents.send('moku:updates-changed');
      },
      openNotificationSettings: () => { shell.openExternal('ms-settings:notifications').catch(() => {}); },
      notificationsSupported: () => Notification.isSupported(),
    });
    episodeService.start().then(() => syncTray(episodeService.state())).catch(() => {});
    protocol.handle('mikozora', handleAppRequest);
    registerBridge(ipcMain, () => win, store, (referer) => { currentPlayerReferer = referer; }, downloadService, episodeService);
    createWindow();
  });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
  app.on('before-quit', () => {
    quitting = true;
    void downloadService?.shutdown();
    void episodeService?.shutdown();
    if (tray) { tray.destroy(); tray = null; }
    store.flush();
  });
}
