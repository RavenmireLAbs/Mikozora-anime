// Source adapters for movi.pk and multimovies.
// Each adapter fetches HTML pages and parses them into structured data.

import { fetchHtml, parseHtml, absoluteUrl, originOf, extractYear, extractRating } from './api.js';

export const SOURCES = {
  movi: {
    id: 'movi',
    name: 'MOVI.PK',
    base: 'https://www.movi.pk',
    accent: '#e74c3c',
    description: 'Hindi movies & downloads',
    supportsSeries: false,
    supportsSearch: true,
  },
  multimovies: {
    id: 'multimovies',
    name: 'MultiMovies',
    base: 'https://m1.multimovies.courses',
    accent: '#3498db',
    description: 'Movies, series & anime',
    supportsSeries: true,
    supportsSearch: true,
  },
};

// ── Shared helpers ──────────────────────────────────────────────────────────

function cleanTitle(t) {
  return (t || '')
    .replace(/\s*(watch movie|favorite|report|download)\s*$/i, '')
    .replace(/\s*[·|]\s*watch online.*$/i, '')
    .replace(/\s*[·|]\s*free download.*$/i, '')
    .replace(/\s*[·|]\s*online free.*$/i, '')
    .replace(/\s*\(.*?\)\s*$/, '') // strip trailing parentheticals for cleaner display
    .replace(/\s+/g, ' ')
    .trim();
}

function findCardContainer(el, maxDepth = 6) {
  let node = el;
  for (let i = 0; i < maxDepth; i++) {
    node = node.parentElement;
    if (!node) break;
    if (node.querySelector('img')) break;
    const tag = node.tagName;
    if (tag === 'ARTICLE' || tag === 'LI' || tag === 'FIELDSET') break;
    const cls = (node.className || '');
    if (/movie|post|card|item|entry|cell|box/i.test(cls)) break;
  }
  return node || el;
}

function extractImage(container, anchor, base) {
  const img = container.querySelector('img') || anchor.querySelector('img');
  if (!img) return '';
  const src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('src') || '';
  return absoluteUrl(src, base);
}

// ── movi.pk adapter ─────────────────────────────────────────────────────────

const moviAdapter = {
  async fetchHome() {
    const html = await fetchHtml(`${SOURCES.movi.base}/`);
    return parseMoviCards(html, SOURCES.movi.base);
  },

  async fetchList(filters = {}) {
    const base = SOURCES.movi.base;
    let url = `${base}/movies/`;
    if (filters.genre) url = `${base}/genre/${encodeURIComponent(filters.genre)}/`;
    if (filters.year) url = `${base}/release-year/${filters.year}/`;
    const html = await fetchHtml(url);
    return parseMoviCards(html, base);
  },

  async fetchGenres() {
    const html = await fetchHtml(`${SOURCES.movi.base}/movies/`);
    const doc = parseHtml(html);
    const genres = new Set();
    doc.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (/\/genre\//.test(href)) {
        const name = a.textContent.trim();
        if (name && name.length < 40) genres.add(name);
      }
    });
    return [...genres].sort();
  },

  async fetchDetail(url) {
    const html = await fetchHtml(url);
    return parseMoviDetail(html, url);
  },

  async fetchSearch(query) {
    const html = await fetchHtml(`${SOURCES.movi.base}/?s=${encodeURIComponent(query)}`);
    return parseMoviCards(html, SOURCES.movi.base);
  },

  getWatchUrl(detail) {
    return detail.watchUrl || '';
  },
};

function parseMoviCards(html, base) {
  const doc = parseHtml(html);
  const cards = [];
  const seen = new Set();

  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (!href) return;
    const url = absoluteUrl(href, base);

    // Direct movie page: https://www.movi.pk/{slug}/
    if (!/^https?:\/\/(www\.)?movi\.pk\/[a-z0-9][a-z0-9-]*\/?$/i.test(url)) return;
    // Exclude non-movie paths
    if (/\/(genre|country|release-year|tag|category|director|stars|noticias|advertise|page|wp-content|wp-admin|feed)\//.test(url)) return;

    if (seen.has(url)) return;

    const container = findCardContainer(a);
    const text = container.textContent || a.textContent || '';

    // Title from alt, title attribute, or heading
    let title = a.getAttribute('title') || '';
    if (!title) {
      const img = a.querySelector('img') || container.querySelector('img');
      title = img?.getAttribute('alt') || '';
    }
    if (!title) {
      const heading = container.querySelector('h1, h2, h3, h4, .title, .name, .tt');
      title = heading?.textContent?.trim() || '';
    }
    if (!title) title = a.textContent.trim().split('\n')[0].trim();
    title = cleanTitle(title);
    if (!title || title.length < 2) return;

    seen.add(url);

    const image = extractImage(container, a, base);
    const year = extractYear(text);
    const rating = extractRating(text);
    const qualityMatch = text.match(/\b(HDTC|HDTS|HDRip|HDCAM|HD-CAM|CAM|PreDVD|PreHD|SDTV|HDTV|HD Hindi|HD Urdu|HD English|HDTC Hindi|HDTS Hindi)\b/i);
    const quality = qualityMatch ? qualityMatch[0] : null;

    cards.push({ url, title, image, year, rating, quality, type: 'movie', source: 'movi' });
  });

  return cards;
}

