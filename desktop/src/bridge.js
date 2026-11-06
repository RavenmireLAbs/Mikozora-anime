// Desktop host for the MokuBridge contract the web UI speaks to Android
// (see MainActivity.java). Calls arrive over IPC as { method, id, args }
// and results return by evaluating
// window.__mokuNativeChunk(id, chunk, done, error) in the page, exactly
// like the Android bridge. The implemented surface covers networking,
// backup files, appearance, external links, downloads/offline playback,
// folder export, episode-update checks/alerts, and folder-based device sync.
import { dialog, shell } from 'electron';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { allowedSource, allowedProjectRelease } from './lib/allowlist.js';
import { getText } from './lib/http.js';
import { normalizeAppearance, backgroundFor } from './lib/appearance.js';
import { playerRefererForEpisode } from './lib/player-network.js';
import { episodeErrorMessage } from './lib/episode-service.js';

// Android chunks at 20000 chars for Binder limits; desktop can use fewer,
// bigger pieces. The page joins chunks until `done`, so size is invisible.
const CHUNK = 100000;

function sendChunks(contents, id, body, error) {
  if (!contents || contents.isDestroyed()) return;
  const send = (chunk, done, err) => {
    contents.executeJavaScript(
      `window.__mokuNativeChunk&&window.__mokuNativeChunk(${JSON.stringify(id)},${JSON.stringify(chunk)},${done},${err ? JSON.stringify(err) : 'null'});`,
      true).catch(() => {});
  };
  if (error) { send('', true, error); return; }
  if (!body) { send('', true, null); return; }
  for (let start = 0; start < body.length; start += CHUNK) {
    let end = Math.min(start + CHUNK, body.length);
    // Avoid cutting a UTF-16 surrogate pair across JavaScript strings.
    if (end < body.length) {
      const code = body.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end--;
    }
    send(body.slice(start, end), end === body.length, null);
    if (end < start + CHUNK) start--;
  }
}

async function saveBackupFile(win, name, text) {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save Mikozora backup',
    defaultPath: name && String(name).trim() ? String(name) : 'mikozora-backup.json',
    filters: [{ name: 'Mikozora backup', extensions: ['json'] }],
  });
  if (canceled || !filePath) return '{"canceled":true}';
  try { await writeFile(filePath, String(text ?? ''), 'utf8'); }
  catch { throw new Error('Could not save the backup file.'); }
  return '{"saved":true}';
}

const TEXT_FILE_FILTERS = {
  '.json': { name: 'JSON file', extensions: ['json'] },
  '.csv': { name: 'CSV file', extensions: ['csv'] },
  '.xml': { name: 'XML file', extensions: ['xml'] },
  '.svg': { name: 'SVG image', extensions: ['svg'] },
  '.txt': { name: 'Text file', extensions: ['txt'] },
};

function cleanTextFileName(name) {
  const base = basename(String(name || '').replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180);
  return TEXT_FILE_FILTERS[extname(base).toLowerCase()] ? base : 'mikozora-library.txt';
}

async function saveTextFile(win, name, text) {
  const body = String(text ?? '');
  if (Buffer.byteLength(body, 'utf8') > 8 * 1024 * 1024) throw new Error('That file is too large to save.');
  const defaultPath = cleanTextFileName(name);
  const filter = TEXT_FILE_FILTERS[extname(defaultPath).toLowerCase()] || TEXT_FILE_FILTERS['.txt'];
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save Mikozora file',
    defaultPath,
    filters: [filter],
  });
  if (canceled || !filePath) return '{"canceled":true}';
  try { await writeFile(filePath, body, 'utf8'); }
  catch { throw new Error('Could not save that file.'); }
  return '{"saved":true}';
}

async function openTextFile(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open a Mikozora library file',
    properties: ['openFile'],
    filters: [
      { name: 'Library files', extensions: ['json', 'csv', 'tsv', 'xml', 'txt'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths?.length) return '{"canceled":true}';
  try {
    const info = await stat(filePaths[0]);
    if (info.size > 8 * 1024 * 1024) throw new Error('too large');
    return JSON.stringify({ text: await readFile(filePaths[0], 'utf8'), name: basename(filePaths[0]) });
  } catch { throw new Error('Could not read that file. Choose a library JSON, CSV or XML file.'); }
}

let folderPickerOpen = false;

async function chooseDownloadFolder(win, service) {
  if (!service) throw new Error('Downloads are unavailable in this Windows build.');
  if (folderPickerOpen) throw new Error('A folder picker is already open.');
  folderPickerOpen = true;
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose where playable copies are saved',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths?.length) {
      return JSON.stringify({ ...(await service.exportSettings()), canceled: true });
    }
    return JSON.stringify(await service.setDownloadFolder(filePaths[0]));
  } finally {
    folderPickerOpen = false;
  }
}

