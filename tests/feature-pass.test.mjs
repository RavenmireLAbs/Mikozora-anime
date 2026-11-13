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
  assert.match(ui, /sortBrowseTitles\(filteredItems, effectiveSort\)/);

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
  assert.match(ui, /markWatched=\{markWatched\} onlinePrefs=\{onlinePlayback\}/);
  assert.match(ui, /window\.__mokuPlayerWatched=watchedHandler/);

  // Offline playback controls in the Windows/shared modal. Native Android
  // equivalents are pinned separately in player-native.test.mjs.
  assert.match(ui, /Offline playback speed/);
  assert.match(ui, /seekBy\(-cleanPrefs\.seekSeconds\)/);
  assert.match(ui, /seekBy\(cleanPrefs\.seekSeconds\)/);
  assert.match(ui, /> Restart</);
  assert.match(ui, /requestFullscreen/);

  assert.match(css, /\.personal-shelf\{/);
  assert.match(css, /\.library-bulk-bar\{/);
  assert.match(css, /\.player-episode-actions\{/);
  assert.match(css, /\.offline-controls\{/);
});

test('0.29 UI wires grouped Universal Search and confirmation-gated Source Match progress', async () => {
  const ui = await readFile('src/main.jsx', 'utf8');
  const css = await readFile('src/style.css', 'utf8');

  // Multi-source search stays grouped for display and keeps every variant openable.
  assert.equal(ui.includes('const grouping = searching && selectedSources(source).length > 1;'), true);
  assert.equal(ui.includes('rankUniversalResults(filteredItems, query'), true);
  assert.equal(ui.includes('groupUniversalResults(sortedItems, { query, links:sourceMatches, categoryOf:sourceCategory'), true);
  assert.equal(ui.includes('sourceVariants={group.variants}'), true);
  assert.equal(ui.includes('Universal Search groups likely versions of the same show for display; grouping never links watched progress by itself.'), true);
  assert.equal(ui.includes('sourceVariants = []'), true);
  assert.equal(ui.includes('className="card-sources"'), true);
  assert.equal(ui.includes('<span>Also on</span>'), true);

  // Find-on-another-source only searches the existing sources in this title's
  // category, and a progress link is created only through the confirmation.
  assert.equal(ui.includes('function SourceVersionsPanel'), true);
  assert.equal(ui.includes('<h2 id="source-versions-title">Find this show elsewhere</h2>'), true);
  assert.equal(ui.includes('source.id!==item.source && (!category || source.category===category)'), true);
  assert.equal(ui.includes('for(const searchQuery of titleVariantQueries(item))'), true);
  assert.equal(ui.includes('getCatalog(sourceId,{query:searchQuery,page:1'), true);
  assert.equal(ui.includes('entry.match.score>=SOURCE_MATCH_CANDIDATE_THRESHOLD'), true);
  assert.equal(ui.includes('Link the ${sourceName(candidate.source)} listing as the same show?'), true);
  assert.equal(ui.includes('Only watched episode numbers will carry between these versions.'), true);
  assert.equal(ui.includes('Link as same show'), true);
  assert.equal(ui.includes('Unlink version'), true);

  // Detail, Home/Library summaries and the shared player all use the effective
  // linked watched numbers rather than just the current listing's URLs.
  assert.equal(ui.includes('linkedItems={linkedTitleItems(sourceMatches,route.item,knownSourceItems)}'), true);
  assert.equal(ui.includes('watchedNumbers={watchedEpisodeNumbers(progress,history,linkedTitleKeys(sourceMatches,route.item))}'), true);
  assert.equal(ui.includes('const effectiveWatched=useMemo'), true);
  assert.equal(ui.includes('if(watchedNumbers.has(episodeNumberKey(episode))) set.add(episode.url);'), true);
  assert.equal(ui.includes('const nextUnwatched=firstUnwatchedEpisode(orderedEpisodes,effectiveWatched);'), true);
  assert.equal(ui.includes('continueWatching(progress,history,12,sourceRelatedKeys)'), true);
  assert.equal(ui.includes('progressByTitle(progress,history,sourceRelatedKeys)'), true);
  assert.equal(ui.includes('watchedUrlSetForEpisodes(progress,history,player.item'), true);
  assert.equal(ui.includes('const watchedSet=watchedUrlSetForEpisodes(progress,history,item,playlist.episodes'), true);
  assert.equal(ui.includes('setLinkedEpisodesWatched(prev,item,item.episodes||[],targets,flag,relatedKeys,Date.now())'), true);

  // App handlers, backup restore facts and Settings copy name linked versions
  // as portable local data without merging the underlying source identities.
  assert.equal(ui.includes('linkSourceTitles(previous,current,candidate)'), true);
  assert.equal(ui.includes('unlinkSourceTitle(previous,candidate)'), true);
  assert.equal(ui.includes('watched episode numbers now carry over'), true);
  assert.equal(ui.includes('${s.sourceMatches} linked source version'), true);
  assert.equal(ui.includes('history, watch progress, linked source versions and settings to a file you keep'), true);
  assert.equal(ui.includes('history, progress, linked source versions and settings with a backup file'), true);

  assert.match(css, /\.card-sources\{/);
  assert.match(css, /\.source-versions\{/);
  assert.match(css, /\.source-version-row\{flex-direction:column/);
  assert.match(css, /\.source-version-actions \.btn\{flex:1\}/);
});

test('spotlight long titles get compact responsive spacing while short titles keep the default style', async () => {
  const ui = await readFile('src/main.jsx', 'utf8');
  const css = await readFile('src/style.css', 'utf8');
  assert.match(ui, /const longTitle = \(item\?\.title\?\.length \|\| 0\) > 34/);
  assert.match(ui, /'hero-content' \+ \(longTitle \? ' hero-content-long' : ''\)/);
  assert.match(css, /\.hero-content-long h2\{font-size:clamp\(21px,2vw,25px\);line-height:1\.1/);
  assert.match(css, /\.hero-content-long p\{margin:8px 0 12px\}/);
  assert.match(css, /@media\(max-width:760px\)\{[\s\S]*?\.hero-content-long h2\{font-size:clamp\(18px,5vw,21px\)\}/);
});

test('home source failures retain last good titles and expose a retry action', async () => {
  const ui = await readFile('src/main.jsx', 'utf8');
  const css = await readFile('src/style.css', 'utf8');
  assert.match(ui, /errors:\{\},loadingSogo:true/);
  assert.match(ui, /if\(alive\)setState\(x=>\(\{\.\.\.x,\.\.\.\(loadingKey\?\{\[loadingKey\]:false\}:\{\}\),errors:\{\.\.\.x\.errors,\[key\]:true\}\}\)\)/);
  assert.match(ui, /Some source data may be out of date/);
  assert.match(ui, /Retry failed sections/);
  assert.match(ui, /onRetry=\{refreshSources\}/);
  assert.match(css, /\.home-source-status\{display:flex/);
});
