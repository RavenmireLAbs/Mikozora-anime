import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Watched markers in the Android player span a JS/native contract: the web
// layer annotates compact playlist entries with `watched` (unit-tested in
// playback.test.mjs), and PlayerActivity must parse, render and toggle that
// flag through the trusted main WebView. Pin the native side so the pieces
// cannot drift apart silently.
test('native player parses, renders and toggles watched episode flags', async () => {
  const player = await readFile('android/app/src/main/java/app/moku/anime/PlayerActivity.java', 'utf8');
  const navigation = await readFile('android/app/src/main/java/app/moku/anime/PlayerNavigation.java', 'utf8');
  const main = await readFile('android/app/src/main/java/app/moku/anime/MainActivity.java', 'utf8');
  const ui = await readFile('src/main.jsx', 'utf8');

  assert.match(player, /boolean watched;/);
  assert.doesNotMatch(player, /final boolean watched;/);
  assert.match(player, /optBoolean\("watched", false\)/);
  assert.match(player, /"✓ " \+ episode\.number/);
  assert.match(player, /PlayerNavigation\.requestWatchedChange\(current\.url, intended\)/);
  assert.match(player, /onWatchedChangeRejected\(String url, boolean watched\)/);
  assert.match(navigation, /void onWatchedChanged\(String url, boolean watched\)/);
  assert.match(navigation, /requestWatchedChange\(String url, boolean watched\)/);
  assert.match(main, /window\.__mokuPlayerWatched/);
  assert.match(main, /PlayerNavigation\.reportWatchedRejected\(url, watched\)/);
  assert.match(ui, /window\.__mokuPlayerWatched=watchedHandler/);
});

test('native online player exposes next-unwatched, episode jump and server cycling', async () => {
  const player = await readFile('android/app/src/main/java/app/moku/anime/PlayerActivity.java', 'utf8');
  assert.match(player, /firstUnwatchedIndex\(\)/);
  assert.match(player, /Next unwatched · /);
  assert.match(player, /jumpToEpisode\(\)/);
  assert.match(player, /Jump to episode number/);
  assert.match(player, /watchedCount\(\)/);
  assert.match(player, /cycleServer\(-1\)/);
  assert.match(player, /cycleServer\(1\)/);
  assert.match(player, /Previous video server/);
  assert.match(player, /Next video server/);
});

test('native offline player exposes speed, ten-second seeks and restart', async () => {
  const player = await readFile('android/app/src/main/java/app/moku/anime/OfflinePlayerActivity.java', 'utf8');
  assert.match(player, /setSeekBackIncrementMs\(10000\)/);
  assert.match(player, /setSeekForwardIncrementMs\(10000\)/);
  assert.match(player, /seekBy\(-10000\)/);
  assert.match(player, /seekBy\(10000\)/);
  assert.match(player, /player\.seekTo\(0\)/);
  assert.match(player, /new PlaybackParameters\(speed\)/);
  assert.match(player, /Speed 1×/);
});

test('native offline tools auto-hide with the Media3 controller', async () => {
  const player = await readFile('android/app/src/main/java/app/moku/anime/OfflinePlayerActivity.java', 'utf8');
  assert.match(player, /setControllerShowTimeoutMs\(5000\)/);
  assert.match(player, /setControllerVisibilityListener\(\(PlayerView\.ControllerVisibilityListener\)\(visibility->header\.setVisibility\(visibility\)\)\)/);
  assert.equal((player.match(/view\.showController\(\)/g) || []).length, 5,
    'initial playback and each custom seek, restart and speed action restart the shared hide timer');
});