function parseMoviDetail(html, url) {
  const doc = parseHtml(html);
  const base = originOf(url);

  // Title
  const title = doc.querySelector('h1')?.textContent?.trim() ||
                doc.querySelector('.entry-title, .post-title, h2.entry-title')?.textContent?.trim() ||
                doc.querySelector('title')?.textContent?.split('|')[0]?.trim() || '';

  // Poster
  const posterImg = doc.querySelector('.poster img, .entry-content img, article img, .single img, .featured-img img, .thumb img');
  const image = absoluteUrl(posterImg?.getAttribute('src') || posterImg?.getAttribute('data-src') || '', base);

  // Synopsis - find the first substantial paragraph in the entry content
  let synopsis = '';
  const contentEl = doc.querySelector('.entry-content, .post-content, .single-content, article .content, .summary');
  if (contentEl) {
    const paras = [...contentEl.querySelectorAll('p')].map(p => p.textContent.trim()).filter(p => p.length > 40);
    synopsis = paras[0] || contentEl.textContent.trim().slice(0, 500);
  }

  // Genres
  const genres = new Set();
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (/\/genre\//.test(href)) {
      const name = a.textContent.trim();
      if (name && name.length < 40) genres.add(name);
    }
  });

  // Director
  let director = '';
  const dirLink = [...doc.querySelectorAll('a[href]')].find(a => /\/director\//.test(a.getAttribute('href') || ''));
  if (dirLink) director = dirLink.textContent.trim();

  // Actors
  const actors = new Set();
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (/\/stars\//.test(href)) {
      const name = a.textContent.trim();
      if (name && name.length < 60) actors.add(name);
    }
  });

  // Country
  let country = '';
  const countryLink = [...doc.querySelectorAll('a[href]')].find(a => /\/country\//.test(a.getAttribute('href') || ''));
  if (countryLink) country = countryLink.textContent.trim();

  // Text-based metadata
  const text = doc.body.textContent || '';
  const durationMatch = text.match(/Duration:\s*([\d\s]+min|[\d:]+)/i);
  const duration = durationMatch ? durationMatch[1].trim() : '';
  const qualityMatch = text.match(/Quality:\s*(\S+)/i);
  const quality = qualityMatch ? qualityMatch[1] : '';
  const yearMatch = text.match(/Release:\s*(?:\[)?(\d{4})/i);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
  const rating = extractRating(text);

  // Player URL - look for ardance.org links
  let watchUrl = '';
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (/ardance\.org/.test(href)) {
      const linkText = a.textContent.trim().toLowerCase();
      if (!watchUrl || linkText.includes('stream') || linkText.includes('watch')) {
        watchUrl = absoluteUrl(href, base);
      }
    }
  });
  // Fallback: any ardance link
  if (!watchUrl) {
    const ardLink = [...doc.querySelectorAll('a[href]')].find(a => /ardance\.org/.test(a.getAttribute('href') || ''));
    if (ardLink) watchUrl = absoluteUrl(ardLink.getAttribute('href'), base);
  }

  // Download links
  const downloads = [];
  const seenDl = new Set();
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    const linkText = a.textContent.trim();
    const hrefLower = href.toLowerCase();
    const textLower = linkText.toLowerCase();
    if (/(bbupload|filepress|gofile|cloud\.mail\.ru|file\.|download\.|\/download)/.test(hrefLower) ||
        (textLower.includes('download') && !href.includes('movi.pk/' + url.split('/').pop()))) {
      const dlUrl = absoluteUrl(href, base);
      if (dlUrl && !seenDl.has(dlUrl) && dlUrl !== url) {
        seenDl.add(dlUrl);
        downloads.push({ name: linkText || dlUrl.split('/').pop(), url: dlUrl });
      }
    }
  });

  return {
    url, title, image, synopsis,
    genres: [...genres], year, rating, duration, quality,
    director, actors: [...actors], country,
    type: 'movie', watchUrl, downloads, source: 'movi',
  };
}

