import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The 0.28 discovery/player/library features are mostly shared React wiring.
// Their pure ranking, shelf and episode helpers have behavior tests; this
// contract keeps the screens, route props and player callbacks connected.
test('shared UI wires discovery, personal shelf, library tools and player upgrades', async () => {
  const ui = await readFile('src/main.jsx', 'utf8');
  const css = await readFile('src/style.css', 'utf8');

  // Discovery and Browse organization.
  assert.match(ui, /buildTasteProfile\(\{ library, history: recent \|\| \[\], progress, libraryMeta \}\)/);
  assert.match(ui, /Made for your taste/);
  assert.match(ui, /Because you watch|recommendationReason/);
  assert.match(ui, /<option value="for-you">For you<\/option>/);
  assert.match(ui, /\['saved','Saved'\],\['not-saved','Not saved'\]/);
  assert.match(ui, /sortBrowseTitles\(savedFilteredItems, sort\)/);

  // Personal shelf and richer Library tools.
  assert.match(ui, /function PersonalShelf/);
  assert.match(ui, /YOUR RATING/);
  assert.match(ui, /SHELF STATUS/);
  assert.match(ui, /PRIVATE NOTE/);
  assert.match(ui, /Search your library/);
  assert.match(ui, /libraryStats\(catalog,progressByTitle,libraryMeta\)/);
  assert.match(ui, /sortLibraryTitles\(filtered,sort,progressByTitle,libraryMeta\)/);
  assert.match(ui, /Add to collection/);
  assert.match(ui, /Remove from library/);
  assert.match(ui, /libraryMeta=\{libraryMeta\} onRemoveTitles=\{removeLibraryTitles\} onAddTitlesToCollection=\{addTitlesToCollection\}/);

  // Episode shortcuts on Detail and in the shared online player.
  assert.match(ui, /Next unwatched · Episode/);
  assert.match(ui, /Mark through/);
  assert.match(ui, /Select range/);
  assert.match(ui, /episodesInRange\(orderedEpisodes,rangeFrom,rangeTo\)/);
  assert.match(ui, /Next unwatched · \$\{nextUnwatched\.number\}/);
  assert.match(ui, /Jump to episode number/);
  assert.match(ui, /Previous video server/);
  assert.match(ui, /Next video server/);
  assert.match(ui, /markWatched=\{markWatched\}\/>/);
  assert.match(ui, /window\.__mokuPlayerWatched=watchedHandler/);

  // Offline playback controls in the Windows/shared modal. Native Android
  // equivalents are pinned separately in player-native.test.mjs.
  assert.match(ui, /Offline playback speed/);
  assert.match(ui, /seekBy\(-10\)/);
  assert.match(ui, /seekBy\(10\)/);
  assert.match(ui, /> Restart</);
  assert.match(ui, /requestFullscreen/);

  assert.match(css, /\.personal-shelf\{/);
  assert.match(css, /\.library-bulk-bar\{/);
  assert.match(css, /\.player-episode-actions\{/);
  assert.match(css, /\.offline-controls\{/);
});
