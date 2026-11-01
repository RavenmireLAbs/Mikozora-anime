// Desktop host for the MokuBridge contract the web UI speaks to Android
// (see MainActivity.java). Calls arrive over IPC as { method, id, args }
// and results return by evaluating
// window.__mokuNativeChunk(id, chunk, done, error) in the page, exactly
// like the Android bridge. Stage 1 implements the core methods (network,
// backup files, external links, appearance); the UI probes for the rest
// (openPlayer, downloads, episode updates) and degrades gracefully until
// they land in later desktop stages.
import { dialog, shell } from 'electron';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { allowedSource, allowedProjectRelease } from './lib/allowlist.js';
import { getText } from './lib/http.js';
import { normalizeAppearance, backgroundFor } from './lib/appearance.js';

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

export function registerBridge(ipcMain, getWindow, store) {
  ipcMain.on('moku:bridge', async (event, payload) => {
    const { method, id, args } = payload || {};
    if (!fromApp(event) || typeof id !== 'string' || !/^[0-9]{1,12}$/.test(id)) return;
    try {
      let out;
      if (method === 'request') out = await getText(String(args?.[0] ?? ''));
      else if (method === 'saveBackupFile') out = await saveBackupFile(getWindow(), args?.[0], args?.[1]);
      else if (method === 'openBackupFile') out = await openBackupFile(getWindow());
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
    } else if (method === 'openExternal') {
      const url = String(args?.[0] ?? '');
      if (allowedSource(url) || allowedProjectRelease(url)) shell.openExternal(url).catch(() => {});
    }
  });
}
