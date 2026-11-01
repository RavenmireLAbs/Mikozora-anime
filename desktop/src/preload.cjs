// Exposes the MokuBridge surface the web UI expects from the Android app,
// backed by IPC to the main process (see bridge.js). The bridge is exposed
// ONLY on the app's own mikozora:// origin — third-party player embeds run
// in iframes and must stay bridge-free, exactly as on Android. Methods that
// a desktop stage has not implemented yet are simply absent; the UI checks
// for their existence and degrades gracefully.
const { contextBridge, ipcRenderer } = require('electron');

let protocol = '';
try { protocol = window.location.protocol; } catch { /* about:blank during startup */ }

if (protocol === 'mikozora:') {
  const call = (method) => (id, ...args) => {
    if (typeof id === 'string' && /^[0-9]{1,12}$/.test(id)) {
      ipcRenderer.send('moku:bridge', { method, id, args });
    }
  };
  const fire = (method) => (...args) => ipcRenderer.send('moku:fire', { method, args });

  contextBridge.exposeInMainWorld('MokuBridge', {
    platform: 'desktop',
    request: call('request'),
    saveBackupFile: call('saveBackupFile'),
    openBackupFile: call('openBackupFile'),
    setAppearance: fire('setAppearance'),
    openExternal: fire('openExternal'),
  });
}