// ── MultiMovies adapter ─────────────────────────────────────────────────────

const multimoviesAdapter = {
  async fetchHome() {
    const html = await fetchHtml(`${SOURCES.multimovies.base}/`);
    return parseMMCards(html, SOURCES.multimovies.base);
  },

  async fetchList(type, filters = {}) {
    const base = SOURCES.multimovies.base;
    let url = type === 'series' ? `${base}/series` : `${base}/movies`;
    if (filters.genre) url = `${base}/genre/${encodeURIComponent(filters.genre)}`;
    const html = await fetchHtml(url);
    return parseMMCards(html, base, type);
  },

  async fetchGenres() {
    const html = await fetchHtml(`${SOURCES.multimovies.base}/movies`);
    const doc = parseHtml(html);
    const genres = new Set();
    doc.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (/\/genre\//.test(href)) {
        const name = a.textContent.trim();
        if (name && name.length < 40) genres.add(name);
      }
    });
    return [...genres].sort();
  },

  async fetchDetail(url) {
    const html = await fetchHtml(url);
    return parseMMDetail(html, url);
  },

  async fetchEpisodes(url) {
    const html = await fetchHtml(url);
    return parseMMEpisodes(html, url);
  },

  async fetchSearch(query) {
    const html = await fetchHtml(`${SOURCES.multimovies.base}/?s=${encodeURIComponent(query)}`);
    return parseMMCards(html, SOURCES.multimovies.base);
  },

  getWatchUrl(detail) {
    return detail.watchUrl || '';
  },
};

function parseMMCards(html, base, typeFilter) {
  const doc = parseHtml(html);
  const cards = [];
  const seen = new Set();

  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    const url = absoluteUrl(href, base);

    const isMovie = /\/movie\/[a-z0-9-]+/i.test(url);
    const isSeries = /\/series\/[a-z0-9-]+/i.test(url);
    if (!isMovie && !isSeries) return;
    if (typeFilter === 'movie' && !isMovie) return;
    if (typeFilter === 'series' && !isSeries) return;

    if (seen.has(url)) return;

    const container = findCardContainer(a);
    const text = container.textContent || a.textContent || '';

    let title = a.getAttribute('title') || '';
    if (!title) {
      const heading = container.querySelector('h1, h2, h3, h4, h5, .title, .tt');
      title = heading?.textContent?.trim() || '';
    }
    if (!title) title = a.textContent.trim().split('\n')[0].trim();
    title = cleanTitle(title);
    if (!title || title.length < 2) return;

    seen.add(url);

    const image = extractImage(container, a, base);
    const year = extractYear(text);
    const ratingMatch = text.match(/★\s*([\d.]+)/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
    const type = isSeries ? 'series' : 'movie';
    const durationMatch = text.match(/(\d+)\s*min/i);
    const duration = durationMatch ? durationMatch[1] + ' min' : '';
    const qualityMatch = text.match(/(1080p|720p|480p|HD)/i);
    const quality = qualityMatch ? qualityMatch[0] : null;

    // Watch URL from "Watch now" / "Explore episodes" link
    let watchUrl = '';
    const watchLink = [...container.querySelectorAll('a[href]')].find(a =>
      /\/watch\/(movie|series)\//.test(a.getAttribute('href') || '')
    );
    if (watchLink) watchUrl = absoluteUrl(watchLink.getAttribute('href'), base);

    cards.push({ url, title, image, year, rating, quality, duration, type, watchUrl, source: 'multimovies' });
  });

  return cards;
}

