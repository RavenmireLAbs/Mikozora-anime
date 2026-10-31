import { useCallback, useEffect, useMemo, useState } from 'react';
import { Settings as SettingsIcon, Sparkles, X } from 'lucide-react';
import BrowsePage from './components/BrowsePage.jsx';
import DetailDialog from './components/DetailDialog.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import { CATALOG } from './data/catalog.js';
import {
  DEFAULT_FILTERS,
  availableGenres,
  availableSources,
  availableYears,
  countAdultTitles,
  filterTitles,
  normalizeFilters,
} from './lib/filters.js';
import { isAdultTitle } from './lib/ratings.js';
import {
  DEFAULT_PREFS,
  loadBrowseFilters,
  loadPrefs,
  normalizePrefs,
  saveBrowseFilters,
  savePrefs,
} from './lib/storage.js';

export default function App() {
  const [prefs, setPrefs] = useState(() => loadPrefs());
  const [filters, setFilters] = useState(() =>
    normalizeFilters(loadBrowseFilters() || DEFAULT_FILTERS, loadPrefs()),
  );
  const [tab, setTab] = useState('browse');
  const [panelOpen, setPanelOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');

  const genres = useMemo(() => availableGenres(CATALOG), []);
  const years = useMemo(() => availableYears(CATALOG), []);
  const sources = useMemo(() => availableSources(CATALOG), []);
  const adultCount = useMemo(() => countAdultTitles(CATALOG), []);
  const results = useMemo(() => filterTitles(CATALOG, filters, prefs), [filters, prefs]);
  const visibleAdultCount = useMemo(() => results.filter(isAdultTitle).length, [results]);

  // Persist each area under its own keys. Failures (blocked storage) are silent.
  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    saveBrowseFilters(filters);
  }, [filters]);

  // Turning adult content off closes any open adult detail view immediately.
  useEffect(() => {
    if (!prefs.allowNsfw && selected && isAdultTitle(selected)) setSelected(null);
  }, [prefs.allowNsfw, selected]);

  // Auto-dismiss the settings notice.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  const changeFilters = useCallback(
    (patch) => {
      setFilters((current) => normalizeFilters({ ...current, ...patch }, prefs));
    },
    [prefs],
  );

  const resetFilters = useCallback(() => {
    setFilters(normalizeFilters(DEFAULT_FILTERS, prefs));
  }, [prefs]);

  const changePrefs = useCallback(
    (patch) => {
      const next = normalizePrefs({ ...prefs, ...patch });
      setPrefs(next);
      if (!next.allowNsfw) {
        // The global switch always wins: force the Browse NSFW filter back to
        // "Hide 18+" so stored state cannot keep adult titles listed.
        setFilters((current) => normalizeFilters(current, next));
        setNotice(
          'Adult content is off. NSFW titles were removed everywhere and the Browse filter was reset to “Hide 18+”.',
        );
      } else {
        setNotice('Adult content is allowed. Choose “Include” or “Only 18+” in the Browse NSFW filter to see those titles.');
      }
    },
    [prefs],
  );

  const includeAdultInBrowse = useCallback(() => {
    const next = normalizePrefs({ ...prefs, allowNsfw: true });
    setPrefs(next);
    setFilters((current) => normalizeFilters({ ...current, nsfw: 'show' }, next));
    setTab('browse');
    setPanelOpen(true);
    setNotice('NSFW filter set to “Include”. 18+ titles now appear with an adult badge.');
  }, [prefs]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="header">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            M
          </span>
          <span className="brand__text">
            <strong>Moku</strong>
            <span>your anime space</span>
          </span>
        </div>

        <nav className="tabs" aria-label="Primary">
          <button
            type="button"
            className={`tab${tab === 'browse' ? ' is-active' : ''}`}
            aria-current={tab === 'browse' ? 'page' : undefined}
            onClick={() => setTab('browse')}
          >
            <Sparkles size={16} aria-hidden="true" />
            Browse
          </button>
          <button
            type="button"
            className={`tab${tab === 'settings' ? ' is-active' : ''}`}
            aria-current={tab === 'settings' ? 'page' : undefined}
            onClick={() => setTab('settings')}
          >
            <SettingsIcon size={16} aria-hidden="true" />
            Settings
          </button>
        </nav>

        <span className={`safe-chip${prefs.allowNsfw ? ' is-open' : ''}`} title="Adult content setting">
          {prefs.allowNsfw ? '18+ allowed' : 'Safe mode'}
        </span>
      </header>

      <main id="main" className="main">
        {tab === 'browse' ? (
          <BrowsePage
            filters={filters}
            prefs={prefs}
            results={results}
            totalCount={CATALOG.length}
            hiddenAdultCount={prefs.allowNsfw ? 0 : adultCount}
            genres={genres}
            years={years}
            sources={sources}
            panelOpen={panelOpen}
            onPanelOpenChange={setPanelOpen}
            onChange={changeFilters}
            onReset={resetFilters}
            onOpenSettings={() => {
              setPanelOpen(false);
              setTab('settings');
            }}
            onOpenTitle={setSelected}
          />
        ) : (
          <SettingsPage
            prefs={prefs}
            onChangePrefs={changePrefs}
            adultCount={adultCount}
            filteredAdultVisible={visibleAdultCount}
            onResetFilters={() => {
              resetFilters();
              setNotice('Browse filters were reset to their defaults.');
            }}
            onIncludeAdultInBrowse={includeAdultInBrowse}
          />
        )}
      </main>

      {notice ? (
        <div className="toast" role="status">
          <p>{notice}</p>
          <button type="button" className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {selected ? <DetailDialog title={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