async function chooseDeviceSyncFolder(win, service) {
  if (!service) throw new Error('Device sync is unavailable in this Windows build.');
  if (folderPickerOpen) throw new Error('A folder picker is already open.');
  folderPickerOpen = true;
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose the folder your sync service keeps on both devices',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths?.length) {
      return JSON.stringify({ ...(await service.settings()), canceled: true });
    }
    return JSON.stringify(await service.setFolder(filePaths[0]));
  } finally {
    folderPickerOpen = false;
  }
}

function downloadOptionsError(error) {
  const message = String(error?.message || '');
  const known = message.length < 180 && (
    message === 'Server check superseded.'
    || message.startsWith('No Mikozora-compatible download server')
    || message.startsWith('No compatible download server')
    || message.startsWith('No compatible subtitled AnimeBash')
  );
  return known ? message : 'Could not check server qualities. Try again or use Automatic.';
}

function onlineStreamError(error) {
  const message = String(error?.message || '');
  const safe = message.length < 180 && !/https?:\/\/|file:\/\/|[A-Za-z]:\\|\/home\/|\/Users\//.test(message) && (
    message === 'Stream check superseded.'
    || message.startsWith('Invalid episode')
    || message.startsWith('Invalid download server')
    || message.startsWith('Choose a server')
    || message.startsWith('The chosen server')
    || message.startsWith('This server did not provide a direct stream')
    || message.startsWith('No supported')
    || message.startsWith('No compatible')
  );
  return safe ? message : 'This server could not provide a direct stream. The embedded player is available.';
}