function parseMMDetail(html, url) {
  const doc = parseHtml(html);
  const base = originOf(url);
  const isSeries = /\/series\//.test(url);

  // Title
  const title = doc.querySelector('h1')?.textContent?.trim() ||
                doc.querySelector('.title, h2, .movie-title, .series-title')?.textContent?.trim() ||
                doc.querySelector('title')?.textContent?.replace(/ - MultiMovies.*$/i, '').trim() || '';

  // Image
  const img = doc.querySelector('main img, article img, .poster img, .detail-img img, img.poster, img');
  const image = img?.getAttribute('src') || img?.getAttribute('data-src') || '';

  // Synopsis
  let synopsis = '';
  const descEl = doc.querySelector('.synopsis, .description, .overview, .plot, main p, article p');
  if (descEl) {
    const paras = [...descEl.querySelectorAll('p')].map(p => p.textContent.trim()).filter(p => p.length > 30);
    synopsis = paras[0] || descEl.textContent.trim().slice(0, 500);
  }

  // Genres
  const genres = new Set();
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (/\/genre\//.test(href)) {
      const name = a.textContent.trim();
      if (name && name.length < 40) genres.add(name);
    }
  });

  // Text metadata
  const text = doc.body.textContent || '';
  const year = extractYear(text);
  const ratingMatch = text.match(/★\s*([\d.]+)/);
  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
  const runtimeMatch = text.match(/(\d+)\s*h\s*(\d+)?\s*m/i) || text.match(/(\d+)\s*min/i);
  const duration = runtimeMatch ? runtimeMatch[0].replace(/\s+/g, ' ').trim() : '';
  const qualityMatch = text.match(/(1080p|720p|480p)/i);
  const quality = qualityMatch ? qualityMatch[0] : '';
  const directorMatch = text.match(/Director:\s*(.+)/i) || text.match(/Creators:\s*(.+)/i);
  const director = directorMatch ? directorMatch[1].trim() : '';

  // Watch URL
  let watchUrl = '';
  const watchLink = [...doc.querySelectorAll('a[href]')].find(a =>
    /\/watch\/(movie|series)\//.test(a.getAttribute('href') || '')
  );
  if (watchLink) {
    watchUrl = absoluteUrl(watchLink.getAttribute('href'), base);
  }
  // Fallback: extract title_id from report URL
  if (!watchUrl) {
    const reportLink = [...doc.querySelectorAll('a[href]')].find(a =>
      /report\?title_id=/.test(a.getAttribute('href') || '')
    );
    if (reportLink) {
      const idMatch = reportLink.getAttribute('href').match(/title_id=(\d+)/);
      if (idMatch) {
        watchUrl = `${base}/watch/${isSeries ? 'series' : 'movie'}/${idMatch[1]}`;
      }
    }
  }

  // Download links
  const downloads = [];
  const seenDl = new Set();
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    const linkText = a.textContent.trim();
    const hrefLower = href.toLowerCase();
    const textLower = linkText.toLowerCase();
    if (/download/.test(hrefLower) || (textLower.includes('download') && !href.includes('/movie/') && !href.includes('/series/'))) {
      const dlUrl = absoluteUrl(href, base);
      if (dlUrl && !seenDl.has(dlUrl) && dlUrl !== url) {
        seenDl.add(dlUrl);
        downloads.push({ name: linkText || dlUrl.split('/').pop(), url: dlUrl });
      }
    }
  });

  return {
    url, title, image, synopsis,
    genres: [...genres], year, rating, duration, quality,
    director, actors: [], country: '',
    type: isSeries ? 'series' : 'movie', watchUrl, downloads, source: 'multimovies',
  };
}

function parseMMEpisodes(html, url) {
  const doc = parseHtml(html);
  const base = originOf(url);

  const episodeLinks = [];
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    const match = href.match(/\/series\/[a-z0-9-]+\/season\/(\d+)\/episode\/(\d+)/i);
    if (!match) return;
    const season = parseInt(match[1], 10);
    const episodeUrl = absoluteUrl(href, base);

    const container = findCardContainer(a);
    const text = container.textContent || a.textContent || '';
    const epMatch = text.match(/E(\d+)/i);
    const episodeNum = epMatch ? parseInt(epMatch[1], 10) : parseInt(match[2], 10);
    const durationMatch = text.match(/(\d+)\s*m\b/i);
    const duration = durationMatch ? durationMatch[1] + ' min' : '';
    const image = extractImage(container, a, base);

    // Episode title from nearby heading
    let epTitle = '';
    const heading = container.querySelector('h3, h4, .title, .ep-title');
    if (heading) epTitle = heading.textContent.trim();

    episodeLinks.push({ season, episode: episodeNum, url: episodeUrl, image, duration, title: epTitle });
  });

  // Group by season
  const seasonsMap = new Map();
  episodeLinks.forEach(ep => {
    if (!seasonsMap.has(ep.season)) {
      seasonsMap.set(ep.season, { number: ep.season, episodes: [] });
    }
    seasonsMap.get(ep.season).episodes.push(ep);
  });

  const seasons = [...seasonsMap.values()]
    .sort((a, b) => a.number - b.number)
    .map(s => ({ ...s, episodes: s.episodes.sort((a, b) => a.episode - b.episode) }));

  return { seasons };
}

// ── Registry ────────────────────────────────────────────────────────────────

export const ADAPTERS = {
  movi: moviAdapter,
  multimovies: multimoviesAdapter,
};

export function getAdapter(sourceId) {
  return ADAPTERS[sourceId];
}
