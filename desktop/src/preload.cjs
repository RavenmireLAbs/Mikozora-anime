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

  // Episode-update signals from the main process (Android dispatches the
  // same window events from its activity). takeOpenUpdates is synchronous
  // on Android, so the flag lives here: the main process latches it when a
  // notification is clicked, and the UI consumes it exactly once.
  let openUpdates = false;
  let openDownloads = false;
  ipcRenderer.on('moku:updates-changed', () => {
    window.dispatchEvent(new Event('moku-updates-changed'));
  });
  ipcRenderer.on('moku:open-updates', () => {
    openUpdates = true;
    window.dispatchEvent(new Event('moku-open-updates'));
  });
  ipcRenderer.on('moku:open-downloads', () => {
    openDownloads = true;
    window.dispatchEvent(new Event('moku-open-downloads'));
  });

  contextBridge.exposeInMainWorld('MokuBridge', {
    platform: 'desktop',
    request: call('request'),
    setPlayerReferer: call('setPlayerReferer'),
    downloads: call('downloads'),
    downloadOptions: call('downloadOptions'),
    enqueueDownloads: call('enqueueDownloads'),
    removeDownload: call('removeDownload'),
    exportSettings: call('exportSettings'),
    chooseDownloadFolder: call('chooseDownloadFolder'),
    clearDownloadFolder: call('clearDownloadFolder'),
    exportDownload: call('exportDownload'),
    openDownload: fire('openDownload'),
    openExport: fire('openExport'),
    syncEpisodeTitles: call('syncEpisodeTitles'),
    episodeUpdates: call('episodeUpdates'),
    checkEpisodes: call('checkEpisodes'),
    setEpisodeAutomatic: call('setEpisodeAutomatic'),
    setEpisodeAlerts: call('setEpisodeAlerts'),
    markEpisodeRead: call('markEpisodeRead'),
    episodeNotificationPermission: fire('episodeNotificationPermission'),
    takeOpenUpdates: () => {
      const value = openUpdates;
      openUpdates = false;
      return value;
    },
    takeOpenDownloads: () => {
      const value = openDownloads;
      openDownloads = false;
      return value;
    },
    saveBackupFile: call('saveBackupFile'),
    openBackupFile: call('openBackupFile'),
    setAppearance: fire('setAppearance'),
    openExternal: fire('openExternal'),
  });
}
