import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const preload = read('desktop/src/preload.cjs');
const bridge = read('desktop/src/bridge.js');
const main = read('desktop/src/main.js');
const builder = read('desktop/electron-builder.yml');
const desktopPkg = JSON.parse(read('desktop/package.json'));

test('desktop preload exposes the bridge only on the app origin, stage 1 methods only', () => {
  // Embedded third-party players must stay bridge-free, as on Android.
  assert.match(preload, /protocol === 'mikozora:'\{\}|protocol === 'mikozora:'\) \{|=== 'mikozora:'\) \{/);
  assert.match(preload, /platform: 'desktop'/);
  assert.match(preload, /request: call\('request'\)/);
  assert.match(preload, /saveBackupFile: call\('saveBackupFile'\)/);
  assert.match(preload, /openBackupFile: call\('openBackupFile'\)/);
  // Unimplemented stages stay absent so the UI's capability probes degrade.
  assert.ok(!/openPlayer\s*:/.test(preload));
  assert.ok(!/downloads\s*:/.test(preload));
  assert.ok(!/episodeUpdates\s*:/.test(preload));
});

test('desktop bridge mirrors the Android chunk protocol and re-checks the sender origin', () => {
  assert.match(bridge, /__mokuNativeChunk/);
  assert.match(bridge, /startsWith\('mikozora:\/\/'\)/);
  assert.match(bridge, /method === 'request'/);
  assert.match(bridge, /showSaveDialog/);
  assert.match(bridge, /showOpenDialog/);
  assert.match(bridge, /allowedSource\(url\) \|\| allowedProjectRelease\(url\)/);
});

test('desktop window is sandboxed and packaging ships installer + portable', () => {
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /registerSchemesAsPrivileged/);
  assert.equal(desktopPkg.main, 'src/main.js');
  assert.match(builder, /target: nsis/);
  assert.match(builder, /target: portable/);
  assert.match(builder, /Mikozora-v\$\{version\}-Windows-Setup\.exe/);
  assert.match(builder, /Mikozora-v\$\{version\}-Windows-Portable\.exe/);
});
