import { useEffect, useRef, useState } from 'react';
import { Search, ShieldOff, SlidersHorizontal, X } from 'lucide-react';
import FilterPanel from './FilterPanel.jsx';
import TitleCard from './TitleCard.jsx';
import { ANY_YEAR, activeFilterCount, SORTS, STATUSES, TYPES } from '../lib/filters.js';

const DESKTOP_QUERY = '(min-width: 961px)';

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

function labelFor(list, id) {
  return list.find((entry) => entry.id === id)?.label ?? id;
}

function buildChips(filters) {
  const chips = [];
  const push = (key, label, patch) => chips.push({ key, label, patch });

  if (filters.query.trim()) {
    push('query', `“${filters.query.trim()}”`, { query: '' });
  }
  if (filters.type !== 'all') {
    push('type', labelFor(TYPES, filters.type), { type: 'all' });
  }
  if (filters.source !== 'all') {
    push('source', filters.source, { source: 'all' });
  }
  if (filters.status !== 'all') {
    push('status', labelFor(STATUSES, filters.status), { status: 'all' });
  }
  for (const genre of filters.genres) {
    push(`genre:${genre}`, genre, { genres: filters.genres.filter((entry) => entry !== genre) });
  }
  if (filters.yearFrom !== ANY_YEAR && filters.yearTo !== ANY_YEAR && filters.yearFrom === filters.yearTo) {
    push('year', filters.yearFrom, { yearFrom: ANY_YEAR, yearTo: ANY_YEAR });
  } else {
    if (filters.yearFrom !== ANY_YEAR) {
      push('yearFrom', `From ${filters.yearFrom}`, { yearFrom: ANY_YEAR });
    }
    if (filters.yearTo !== ANY_YEAR) {
      push('yearTo', `Until ${filters.yearTo}`, { yearTo: ANY_YEAR });
    }
  }
  if (filters.nsfw !== 'hide') {
    push('nsfw', filters.nsfw === 'only' ? 'Only 18+' : '18+ included', { nsfw: 'hide' });
  }
  return chips;
}

export default function BrowsePage({
  filters,
  prefs,
  results,
  totalCount,
  hiddenAdultCount,
  genres,
  years,
  sources,
  panelOpen,
  onPanelOpenChange,
  onChange,
  onReset,
  onOpenSettings,
  onOpenTitle,
}) {
  const searchRef = useRef(null);
  const chips = buildChips(filters);
  const filterCount = activeFilterCount(filters, prefs);
  const adultAllowed = prefs.allowNsfw === true;
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const drawerOffscreen = !isDesktop && !panelOpen;
  const sortLabel = SORTS.find((sort) => sort.id === filters.sort)?.label ?? 'Most popular';

  // Close the mobile filter drawer with Escape.
  useEffect(() => {
    if (!panelOpen) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') onPanelOpenChange(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panelOpen, onPanelOpenChange]);

  return (
    <div className="browse">
      <div className="browse__top">
        <div className="browse__intro">
          <h1>Browse</h1>
          <p className="browse__subtitle">
            Ten sources, one library. Filter by genre, year and NSFW before you open a title.
          </p>
        </div>

        <div className="browse__search">
          <Search size={16} className="browse__search-icon" aria-hidden="true" />
          <input
            id="browse-search"
            ref={searchRef}
            type="search"
            className="search-input"
            placeholder="Search titles, genres or sources"
            aria-label="Search titles, genres or sources"
            value={filters.query}
            onChange={(event) => onChange({ query: event.target.value })}
          />
          {filters.query ? (
            <button
              type="button"
              className="search-clear"
              aria-label="Clear search"
              onClick={() => {
                onChange({ query: '' });
                searchRef.current?.focus();
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="button button--filter"
          aria-expanded={panelOpen}
          aria-controls="browse-filters"
          onClick={() => onPanelOpenChange(!panelOpen)}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          Filters
          {filterCount > 0 ? <span className="button__badge">{filterCount}</span> : null}
        </button>
      </div>

      {!adultAllowed && hiddenAdultCount > 0 ? (
        <div className="banner" role="status">
          <ShieldOff size={18} aria-hidden="true" />
          <p>
            <strong>Adult content is off.</strong> {hiddenAdultCount}{' '}
            {hiddenAdultCount === 1 ? 'NSFW title is' : 'NSFW titles are'} hidden from Browse, search and details.
          </p>
          <button type="button" className="link-button" onClick={onOpenSettings}>
            Manage in Settings
          </button>
        </div>
      ) : null}

      <div className="browse__layout">
        <aside
          id="browse-filters"
          className={`browse__aside${panelOpen ? ' is-open' : ''}`}
          aria-label="Browse filters"
          aria-hidden={drawerOffscreen || undefined}
          inert={drawerOffscreen ? '' : undefined}
        >
          <div className="browse__aside-head">
            <span className="browse__aside-title">Refine results</span>
            <button
              type="button"
              className="icon-button browse__aside-close"
              aria-label="Close filters"
              onClick={() => onPanelOpenChange(false)}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <FilterPanel
            filters={filters}
            prefs={prefs}
            genres={genres}
            years={years}
            sources={sources}
            resultsCount={results.length}
            totalCount={totalCount}
            hiddenAdultCount={hiddenAdultCount}
            onChange={onChange}
            onReset={onReset}
            onOpenSettings={onOpenSettings}
          />
        </aside>

        <div className="browse__main">
          <div className="results-bar">
            <p className="results-bar__summary">
              <strong>{results.length}</strong> {results.length === 1 ? 'title' : 'titles'}
              <span className="results-bar__sort">· {sortLabel}</span>
            </p>
            {chips.length > 0 ? (
              <div className="active-filters" aria-label="Active filters">
                {chips.map((chip) => (
                  <span key={chip.key} className="active-filter">
                    {chip.label}
                    <button
                      type="button"
                      aria-label={`Remove filter ${chip.label}`}
                      onClick={() => onChange(chip.patch)}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                ))}
                <button type="button" className="link-button" onClick={onReset}>
                  Clear all
                </button>
              </div>
            ) : null}
          </div>

          {results.length === 0 ? (
            <div className="empty-state">
              <h2>No titles match these filters</h2>
              <p>
                {filters.nsfw === 'only' && adultAllowed
                  ? 'Try “Include” or “Hide 18+” to see the rest of the catalogue.'
                  : 'Loosen the year range, remove a genre or clear the search to widen the results.'}
              </p>
              <button type="button" className="button button--primary" onClick={onReset}>
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="title-grid">
              {results.map((title) => (
                <TitleCard key={title.id} title={title} onOpen={onOpenTitle} />
              ))}
            </div>
          )}
        </div>
      </div>

      {panelOpen ? (
        <button
          type="button"
          className="browse__scrim"
          aria-label="Close filters"
          onClick={() => onPanelOpenChange(false)}
        />
      ) : null}
    </div>
  );
}
