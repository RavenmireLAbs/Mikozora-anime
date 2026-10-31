import { useMemo, useState } from 'react';
import { Check, Lock, RotateCcw } from 'lucide-react';
import { NSFW_MODES, SORTS, STATUSES, TYPES, ANY_YEAR, toggleGenre } from '../lib/filters.js';

const COLLAPSED_GENRE_COUNT = 10;

function Section({ title, hint, children, htmlFor }) {
  return (
    <section className="filter-section">
      <div className="filter-section__head">
        <h3 className="filter-section__title">
          {htmlFor ? <label htmlFor={htmlFor}>{title}</label> : title}
        </h3>
        {hint ? <span className="filter-section__hint">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

export default function FilterPanel({
  filters,
  prefs,
  genres,
  years,
  sources,
  resultsCount,
  totalCount,
  hiddenAdultCount,
  onChange,
  onReset,
  onOpenSettings,
}) {
  const [showAllGenres, setShowAllGenres] = useState(false);
  const adultAllowed = prefs.allowNsfw === true;

  // Selected genres always stay visible, even when the list is collapsed.
  const orderedGenres = useMemo(() => {
    const selected = genres.filter((genre) => filters.genres.includes(genre));
    const rest = genres.filter((genre) => !filters.genres.includes(genre));
    return [...selected, ...rest];
  }, [genres, filters.genres]);

  const visibleGenres = showAllGenres ? orderedGenres : orderedGenres.slice(0, COLLAPSED_GENRE_COUNT);
  const canExpand = orderedGenres.length > COLLAPSED_GENRE_COUNT;

  function setYear(which, value) {
    const patch = { [which]: value };
    const other = which === 'yearFrom' ? filters.yearTo : filters.yearFrom;
    if (value !== ANY_YEAR && other !== ANY_YEAR) {
      const picked = Number(value);
      const boundary = Number(other);
      // Keep the range valid: dragging the lower bound past the upper bound
      // moves the upper bound with it (and vice versa).
      if (which === 'yearFrom' && picked > boundary) patch.yearTo = value;
      if (which === 'yearTo' && picked < boundary) patch.yearFrom = value;
    }
    onChange(patch);
  }

  return (
    <div className="filter-panel">
      <div className="filter-panel__head">
        <div>
          <h2 className="filter-panel__title">Filters</h2>
          <p className="filter-panel__count">
            {resultsCount} of {totalCount} titles
          </p>
        </div>
        <button type="button" className="button button--ghost button--small" onClick={onReset}>
          <RotateCcw size={14} aria-hidden="true" />
          Reset
        </button>
      </div>

      <Section title="Category" hint="Anime or donghua">
        <div className="segmented" role="radiogroup" aria-label="Category">
          {TYPES.map((type) => (
            <button
              key={type.id}
              type="button"
              role="radio"
              aria-checked={filters.type === type.id}
              className={`segmented__item${filters.type === type.id ? ' is-active' : ''}`}
              onClick={() => onChange({ type: type.id })}
            >
              {type.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Source" hint={`${sources.length} sources`} htmlFor="filter-source">
        <select
          id="filter-source"
          className="select"
          value={filters.source}
          onChange={(event) => onChange({ source: event.target.value })}
        >
          <option value="all">All sources</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </Section>

      <Section title="Genre" hint={filters.genres.length ? `${filters.genres.length} selected` : 'Any genre'}>
        <div className="chip-grid">
          {visibleGenres.map((genre) => {
            const selected = filters.genres.includes(genre);
            return (
              <button
                key={genre}
                type="button"
                className={`chip${selected ? ' is-active' : ''}`}
                aria-pressed={selected}
                onClick={() => onChange(toggleGenre(filters, genre))}
              >
                {selected ? <Check size={12} aria-hidden="true" /> : null}
                {genre}
              </button>
            );
          })}
        </div>
        {canExpand ? (
          <button
            type="button"
            className="link-button"
            onClick={() => setShowAllGenres((value) => !value)}
            aria-expanded={showAllGenres}
          >
            {showAllGenres ? 'Show fewer genres' : `Show all ${orderedGenres.length} genres`}
          </button>
        ) : null}
      </Section>

      <Section title="Year" hint="Release year">
        <div className="year-range">
          <div className="field">
            <label className="field__label" htmlFor="filter-year-from">
              From
            </label>
            <select
              id="filter-year-from"
              className="select"
              value={filters.yearFrom}
              onChange={(event) => setYear('yearFrom', event.target.value)}
            >
              <option value={ANY_YEAR}>Any</option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="filter-year-to">
              To
            </label>
            <select
              id="filter-year-to"
              className="select"
              value={filters.yearTo}
              onChange={(event) => setYear('yearTo', event.target.value)}
            >
              <option value={ANY_YEAR}>Any</option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>
        {filters.yearFrom !== ANY_YEAR || filters.yearTo !== ANY_YEAR ? (
          <button
            type="button"
            className="link-button"
            onClick={() => onChange({ yearFrom: ANY_YEAR, yearTo: ANY_YEAR })}
          >
            Clear year range
          </button>
        ) : null}
      </Section>

      <Section title="Status" htmlFor="filter-status">
        <select
          id="filter-status"
          className="select"
          value={filters.status}
          onChange={(event) => onChange({ status: event.target.value })}
        >
          {STATUSES.map((status) => (
            <option key={status.id} value={status.id}>
              {status.label}
            </option>
          ))}
        </select>
      </Section>

      <Section title="NSFW" hint={adultAllowed ? '18+ titles' : 'Turned off in Settings'}>
        <div className="segmented" role="radiogroup" aria-label="NSFW filter">
          {NSFW_MODES.map((mode) => {
            const disabled = !adultAllowed && mode.id !== 'hide';
            const active = filters.nsfw === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`segmented__item${active ? ' is-active' : ''}`}
                title={mode.description}
                disabled={disabled}
                onClick={() => onChange({ nsfw: mode.id })}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
        {adultAllowed ? (
          <p className="filter-section__note">{NSFW_MODES.find((mode) => mode.id === filters.nsfw)?.description}</p>
        ) : (
          <div className="notice notice--inline">
            <Lock size={14} aria-hidden="true" />
            <p>
              Adult content is off, so 18+ titles are hidden everywhere — even when a filter asks for them.
              {hiddenAdultCount > 0 ? ` ${hiddenAdultCount} ${hiddenAdultCount === 1 ? 'title is' : 'titles are'} hidden.` : ''}
            </p>
            <button type="button" className="link-button" onClick={onOpenSettings}>
              Open Settings
            </button>
          </div>
        )}
      </Section>

      <Section title="Sort by" htmlFor="filter-sort">
        <select
          id="filter-sort"
          className="select"
          value={filters.sort}
          onChange={(event) => onChange({ sort: event.target.value })}
        >
          {SORTS.map((sort) => (
            <option key={sort.id} value={sort.id}>
              {sort.label}
            </option>
          ))}
        </select>
      </Section>
    </div>
  );
}
