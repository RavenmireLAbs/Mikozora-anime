import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Watched markers in the Android player span a JS/native contract: the web
// layer annotates compact playlist entries with `watched` (unit-tested in
// playback.test.mjs), and PlayerActivity must parse and render that flag.
// Pin the native side so the two cannot drift apart silently.
test('native player parses and renders watched episode flags', async () => {
  const player = await readFile('android/app/src/main/java/app/moku/anime/PlayerActivity.java', 'utf8');
  assert.match(player, /final boolean watched;/);
  assert.match(player, /optBoolean\("watched", false\)/);
  assert.match(player, /"✓ " \+ episode\.number/);
});