async function openBackupFile(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Restore a Mikozora backup',
    properties: ['openFile'],
    filters: [{ name: 'Mikozora backup', extensions: ['json'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (canceled || !filePaths?.length) return '{"canceled":true}';
  try {
    const info = await stat(filePaths[0]);
    if (info.size > 8 * 1024 * 1024) throw new Error('too large');
    return JSON.stringify({ text: await readFile(filePaths[0], 'utf8') });
  } catch { throw new Error('Could not read that file. Choose a Mikozora backup (.json).'); }
}

// Only IPC from the app's own origin may use the bridge (the preload also
// refuses to expose it elsewhere — embedded players stay bridge-free).
function fromApp(event) {
  const url = event.senderFrame?.url || event.sender.getURL();
  return typeof url === 'string' && url.startsWith('mikozora://');
}

export function registerBridge(ipcMain, getWindow, store, setPlayerReferer = () => {}, downloadService = null, episodeService = null, deviceSyncService = null, setOnlineStreamContext = () => {}) {
  const requireDownloads = () => {
    if (!downloadService) throw new Error('Downloads are unavailable in this Windows build.');
    return downloadService;
  };
  const requireEpisodes = () => {
    if (!episodeService) throw new Error('Episode updates are unavailable in this Windows build.');
    return episodeService;
  };
  const requireDeviceSync = () => {
    if (!deviceSyncService) throw new Error('Device sync is unavailable in this Windows build.');
    return deviceSyncService;
  };
  // Episode methods mirror MainActivity.episodeError: only the known
  // user-facing messages reach the UI; everything else is generic.
  const episodeCall = async (fn) => {
    try { return JSON.stringify(await fn(requireEpisodes())); }
    catch (err) { throw new Error(episodeErrorMessage(err)); }
  };
  ipcMain.on('moku:bridge', async (event, payload) => {
    const { method, id, args } = payload || {};
    if (!fromApp(event) || typeof id !== 'string' || !/^[0-9]{1,12}$/.test(id)) return;
    try {
      let out;
      if (method === 'request') out = await getText(String(args?.[0] ?? ''));
      else if (method === 'setPlayerReferer') {
        const referer = playerRefererForEpisode(String(args?.[0] ?? ''));
        if (!referer) throw new Error('Invalid episode URL.');
        setPlayerReferer(referer);
        out = '{"ok":true}';
      }
      else if (method === 'downloads') out = JSON.stringify(await requireDownloads().list());
      else if (method === 'downloadOptions') {
        try { out = JSON.stringify(await requireDownloads().downloadOptions(String(args?.[0] ?? ''))); }
        catch (err) { throw new Error(downloadOptionsError(err)); }
      }
      else if (method === 'resolveOnlineStream') {
        try {
          const stream = await requireDownloads().resolveOnlineStream(String(args?.[0] ?? ''));
          setOnlineStreamContext(stream?._context || null);
          const { _context, ...publicStream } = stream || {};
          out = JSON.stringify(publicStream);
        } catch (err) { throw new Error(onlineStreamError(err)); }
      }
      else if (method === 'clearOnlineStream') {
        const result = requireDownloads().clearOnlineStream(String(args?.[0] ?? ''));
        setOnlineStreamContext(null);
        out = JSON.stringify(result);
      }
      else if (method === 'enqueueDownloads') out = JSON.stringify(await requireDownloads().enqueue(String(args?.[0] ?? '')));
      else if (method === 'removeDownload') { await requireDownloads().remove(String(args?.[0] ?? '')); out = 'ok'; }
      else if (method === 'setDownloadQueueOrder') out = JSON.stringify(await requireDownloads().setQueueOrder(String(args?.[0] ?? '')));
      else if (method === 'exportSettings') out = JSON.stringify(await requireDownloads().exportSettings());
      else if (method === 'chooseDownloadFolder') out = await chooseDownloadFolder(getWindow(), requireDownloads());
      else if (method === 'clearDownloadFolder') out = JSON.stringify(await requireDownloads().clearDownloadFolder());
      else if (method === 'exportDownload') out = JSON.stringify(await requireDownloads().queueExport(String(args?.[0] ?? '')));
      else if (method === 'backgroundStatus') out = '{"enabled":true,"batteryOptimization":"not-applicable","pending":false}';
      else if (method === 'setBackgroundDownloads') out = '{"enabled":true,"batteryOptimization":"not-applicable","pending":false}';
      else if (method === 'requestBackgroundExemption') out = '{"enabled":true,"batteryOptimization":"not-applicable","pending":false}';
      else if (method === 'syncEpisodeTitles') out = await episodeCall((svc) => svc.syncTitles(String(args?.[0] ?? ''), !!args?.[1]));
      else if (method === 'episodeUpdates') out = await episodeCall((svc) => svc.updates());
      else if (method === 'checkEpisodes') out = await episodeCall((svc) => svc.checkNow());
      else if (method === 'setEpisodeAutomatic') out = await episodeCall((svc) => svc.setAutomatic(!!args?.[0]));
      else if (method === 'setEpisodeAlerts') out = await episodeCall((svc) => svc.setAlerts(!!args?.[0]));
      else if (method === 'markEpisodeRead') out = await episodeCall((svc) => svc.markRead(String(args?.[0] ?? '')));
      else if (method === 'saveBackupFile') out = await saveBackupFile(getWindow(), args?.[0], args?.[1]);
      else if (method === 'openBackupFile') out = await openBackupFile(getWindow());
      else if (method === 'saveTextFile') out = await saveTextFile(getWindow(), args?.[0], args?.[1]);
      else if (method === 'openTextFile') out = await openTextFile(getWindow());
      else if (method === 'deviceSyncSettings') out = JSON.stringify(await requireDeviceSync().settings());
      else if (method === 'chooseDeviceSyncFolder') out = await chooseDeviceSyncFolder(getWindow(), requireDeviceSync());
      else if (method === 'clearDeviceSyncFolder') out = JSON.stringify(await requireDeviceSync().clearFolder());
      else if (method === 'readDeviceSyncFolder') out = JSON.stringify(await requireDeviceSync().readFolder());
      else if (method === 'writeDeviceSyncFile') out = JSON.stringify(await requireDeviceSync().writeFile(String(args?.[0] ?? ''), String(args?.[1] ?? '')));
      else throw new Error('Not available in the Windows app yet.');
      sendChunks(event.sender, id, out, null);
    } catch (err) {
      sendChunks(event.sender, id, '', String(err?.message || 'Something went wrong.'));
    }
  });

  // Fire-and-forget methods (no request id, no reply), mirroring Android.
  ipcMain.on('moku:fire', (event, payload) => {
    if (!fromApp(event)) return;
    const { method, args } = payload || {};
    if (method === 'setAppearance') {
      const appearance = normalizeAppearance({ mode: args?.[0], accent: args?.[1] });
      store.set('appearance', appearance);
      getWindow()?.setBackgroundColor(backgroundFor(appearance));
    } else if (method === 'openDownload' || method === 'openOfflinePlayer') {
      const id = String(args?.[0] ?? '');
      (async () => {
        const contents = event.sender;
        if (!downloadService || !/^[a-f0-9]{32}$/.test(id) || !contents || contents.isDestroyed()) return;
        const token = await downloadService.createPlaybackToken(id).catch(() => null);
        const script = token
          ? `window.__mokuOpenOfflineDownload&&window.__mokuOpenOfflineDownload(${JSON.stringify({ id, token })});`
          : `window.__mokuOfflineDownloadError&&window.__mokuOfflineDownloadError('This episode has not finished downloading');`;
        contents.executeJavaScript(script, true).catch(() => {});
      })();
    } else if (method === 'openExport') {
      const id = String(args?.[0] ?? '');
      (async () => {
        if (!downloadService || !/^[a-f0-9]{32}$/.test(id)) return;
        const file = await downloadService.exportFile(id).catch(() => '');
        if (!file) return;
        const error = await shell.openPath(file);
        if (error) {
          event.sender?.executeJavaScript(
            `window.__mokuOfflineDownloadError&&window.__mokuOfflineDownloadError('Could not open the exported file. Check the folder and install a video player.');`,
            true,
          ).catch(() => {});
        }
      })();
    } else if (method === 'episodeNotificationPermission') {
      episodeService?.notificationPermission(!!args?.[0]);
    } else if (method === 'openExternal') {
      const url = String(args?.[0] ?? '');
      if (allowedSource(url) || allowedProjectRelease(url)) shell.openExternal(url).catch(() => {});
    }
  });
}
