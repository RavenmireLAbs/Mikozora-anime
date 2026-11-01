// Playback playlists are always presented in story order, even when a source
// lists its newest episodes first or the detail page is sorted newest-first.

function episodeNumberValue(episode) {
  const parsed = Number.parseFloat(String(episode?.number ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function sameEpisode(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  // Different playable URLs are distinct entries even if a source reuses a
  // server token (for example for language variants of the same number).
  if (left.url && right.url) return left.url === right.url;
  if (left.ids && right.ids && left.ids === right.ids) return true;
  return false;
}

/**
 * Build a de-duplicated, chronological playlist containing `current` when it
 * has a playable URL. Original source order breaks ties (including specials
 * whose displayed number is not numeric).
 */
export function buildPlaybackPlaylist(episodes = [], current = null) {
  const candidates = (Array.isArray(episodes) ? episodes : [])
    .filter(episode => episode && typeof episode.url === 'string' && episode.url)
    .map((episode, index) => ({ episode, index }));

  if (current && typeof current.url === 'string' && current.url
      && !candidates.some(({ episode }) => sameEpisode(episode, current))) {
    candidates.push({ episode: current, index: candidates.length });
  }

  const seen = new Set();
  const unique = candidates.filter(({ episode }) => {
    if (seen.has(episode.url)) return false;
    seen.add(episode.url);
    return true;
  });

  unique.sort((left, right) => {
    const byNumber = episodeNumberValue(left.episode) - episodeNumberValue(right.episode);
    return byNumber || left.index - right.index;
  });

  const playlist = unique.map(({ episode }) => episode);
  let currentIndex = playlist.findIndex(episode => sameEpisode(episode, current));
  if (currentIndex < 0 && current) {
    currentIndex = playlist.findIndex(episode => String(episode.number) === String(current.number));
  }
  return { episodes: playlist, currentIndex };
}

/** The Android player only needs to display and identify episodes; the web
 * layer keeps the full source objects (including private server tokens). */
export function compactPlaybackEpisodes(episodes = [], { includeTitles = true, watched = null } = {}) {
  return episodes.map(episode => {
    const number = String(episode?.number ?? '').slice(0, 40);
    const compact = { number, url: episode.url };
    if (watched?.has(episode.url)) compact.watched = true;
    const title = String(episode?.title || '').trim();
    if (includeTitles && title && title !== `Episode ${number}`) compact.title = title.slice(0, 120);
    return compact;
  });
}

/**
 * Keep a very long series inside the Android bridge's payload limit. Titles
 * are dropped first; as a last resort the current episode still plays even if
 * its complete episode rail cannot be sent to the native player.
 */
export function compactPlaybackPlaylist(episodes = [], currentIndex = 0, maxChars = 260000, watched = null) {
  const index = Math.min(Math.max(0, currentIndex), Math.max(0, episodes.length - 1));
  let compact = compactPlaybackEpisodes(episodes, { watched });
  if (JSON.stringify(compact).length <= maxChars) return { episodes: compact, episodeIndex: index };

  compact = compactPlaybackEpisodes(episodes, { includeTitles: false, watched });
  if (JSON.stringify(compact).length <= maxChars) return { episodes: compact, episodeIndex: index };

  return { episodes: compact[index] ? [compact[index]] : [], episodeIndex: 0 };
}
