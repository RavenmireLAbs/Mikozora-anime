// Small, pure episode-list helpers shared by the series page and the
// built-in browser/desktop player. Sources often list episodes newest-first;
// "through", "next unwatched" and ranges must reason in story order instead.

export function episodeNumberValue(episode) {
  const value = Number.parseFloat(episode?.number ?? episode);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

/**
 * Canonical key for comparing an episode number across source listings.
 * "01", "1" and "1.0" all become "1"; unnumbered episodes return '' and
 * therefore never inherit watched state from another source.
 */
export function episodeNumberKey(episode) {
  const value = episodeNumberValue(episode);
  return Number.isFinite(value) && value >= 0 ? String(value) : '';
}

export function chronologicalEpisodes(episodes) {
  return (Array.isArray(episodes) ? episodes : [])
    .map((episode, index) => ({ episode, index }))
    .filter(entry => entry.episode?.url)
    .sort((a, b) => episodeNumberValue(a.episode) - episodeNumberValue(b.episode) || a.index - b.index)
    .map(entry => entry.episode);
}

export function findEpisodeByNumber(episodes, value) {
  const wanted = Number.parseFloat(value);
  if (!Number.isFinite(wanted)) return null;
  return chronologicalEpisodes(episodes).find(episode => episodeNumberValue(episode) === wanted) || null;
}

export function firstUnwatchedEpisode(episodes, watched) {
  return chronologicalEpisodes(episodes).find(episode => !watched?.has?.(episode.url)) || null;
}

export function episodesThrough(episodes, targetUrl) {
  const ordered = chronologicalEpisodes(episodes);
  const index = ordered.findIndex(episode => episode.url === targetUrl);
  return index >= 0 ? ordered.slice(0, index + 1) : [];
}

export function episodesInRange(episodes, from, to) {
  const first = Number.parseFloat(from);
  const last = Number.parseFloat(to);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return [];
  const low = Math.min(first, last);
  const high = Math.max(first, last);
  return chronologicalEpisodes(episodes).filter(episode => {
    const number = episodeNumberValue(episode);
    return Number.isFinite(number) && number >= low && number <= high;
  });
}

export function wrappedIndex(current, delta, count) {
  const total = Math.max(0, Math.trunc(Number(count) || 0));
  if (!total) return 0;
  const start = Math.max(0, Math.min(total - 1, Math.trunc(Number(current) || 0)));
  return (start + Math.trunc(Number(delta) || 0) + total) % total;
}
