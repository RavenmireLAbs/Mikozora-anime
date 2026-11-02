import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const preload = read('desktop/src/preload.cjs');
const bridge = read('desktop/src/bridge.js');
const main = read('desktop/src/main.js');
const builder = read('desktop/electron-builder.yml');
const desktopPkg = JSON.parse(read('desktop/package.json'));
const ui = read('src/main.jsx');

test('desktop preload exposes the bridge only on the app origin, with stage 2 download methods', () => {
  // Embedded third-party players must stay bridge-free, as on Android.
  assert.match(preload, /protocol === 'mikozora:'\{\}|protocol === 'mikozora:'\) \{|=== 'mikozora:'\) \{/);
  assert.match(preload, /platform: 'desktop'/);
  assert.match(preload, /request: call\('request'\)/);
  assert.match(preload, /saveBackupFile: call\('saveBackupFile'\)/);
  assert.match(preload, /openBackupFile: call\('openBackupFile'\)/);
  assert.match(preload, /setPlayerReferer: call\('setPlayerReferer'\)/);
  assert.match(preload, /downloads: call\('downloads'\)/);
  assert.match(preload, /downloadOptions: call\('downloadOptions'\)/);
  assert.match(preload, /enqueueDownloads: call\('enqueueDownloads'\)/);
  assert.match(preload, /removeDownload: call\('removeDownload'\)/);
  assert.match(preload, /exportSettings: call\('exportSettings'\)/);
  assert.match(preload, /chooseDownloadFolder: call\('chooseDownloadFolder'\)/);
  assert.match(preload, /clearDownloadFolder: call\('clearDownloadFolder'\)/);
  assert.match(preload, /exportDownload: call\('exportDownload'\)/);
  assert.match(preload, /openDownload: fire\('openDownload'\)/);
  assert.match(preload, /openExport: fire\('openExport'\)/);
  // The remaining unimplemented stage stays absent so capability probes degrade.
  assert.ok(!/openPlayer\s*:/.test(preload));
  assert.ok(!/episodeUpdates\s*:/.test(preload));
});

test('desktop bridge mirrors the Android chunk protocol and re-checks the sender origin', () => {
  assert.match(bridge, /__mokuNativeChunk/);
  assert.match(bridge, /startsWith\('mikozora:\/\/'\)/);
  assert.match(bridge, /method === 'request'/);
  assert.match(bridge, /method === 'setPlayerReferer'/);
  assert.match(bridge, /playerRefererForEpisode/);
  assert.match(bridge, /method === 'downloads'/);
  assert.match(bridge, /method === 'downloadOptions'/);
  assert.match(bridge, /method === 'enqueueDownloads'/);
  assert.match(bridge, /method === 'removeDownload'/);
  assert.match(bridge, /method === 'exportSettings'/);
  assert.match(bridge, /method === 'chooseDownloadFolder'/);
  assert.match(bridge, /method === 'clearDownloadFolder'/);
  assert.match(bridge, /method === 'exportDownload'/);
  assert.match(bridge, /__mokuOpenOfflineDownload/);
  assert.match(bridge, /shell\.openPath/);
  assert.match(bridge, /showSaveDialog/);
  assert.match(bridge, /showOpenDialog/);
  assert.match(bridge, /allowedSource\(url\) \|\| allowedProjectRelease\(url\)/);
});

test('desktop window is sandboxed and packaging ships installer + portable', () => {
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /onBeforeSendHeaders/);
  assert.match(main, /playerEmbedHeaders/);
  assert.match(main, /setUserAgent\(browserUserAgent\)/);
  assert.match(main, /registerSchemesAsPrivileged/);
  assert.match(main, /new DownloadService/);
  assert.match(main, /createFfmpegProcessor/);
  assert.match(main, /handleDownloadRequest/);
  assert.match(main, /validPlaybackToken/);
  assert.match(main, /content-range/);
  assert.match(ui, /function OfflinePlayerModal/);
  assert.match(ui, /__mokuOpenOfflineDownload/);
  assert.ok(desktopPkg.dependencies['ffmpeg-static']);
  assert.ok(desktopPkg.dependencies.linkedom);
  assert.match(builder, /asarUnpack:[\s\S]*node_modules\/ffmpeg-static/);
  assert.equal(desktopPkg.main, 'src/main.js');
  assert.match(builder, /target: nsis/);
  assert.match(builder, /target: portable/);
  assert.match(builder, /Mikozora-v\$\{version\}-Windows-Setup\.exe/);
  assert.match(builder, /Mikozora-v\$\{version\}-Windows-Portable\.exe/);
});
