import React, { useMemo, useState } from 'react';
import {
  AlertCircle, Bell, Check, Clock3, Download, Film, Gauge, Moon, Play,
  RotateCcw, Search, ShieldCheck, Sparkles,
} from 'lucide-react';
import { SOURCES, getCatalog } from './data.js';
import {
  ONLINE_QUALITY_CAPS,
  normalizeOnlinePlayback,
  qualityCapLabel,
} from './online-playback.js';
import {
  OFFLINE_PLAYBACK_RATES,
  OFFLINE_SEEK_SECONDS,
  OFFLINE_SLEEP_MINUTES,
  OFFLINE_SUBTITLE_BACKGROUNDS,
  OFFLINE_SUBTITLE_COLORS,
  OFFLINE_SUBTITLE_SIZES,
  normalizeOfflinePlayback,
} from './offline-playback.js';
import {
  applyPortabilityPreview,
  attachPortabilityMatch,
  buildAniListJson,
  buildLibraryCsv,
  buildMalXml,
  buildPortabilityPreview,
  buildPortableLibrary,
  normalizePortabilityState,
  normalizedPortableTitle,
  parsePortableLibrary,
  portableFileName,
} from './library-portability.js';

function ToggleRow({ icon: Icon, title, body, value, onChange, label, disabled = false }) {
  return <div className="setting-row">
    <div className="setting-icon"><Icon size={19} /></div>
    <div><strong>{title}</strong><p>{body}</p></div>
    <button type="button" aria-label={label || title} aria-pressed={!!value} disabled={disabled} onClick={() => onChange(!value)}>{value ? 'On' : 'Off'}</button>
  </div>;
}

function SelectRow({ icon: Icon, title, body, value, onChange, label, children, disabled = false }) {
  return <div className="setting-row">
    <div className="setting-icon"><Icon size={19} /></div>
    <div><strong>{title}</strong><p>{body}</p></div>
    <select className="smart-select" aria-label={label || title} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{children}</select>
  </div>;
}

