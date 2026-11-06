import { useState, useEffect, useCallback, useRef } from 'react';
import { SOURCES, getAdapter } from './sources.js';
import { isAndroidApp } from './api.js';
import {
  SearchIcon, PlayIcon, BackIcon, HomeIcon, GridIcon, StarIcon,
  CalendarIcon, ClockIcon, FilmIcon, DownloadIcon, ChevronDown,
  ChevronRight, CloseIcon, RefreshIcon, SeriesIcon,
} from './icons.jsx';

// ── Router ──────────────────────────────────────────────────────────────────

function parseHash() {
  const raw = window.location.hash.slice(1) || '/';
  const [path, queryStr] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(queryStr || '') };
}

function navigate(path) {
  window.location.hash = path;
  window.scrollTo(0, 0);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function showLoading(msg = 'Loading…') {
  return <div className="loading"><RefreshIcon size={20} className="spin" /> {msg}</div>;
}

function showError(msg) {
  return <div className="error"><CloseIcon size={18} /> {msg}</div>;
}

function posterOrPlaceholder(card, accent) {
  if (card.image) return card.image;
  return 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="100%" height="100%" fill="' + accent + '22"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="28" fill="' + accent + '" font-family="sans-serif">' + (card.title || '?').slice(0, 20) + '</text></svg>'
  );
}