export function OnlinePlayerSettings({
  onlinePlayback,
  changeOnlinePlayback = () => {},
  playback,
  changeOfflinePlayback = () => {},
  available = false,
}) {
  const online = normalizeOnlinePlayback(onlinePlayback);
  const player = normalizeOfflinePlayback(playback);
  return <section className="settings-group online-player-settings" aria-labelledby="online-player-title">
    <div className="settings-title" id="online-player-title">ONLINE PLAYER PRO <span>DIRECT WHEN A SERVER ALLOWS IT</span></div>
    <div className="folder-explainer online-player-note">
      <p><strong>{available ? 'Direct playback is available in this build.' : 'Direct playback is not available in this build.'}</strong> When a server provides a stream Mikozora can play itself, exact timestamps, speed, seeking, subtitle styling, the sleep timer and auto-next work in Mikozora's player. When it only provides an embed, Mikozora labels it as embedded and that server keeps control of playback position.</p>
    </div>
    <ToggleRow
      icon={Play}
      title="Try direct streams first"
      body="Ask each server for a direct stream before falling back to its embedded player."
      value={online.directFirst}
      onChange={value => changeOnlinePlayback({ directFirst: value })}
      label="Try direct online streams first"
    />
    <ToggleRow
      icon={Clock3}
      title="Resume exact position"
      body="Remember where direct online playback stopped on this device. Embedded players cannot report a timestamp."
      value={online.resume}
      onChange={value => changeOnlinePlayback({ resume: value })}
      label="Resume exact direct online position"
    />
    <ToggleRow
      icon={Sparkles}
      title="Auto-play next episode"
      body="Move to the next episode when a direct online episode ends."
      value={online.autoPlayNext}
      onChange={value => changeOnlinePlayback({ autoPlayNext: value })}
      label="Auto-play next direct online episode"
    />
    <SelectRow
      icon={Film}
      title="Preferred subtitles"
      body="The first matching separate subtitle track is selected when a direct server provides one."
      value={online.subtitleLanguage}
      onChange={value => changeOnlinePlayback({ subtitleLanguage: value })}
      label="Preferred direct online subtitle language"
    >
      <option value="english">English</option>
      <option value="indonesian">Indonesian</option>
    </SelectRow>
    <SelectRow
      icon={Gauge}
      title="Direct quality limit"
      body="Caps adaptive direct streams where the server reports separate resolutions."
      value={online.qualityCap}
      onChange={value => changeOnlinePlayback({ qualityCap: Number(value) })}
      label="Direct online quality limit"
    >
      {ONLINE_QUALITY_CAPS.map(cap => <option key={cap} value={cap}>{qualityCapLabel(cap)}</option>)}
    </SelectRow>
    <div className="settings-subheading">MIKOZORA PLAYER CONTROLS</div>
    <SelectRow
      icon={Gauge}
      title="Remembered speed"
      body="Used by Mikozora's direct online and offline players."
      value={player.playbackRate}
      onChange={value => changeOfflinePlayback({ playbackRate: Number(value) })}
      label="Remembered player speed"
    >
      {OFFLINE_PLAYBACK_RATES.map(rate => <option key={rate} value={rate}>{rate}×</option>)}
    </SelectRow>
    <SelectRow
      icon={Clock3}
      title="Seek buttons"
      body="How far Mikozora's own back and forward buttons move."
      value={player.seekSeconds}
      onChange={value => changeOfflinePlayback({ seekSeconds: Number(value) })}
      label="Player seek length"
    >
      {OFFLINE_SEEK_SECONDS.map(seconds => <option key={seconds} value={seconds}>±{seconds} seconds</option>)}
    </SelectRow>
    <SelectRow
      icon={Film}
      title="Subtitle size"
      body="For separate subtitle tracks in Mikozora's direct and offline players."
      value={player.subtitleSize}
      onChange={value => changeOfflinePlayback({ subtitleSize: Number(value) })}
      label="Player subtitle size"
    >
      {OFFLINE_SUBTITLE_SIZES.map(size => <option key={size} value={size}>{size}px</option>)}
    </SelectRow>
    <SelectRow
      icon={Sparkles}
      title="Subtitle color"
      body="Burned-in subtitles are part of the video and cannot be restyled."
      value={player.subtitleColor}
      onChange={value => changeOfflinePlayback({ subtitleColor: value })}
      label="Player subtitle color"
    >
      {OFFLINE_SUBTITLE_COLORS.map(color => <option key={color.id} value={color.id}>{color.label}</option>)}
    </SelectRow>
    <SelectRow
      icon={ShieldCheck}
      title="Subtitle background"
      body="Keep separate captions readable over bright scenes."
      value={player.subtitleBackground}
      onChange={value => changeOfflinePlayback({ subtitleBackground: value })}
      label="Player subtitle background"
    >
      {OFFLINE_SUBTITLE_BACKGROUNDS.map(background => <option key={background.id} value={background.id}>{background.label}</option>)}
    </SelectRow>
    <SelectRow
      icon={Moon}
      title="Sleep timer"
      body="Pause Mikozora's direct or offline player after this long."
      value={player.sleepTimerMinutes}
      onChange={value => changeOfflinePlayback({ sleepTimerMinutes: Number(value) })}
      label="Player sleep timer"
    >
      {OFFLINE_SLEEP_MINUTES.map(minutes => <option key={minutes} value={minutes}>{minutes ? `${minutes} minutes` : 'Off'}</option>)}
    </SelectRow>
  </section>;
}

const EXPORT_FORMATS = [
  { id: 'json', label: 'Mikozora JSON · fullest local copy' },
  { id: 'csv', label: 'CSV · spreadsheet friendly' },
  { id: 'mal', label: 'MAL-style XML · local file' },
  { id: 'anilist', label: 'AniList-style JSON · local file' },
];

function portableCandidateYear(item) {
  const direct = Number(item?.year);
  if (Number.isFinite(direct) && direct >= 1900 && direct <= 2100) return Math.trunc(direct);
  const match = String(item?.aired || item?.status || '').match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : 0;
}