function openWatch(url) {
  if (!url) return;
  if (isAndroidApp) {
    window.location.href = url;
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

function downloadFile(url, name) {
  if (isAndroidApp && window.MokuBridge && window.MokuBridge.download) {
    window.MokuBridge.download(url, name || 'download');
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = name || '';
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  }
}

// ── Movie Card ───────────────────────────────────────────────────────────────

function MovieCard({ card, onClick }) {
  const source = SOURCES[card.source];
  const accent = source ? source.accent : '#888';
  return (
    <div className="card" onClick={onClick}>
      <div className="card-poster">
        <img src={posterOrPlaceholder(card, accent)} alt={card.title} loading="lazy"
          onError={e => { e.target.style.display = 'none'; }} />
        <div className="card-badges">
          {card.quality && <span className="badge quality">{card.quality}</span>}
          {card.type === 'series' && <span className="badge type">S</span>}
        </div>
      </div>
      <div className="card-info">
        <div className="card-title">{card.title}</div>
        <div className="card-meta">
          {card.year && <span><CalendarIcon size={11} /> {card.year}</span>}
          {card.rating && <span><StarIcon size={11} /> {card.rating}</span>}
          {card.duration && <span><ClockIcon size={11} /> {card.duration}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Top Bar ────────────────────────────────────────────────────────────────

function TopBar({ navigate }) {
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (showSearch) inputRef.current && inputRef.current.focus();
  }, [showSearch]);

  const submit = e => {
    e.preventDefault();
    if (query.trim()) {
      navigate('/search?q=' + encodeURIComponent(query.trim()));
      setShowSearch(false);
      setQuery('');
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <a className="logo" href="#/" onClick={e => { e.preventDefault(); navigate('/'); }}>
          <FilmIcon size={22} />
          <span>MovieHub</span>
        </a>
      </div>
      <div className="topbar-right">
        {showSearch ? (
          <form className="search-form" onSubmit={submit}>
            <input ref={inputRef} type="text" placeholder="Search movies…" value={query}
              onChange={e => setQuery(e.target.value)} />
            <button type="submit"><SearchIcon size={16} /></button>
            <button type="button" className="search-cancel" onClick={() => setShowSearch(false)}><CloseIcon size={16} /></button>
          </form>
        ) : (
          <button className="icon-btn" onClick={() => setShowSearch(true)}><SearchIcon size={20} /></button>
        )}
      </div>
    </header>
  );
}

// ── Home Page ───────────────────────────────────────────────────────────────

function HomePage({ navigate }) {
  const [tab, setTab] = useState('all');
  const [data, setData] = useState({});
  const [isLoading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrMsg('');
    Promise.allSettled(
      Object.values(SOURCES).map(src => getAdapter(src.id).fetchHome())
    ).then(results => {
      if (!active) return;
      setLoading(false);
      const d = {};
      results.forEach((r, i) => {
        const id = Object.keys(SOURCES)[i];
        d[id] = r.status === 'fulfilled' ? r.value : null;
        if (r.status === 'rejected') setErrMsg(r.reason && r.reason.message ? r.reason.message : 'Failed to load');
      });
      setData(d);
    });
    return () => { active = false; };
  }, []);

  const allCards = Object.entries(data).flatMap(([id, cards]) =>
    cards ? cards.map(c => ({ ...c, sourceId: id })) : []
  );

  const tabs = [
    { id: 'all', label: 'All' },
    ...Object.entries(SOURCES).map(([id, src]) => ({ id, label: src.name })),
  ];

  const visible = tab === 'all' ? allCards : (data[tab] || []).map(c => ({ ...c, sourceId: tab }));

  return (
    <div className="page">
      <div className="page-heading">
        <div className="eyebrow">PRESS PLAY. FIND YOUR WORLD.</div>
        <h1>Browse Movies & Series</h1>
        <p>Stream and download from two sources.</p>
      </div>

      <div className="source-tabs">
        {tabs.map(t => (
          <button key={t.id} className={'source-tab ' + (tab === t.id ? 'active' : '')}
            onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && showLoading('Loading movies…')}
      {errMsg && !isLoading && showError(errMsg)}
      {!isLoading && visible.length === 0 && (
        <div className="empty">No movies found. Try another source tab.</div>
      )}
      {!isLoading && visible.length > 0 && (
        <div className="card-grid">
          {visible.map((card, i) => (
            <MovieCard key={card.url + '-' + i} card={card}
              onClick={() => navigate('/detail/' + card.sourceId + '/' + encodeURIComponent(card.url))} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Browse Page ──────────────────────────────────────────────────────────────

function BrowsePage({ sourceId, params, navigate }) {
  const [type, setType] = useState(params.get('type') || 'movie');
  const [genres, setGenres] = useState([]);
  const [genre, setGenre] = useState('');
  const [cards, setCards] = useState([]);
  const [isLoading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState('');

  const src = SOURCES[sourceId];
  const adapter = getAdapter(sourceId);

  useEffect(() => {
    let active = true;
    adapter.fetchGenres().then(g => { if (active) setGenres(g); }).catch(() => {});
    return () => { active = false; };
  }, [sourceId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrMsg('');
    const typeArg = src.supportsSeries ? type : 'movie';
    adapter.fetchList(typeArg, { genre }).then(cs => {
      if (!active) return;
      setCards(cs);
      setLoading(false);
    }).catch(e => {
      if (!active) return;
      setErrMsg(e.message || 'Failed to load');
      setLoading(false);
    });
    return () => { active = false; };
  }, [sourceId, type, genre]);

  return (
    <div className="page">
      <div className="page-heading">
        <div className="eyebrow">{src.name.toUpperCase()}</div>
        <h1>{src.supportsSeries ? 'Movies & Series' : 'Movies'}</h1>
        <p>{src.description}</p>
      </div>

      {src.supportsSeries && (
        <div className="type-tabs">
          <button className={'type-tab ' + (type === 'movie' ? 'active' : '')} onClick={() => setType('movie')}>Movies</button>
          <button className={'type-tab ' + (type === 'series' ? 'active' : '')} onClick={() => setType('series')}>Series</button>
        </div>
      )}

      {genres.length > 0 && (
        <div className="filter-row">
          <button className={'filter-chip ' + (!genre ? 'active' : '')} onClick={() => setGenre('')}>All</button>
          {genres.slice(0, 30).map(g => (
            <button key={g} className={'filter-chip ' + (genre === g ? 'active' : '')} onClick={() => setGenre(g)}>{g}</button>
          ))}
        </div>
      )}

      {isLoading && showLoading('Loading…')}
      {errMsg && !isLoading && showError(errMsg)}
      {!isLoading && cards.length === 0 && <div className="empty">No results.</div>}
      {!isLoading && cards.length > 0 && (
        <div className="card-grid">
          {cards.map((card, i) => (
            <MovieCard key={card.url + '-' + i} card={{ ...card, source: sourceId }}
              onClick={() => navigate('/detail/' + sourceId + '/' + encodeURIComponent(card.url))} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Detail Page ─────────────────────────────────────────────────────────────

function DetailPage({ sourceId, url, navigate }) {
  const [detail, setDetail] = useState(null);
  const [episodes, setEpisodes] = useState(null);
  const [isLoading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState('');
  const [activeSeason, setActiveSeason] = useState(1);

  const src = SOURCES[sourceId];
  const adapter = getAdapter(sourceId);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrMsg('');
    setDetail(null);
    setEpisodes(null);
    adapter.fetchDetail(url).then(d => {
      if (!active) return;
      setDetail(d);
      if (d.type === 'series' && adapter.fetchEpisodes) {
        adapter.fetchEpisodes(url).then(ep => {
          if (!active) return;
          setEpisodes(ep);
          if (ep.seasons && ep.seasons.length) setActiveSeason(ep.seasons[0].number);
        }).catch(() => {});
      }
      setLoading(false);
    }).catch(e => {
      if (!active) return;
      setErrMsg(e.message || 'Failed to load detail');
      setLoading(false);
    });
    return () => { active = false; };
  }, [sourceId, url]);

  if (isLoading) return <div className="page">{showLoading('Loading details…')}</div>;
  if (errMsg) return <div className="page">{showError(errMsg)}</div>;
  if (!detail) return <div className="page"><div className="empty">Not found.</div></div>;

  const accent = src.accent;

  return (
    <div className="page detail-page">
      <button className="back-btn" onClick={() => navigate('/')}><BackIcon size={18} /> Back</button>

      <div className="detail-hero">
        <div className="detail-poster">
          <img src={detail.image || posterOrPlaceholder(detail, accent)} alt={detail.title}
            onError={e => { e.target.src = posterOrPlaceholder(detail, accent); }} />
        </div>
        <div className="detail-info">
          <h1>{detail.title}</h1>
          <div className="detail-meta">
            {detail.year && <span><CalendarIcon size={14} /> {detail.year}</span>}
            {detail.rating && <span><StarIcon size={14} /> {detail.rating}</span>}
            {detail.duration && <span><ClockIcon size={14} /> {detail.duration}</span>}
            {detail.quality && <span className="badge quality">{detail.quality}</span>}
            {detail.type === 'series' && <span className="badge type">Series</span>}
          </div>
          {detail.genres && detail.genres.length > 0 && (
            <div className="detail-genres">
              {detail.genres.map(g => <span key={g} className="genre-tag">{g}</span>)}
            </div>
          )}
          {detail.director && <p className="detail-director">Director: {detail.director}</p>}
          {detail.actors && detail.actors.length > 0 && (
            <p className="detail-actors">{detail.actors.slice(0, 5).join(', ')}</p>
          )}
          {detail.country && <p className="detail-country">{detail.country}</p>}
          {detail.synopsis && <p className="detail-synopsis">{detail.synopsis}</p>}

          {detail.watchUrl && (
            <button className="play-btn" onClick={() => openWatch(detail.watchUrl)}>
              <PlayIcon size={18} /> Play Now
            </button>
          )}

          {detail.downloads && detail.downloads.length > 0 && (
            <div className="detail-downloads">
              <div className="downloads-title"><DownloadIcon size={16} /> Downloads</div>
              {detail.downloads.slice(0, 6).map((dl, i) => (
                <button key={i} className="download-btn" onClick={() => downloadFile(dl.url, dl.name)}>
                  <DownloadIcon size={14} /> {dl.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {detail.type === 'series' && episodes && episodes.seasons && episodes.seasons.length > 0 && (
        <div className="episodes-section">
          <h2>Episodes</h2>
          <div className="season-tabs">
            {episodes.seasons.map(s => (
              <button key={s.number} className={'season-tab ' + (activeSeason === s.number ? 'active' : '')}
                onClick={() => setActiveSeason(s.number)}>
                Season {s.number}
              </button>
            ))}
          </div>
          <div className="episode-grid">
            {episodes.seasons.find(s => s.number === activeSeason) &&
              episodes.seasons.find(s => s.number === activeSeason).episodes.map(ep => (
                <div key={ep.url} className="episode-card" onClick={() => openWatch(ep.url)}>
                  <div className="episode-thumb">
                    {ep.image && <img src={ep.image} alt={ep.title || 'E' + ep.episode} loading="lazy" />}
                    <div className="episode-play"><PlayIcon size={20} /></div>
                  </div>
                  <div className="episode-info">
                    <div className="episode-title">{ep.title || 'Episode ' + ep.episode}</div>
                    <div className="episode-meta">
                      <span>E{ep.episode}</span>
                      {ep.duration && <span><ClockIcon size={11} /> {ep.duration}</span>}
                    </div>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}

      <div className="back-to-top" onClick={() => navigate('/')}>
        <HomeIcon size={16} /> Back to Home
      </div>
    </div>
  );
}

// ── Search Page ─────────────────────────────────────────────────────────────

function SearchPage({ query, navigate }) {
  const [results, setResults] = useState([]);
  const [isLoading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    if (!query) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    setErrMsg('');
    Promise.allSettled(
      Object.values(SOURCES).map(src => getAdapter(src.id).fetchSearch(query))
    ).then(rs => {
      if (!active) return;
      setLoading(false);
      const all = [];
      rs.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          const id = Object.keys(SOURCES)[i];
          r.value.forEach(c => all.push({ ...c, source: id }));
        }
      });
      setResults(all);
    });
    return () => { active = false; };
  }, [query]);

  return (
    <div className="page">
      <div className="page-heading">
        <div className="eyebrow">SEARCH RESULTS</div>
        <h1>{query || 'Search'}</h1>
        <p>{results.length} results</p>
      </div>
      {isLoading && showLoading('Searching…')}
      {errMsg && !isLoading && showError(errMsg)}
      {!isLoading && results.length === 0 && <div className="empty">No results for "{query}".</div>}
      {!isLoading && results.length > 0 && (
        <div className="card-grid">
          {results.map((card, i) => (
            <MovieCard key={card.url + '-' + i} card={card}
              onClick={() => navigate('/detail/' + card.source + '/' + encodeURIComponent(card.url))} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [route, setRoute] = useState(parseHash());

  useEffect(() => {
    const handler = () => setRoute(parseHash());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const navigate = useCallback((path) => {
    window.location.hash = path;
    window.scrollTo(0, 0);
  }, []);

  const segments = route.path.split('/').filter(Boolean);

  let page;
  if (segments.length === 0) {
    page = <HomePage navigate={navigate} />;
  } else if (segments[0] === 'browse' && segments[1]) {
    page = <BrowsePage sourceId={segments[1]} params={route.params} navigate={navigate} />;
  } else if (segments[0] === 'detail' && segments[1] && segments[2]) {
    page = <DetailPage sourceId={segments[1]} url={decodeURIComponent(segments[2])} navigate={navigate} />;
  } else if (segments[0] === 'search') {
    page = <SearchPage query={route.params.get('q') || ''} navigate={navigate} />;
  } else {
    page = <HomePage navigate={navigate} />;
  }

  return (
    <div className="app">
      <TopBar navigate={navigate} />
      <main className="content">{page}</main>
      <nav className="bottom-nav">
        <a href="#/" onClick={e => { e.preventDefault(); navigate('/'); }}>
          <HomeIcon size={20} /> Home
        </a>
        {Object.values(SOURCES).map(src => (
          <a key={src.id} href={'#/browse/' + src.id}
            onClick={e => { e.preventDefault(); navigate('/browse/' + src.id); }}>
            <GridIcon size={20} /> {src.name.split('.')[0]}
          </a>
        ))}
      </nav>
    </div>
  );
}