function portableMatchScore(entry, candidate) {
  const wanted = normalizedPortableTitle(entry?.title);
  const actual = normalizedPortableTitle(candidate?.title);
  if (!wanted || !actual) return 0;
  let score = 0;
  if (actual === wanted) score = 100;
  else if (actual.startsWith(wanted) || wanted.startsWith(actual)) score = 82;
  else if (actual.includes(wanted) || wanted.includes(actual)) score = 70;
  else {
    const wantedTokens = new Set(wanted.split(/\s+/).filter(Boolean));
    const actualTokens = new Set(actual.split(/\s+/).filter(Boolean));
    const shared = [...wantedTokens].filter(token => actualTokens.has(token)).length;
    score = wantedTokens.size ? Math.round((shared / wantedTokens.size) * 65) : 0;
  }
  const wantedYear = Number(entry?.year) || 0;
  const actualYear = portableCandidateYear(candidate);
  if (wantedYear && actualYear) score += Math.max(-15, 8 - Math.abs(wantedYear - actualYear) * 3);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function previewTitles(entries, limit = 5) {
  return (Array.isArray(entries) ? entries : []).slice(0, limit).map(entry => entry.entry?.title || entry.title || 'Untitled');
}

export function LibraryPortabilitySettings({
  library = [],
  collections = [],
  libraryMeta = {},
  progress = [],
  portability = {},
  canUseFiles = false,
  saveText,
  readText,
  onApply = () => {},
  notify = () => {},
}) {
  const [exportKind, setExportKind] = useState('json');
  const [busy, setBusy] = useState('');
  const [pending, setPending] = useState(null);
  const [includePossibleDuplicates, setIncludePossibleDuplicates] = useState(false);
  const [matchSearch, setMatchSearch] = useState(null);
  const context = useMemo(() => ({ library, collections, libraryMeta, progress }), [library, collections, libraryMeta, progress]);
  const preview = useMemo(
    () => pending ? buildPortabilityPreview({ entries: pending.entries, ...context }) : null,
    [pending, context],
  );
  const summary = preview?.summary;
  const pendingProgressCount = Object.keys(normalizePortabilityState(portability).pendingProgress).length;
  const closePreview = () => {
    setPending(null);
    setMatchSearch(null);
    setIncludePossibleDuplicates(false);
  };

  const exportLibrary = async () => {
    if (busy || !canUseFiles || typeof saveText !== 'function') return;
    setBusy('export');
    try {
      let text;
      let mime = 'text/plain';
      if (exportKind === 'csv') {
        text = buildLibraryCsv(context);
        mime = 'text/csv';
      } else if (exportKind === 'mal') {
        text = buildMalXml(context);
        mime = 'application/xml';
      } else if (exportKind === 'anilist') {
        text = buildAniListJson(context);
        mime = 'application/json';
      } else {
        text = JSON.stringify(buildPortableLibrary(context), null, 2);
        mime = 'application/json';
      }
      const result = await saveText(portableFileName(exportKind), text, mime);
      if (result?.canceled) notify('Library export canceled');
      else notify('Portable library saved');
    } catch (error) {
      notify(error?.message || 'Could not export your portable library.');
    } finally {
      setBusy('');
    }
  };

  const chooseImport = async () => {
    if (busy || !canUseFiles || typeof readText !== 'function') return;
    setBusy('import');
    try {
      const result = await readText();
      if (result?.canceled) {
        notify('Library import canceled');
        return;
      }
      const parsed = parsePortableLibrary(result?.text || '');
      setPending({ format: parsed.format, entries: parsed.entries });
      setMatchSearch(null);
      setIncludePossibleDuplicates(false);
    } catch (error) {
      notify(error?.message || 'Could not read that library file.');
    } finally {
      setBusy('');
    }
  };

  const findPortableMatches = async (entry, entryIndex) => {
    if (busy || matchSearch?.loading || !entry?.title) return;
    setMatchSearch({ entryIndex, title: entry.title, loading: true, results: [], failed: [] });
    const sourceIds = Object.values(SOURCES).map(source => source.id);
    const settled = await Promise.allSettled(sourceIds.map(sourceId => getCatalog(sourceId, {
      query: entry.title,
      page: 1,
      status: 'all',
      genre: '',
      year: '',
    })));
    const failed = [];
    const byKey = new Map();
    settled.forEach((result, index) => {
      const sourceId = sourceIds[index];
      if (result.status === 'rejected') {
        failed.push(SOURCES[sourceId]?.name || sourceId);
        return;
      }
      for (const candidate of result.value?.items || []) {
        if (!candidate?.source || !candidate?.url || !candidate?.title) continue;
        const key = `${candidate.source}|${candidate.url}`;
        if (!byKey.has(key)) byKey.set(key, candidate);
      }
    });
    const results = [...byKey.values()]
      // Already-saved listings are useful matches too: choosing one merges
      // the imported status/rating/count into that exact listing.
      .map(candidate => ({ item: candidate, score: portableMatchScore(entry, candidate) }))
      .filter(result => result.score >= 35)
      .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
      .slice(0, 8);
    setMatchSearch({ entryIndex, title: entry.title, loading: false, results, failed });
  };

  const usePortableMatch = (entryIndex, candidate) => {
    setPending(previous => previous ? {
      ...previous,
      entries: attachPortabilityMatch(previous.entries, entryIndex, candidate),
    } : previous);
    setMatchSearch(null);
  };

  const applyImport = () => {
    if (!preview || busy) return;
    const exactEntries = includePossibleDuplicates
      ? preview.exactEntries
      : [...preview.exactNew, ...preview.exactExisting];
    if (!exactEntries.length) {
      notify('There are no exact source matches to import.');
      return;
    }
    try {
      const result = applyPortabilityPreview({
        preview: { ...preview, exactEntries },
        ...context,
        portability,
      });
      onApply(result);
      closePreview();
    } catch (error) {
      notify(error?.message || 'Could not apply that library import.');
    }
  };

  return <section className="settings-group library-portability-settings" aria-labelledby="library-portability-title">
    <div className="settings-title" id="library-portability-title">LIBRARY PORTABILITY <span>LOCAL FILES ONLY</span></div>
    <div className="folder-explainer">
      <p>Export or import your saved titles, collections, shelf status, ratings, notes and watched counts without an account or network API. Imports only merge entries whose Mikozora source and URL match exactly; title-only matches stay out until you choose them after reviewing the preview.</p>
      {pendingProgressCount > 0 && <p>{pendingProgressCount} imported {pendingProgressCount === 1 ? 'title has' : 'titles have'} a watched count waiting for its episode list. Open the series once and Mikozora can turn that count into watched episodes.</p>}
      {!canUseFiles && <p>File export and import are available in the Android and Windows apps.</p>}
    </div>
    <div className="setting-row portability-export-row">
      <div className="setting-icon"><Download size={19} /></div>
      <div><strong>Export portable library</strong><p>{library.length} saved {library.length === 1 ? 'title' : 'titles'} on this device. Videos are never included.</p></div>
      <div className="portability-actions">
        <select className="smart-select" aria-label="Portable library export format" value={exportKind} disabled={!canUseFiles || !!busy} onChange={event => setExportKind(event.target.value)}>
          {EXPORT_FORMATS.map(format => <option key={format.id} value={format.id}>{format.label}</option>)}
        </select>
        <button type="button" onClick={exportLibrary} disabled={!canUseFiles || !!busy}>{busy === 'export' ? 'Saving…' : 'Export'}</button>
      </div>
    </div>
    <div className="setting-row">
      <div className="setting-icon"><RotateCcw size={19} /></div>
      <div><strong>Import and merge</strong><p>Choose a Mikozora JSON, CSV, MAL-style XML or AniList-style JSON file. Nothing changes until you approve the preview.</p></div>
      <button type="button" onClick={chooseImport} disabled={!canUseFiles || !!busy}>{busy === 'import' ? 'Reading…' : 'Choose file'}</button>
    </div>
    {preview && <div className="portability-preview" role="region" aria-label="Library import preview">
      <div className="portability-preview-head">
        <div><span className="eyebrow">MERGE PREVIEW</span><h3>{pending.format} · {summary.total} entries found</h3></div>
        <button className="text-link muted" type="button" onClick={closePreview}>Discard</button>
      </div>
      <div className="portability-summary">
        <div><strong>{summary.newTitles}</strong><span>new exact matches</span></div>
        <div><strong>{summary.existingTitles}</strong><span>already saved</span></div>
        <div><strong>{summary.possibleDuplicates}</strong><span>possible duplicates</span></div>
        <div><strong>{summary.unmatched}</strong><span>unmatched</span></div>
        <div><strong>{summary.invalid}</strong><span>invalid or repeated</span></div>
      </div>
      {previewTitles(preview.exactNew).length > 0 && <p><Check size={14} /> New: {previewTitles(preview.exactNew).join(' · ')}</p>}
      {previewTitles(preview.exactExisting).length > 0 && <p><Bell size={14} /> Updates saved titles: {previewTitles(preview.exactExisting).join(' · ')}</p>}
      {preview.possibleDuplicates.length > 0 && <div className="portability-duplicates">
        <p><AlertCircle size={15} /> These exact source listings have the same normalized title as a different saved listing. They may be another source version, not a duplicate account entry.</p>
        <ul>{preview.possibleDuplicates.slice(0, 6).map(entry => <li key={entry.key}><strong>{entry.entry.title}</strong><span>Possible match: {entry.possibleMatch?.title}</span></li>)}</ul>
        <label><input type="checkbox" checked={includePossibleDuplicates} onChange={event => setIncludePossibleDuplicates(event.target.checked)} /> Include possible duplicates as separate source listings</label>
      </div>}
      {preview.unmatchedEntries?.length > 0 && <div className="portability-unmatched">
        <p><Search size={15} /> These rows have a title but no Mikozora source listing. Search only when you ask, then choose the exact listing yourself; Mikozora never guesses one.</p>
        <ul>{preview.unmatchedEntries.slice(0, 8).map(({ entry, entryIndex }) => <li key={`${entryIndex}-${entry.title}`}>
          <div className="portability-unmatched-row">
            <span><strong>{entry.title}</strong><small>{[entry.year || '', entry.watchedEpisodes ? `${entry.watchedEpisodes} watched` : '', entry.personalStatus || ''].filter(Boolean).join(' · ') || 'Title-only entry'}</small></span>
            <button type="button" onClick={() => findPortableMatches(entry, entryIndex)} disabled={!!busy || !!matchSearch?.loading}>{matchSearch?.entryIndex === entryIndex && matchSearch.loading ? 'Searching…' : 'Find source listing'}</button>
          </div>
          {matchSearch?.entryIndex === entryIndex && !matchSearch.loading && <div className="portability-match-results">
            {matchSearch.results.length ? matchSearch.results.map(({ item: candidate, score }) => <button type="button" key={`${candidate.source}|${candidate.url}`} onClick={() => usePortableMatch(entryIndex, candidate)}>
              <span><strong>{candidate.title}</strong><small>{SOURCES[candidate.source]?.name || candidate.source}{portableCandidateYear(candidate) ? ` · ${portableCandidateYear(candidate)}` : ''}{candidate.type ? ` · ${candidate.type}` : ''}</small></span><b>{score}%</b>
            </button>) : <p>No likely source listing was found for this title.</p>}
            {matchSearch.failed.length > 0 && <p>Could not search: {matchSearch.failed.join(', ')}.</p>}
          </div>}
        </li>)}</ul>
        {preview.unmatchedEntries.length > 8 && <p>Showing the first 8 unmatched titles. Match or apply this preview, then import again to continue with the rest.</p>}
      </div>}
      {(summary.unmatched > 0 || summary.invalid > 0) && <p className="portability-warning"><AlertCircle size={15} /> Anything still unmatched or invalid when you apply the merge will be left out. Mikozora will not attach a title-only row to a guessed source listing.</p>}
      <div className="portability-preview-actions">
        <button className="btn secondary" type="button" onClick={closePreview}>Cancel</button>
        <button className="btn primary" type="button" onClick={applyImport} disabled={!preview.exactNew.length && !preview.exactExisting.length && !(includePossibleDuplicates && preview.possibleDuplicates.length)}>
          <Check size={15} /> Apply merge
        </button>
      </div>
    </div>}
  </section>;
}
