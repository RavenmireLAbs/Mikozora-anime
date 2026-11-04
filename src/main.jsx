import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Home, Compass, Bookmark, History, Layers3, Settings2, Search, ArrowRight,
  ArrowUpRight, ChevronLeft, ChevronRight, Play, Check, RefreshCw, X, Clock3,
  ExternalLink, Sparkles, SlidersHorizontal, Film, LoaderCircle, AlertCircle,
  Trash2, RotateCcw, FolderHeart, CircleHelp, ShieldCheck, Plus, ListVideo, Download, HardDrive, ListChecks, CheckCircle2, Heart, FolderPlus, Pencil, Folder, Flame, Bell, Sun, Moon, EyeOff, Star, Maximize, Link2, Unlink, CalendarClock, ArrowUp, ArrowDown, Gauge
} from 'lucide-react';
import { SOURCES, getCatalog, getDetail, getFeatured, getTrending, getDiscoverAnime, getServers, imageUrl, isAndroid, clearNetworkCache, getDownloads, getDownloadOptions, enqueueDownloads, removeDownload, setDownloadQueueOrder, openDownload, getExportSettings, chooseDownloadFolder, clearDownloadFolder, exportDownload, openExport, hasEpisodeUpdates, syncEpisodeTitles, getEpisodeUpdates, checkEpisodes, setEpisodeAutomatic, setEpisodeAlerts, markEpisodeRead, fetchLatestRelease, exportBackupToFile, readBackupFromFile, isDesktopApp, hasNativeDownloads, setPlayerReferer, hasDeviceSync, getDeviceSyncSettings, chooseDeviceSyncFolder, clearDeviceSyncFolder, readDeviceSyncFolder, writeDeviceSyncFile, hasTextFiles, exportTextToFile, readTextFromFile, hasOnlinePlayerPro, resolveOnlineStream, clearOnlineStream, openOnlinePlayerPro } from './data';
import { buildPlaybackPlaylist, compactPlaybackPlaylist } from './playback';
import { monitoredTitles, unreadByTitle } from './episode-updates';
import { SMART_DOWNLOADS_KEY, readSmartDownloads, saveSmartDownloads, smartTitleSelection, smartDownloadsForSync, withDownloadPreset } from './smart-downloads';
import { COLLECTIONS_KEY, FAVOURITES_ID, titleKey, normalizeCollections, collectionNameError, createCollection, renameCollection, deleteCollection, setCollectionItems, setTitleCollections, toggleFavourite, removeTitleFromCollections } from './collections';
import { PROGRESS_KEY, normalizeProgress, recordWatch, refreshSnapshot, setEpisodesWatched, setLinkedEpisodesWatched, removeProgressTitle, removeProgressTitles, watchedUrlSet, watchedEpisodeNumbers, watchedUrlSetForEpisodes, continueWatching, progressByTitle } from './progress';
import { SOURCE_MATCH_CANDIDATE_THRESHOLD, groupUniversalResults, linkSourceTitles, linkedTitleItems, linkedTitleKeys, normalizeSourceMatches, rankUniversalResults, readSourceMatches, relatedKeysByTitle, saveSourceMatches, scoreTitleMatch, titleVariantQueries, unlinkSourceTitle } from './source-match';
import { backupFileName, buildBackup, parseBackup, applyBackup, downloadBackupInBrowser, pickBackupInBrowser } from './backup';
import { APP_VERSION, RELEASES, startupExperience, completeExperience } from './releases';
import { DEFAULT_UPDATE_STATE, readUpdateState, saveUpdateState, shouldCheckOnForeground, shouldCheckOnLaunch, withCheckResult, visibleUpdate, dismissUpdate, updateDownloadUrl } from './update';
import { APPEARANCE_KEY, ACCENTS, MODES, DEFAULT_APPEARANCE, readAppearance, saveAppearance, applyAppearance, syncNativeAppearance } from './appearance';
import { CONTENT_KEY, GENRES, DEFAULT_CONTENT_PREFS, readContentPrefs, saveContentPrefs, isNsfw, ratingOf, yearOf, filterTitles } from './content';
import { markDeviceSyncPublished, prepareDeviceSync, publicDeviceSyncMeta, readDeviceSyncMeta, resetDeviceSyncPublication, setDeviceSyncAuto, stableStringify } from './device-sync';
import { PERSONAL_STATUSES, readLibraryMeta, saveLibraryMeta, libraryMetaFor, setLibraryMeta as setLibraryMetaRecord, removeLibraryMeta, pruneLibraryMeta, personalStatusLabel, libraryProgressState, sortLibraryTitles, libraryStats } from './library-meta';
import { buildTasteProfile, topTasteGenres, recommendTitles, sortBrowseTitles, similarTitles, moodShelves, pickRandomTitle } from './discovery';
import { chronologicalEpisodes, episodeNumberKey, findEpisodeByNumber, firstUnwatchedEpisode, episodesThrough, episodesInRange, wrappedIndex } from './episode-tools';
import { OFFLINE_STORAGE_LIMITS_GB, OFFLINE_AUTO_DELETE_DAYS, readOfflineManager, saveOfflineManager, normalizeOfflineManager, downloadBytes, downloadStorageSummary, downloadCleanupCandidates, cleanupBytes, queueOrderIds, moveQueueOrder, sortManagerDownloads, watchedInfoFor, downloadTitleKey } from './offline-manager';
import { OFFLINE_PLAYBACK_RATES, OFFLINE_SEEK_SECONDS, OFFLINE_SLEEP_MINUTES, OFFLINE_SUBTITLE_SIZES, OFFLINE_SUBTITLE_COLORS, OFFLINE_SUBTITLE_BACKGROUNDS, readOfflinePlayback, saveOfflinePlayback, normalizeOfflinePlayback, offlineSubtitleStyle, nextDownloadedEpisodes, offlinePlaybackPayload } from './offline-playback';
import { WATCH_PLAN_MODES, readWatchPlanner, saveWatchPlanner, setWatchPlan, buildCatchUpQueue, plannerSummary, buildBingeSession, watchPlanLabel } from './watch-planner';
import { computeWatchStats, buildWrapped, formatWatchDuration, monthLabel, statusBreakdown } from './watch-stats';
import { normalizeOnlinePlayback, readOnlinePlayback, saveOnlinePlayback, normalizeOnlinePositions, readOnlinePositions, saveOnlinePositions, onlinePositionFor, rememberOnlinePosition, formatPlaybackClock, directStreamKind, cleanDirectStream } from './online-playback';
import { RELEASE_RADAR_MODES, normalizeReleaseRadar, readReleaseRadar, saveReleaseRadar, setReleaseRadarRule, dismissReleaseRadarEntry, effectiveReleaseRadarRule, buildReleaseRadar, releaseRadarModeLabel } from './release-radar';
import { normalizeSearchCentre, readSearchCentre, saveSearchCentre, recordSearch, clearSearchHistory, saveSearch, removeSavedSearch, buildCommandIndex } from './command-centre';
import { normalizePortabilityState, readPortabilityState, savePortabilityState, pendingProgressFor, clearPendingProgress, buildShareCardSvg, portableFileName } from './library-portability';
import { DirectOnlinePlayer } from './direct-online-player.jsx';
import { CommandCentre } from './command-centre-ui.jsx';
import { OnlinePlayerSettings, LibraryPortabilitySettings } from './feature-settings.jsx';
import './style.css';
import './theme-generated.css';
import './appearance.css';

// Apply the saved preference before React renders, including the welcome screen.
let initialAppearance={...DEFAULT_APPEARANCE};
try { initialAppearance=readAppearance(window.localStorage); } catch { /* retain default */ }
applyAppearance(document,initialAppearance);
syncNativeAppearance(initialAppearance);

// The hide-NSFW preference is read before first render so hidden titles never flash.
let initialContent={...DEFAULT_CONTENT_PREFS};
try { initialContent=readContentPrefs(window.localStorage); } catch { /* retain default */ }

const LIBRARY_KEY = 'moku.library.v1';
const HISTORY_KEY = 'moku.history.v1';
const sourceName = id => SOURCES[id]?.name || 'Source';
const sourceCategory = value => SOURCES[typeof value === 'string' ? value : value?.source]?.category || '';
const identity = titleKey;
const savedSummary = item => ({source:item.source,url:item.url,title:item.title,image:item.image,type:item.type,badge:item.badge,status:item.status,genres:item.genres,aired:item.aired,year:item.year,rating:item.rating,nsfw:item.nsfw});
const displayStatus = value => ({'currently airing':'Ongoing','releasing':'Ongoing','finished airing':'Completed','finished':'Completed','not yet aired':'Upcoming','not_yet_released':'Upcoming'}[String(value||'').trim().toLowerCase()] || value || 'Not provided');
function readStored(key) {
  try { const x = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(x) ? x : []; }
  catch { return []; }
}
function useStored(key) {
  const [value, setValue] = useState(() => readStored(key));
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage can be disabled */ } }, [key, value]);
  return [value, setValue];
}
function prettyTime(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function external(url) {
  if (!url) return;
  if (isAndroid()) window.MokuBridge.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
function Mark({ small = false }) {
  return <span className={'mark' + (small ? ' mark-small' : '')} aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="M20 4l.6 1.9L22.5 6.5l-1.9.6L20 9l-.6-1.9L17.5 6.5l1.9-.6Z" fill="currentColor"/><path d="M5 11.4C11 12.7 14.8 13.3 20 13.3s9-0.6 15-1.9l-.6 2.8C29 15.1 25.2 15.5 20 15.5S11 15.1 5.6 14.2Z" fill="currentColor"/><path d="M9.9 14.6h20.2v1.9H9.9Zm9.2 1.9h1.9v2.8h-1.9ZM8.4 19.3h23.2v2H8.4Zm3.7-3.4h3L15.5 29h-3.7Zm12.8 0h3L28.3 29h-3.8Z" fill="currentColor"/></svg></span>;
}
function Brand({ onClick }) {
  return <button className="brand" onClick={onClick} aria-label="Mikozora home"><Mark/><span><strong>Mikozora<span className="brand-dot">.</span></strong><small>YOUR ANIME SPACE</small></span></button>;
}
function SideNav({ page, go, unread = 0 }) {
  const rows = [
    { id:'home', name:'Discover', icon:Home },
    { id:'browse', name:'Browse', icon:Compass },
    { id:'library', name:'Library', icon:Bookmark },
    { id:'planner', name:'Planner', icon:CalendarClock },
    { id:'updates', name:'Updates', icon:Bell },
    { id:'history', name:'History', icon:History },
    { id:'downloads', name:'Downloads', icon:Download },
  ];
  return <aside className="sidebar">
    <Brand onClick={() => go('home')}/>
    <div className="nav-label">MENU</div>
    <nav className="side-nav" aria-label="Main navigation">
      {rows.map(({id,name,icon:Icon}) => <button key={id} onClick={() => go(id)} className={'nav-item ' + (page===id ? 'active' : '')}><Icon size={19}/><span>{name}</span>{id==='updates'&&unread>0&&<em className="nav-update-count">{unread>99?'99+':unread}</em>}{page===id && <i/>}</button>)}
    </nav>
    <div className="nav-label second">COLLECTION</div>
    <nav className="side-nav" aria-label="More navigation">
      <button onClick={() => go('sources')} className={'nav-item ' + (page==='sources' ? 'active' : '')}><Layers3 size={19}/><span>Sources</span><em>{Object.keys(SOURCES).length}</em></button>
      <button onClick={() => go('stats')} className={'nav-item ' + (page==='stats' ? 'active' : '')}><Flame size={19}/><span>Watch stats</span></button>
      <button onClick={() => go('settings')} className={'nav-item ' + (page==='settings' ? 'active' : '')}><Settings2 size={19}/><span>Settings</span></button>
    </nav>
    <div className="side-note"><div className="side-note-icon"><Sparkles size={18}/></div><strong>A little escape.</strong><p>All your favorite worlds, right here.</p><button onClick={() => go('browse')}>Find your next watch <ArrowRight size={14}/></button></div>
    <div className="side-footer"><span className="status-dot"/> MADE FOR YOUR WATCH TIME <span>✦</span></div>
  </aside>;
}
function BottomNav({ page, go }) {
  const rows = [ ['home','Discover',Home], ['browse','Browse',Compass], ['library','Library',Bookmark], ['history','History',History], ['downloads','Downloads',Download], ['sources','Sources',Layers3] ];
  return <nav className="bottom-nav" aria-label="Mobile navigation">{rows.map(([id,label,Icon]) => <button key={id} onClick={() => go(id)} className={page===id?'active':''}><Icon size={20}/><span>{label}</span></button>)}</nav>;
}
function TopBar({ page, go, submitSearch, refresh, unread = 0, openCommandCentre = () => {} }) {
  const [input, setInput] = useState('');
  const labels = { home:'Discover', browse:'Browse', library:'Library', planner:'Planner', updates:'Updates', history:'History', downloads:'Downloads', sources:'Sources', stats:'Watch stats', settings:'Settings', detail:'Anime details' };
  function submit(e) { e.preventDefault(); submitSearch(input.trim()); }
  return <header className="topbar">
    <div className="mobile-brand"><Brand onClick={() => go('home')}/></div>
    <div className="breadcrumbs"><span>YOUR SPACE</span><ChevronRight size={14}/><strong>{labels[page] || 'Discover'}</strong></div>
    <div className="top-actions"><form className="top-search" onSubmit={submit}><Search size={17}/><input aria-label="Search anime" value={input} onChange={e=>setInput(e.target.value)} placeholder="Search anime..."/><kbd>↵</kbd></form><button className="command-centre-button" type="button" onClick={openCommandCentre} title="Command Centre (Ctrl/⌘ K)" aria-label="Open Command Centre"><Sparkles size={16}/><span>Command</span><kbd>Ctrl K</kbd></button><button className="icon-btn refresh" onClick={refresh} title="Refresh source data" aria-label="Refresh source data"><RefreshCw size={18}/></button><button className={'icon-btn updates-button '+(page==='updates'?'active':'')} onClick={()=>go('updates')} title="Episode updates" aria-label={unread?`Updates, ${unread} unread`:'Updates'}><Bell size={18}/>{unread>0&&<span className="updates-badge">{unread>99?'99+':unread}</span>}</button><button className="mobile-settings icon-btn" onClick={() => go('settings')} aria-label="Settings"><Settings2 size={19}/></button></div>
  </header>;
}
function ReleaseRadarRuleControls({ item, radar = {}, onChange = () => {}, compact = false }) {
  if (!item?.source || !item?.url) return null;
  const rule = effectiveReleaseRadarRule(radar, item);
  const snoozeOptions = [[0, 'No snooze'], [1, 'Snooze 1 day'], [7, 'Snooze 7 days'], [30, 'Snooze 30 days'], [90, 'Snooze 90 days']];
  const until = rule.snoozedUntil > Date.now()
    ? new Date(rule.snoozedUntil).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';
  return <div className={'release-radar-rule' + (compact ? ' compact' : '')} aria-label={`Release Radar rule for ${item.title}`}>
    <label><span>Release Radar</span><select aria-label={`Release Radar mode for ${item.title}`} value={rule.mode} onChange={event => onChange(item, { mode: event.target.value })}>
      {RELEASE_RADAR_MODES.map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
    </select></label>
    <label><span>Snooze</span><select aria-label={`Snooze Release Radar for ${item.title}`} value="0" onChange={event => {
      const days = Number(event.target.value) || 0;
      onChange(item, { snoozedUntil: days ? Date.now() + days * 24 * 60 * 60 * 1000 : 0 });
    }}>
      {snoozeOptions.map(([days, label]) => <option key={days} value={days}>{label}</option>)}
    </select></label>
    {until && <small>Snoozed until {until}</small>}
    {rule.mode === 'muted' && <small>Still checked; alerts and inbox badges are muted.</small>}
    {rule.mode === 'inbox' && <small>Shows in the inbox without a device alert.</small>}
  </div>;
}
function SearchCentrePanel({ searchCentre = {}, currentQuery = '', currentSource = 'all', onRun = () => {}, onSave = () => {}, onRemoveSaved = () => {}, onClearHistory = () => {} }) {
  const centre = normalizeSearchCentre(searchCentre);
  const cleanQuery = String(currentQuery || '').trim();
  const alreadySaved = centre.saved.some(entry => entry.query.toLowerCase() === cleanQuery.toLowerCase() && entry.source === currentSource);
  return <section className="search-centre-panel" aria-label="Search Centre">
    <div className="search-centre-head"><div><span className="eyebrow">SEARCH CENTRE</span><h2>Your searches</h2><p>Recent and saved searches stay on this device.</p></div>{cleanQuery && <button className="btn secondary" type="button" disabled={alreadySaved} onClick={() => onSave(cleanQuery, currentSource)}>{alreadySaved ? 'Search saved' : 'Save this search'}</button>}</div>
    {centre.saved.length > 0 && <div className="search-chip-group"><span>Saved</span><div>{centre.saved.slice(0, 12).map(entry => <span className="search-chip saved" key={entry.id}><button type="button" onClick={() => onRun(entry.query, entry.source)}>{entry.name}<small>{entry.source === 'all' ? 'All sources' : sourceName(entry.source)}</small></button><button type="button" onClick={() => onRemoveSaved(entry.id)} aria-label={`Remove saved search ${entry.name}`}><X size={13} /></button></span>)}</div></div>}
    {centre.history.length > 0 ? <div className="search-chip-group"><span>Recent</span><div>{centre.history.slice(0, 12).map(entry => <button className="search-chip" type="button" key={entry.id} onClick={() => onRun(entry.query, entry.source)}>{entry.query}<small>{entry.source === 'all' ? 'All sources' : sourceName(entry.source)}</small></button>)}</div><button className="text-link muted" type="button" onClick={onClearHistory}>Clear search history</button></div> : <p className="search-centre-empty">Search for a title and it will appear here for next time.</p>}
  </section>;
}
function SourcePill({ source, compact = false }) {
  return <span className={'source-pill ' + source + (compact ? ' compact' : '')} style={{'--source-accent':SOURCES[source]?.accent}}><i/>{sourceName(source)}</span>;
}
// Every card carries an age-rating chip: the normalized rating the source provided,
// or NR (not rated) when it provided none. Mikozora never invents a rating.
function RatingBadge({ item }) {
  const rating = ratingOf(item);
  return <span className={'card-rating' + (rating?.adult ? ' rating-adult' : rating ? ' rating-known' : ' rating-unknown')} title={rating ? `Age rating: ${rating.label}${rating.adult ? ' · adult content' : ''} (reported by ${sourceName(item?.source)})` : `Not rated · ${sourceName(item?.source)} does not provide an age rating`}>{rating ? rating.label : 'NR'}</span>;
}
function Cover({ item, eager = false }) {
  return <div className="cover-img"><img src={imageUrl(item.image)} alt="" loading={eager ? 'eager' : 'lazy'} onError={e=>{ e.currentTarget.style.display='none'; }}/><div className="cover-fallback"><Film size={28}/></div></div>;
}
function AnimeCard({ item, onOpen, inLibrary, toggle, index = 0, favourite, onFavourite, newCount = 0, progress = null, personalMeta = null, sourceVariants = [] }) {
  const year = yearOf(item);
  const personalRating = Number(personalMeta?.rating) || 0;
  const personalStatus = personalStatusLabel(personalMeta?.status);
  const hasPersonalNote = !!personalMeta?.note?.trim();
  const recommendationReason = typeof item.recommendationReason === 'string' ? item.recommendationReason : '';
  const otherSources = (Array.isArray(sourceVariants) ? sourceVariants : []).filter(variant => variant && identity(variant) !== identity(item));
  return <article className="anime-card">
    <div className="card-cover">
      <button className="cover-hit" onClick={() => onOpen(item)} aria-label={`Open ${item.title}`}><Cover item={item} eager={index<4}/><span className="card-shade"/><span className="card-play"><Play size={16} fill="currentColor"/></span></button>
      <div className="cover-top"><div className="cover-badges"><span className="cover-badge">{item.badge || 'SUB'}</span><RatingBadge item={item}/></div><div className="cover-buttons">{onFavourite&&<button className={'save-mini favourite-mini '+(favourite?'saved':'')} onClick={()=>onFavourite(item)} aria-label={favourite?`Remove ${item.title} from Favourites`:`Add ${item.title} to Favourites`} title={favourite?'Remove from Favourites':'Add to Favourites'}><Heart size={15} fill={favourite?'currentColor':'none'}/></button>}<button className={'save-mini '+(inLibrary?'saved':'')} onClick={() => toggle(item)} aria-label={inLibrary ? `Remove ${item.title} from library` : `Save ${item.title} to library`} title={inLibrary?'Remove from library':'Save to library'}><Bookmark size={15} fill={inLibrary?'currentColor':'none'}/></button></div></div>
      {progress?.watchedCount>0 ? <span className="cover-status">{progress.total>0?`${progress.watchedCount}/${progress.total} watched`:`${progress.watchedCount} watched`}</span> : item.status && <span className="cover-status">{item.status}</span>}
      {newCount>0&&<span className="cover-new" aria-label={`${newCount} new episode${newCount===1?'':'s'}`}>{newCount} NEW</span>}
      {progress?.total>0&&progress.watchedCount>0&&<span className="cover-progress"><i style={{width:`${Math.min(100,Math.round(progress.watchedCount/progress.total*100))}%`}}/></span>}
    </div>
    <button className="card-title" onClick={() => onOpen(item)} title={item.title}>{item.title}</button>
    <div className="card-meta">{year>0&&<><span>{year}</span><b>·</b></>}<span>{item.type || 'ANIME'}</span><b>·</b><span>{sourceName(item.source)}</span></div>
    {(personalRating>0||personalStatus||hasPersonalNote)&&<div className="card-personal" aria-label={`Your shelf: ${[personalRating?`${personalRating} of 5 stars`:'',personalStatus,hasPersonalNote?'note saved':''].filter(Boolean).join(', ')}`}>{personalRating>0&&<span><Star size={11} fill="currentColor"/> {personalRating}/5</span>}{personalStatus&&<span>{personalStatus}</span>}{hasPersonalNote&&<span>Note saved</span>}</div>}
    {recommendationReason&&<p className="card-reason">{recommendationReason}</p>}
    {otherSources.length>0&&<div className="card-sources" aria-label={`Also available on ${otherSources.map(variant=>sourceName(variant.source)).join(', ')}`}><span>Also on</span>{otherSources.slice(0,3).map(variant=><button key={identity(variant)} type="button" onClick={()=>onOpen(variant)} aria-label={`Open ${variant.title} on ${sourceName(variant.source)}`} title={`Open on ${sourceName(variant.source)}`}>{sourceName(variant.source)}</button>)}{otherSources.length>3&&<span className="card-sources-more" aria-label={`${otherSources.length-3} more sources`}>+{otherSources.length-3}</span>}</div>}
  </article>;
}
function Empty({ icon: Icon = Sparkles, title, body, action, actionLabel }) {
  return <div className="empty"><div className="empty-icon"><Icon size={25}/></div><h3>{title}</h3><p>{body}</p>{action && <button className="btn primary" onClick={action}>{actionLabel}<ArrowRight size={16}/></button>}</div>;
}
function SkeletonRail() { return <div className="card-rail skeleton-rail">{Array.from({length:7}).map((_,i)=><div className="skeleton-card" key={i}><div className="skeleton shimmer"/><span className="skeleton shimmer"/><span className="skeleton shimmer"/></div>)}</div>; }
function SectionHeading({ eyebrow, title, link, action, count }) {
  return <div className="section-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}{count != null && <small className="count">{count}</small>}</h2></div>{action && <button className="text-link" onClick={action}>{link || 'See all'} <ArrowRight size={15}/></button>}</div>;
}
function Rail({ items, open, has, toggle, libraryMeta = null }) {
  return <div className="card-rail">{items.map((item,i)=><AnimeCard key={identity(item)} item={item} index={i} onOpen={open} inLibrary={has(item)} toggle={toggle} personalMeta={libraryMeta?libraryMetaFor(libraryMeta,item):null}/>)}</div>;
}
function ErrorNote({ source, onRetry }) {
  return <div className="source-error"><AlertCircle size={17}/><span>Couldn’t load {sourceName(source)} right now.</span><button onClick={onRetry}>Try again</button></div>;
}
function Hero({ featured, fallback, open, has, toggle }) {
  const [spotlight,setSpotlight] = useState(0);
  const slides = (featured || []).filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i).slice(0,2);
  const slide = slides[spotlight % Math.max(slides.length,1)];
  const matching = fallback.find(x=>x.url===slide?.url);
  const item = slide ? {...slide, image:matching?.image || slide.banner, type:matching?.type || 'ANIME', badge: matching?.badge || 'SUB', rating:matching?.rating, year:matching?.year, nsfw:matching?.nsfw, genres: matching?.genres || slide.genres} : null;
  return <div className={'hero ' + (!item ? 'hero-loading' : '')} style={item ? {backgroundImage:`linear-gradient(90deg, #171d19 0%, rgba(22,29,25,.98) 25%, rgba(22,29,25,.8) 47%, rgba(22,29,25,.08) 100%), linear-gradient(0deg, rgba(18,25,21,.35), transparent 70%), url("${imageUrl(item.banner)}")`} : undefined}>
    <div className="hero-noise"/>
    <div className="hero-content"><div className="hero-label"><span className="tiny-spark">✦</span> THE SPOTLIGHT <span className="hero-line"/> <span>{String(spotlight+1).padStart(2,'0')} / {String(Math.max(slides.length,1)).padStart(2,'0')}</span></div>
      {item ? <><div className="hero-kicker">FEATURED ON ANIMESOGO</div><h2>{item.title}</h2><div className="hero-meta"><RatingBadge item={item}/>{yearOf(item)>0&&<span>{yearOf(item)}</span>}</div><p>{Array.isArray(item.genres) ? item.genres.join(' · ') : item.genres || 'A story worth getting lost in.'}</p><div className="hero-buttons"><button className="btn primary" onClick={()=>open(item)}><Play size={15} fill="currentColor"/> View anime</button><button className="btn hero-save" onClick={()=>toggle(item)} aria-label={has(item)?'Remove from library':'Add to library'}><Bookmark size={17} fill={has(item)?'currentColor':'none'}/><span>{has(item)?'Saved':'My library'}</span></button></div></> : <><div className="hero-kicker">A LITTLE ESCAPE AWAITS</div><h2>Find a world to<br/>get lost in.</h2><p>Stories, adventures and everything in between.</p><button className="btn primary" onClick={()=>open(null)}><Compass size={16}/> Explore anime</button></>}
    </div><div className="hero-index"><span>CURATED FOR YOU</span><div>{slides.map((x,i)=><button key={x.url} onClick={()=>setSpotlight(i)} className={spotlight===i?'current':''} aria-label={`Show spotlight ${i+1}`}/>)}</div></div>
  </div>;
}
function TrendingSection({ rankings, loading, open, hideNsfw = false }) {
  const [source,setSource] = useState('sogo');
  const items = filterTitles(rankings[source] || [], { hideNsfw });
  return <section className="content-section trending-section">
    <SectionHeading eyebrow="WHAT PEOPLE ARE WATCHING" title="Trending now"/>
    <div className="trending-controls"><div className="tabs" role="tablist" aria-label="Trending sources">
      {[['sogo','Anime · AnimeSogo'],['xin','Donghua · AnimeXin']].map(([id,label])=><button key={id} role="tab" aria-selected={source===id} className={source===id?'selected':''} onClick={()=>setSource(id)}>{label}</button>)}
    </div><span><Flame size={14}/> WEEKLY SOURCE RANKING</span></div>
    {loading[source] ? <div className="trending-loading"><LoaderCircle className="spin" size={17}/> Loading the weekly ranking…</div> : items.length ?
      <div className="trending-rail" aria-label={`${sourceName(source)} weekly ranking`}>{items.map((item)=><button className="trending-card" key={identity(item)} onClick={()=>open(item)} aria-label={`Open ${item.title}, number ${item.rank} on ${sourceName(source)}`}>
        <div className="trending-image"><Cover item={item}/><span className="trending-rating"><RatingBadge item={item}/></span><span className="trending-number">{String(item.rank).padStart(2,'0')}</span></div>
        <div className="trending-copy"><small>#{item.rank} THIS WEEK</small><strong>{item.title}</strong><span>{sourceName(source)} <ArrowRight size={13}/></span></div>
      </button>)}</div> : <div className="source-error"><AlertCircle size={17}/><span>The weekly ranking from {sourceName(source)} is unavailable. Try refreshing.</span></div>}
  </section>;
}
function HomePage({open, has, toggle, browse, recent, refreshKey, hideNsfw = false, continueItems = [], resumeNext, removeContinue, library = [], progress = [], libraryMeta = {}, catchUpItems = [], catchUpSummary = null, openPlanner}) {
  const [state,setState] = useState({featured:[],sogo:[],xin:[],discover:[],trendSogo:[],trendXin:[],loadingSogo:true,loadingXin:true,loadingDiscover:true,loadingTrendSogo:true,loadingTrendXin:true});
  useEffect(()=>{ let alive=true; setState(x=>({...x,loadingSogo:true,loadingXin:true,loadingDiscover:true,loadingTrendSogo:true,loadingTrendXin:true}));
    getFeatured().then(value=>{if(alive)setState(x=>({...x,featured:value}))}).catch(()=>{if(alive)setState(x=>({...x,featured:[]}))});
    getCatalog('sogo').then(value=>{if(alive)setState(x=>({...x,sogo:value.items,loadingSogo:false}))}).catch(()=>{if(alive)setState(x=>({...x,sogo:[],loadingSogo:false}))});
    getCatalog('xin').then(value=>{if(alive)setState(x=>({...x,xin:value.items,loadingXin:false}))}).catch(()=>{if(alive)setState(x=>({...x,xin:[],loadingXin:false}))});
    getDiscoverAnime().then(value=>{if(alive)setState(x=>({...x,discover:value,loadingDiscover:false}))}).catch(()=>{if(alive)setState(x=>({...x,discover:[],loadingDiscover:false}))});
    getTrending('sogo').then(value=>{if(alive)setState(x=>({...x,trendSogo:value,loadingTrendSogo:false}))}).catch(()=>{if(alive)setState(x=>({...x,trendSogo:[],loadingTrendSogo:false}))});
    getTrending('xin').then(value=>{if(alive)setState(x=>({...x,trendXin:value,loadingTrendXin:false}))}).catch(()=>{if(alive)setState(x=>({...x,trendXin:[],loadingTrendXin:false}))});
    return ()=>{alive=false};
  },[refreshKey]);
  const shown = list => filterTitles(list || [], { hideNsfw });
  const shownRecent = (recent || []).filter(entry => !hideNsfw || !isNsfw(entry.item));
  const shownContinue = (continueItems || []).filter(entry => !hideNsfw || !isNsfw(entry.item));
  const shownCatchUp = (catchUpItems || []).filter(entry => !hideNsfw || !isNsfw(entry.item));
  const recommendationProfile = useMemo(
    () => buildTasteProfile({ library, history: recent || [], progress, libraryMeta }),
    [library, recent, progress, libraryMeta],
  );
  const recommendations = useMemo(() => recommendTitles([
    ...filterTitles(state.discover || [], { hideNsfw }),
    ...filterTitles(state.sogo || [], { hideNsfw }),
    ...filterTitles(state.xin || [], { hideNsfw }),
    ...filterTitles(state.trendSogo || [], { hideNsfw }),
    ...filterTitles(state.trendXin || [], { hideNsfw }),
  ], recommendationProfile, { limit: 14 }), [state, hideNsfw, recommendationProfile]);
  const discoveryCandidates = useMemo(() => [
    ...filterTitles(state.discover || [], { hideNsfw }),
    ...filterTitles(state.sogo || [], { hideNsfw }),
    ...filterTitles(state.xin || [], { hideNsfw }),
    ...filterTitles(state.trendSogo || [], { hideNsfw }),
    ...filterTitles(state.trendXin || [], { hideNsfw }),
    ...filterTitles(state.featured || [], { hideNsfw }),
  ], [state, hideNsfw]);
  const becauseSeed = shownRecent[0]?.item || null;
  const becauseYouWatched = useMemo(
    () => becauseSeed ? similarTitles(becauseSeed, discoveryCandidates, recommendationProfile, { limit: 12 }) : [],
    [becauseSeed, discoveryCandidates, recommendationProfile],
  );
  const shelves = useMemo(
    () => moodShelves(discoveryCandidates, recommendationProfile, { limitPerShelf: 12 }).slice(0, 3),
    [discoveryCandidates, recommendationProfile],
  );
  const [randomPick, setRandomPick] = useState(null);
  const chooseRandomPick = () => {
    const pool = filterTitles([...(library || []), ...recommendations, ...discoveryCandidates], { hideNsfw });
    setRandomPick(pickRandomTitle(pool, { seed: `home-${Date.now()}-${Math.random()}` }));
  };
  const tasteGenres = topTasteGenres(recommendationProfile, 3);
  const recommendationLoading = state.loadingSogo && state.loadingXin && state.loadingDiscover && state.loadingTrendSogo && state.loadingTrendXin;
  const date = new Intl.DateTimeFormat(undefined, { weekday:'long', month:'short', day:'numeric' }).format(new Date()).toUpperCase();
  return <div className="content home-page">
    <div className="welcome-row"><div><div className="date-line"><span className="date-star">✦</span> {date} <span className="date-separator"/> A GOOD DAY FOR ANIME</div><h1>Your next story starts here<span>.</span></h1><p>Good to have you here. What are we watching today?</p></div><div className="source-count"><div className="source-count-icon"><Layers3 size={17}/></div><div><strong>{Object.keys(SOURCES).length} sources</strong><small>One cozy place</small></div><i/></div></div>
    <Hero featured={shown(state.featured)} fallback={shown(state.sogo)} open={x=>x?open(x):browse('all')} has={has} toggle={toggle}/>
    {shownContinue.length>0 ? <section className="content-section continue-section"><SectionHeading eyebrow="PICK UP WHERE YOU LEFT OFF" title="Continue watching" link="View history" action={()=>browse('history')}/><div className="continue-rail">{shownContinue.slice(0,8).map((entry)=><div className="continue-card" key={identity(entry.item)}><button className="continue-main" onClick={()=>resumeNext(entry)} aria-label={`Play episode ${entry.episode.number} of ${entry.item.title}`}><div className="continue-cover"><Cover item={entry.item}/></div><div className="continue-info"><span>NEXT · EPISODE {entry.episode.number}</span><strong>{entry.item.title}</strong><small>{sourceName(entry.item.source)} · {entry.watchedCount} of {entry.total} watched</small><span className="continue-progress"><i style={{width:`${Math.min(100,Math.round(entry.watchedCount/entry.total*100))}%`}}/></span></div><span className="continue-play"><Play size={14} fill="currentColor"/></span></button><button className="continue-remove" onClick={()=>removeContinue(entry.item)} aria-label={`Remove ${entry.item.title} from Continue watching`} title="Remove from Continue watching"><X size={13}/></button></div>)}</div></section> : shownRecent.length>0 && <section className="content-section continue-section"><SectionHeading eyebrow="PICK UP WHERE YOU LEFT OFF" title="Recently opened" link="View history" action={()=>browse('history')}/><div className="continue-rail">{shownRecent.slice(0,4).map((entry)=><button className="continue-card" key={`${identity(entry.item)}|${entry.episode.number}`} onClick={()=>open(entry.item)}><div className="continue-cover"><Cover item={entry.item}/></div><div className="continue-info"><span>EPISODE {entry.episode.number}</span><strong>{entry.item.title}</strong><small>{sourceName(entry.item.source)} · {prettyTime(entry.time)}</small></div><span className="continue-play"><Play size={14} fill="currentColor"/></span></button>)}</div></section>}
    {shownCatchUp.length>0&&<section className="content-section catchup-home-section"><SectionHeading eyebrow="YOUR NEXT SITTING" title="Catch up, your way" link="Open planner" action={openPlanner}/><p className="catchup-home-copy">{catchUpSummary?.episodesBehind||0} episodes are waiting across {catchUpSummary?.titlesBehind||shownCatchUp.length} started {(catchUpSummary?.titlesBehind||shownCatchUp.length)===1?'series':'series'}{catchUpSummary?.nearlyFinished?` · ${catchUpSummary.nearlyFinished} nearly finished`:''}.</p><div className="continue-rail">{shownCatchUp.slice(0,4).map(entry=><div className="continue-card catchup-home-card" key={entry.key||identity(entry.item)}><button className="continue-main" onClick={()=>resumeNext(entry)} aria-label={`Play episode ${entry.episode.number} of ${entry.item.title}`}><div className="continue-cover"><Cover item={entry.item}/></div><div className="continue-info"><span>{entry.plan?`${watchPlanLabel(entry.plan.mode).toUpperCase()} · `:''}NEXT · EPISODE {entry.episode.number}</span><strong>{entry.item.title}</strong><small>{entry.behindCount} behind · {entry.watchedCount} of {entry.total} watched</small><span className="continue-progress"><i style={{width:`${Math.min(100,Math.round((entry.percent||0)*100))}%`}}/></span></div><span className="continue-play"><Play size={14} fill="currentColor"/></span></button><button className="catchup-series-link" onClick={()=>open(entry.item)}>Series</button></div>)}</div></section>}
    {(recommendationLoading||recommendations.length>0)&&<section className="content-section recommendation-section"><SectionHeading eyebrow={recommendationProfile.strength?'MADE FROM YOUR WATCHING':'FRESH FROM YOUR SOURCES'} title={recommendationProfile.strength?'Made for your taste':'Fresh picks for you'} action={()=>browse('all')} link="Browse all"/>{tasteGenres.length>0&&<div className="taste-genre-row" aria-label="Your top watched genres"><span>Often in your space</span>{tasteGenres.map(genre=><b key={genre}>{genre}</b>)}</div>}{recommendationLoading?<SkeletonRail/>:<Rail items={recommendations} open={open} has={has} toggle={toggle} libraryMeta={libraryMeta}/>}</section>}
    <section className="content-section discovery-picker-section" aria-label="Random watch picker"><SectionHeading eyebrow="DISCOVERY 2.0" title="Can't decide?"/><div className="random-picker-card"><div><strong>Let Mikozora choose from your space</strong><p>The picker uses your saved titles and the source picks already loaded here. Nothing leaves the device.</p>{randomPick&&<button className="random-pick-open" onClick={()=>open(randomPick)}><span className="random-pick-cover"><Cover item={randomPick}/></span><span><small>YOUR PICK</small><strong>{randomPick.title}</strong><em>{sourceName(randomPick.source)}</em></span><ArrowRight size={17}/></button>}</div><button className="btn primary" onClick={chooseRandomPick}><Sparkles size={16}/> {randomPick?'Pick another':'Surprise me'}</button></div></section>
    {becauseYouWatched.length>0&&<section className="content-section because-section"><SectionHeading eyebrow="MORE LIKE THAT" title={`Because you watched ${becauseSeed.title}`}/><p className="discovery-note">Matched from genre, type, era and your local taste profile.</p><Rail items={becauseYouWatched} open={open} has={has} toggle={toggle} libraryMeta={libraryMeta}/></section>}
    {shelves.map(shelf=><section className="content-section mood-shelf-section" key={shelf.id}><SectionHeading eyebrow="MOOD SHELF" title={shelf.label}/><p className="discovery-note">{shelf.description}</p><Rail items={shelf.items} open={open} has={has} toggle={toggle} libraryMeta={libraryMeta}/></section>)}
    <TrendingSection rankings={{sogo:state.trendSogo,xin:state.trendXin}} loading={{sogo:state.loadingTrendSogo,xin:state.loadingTrendXin}} open={open} hideNsfw={hideNsfw}/>
    <section className="content-section"><SectionHeading eyebrow="FRESH FROM THE SOURCE" title="Recently updated" action={()=>browse('sogo')} link="Explore AnimeSogo"/>{state.loadingSogo?<SkeletonRail/>:shown(state.sogo).length?<Rail items={shown(state.sogo).slice(0,14)} open={open} has={has} toggle={toggle}/>:(state.sogo.length?<div className="source-error"><EyeOff size={17}/><span>These titles are hidden while NSFW content is turned off in Settings.</span></div>:(state.discover.length?<div className="source-error"><EyeOff size={17}/><span>These titles are hidden while NSFW content is turned off in Settings.</span></div>:<ErrorNote source="sogo" onRetry={()=>browse('sogo')}/>))}</section>
    <section className="content-section"><SectionHeading eyebrow="MOST VIEWED ON ANIMESOGO" title="Discover anime" action={()=>browse('sogo')} link="Explore AnimeSogo"/>{state.loadingDiscover?<SkeletonRail/>:shown(state.discover).length?<Rail items={shown(state.discover).slice(0,14)} open={open} has={has} toggle={toggle}/>:<ErrorNote source="sogo" onRetry={()=>browse('sogo')}/>}</section>
    <section className="content-section last-section"><SectionHeading eyebrow="A DIFFERENT WORLD" title="Discover donghua" action={()=>browse('xin')} link="Explore AnimeXin"/>{state.loadingXin?<SkeletonRail/>:shown(state.xin).length?<Rail items={shown(state.xin).slice(0,14)} open={open} has={has} toggle={toggle}/>:(state.xin.length?<div className="source-error"><EyeOff size={17}/><span>These titles are hidden while NSFW content is turned off in Settings.</span></div>:<ErrorNote source="xin" onRetry={()=>browse('xin')}/>)}</section>
    <div className="end-note"><span>✦</span> THERE’S ALWAYS ANOTHER STORY WAITING <span>✦</span></div>
  </div>;
}
function selectedSources(source) {
  if (source==='all') return Object.keys(SOURCES);
  if (source==='anime' || source==='donghua') return Object.values(SOURCES).filter(x=>x.category.toLowerCase()===source).map(x=>x.id);
  return SOURCES[source] ? [source] : [];
}
const BROWSE_YEARS = Array.from({length:new Date().getFullYear()+2-1990}, (_,i)=>String(new Date().getFullYear()+1-i));
function BrowsePage({open,has,toggle, query, setQuery, source, setSource, refreshKey, hideNsfw = false, openSettings, library = [], history = [], progress = [], libraryMeta = {}, sourceMatches = null, searchCentre = {}, submitSearch = null, saveCurrentSearch = () => {}, removeSavedSearchEntry = () => {}, clearSearchHistoryEntries = () => {}}) {
  const [draft,setDraft] = useState(query);
  const [status,setStatus] = useState('all');
  const [genre,setGenre] = useState('');
  const [year,setYear] = useState('');
  const [nsfw,setNsfw] = useState('all');
  const [sort,setSort] = useState('source');
  const [savedFilter,setSavedFilter] = useState('all');
  const searching = !!query.trim();
  const activeStatus = searching ? 'all' : status;
  const activeGenre = searching ? '' : genre;
  const activeYear = searching ? '' : year;
  const [data,setData] = useState({items:[],page:1,more:false,loading:true,errors:[],moreBySource:{}});
  const generation=useRef(0);
  useEffect(()=>{setDraft(query);if(query.trim())setStatus('all')},[query]);
  useEffect(()=>{
    let alive=true;const current=++generation.current;const selected=selectedSources(source);
    setData({items:[],page:1,more:false,loading:true,errors:[],moreBySource:{}});
    if (!selected.length) {setData({items:[],page:1,more:false,loading:false,errors:[],moreBySource:{}});return()=>{alive=false};}
    let remaining=selected.length;
    selected.forEach(id=>getCatalog(id,{query,page:1,status:activeStatus,genre:activeGenre,year:activeYear}).then(result=>{
      if(!alive || current!==generation.current)return;
      remaining--;
      setData(previous=>{
        const moreBySource={...previous.moreBySource,[id]:result.hasMore};
        const seen=new Set(previous.items.map(identity));
        const added=result.items.filter(item=>!seen.has(identity(item))&&seen.add(identity(item)));
        const items=[...previous.items,...added].sort((a,b)=>selected.indexOf(a.source)-selected.indexOf(b.source));
        return {...previous,items,moreBySource,more:Object.values(moreBySource).some(Boolean),loading:remaining>0};
      });
    }).catch(()=>{
      if(!alive || current!==generation.current)return;
      remaining--;
      setData(previous=>({...previous,loading:remaining>0,errors:[...previous.errors,id]}));
    }));
    return ()=>{alive=false};
  },[query,source,refreshKey,activeStatus,activeGenre,activeYear]);
  async function more() {
    if(data.loading || data.loadingMore)return;
    const page=data.page+1,current=generation.current,selected=selectedSources(source).filter(id=>data.moreBySource[id]);
    setData(previous=>({...previous,loadingMore:true}));
    const result=await Promise.allSettled(selected.map(id=>getCatalog(id,{query,page,status:activeStatus,genre:activeGenre,year:activeYear})));
    if(current!==generation.current)return;
    setData(previous=>{
      const seen=new Set(previous.items.map(identity));
      const items=result.flatMap(x=>x.status==='fulfilled'?x.value.items:[]).filter(x=>!seen.has(identity(x))&&seen.add(identity(x)));
      const moreBySource={...previous.moreBySource};
      result.forEach((x,i)=>{moreBySource[selected[i]]=x.status==='fulfilled' && x.value.hasMore;});
      return {...previous,items:[...previous.items,...items],page,moreBySource,more:Object.values(moreBySource).some(Boolean) && items.length>0,loadingMore:false,errors:[...new Set([...previous.errors,...result.map((x,i)=>x.status==='rejected'?selected[i]:null).filter(Boolean)])]};
    });
  }
  // The content (NSFW) rule and the global hide-NSFW preference apply on top of
  // what the sources returned; genre/year/status mismatches are only used to
  // drop titles whose own metadata contradicts the filter.
  const filteredItems = filterTitles(data.items, { genre:activeGenre, year:activeYear, status:activeStatus, nsfw, hideNsfw });
  const grouping = searching && selectedSources(source).length > 1;
  const effectiveSort = searching && sort==='source' ? 'universal' : (!searching && sort==='universal' ? 'source' : sort);
  const libraryKeySet = new Set((library || []).map(identity));
  const watchedKeySet = new Set([
    ...(progress || []).map(entry=>entry?.key || (entry?.item ? identity(entry.item) : '')),
    ...(history || []).map(entry=>entry?.item ? identity(entry.item) : ''),
  ].filter(Boolean));
  const sortedItems = effectiveSort==='for-you'
    ? recommendTitles(filteredItems, { library, history, progress, libraryMeta }, { limit:filteredItems.length, excludeLibrary:false, excludeWatched:false })
    : effectiveSort==='universal'
      ? rankUniversalResults(filteredItems, query, { libraryKeys:libraryKeySet, watchedKeys:watchedKeySet })
      : sortBrowseTitles(filteredItems, effectiveSort);
  const visibleGroups = grouping
    ? groupUniversalResults(sortedItems, { query, links:sourceMatches, categoryOf:sourceCategory, libraryKeys:libraryKeySet, watchedKeys:watchedKeySet, preserveOrder:true })
      .filter(group=>{
        if(savedFilter==='all') return true;
        const anySaved = group.variants.some(has);
        return savedFilter==='saved' ? anySaved : !anySaved;
      })
    : [];
  const visibleItems = grouping
    ? visibleGroups.flatMap(group=>group.variants)
    : (savedFilter==='all' ? sortedItems : sortedItems.filter(item=>savedFilter==='saved' ? has(item) : !has(item)));
  const hiddenCount = data.items.length - visibleItems.length;
  const activeFilterCount = [!!activeGenre, !!activeYear, activeStatus!=='all', nsfw!=='all', savedFilter!=='all'].filter(Boolean).length;
  const clearFilters = ()=>{setStatus('all');setGenre('');setYear('');setNsfw('all');setSavedFilter('all');};
  const moreButton = data.more && <div className="more-wrap"><button className="btn secondary" onClick={more} disabled={data.loading||data.loadingMore}>{data.loadingMore?<LoaderCircle className="spin" size={16}/>:null} Load more <ChevronRight size={16}/></button></div>;
  const extraValue=['all','sogo','xin'].includes(source)?'':source;
  return <div className="content page-content"><div className="page-heading"><div><div className="eyebrow">SOMETHING FOR EVERY MOOD</div><h1>Find your next favorite<span>.</span></h1><p>Search across your sources or just see where the story takes you.</p></div><div className="heading-art"><Compass size={35}/><span>✦</span></div></div>
    <form className="browse-search" onSubmit={e=>{e.preventDefault();const clean=draft.trim();if(submitSearch)submitSearch(clean,source);else setQuery(clean);}}><Search size={20}/><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Search titles, adventures, worlds..." aria-label="Search titles"/><button className="btn primary" type="submit">Search <ArrowRight size={15}/></button></form>
    <SearchCentrePanel searchCentre={searchCentre} currentQuery={draft} currentSource={source} onRun={(value,src)=>{setDraft(value);if(submitSearch)submitSearch(value,src);else{setSource(src);setQuery(value);}}} onSave={saveCurrentSearch} onRemoveSaved={removeSavedSearchEntry} onClearHistory={clearSearchHistoryEntries}/>
    <div className="filter-row source-filter-row"><div className="browse-source-controls"><div className="tabs" role="group" aria-label="Filter by source">{[['all','All sources'],['sogo','AnimeSogo'],['xin','AnimeXin']].map(([id,label])=><button key={id} className={source===id?'selected':''} aria-pressed={source===id} onClick={()=>setSource(id)}>{id!=='all'&&<i className={'tab-dot '+id}/>} {label}</button>)}</div><label className="source-select"><span className="sr-only">More sources</span><select aria-label="More sources" value={extraValue} onChange={e=>setSource(e.target.value || 'all')}><option value="">More sources…</option><option value="anime">All Anime sources</option><option value="donghua">All Donghua sources</option>{['Anime','Donghua'].map(category=><optgroup key={category} label={category}>{Object.values(SOURCES).filter(x=>x.category===category && !['sogo','xin'].includes(x.id)).map(src=><option key={src.id} value={src.id}>{src.name}</option>)}</optgroup>)}</select></label></div><span className="results-label">{data.loading&&!data.items.length?'LOOKING FOR STORIES':`${grouping?`${visibleGroups.length} SHOWS · ${visibleItems.length} SOURCE LISTINGS`:`${visibleItems.length} TITLES SHOWN`}${hiddenCount>0?` · ${hiddenCount} HIDDEN BY FILTERS`:''}${data.loading?' · LOADING':''}`}</span></div>
    <div className="status-filter"><span className="status-filter-label">STATUS</span>{query ? <button className="text-link muted" onClick={()=>{setQuery('');setDraft('')}}>Clear search to filter by status, genre or year <X size={14}/></button> : <div className="tabs status-tabs" role="group" aria-label="Filter by status">{[['all','All statuses'],['ongoing','Ongoing'],['completed','Completed'],['upcoming','Upcoming']].map(([id,label])=><button key={id} className={status===id?'selected':''} aria-pressed={status===id} onClick={()=>setStatus(id)}>{label}</button>)}</div>}</div>
    <div className="browse-filters">
      <div className="filter-field genre-field"><span className="status-filter-label" id="genre-filter-label">GENRE</span><div className="tabs genre-tabs" role="group" aria-labelledby="genre-filter-label"><button className={!genre?'selected':''} aria-pressed={!genre} disabled={searching} onClick={()=>setGenre('')}>All genres</button>{GENRES.map(name=><button key={name} className={genre===name?'selected':''} aria-pressed={genre===name} disabled={searching} onClick={()=>setGenre(genre===name?'':name)}>{name}</button>)}</div></div>
      <div className="filter-field-row">
        <label className="filter-field year-field"><span className="status-filter-label">YEAR</span><select aria-label="Filter by year" value={year} disabled={searching} onChange={e=>setYear(e.target.value)}><option value="">All years</option>{BROWSE_YEARS.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
        <div className="filter-field content-field"><span className="status-filter-label" id="content-filter-label">CONTENT</span>{hideNsfw ? <div className="nsfw-hidden-note"><EyeOff size={14}/><span>NSFW is turned off in Settings.</span>{openSettings&&<button className="text-link" onClick={openSettings}>Change</button>}</div> : <div className="tabs status-tabs" role="group" aria-labelledby="content-filter-label">{[['all','All content'],['safe','Safe only'],['only','NSFW only']].map(([id,label])=><button key={id} className={nsfw===id?'selected':''} aria-pressed={nsfw===id} onClick={()=>setNsfw(id)}>{label}</button>)}</div>}</div>
        {activeFilterCount>0&&<button className="text-link muted clear-filters" onClick={clearFilters}><X size={14}/> Clear filters</button>}
      </div>
      <div className="filter-field-row browse-result-tools">
        <div className="filter-field saved-field"><span className="status-filter-label" id="saved-filter-label">SHOW</span><div className="tabs status-tabs" role="group" aria-labelledby="saved-filter-label">{[['all','All titles'],['saved','Saved'],['not-saved','Not saved']].map(([id,label])=><button key={id} className={savedFilter===id?'selected':''} aria-pressed={savedFilter===id} onClick={()=>setSavedFilter(id)}>{label}</button>)}</div></div>
        <label className="filter-field browse-sort-field"><span className="status-filter-label">SORT LOADED RESULTS</span><select aria-label="Sort loaded results" value={effectiveSort} onChange={e=>setSort(e.target.value)}><option value="universal">Best match</option><option value="source">Source order</option><option value="for-you">For you</option><option value="title-az">Title A–Z</option><option value="title-za">Title Z–A</option><option value="year-desc">Newest year</option><option value="year-asc">Oldest year</option><option value="status">Status</option><option value="source-title">Source, then title</option></select></label>
      </div>
      <p className="filter-hint">Genre and year use each source’s own listings where available; sources without them are noted below. Sorting and the saved-title view organize the stories already loaded below, so use Load more to bring in additional source results. Cards show the age rating a source provides, or NR when it provides none.{grouping&&' Universal Search groups likely versions of the same show for display; grouping never links watched progress by itself.'}</p>
    </div>
    <div className="browse-title"><div><span className="eyebrow">{grouping?'UNIVERSAL SEARCH':query?'SEARCH RESULTS':activeFilterCount>0||hideNsfw?'FILTERED CATALOG':'THE LATEST'}</span><h2>{query?`Results for “${query}”`:activeGenre?`${activeGenre} titles`:'Explore the catalog'}</h2></div><SlidersHorizontal size={17}/></div>
    {data.errors.length>0&&<div className="inline-error"><AlertCircle size={16}/> Some sources could not be reached or do not support this filter: {data.errors.map(sourceName).join(', ')}.</div>}
    {data.loading && !data.items.length ? <div className="anime-grid">{Array.from({length:12}).map((_,i)=><div className="skeleton-card" key={i}><div className="skeleton shimmer"/><span className="skeleton shimmer"/><span className="skeleton shimmer"/></div>)}</div> : visibleItems.length ? <><div className="anime-grid">{grouping ? visibleGroups.map((group,i)=><AnimeCard key={group.id} item={group.item} index={i} onOpen={open} inLibrary={has(group.item)} toggle={toggle} personalMeta={libraryMetaFor(libraryMeta,group.item)} sourceVariants={group.variants}/>) : visibleItems.map((item,i)=><AnimeCard key={identity(item)} item={item} index={i} onOpen={open} inLibrary={has(item)} toggle={toggle} personalMeta={libraryMetaFor(libraryMeta,item)}/>)}</div>{moreButton}</> : data.items.length ? <><Empty icon={hideNsfw?EyeOff:SlidersHorizontal} title="No titles match these filters" body={hideNsfw?'Everything loaded so far is hidden by your filters, or marked NSFW while NSFW is turned off in Settings. Load more titles or clear a filter.':'Everything loaded so far is filtered out. Load more titles from the sources, or clear a filter to see more.'} action={activeFilterCount>0?clearFilters:undefined} actionLabel="Clear filters"/>{moreButton}</> : <Empty icon={Search} title={query?'No titles found':'Nothing to show yet'} body={query?'Try a different title or select another source.':'The source may be unavailable. Try refreshing.'} action={()=>{setQuery('');setDraft('');setSource('all');clearFilters();}} actionLabel="Browse everything"/>}
  </div>;
}
function PersonalShelf({ item, meta, inLibrary, onChange, watchedCount = 0, total = 0 }) {
  const record = meta || { rating:0, note:'', status:'', updatedAt:0 };
  const [note,setNote] = useState(record.note || '');
  useEffect(()=>setNote(record.note || ''),[item.source,item.url]);
  const hasRecord = !!(record.rating || record.status || record.note?.trim());
  const noteChanged = note.trim() !== (record.note || '').trim();
  const saveNote = event => {
    event.preventDefault();
    onChange?.(item,{ note:note.trim() });
  };
  const clearShelf = () => {
    setNote('');
    onChange?.(item,{ rating:0, status:'', note:'' });
  };
  return <section className="personal-shelf" aria-labelledby="personal-shelf-title">
    <div className="personal-shelf-heading"><div><span className="eyebrow">YOUR SHELF</span><h2 id="personal-shelf-title">Make it yours</h2><p>{inLibrary?'Your rating, shelf status and note stay with this saved title.':'Add a rating, shelf status or note and Mikozora will save this title to your library automatically.'}</p></div>{total>0&&<span className="personal-progress">{watchedCount}/{total} watched</span>}</div>
    <div className="personal-shelf-controls">
      <div className="personal-field"><span className="status-filter-label" id="personal-rating-label">YOUR RATING</span><div className="star-rating" role="group" aria-labelledby="personal-rating-label">{[1,2,3,4,5].map(value=><button key={value} type="button" className={record.rating>=value?'selected':''} aria-pressed={record.rating===value} aria-label={record.rating===value?`Clear ${value}-star rating`:`Rate ${value} of 5 stars`} title={record.rating===value?'Clear rating':`${value} of 5 stars`} onClick={()=>onChange?.(item,{rating:record.rating===value?0:value})}><Star size={19} fill={record.rating>=value?'currentColor':'none'}/></button>)}</div></div>
      <label className="personal-field"><span className="status-filter-label">SHELF STATUS</span><select aria-label="Your shelf status" value={record.status || ''} onChange={event=>onChange?.(item,{status:event.target.value})}><option value="">No shelf status</option>{PERSONAL_STATUSES.map(status=><option key={status.id} value={status.id}>{status.label}</option>)}</select></label>
    </div>
    <form className="personal-note" onSubmit={saveNote}>
      <label className="status-filter-label" htmlFor="personal-note">PRIVATE NOTE</label>
      <textarea id="personal-note" value={note} onChange={event=>setNote(event.target.value.slice(0,600))} maxLength={600} rows={3} placeholder="Why this one? Where did you stop? Who recommended it?"/>
      <div className="personal-note-actions"><span>{note.length}/600</span><button className="btn secondary" type="submit" disabled={!noteChanged}>Save note</button>{hasRecord&&<button className="text-link muted" type="button" onClick={clearShelf}>Clear shelf</button>}</div>
    </form>
  </section>;
}
function SourceVersionsPanel({ item, openItem, linkedItems = [], onLink, onUnlink, notify, hideNsfw = false }) {
  const [candidates,setCandidates]=useState([]);
  const [candidateErrors,setCandidateErrors]=useState([]);
  const [searching,setSearching]=useState(false);
  const [searched,setSearched]=useState(false);
  const requestRef=useRef(0);
  const linkedKeys=new Set((linkedItems || []).filter(candidate=>candidate?.source&&candidate?.url).map(identity));
  useEffect(()=>{
    requestRef.current++;
    setCandidates([]);
    setCandidateErrors([]);
    setSearching(false);
    setSearched(false);
  },[item?.source,item?.url]);

  const findVersions=async()=>{
    if(searching || !item?.source || !item?.url) return;
    const request=++requestRef.current;
    const category=sourceCategory(item);
    const sourceIds=Object.values(SOURCES)
      .filter(source=>source.id!==item.source && (!category || source.category===category))
      .map(source=>source.id);
    const found=new Map();
    const failed=new Set();
    const bestBySource=new Map();
    const remember=candidate=>{
      if(!candidate?.source || !candidate?.url) return;
      const key=identity(candidate);
      if(key===identity(item)) return;
      if(!found.has(key)) found.set(key,candidate);
      const match=scoreTitleMatch(item,candidate,{categoryOf:sourceCategory});
      bestBySource.set(candidate.source,Math.max(bestBySource.get(candidate.source)||0,match.score));
    };
    setSearching(true);
    setSearched(true);
    setCandidateErrors([]);
    try {
      for(const searchQuery of titleVariantQueries(item)) {
        const targets=sourceIds.filter(sourceId=>(bestBySource.get(sourceId)||0)<70);
        if(!targets.length) break;
        const results=await Promise.allSettled(targets.map(sourceId=>getCatalog(sourceId,{query:searchQuery,page:1,status:'all',genre:'',year:''})));
        if(request!==requestRef.current) return;
        results.forEach((result,index)=>{
          const sourceId=targets[index];
          if(result.status==='rejected') failed.add(sourceId);
          else {
            failed.delete(sourceId);
            (result.value?.items || []).forEach(remember);
          }
        });
      }
      const ranked=[...found.values()]
        .map(candidate=>({item:candidate,match:scoreTitleMatch(item,candidate,{categoryOf:sourceCategory})}))
        .filter(entry=>entry.match.score>=SOURCE_MATCH_CANDIDATE_THRESHOLD && (!hideNsfw || !isNsfw(entry.item)))
        .sort((a,b)=>b.match.score-a.match.score || a.item.title.localeCompare(b.item.title) || sourceName(a.item.source).localeCompare(sourceName(b.item.source)))
        .slice(0,12);
      if(request!==requestRef.current) return;
      setCandidates(ranked);
      setCandidateErrors([...failed]);
      if(!ranked.length && failed.size===sourceIds.length) notify?.('No other source could be searched right now');
    } finally {
      if(request===requestRef.current) setSearching(false);
    }
  };

  const confirmLink=candidate=>{
    if(window.confirm(`Link the ${sourceName(candidate.source)} listing as the same show?\n\nOnly watched episode numbers will carry between these versions. Your library entries, ratings, notes and downloads will stay separate.`)) onLink?.(item,candidate);
  };
  const confirmUnlink=candidate=>{
    if(window.confirm(`Unlink the ${sourceName(candidate.source)} version?\n\nWatched numbers will no longer be shared with it through this link. Episodes already in each listing’s own history will remain there.`)) onUnlink?.(candidate);
  };
  const renderVersion=(candidate,match=null)=>{
    const linked=linkedKeys.has(identity(candidate));
    const meta=[yearOf(candidate)||'',candidate.type||'',candidate.status||''].filter(Boolean).join(' · ');
    return <div className="source-version-row" key={identity(candidate)}>
      <button className="source-version-open" type="button" onClick={()=>openItem?.(candidate)} aria-label={`Open ${candidate.title} on ${sourceName(candidate.source)}`}>
        <span className="source-version-cover"><Cover item={candidate}/></span>
        <span className="source-version-copy">
          <span className="source-version-top"><SourcePill source={candidate.source} compact/><b>{linked?'Linked version':match?`${match.confidence} match · ${match.score}%`:''}</b></span>
          <strong>{candidate.title}</strong>
          {meta&&<small>{meta}</small>}
          {match?.reasons?.length>0&&<small className="source-version-reasons">{match.reasons.join(' · ')}</small>}
        </span>
      </button>
      <div className="source-version-actions">
        <button className="btn secondary" type="button" onClick={()=>openItem?.(candidate)}>Open <ArrowUpRight size={14}/></button>
        {linked
          ? <button className="btn secondary" type="button" onClick={()=>confirmUnlink(candidate)}><Unlink size={14}/> Unlink version</button>
          : <button className="btn secondary" type="button" onClick={()=>confirmLink(candidate)}><Link2 size={14}/> Link as same show</button>}
      </div>
    </div>;
  };
  const unlinkedCandidates=candidates.filter(entry=>!linkedKeys.has(identity(entry.item)));

  return <section className="source-versions" aria-labelledby="source-versions-title">
    <div className="source-versions-heading">
      <div><span className="eyebrow">SOURCE VERSIONS</span><h2 id="source-versions-title">Find this show elsewhere</h2><p>Search the other {sourceCategory(item)||''} sources for this title. Watched episode numbers travel only after you explicitly link two listings as the same show.</p></div>
      <button className="btn secondary" type="button" onClick={findVersions} disabled={searching}>{searching?<LoaderCircle size={15} className="spin"/>:<Search size={15}/>}{searching?'Searching…':searched?'Search again':'Find on other sources'}</button>
    </div>
    {linkedItems.length>0&&<div className="source-version-group"><div className="source-version-group-label"><Link2 size={14}/> Linked for watched episode numbers</div><div className="source-version-list">{linkedItems.filter(candidate=>!hideNsfw||!isNsfw(candidate)).map(candidate=>renderVersion(candidate))}</div></div>}
    {!searched&&<p className="source-version-hint">Mikozora searches other sources only when you ask, so opening a title does not send requests everywhere.</p>}
    {candidateErrors.length>0&&<div className="inline-error source-version-error"><AlertCircle size={16}/> Some sources could not be searched: {candidateErrors.map(sourceName).join(', ')}.</div>}
    {searched&&!searching&&unlinkedCandidates.length>0&&<div className="source-version-group"><div className="source-version-group-label">Possible versions</div><div className="source-version-list">{unlinkedCandidates.map(entry=>renderVersion(entry.item,entry.match))}</div></div>}
    {searched&&!searching&&!unlinkedCandidates.length&&<p className="source-version-hint" role="status">No unlinked likely versions were found on the other sources. Titles, seasons and years can differ between listings, so a matching version may still exist under another name.</p>}
    {searching&&<p className="source-version-hint" role="status"><LoaderCircle size={14} className="spin"/> Checking the other sources…</p>}
  </section>;
}
function DetailPage({item, openEpisode, has, toggle, organize, back, history, refreshKey, queueEpisodes, downloads, showDownloads, notify, hideNsfw = false, openSettings, watched, onEpisodesReady, markWatched, smartSelection, smartEnabled, toggleSmartDownload, libraryMeta = {}, updateLibraryMeta, openItem, linkedItems = [], linkedKeys = [], watchedNumbers = new Set(), onLinkSource, onUnlinkSource, releaseRadar = {}, onReleaseRadarRule = () => {}, radarActivity = null, onlinePositions = {}, similarCandidates = [], pendingImported = null, saveShareCard = null}) {
  const [state,setState]=useState({detail:null,loading:true,error:''});
  const [order,setOrder]=useState('newest'); const [filter,setFilter]=useState(''); const [visible,setVisible]=useState(40);
  const [selecting,setSelecting]=useState(false); const [selected,setSelected]=useState([]);
  const [episodeJump,setEpisodeJump]=useState(''); const [rangeFrom,setRangeFrom]=useState(''); const [rangeTo,setRangeTo]=useState('');
  useEffect(()=>{let alive=true;setState({detail:null,loading:true,error:''});setVisible(40);setFilter('');setSelected([]);setSelecting(false);setEpisodeJump('');setRangeFrom('');setRangeTo('');getDetail(item).then(detail=>alive&&setState({detail,loading:false,error:''})).catch(e=>alive&&setState({detail:null,loading:false,error:e.message||'Could not load this title.'}));return()=>{alive=false}},[item.source,item.url,refreshKey]);
  useEffect(()=>{if(state.detail?.episodes?.length)onEpisodesReady?.(state.detail);},[state.detail]);
  const detail=state.detail || item;
  const orderedEpisodes=useMemo(()=>chronologicalEpisodes(state.detail?.episodes||[]),[state.detail]);
  const episodes=useMemo(()=>{ const sorted=order==='newest'?[...orderedEpisodes].reverse():orderedEpisodes;return filter?sorted.filter(e=>`${e.number} ${e.title}`.toLowerCase().includes(filter.toLowerCase())):sorted; },[orderedEpisodes,order,filter]);
  const effectiveWatched=useMemo(()=>{
    const set=new Set(watched || []);
    if(watchedNumbers?.size) {
      for(const episode of orderedEpisodes) if(watchedNumbers.has(episodeNumberKey(episode))) set.add(episode.url);
    }
    return set;
  },[watched,watchedNumbers,orderedEpisodes]);
  const relatedKeySet=new Set(linkedKeys?.length ? linkedKeys : [identity(item)]);
  const recent=history.find(x=>relatedKeySet.has(identity(x.item)));
  const first=orderedEpisodes[0] || null;
  const resumeKey=episodeNumberKey(recent?.episode);
  const resume=resumeKey ? (state.detail?.episodes.find(e=>episodeNumberKey(e)===resumeKey) || null) : null;
  const watchedCount=orderedEpisodes.filter(e=>effectiveWatched.has(e.url)).length;
  const nextUnwatched=firstUnwatchedEpisode(orderedEpisodes,effectiveWatched);
  const personalMeta=libraryMetaFor(libraryMeta,detail);
  const smartOn=!!smartEnabled&&!!smartSelection?.selected;
  const similar=useMemo(()=>similarTitles(detail,similarCandidates,{},{limit:12,excludeLibrary:false,excludeWatched:false}),[detail,similarCandidates]);
  const shareSeriesCard=()=>{
    if(!saveShareCard)return;
    const stats=[
      {label:'Episodes listed',value:String(orderedEpisodes.length||detail.episodeCount||'—')},
      {label:'Watched by me',value:String(watchedCount)},
      {label:'My status',value:personalMeta?.status?personalStatusLabel(personalMeta.status):'Not set'},
      {label:'My rating',value:personalMeta?.rating?`${personalMeta.rating} / 5`:'Not rated'},
    ];
    void saveShareCard({kind:'series-card',eyebrow:'MIKOZORA SERIES CARD',title:detail.title,subtitle:`${sourceName(detail.source)}${detail.status?` · ${displayStatus(detail.status)}`:''}${detail.genres?.length?` · ${detail.genres.slice(0,3).join(' · ')}`:''}`,stats});
  };
  const chooseEpisode=ep=>{
    if(!selected.includes(ep.url)&&selected.length>=50){notify('Choose up to 50 episodes in one batch');return;}
    setSelected(previous=>previous.includes(ep.url)?previous.filter(x=>x!==ep.url):[...previous,ep.url]);
  };
  const selectedEpisodes=orderedEpisodes.filter(ep=>selected.includes(ep.url));
  const jumpToEpisode=event=>{
    event.preventDefault();
    const target=findEpisodeByNumber(orderedEpisodes,episodeJump);
    if(!target){notify(episodeJump?`Episode ${episodeJump} is not in this list`:'Enter an episode number');return;}
    openEpisode(detail,target);
  };
  const markThroughEpisode=()=>{
    const target=findEpisodeByNumber(orderedEpisodes,episodeJump);
    if(!target){notify(episodeJump?`Episode ${episodeJump} is not in this list`:'Enter an episode number');return;}
    markWatched(detail,episodesThrough(orderedEpisodes,target.url),true);
  };
  const selectEpisodeRange=event=>{
    event.preventDefault();
    const range=episodesInRange(orderedEpisodes,rangeFrom,rangeTo);
    if(!range.length){notify('No numeric episodes fall in that range');return;}
    setSelecting(true);
    setSelected(range.slice(0,50).map(ep=>ep.url));
    if(range.length>50)notify('Selected the first 50 episodes in that range');
  };
  const rating=ratingOf(detail);
  const releasedYear=yearOf(detail);
  // With NSFW turned off in Settings, an adult-marked title cannot be opened at
  // all, even from the library or an update notice. Nothing is deleted.
  if (hideNsfw && isNsfw(detail)) return <div className="detail-page"><button className="back-link" onClick={back}><ChevronLeft size={17}/> Back <span>TO YOUR SPACE</span></button><div className="content page-content detail-blocked"><Empty icon={EyeOff} title="This title is hidden" body="This title is marked as NSFW (18+) content, and NSFW content is turned off in Settings. Your saved titles and downloads are unchanged; turn it back on there to view this title again." action={openSettings} actionLabel="Open content settings"/></div></div>;
  return <div className="detail-page"><button className="back-link" onClick={back}><ChevronLeft size={17}/> Back <span>TO YOUR SPACE</span></button>
    <div className="detail-banner" style={detail.banner?{backgroundImage:`linear-gradient(90deg,rgba(16,19,18,.88),rgba(16,19,18,.25)),linear-gradient(0deg,#101214,transparent 85%),url("${imageUrl(detail.banner)}")`}:undefined}><div className="banner-text">A STORY AWAITS <span>✦</span></div></div>
    <div className="detail-body"><div className="detail-intro"><div className="detail-cover"><Cover item={detail}/></div><div className="detail-copy"><div className="detail-badges"><SourcePill source={detail.source}/><span className={'plain-badge rating-badge'+(rating?.adult?' rating-badge-adult':'')} title={rating?`Age rating reported by ${sourceName(detail.source)}`:'Not rated — the source does not provide an age rating'}>{rating?rating.label:'NR'}</span>{detail.type&&<span className="plain-badge">{detail.type}</span>}{detail.status&&<span className="plain-badge">{detail.status}</span>}{releasedYear>0&&<span className="plain-badge">{releasedYear}</span>}</div><h1>{detail.title}</h1><div className="genre-line">{detail.genres?.length?detail.genres.join('  ·  '):'Anime  ·  Adventure awaits'}</div><p>{detail.synopsis || (state.loading?'Loading the story...':'A title from your selected source. Open the source page for more information.')}</p><div className="detail-actions"><button className="btn primary" disabled={!first} onClick={()=>openEpisode(detail,resume||first)}><Play size={16} fill="currentColor"/>{resume?`Continue episode ${resume.number}`:'Watch first episode'}</button><button className={'btn secondary '+(has(detail)?'is-saved':'')} onClick={()=>toggle(detail)}><Bookmark size={17} fill={has(detail)?'currentColor':'none'}/>{has(detail)?'In your library':'Add to library'}</button><button className="btn secondary organize-detail" onClick={()=>organize(detail)} aria-label={`Organize ${detail.title} in collections`}><FolderPlus size={17}/> Collections</button><button className={'btn secondary '+(smartOn?'is-saved':'')} onClick={()=>toggleSmartDownload?.(detail)} aria-pressed={smartOn} title={smartOn?'Automatically download new episodes of this series':'Automatically download new episodes of this series'}>{smartOn?<Check size={17}/> :<Download size={17}/>}{smartOn?'Smart downloads on':'Smart downloads'}</button><button className="icon-btn detail-external" onClick={()=>external(detail.url)} aria-label="Open original website" title="Open original website"><ExternalLink size={18}/></button></div>{smartOn&&<p className="smart-detail-note"><Sparkles size={14}/> New episodes will be downloaded automatically after Mikozora finds them.</p>}</div></div>
      {state.error && <div className="detail-error"><AlertCircle size={18}/><span>{state.error}</span><button onClick={()=>external(item.url)}>Open source <ExternalLink size={14}/></button></div>}
      {state.detail && <section className="detail-facts" aria-label="Source details"><div><span>STATUS</span><strong>{displayStatus(detail.status)}</strong>{detail.status && displayStatus(detail.status)!==detail.status && <small>Source: {detail.status}</small>}</div><div><span>{SOURCES[detail.source]?.category==='Donghua'?'RELEASED':'DATE AIRED'}</span><strong>{detail.aired || 'Not provided'}</strong></div><div><span>EPISODES REPORTED</span><strong>{detail.episodeCount || 'Not provided'}</strong></div><div><span>AGE RATING</span><strong>{rating ? rating.label : 'Not provided'}</strong>{rating?.adult&&<small>Marked as adult (NSFW) content</small>}{!rating&&<small>Shown as NR on cards</small>}</div><p>Reported by {sourceName(detail.source)} · Details may change.</p></section>}
      <PersonalShelf item={detail} meta={personalMeta} inLibrary={has(detail)} onChange={updateLibraryMeta} watchedCount={watchedCount} total={orderedEpisodes.length}/>
      <SourceVersionsPanel item={detail} openItem={openItem} linkedItems={linkedItems} onLink={onLinkSource} onUnlink={onUnlinkSource} notify={notify} hideNsfw={hideNsfw}/>
      <section className="detail-radar-panel" aria-label="Release Radar for this series">
        <div><span className="eyebrow">RELEASE RADAR</span><h2>Episode alerts for this series</h2><p>{radarActivity?.latestAt?`Mikozora last found a new episode ${prettyTime(radarActivity.latestAt)}.`:'No episode discoveries are recorded for this series yet.'}{radarActivity?.pattern?` Observed pattern only: new episodes were usually found about every ${radarActivity.pattern.typicalDays} day${radarActivity.pattern.typicalDays===1?'':'s'} across ${radarActivity.pattern.basedOnDays} discovery days. This is not a source-provided schedule.`:''}</p>{pendingImported?.count>0&&<p className="pending-import-note">Imported progress is waiting: {pendingImported.count} watched episode{pendingImported.count===1?'':'s'} will be applied when this episode list is available.</p>}</div>
        <ReleaseRadarRuleControls item={detail} radar={releaseRadar} onChange={onReleaseRadarRule}/>
        <p className="detail-radar-note">Rules apply when this title is followed through Favourites or a personal collection.</p>
      </section>
      <section className="detail-share-panel" aria-label="Share this series">
        <div><span className="eyebrow">SHARE CARD</span><h2>Make a series card</h2><p>Creates a local SVG image with this series and your own progress. No account or upload.</p></div>
        <button className="btn secondary" type="button" onClick={shareSeriesCard} disabled={!saveShareCard}><Sparkles size={15}/> Save series card</button>
      </section>
      {similar.length>0&&<section className="detail-similar-panel" aria-label="Similar titles"><div className="detail-similar-head"><span className="eyebrow">DISCOVERY 2.0</span><h2>Similar titles</h2><p>From titles Mikozora already knows on this device.</p></div><Rail items={similar} open={openItem} has={has} toggle={toggle} libraryMeta={libraryMeta}/></section>}
      <div className="episode-section"><div className="episode-head"><div><span className="eyebrow">THE STORY SO FAR</span><h2>Episodes <small>{state.detail?.episodes.length ?? '—'}</small>{watchedCount>0&&<small>{watchedCount} watched</small>}</h2></div><div className="episode-tools"><label className="episode-search"><Search size={15}/><input value={filter} onChange={e=>{setFilter(e.target.value);setVisible(40)}} placeholder="Find episode" aria-label="Find episode"/></label><button className="sort-button" onClick={()=>setOrder(x=>x==='newest'?'oldest':'newest')}>{order==='newest'?'Newest first':'Oldest first'} <SlidersHorizontal size={15}/></button></div></div>
      {state.detail?.source==='bash' && Number(detail.episodeCount)>detail.episodes.length && detail.episodes.length>0 && <p className="batch-hint">AnimeBash reports {detail.episodeCount} episodes but currently lists {detail.episodes.length}. Availability may vary.</p>}
      {!state.loading && orderedEpisodes.length>0 && <div className="episode-shortcuts" aria-label="Episode shortcuts">
        <button className="btn secondary episode-next-unwatched" disabled={!nextUnwatched} onClick={()=>nextUnwatched&&openEpisode(detail,nextUnwatched)}><Play size={15} fill="currentColor"/>{nextUnwatched?`Next unwatched · Episode ${nextUnwatched.number}`:'All episodes watched'}</button>
        <form className="episode-jump" onSubmit={jumpToEpisode}><label htmlFor="episode-jump-number">EPISODE #</label><input id="episode-jump-number" inputMode="decimal" value={episodeJump} onChange={event=>setEpisodeJump(event.target.value)} placeholder="e.g. 24" aria-label="Episode number to jump to"/><button className="btn secondary" type="submit">Play</button><button className="btn secondary" type="button" onClick={markThroughEpisode}>Mark through</button></form>
        <form className="episode-range" onSubmit={selectEpisodeRange}><span>SELECT RANGE</span><input inputMode="decimal" value={rangeFrom} onChange={event=>setRangeFrom(event.target.value)} placeholder="From" aria-label="Select episodes from"/><span aria-hidden="true">–</span><input inputMode="decimal" value={rangeTo} onChange={event=>setRangeTo(event.target.value)} placeholder="To" aria-label="Select episodes through"/><button className="btn secondary" type="submit">Select range</button></form>
      </div>}
      {!state.loading && episodes.length>0 && <div className="batch-tools">
        <button className="text-link" onClick={()=>{setSelecting(x=>!x);setSelected([])}}><ListChecks size={16}/>{selecting?'Cancel selection':'Select episodes'}</button>
        {selecting&&<><button className="text-link muted" onClick={()=>setSelected(episodes.slice(0,50).map(ep=>ep.url))}>{episodes.length>50?'Select first 50':'Select all matching'}</button><button className="btn primary batch-download" disabled={!selected.length} onClick={()=>queueEpisodes(detail,selectedEpisodes)}><Download size={15}/> Download {selected.length||''}</button><button className="text-link" disabled={!selected.length} onClick={()=>markWatched(detail,selectedEpisodes,true)}>Mark watched</button><button className="text-link muted" disabled={!selected.length} onClick={()=>markWatched(detail,selectedEpisodes,false)}>Mark unwatched</button></>}
        {!selecting&&<button className="text-link muted" onClick={showDownloads}>Your downloads <ArrowRight size={15}/></button>}
      </div>}
      {selecting&&<p className="batch-hint">Choose up to 50 per batch. Use Select range for a numeric run, or search and choose episodes one by one.</p>}
      {state.loading?<div className="episode-loading"><LoaderCircle className="spin" size={19}/> Fetching episodes from {sourceName(item.source)}...</div>:episodes.length ? <><div className="episode-list">{episodes.slice(0,visible).map((ep,i)=>{
        const offline=downloads.find(d=>d.episode?.url===ep.url && d.item?.source===detail.source && d.status==='completed');
        const directPosition=onlinePositionFor(onlinePositions,detail,ep);
        const seen=effectiveWatched.has(ep.url);
        return <div className={'episode-row'+(seen?' watched':'')} key={`${ep.url}-${i}`}>
          {selecting&&<input className="episode-check" type="checkbox" checked={selected.includes(ep.url)} onChange={()=>chooseEpisode(ep)} aria-label={`Select episode ${ep.number}`}/>}
          <button className="episode-open" onClick={()=>selecting?chooseEpisode(ep):openEpisode(detail,ep)}><span className="episode-number">{String(ep.number).padStart(2,'0')}</span><span className="episode-info"><strong>{ep.title}</strong><small>{ep.date || sourceName(item.source)}{ep.sub?' · SUB':''}{ep.dub?' · DUB':''}{seen?' · WATCHED':''}{offline?' · DOWNLOADED':''}{directPosition?` · RESUME ${formatPlaybackClock(directPosition.seconds)}`:''}</small></span><span className="episode-play"><Play size={14} fill="currentColor"/></span></button>
          {!selecting&&<button className={'episode-watched-toggle'+(effectiveWatched.has(ep.url)?' on':'')} onClick={()=>markWatched(detail,[ep],!effectiveWatched.has(ep.url))} aria-pressed={effectiveWatched.has(ep.url)} aria-label={effectiveWatched.has(ep.url)?`Mark episode ${ep.number} as not watched`:`Mark episode ${ep.number} as watched`} title={effectiveWatched.has(ep.url)?'Watched — tap to undo':'Mark as watched'}><Check size={15}/></button>}{!selecting&&<button className={'episode-download '+(offline?'downloaded':'')} onClick={()=>offline?showDownloads():queueEpisodes(detail,[ep])} aria-label={offline?`View downloaded episode ${ep.number}`:`Download episode ${ep.number}`} title={offline?'View download':'Download episode'}>{offline?<CheckCircle2 size={18}/>:<Download size={18}/>}</button>}
        </div>;
      })}</div>{visible<episodes.length&&<div className="more-wrap"><button className="btn secondary" onClick={()=>setVisible(x=>x+40)}>Show more episodes <ChevronRight size={16}/></button></div>}</> : !state.error&&<Empty icon={ListVideo} title="No episodes found" body="This source may have changed its layout, or there are no matching episodes." action={()=>external(item.url)} actionLabel="Open source"/>}
      </div>
    </div>
  </div>;
}
function LibraryPage({items,open,has,toggle,browse,collections,activeCollection,setActiveCollection,onCreate,onRename,onDelete,onMembers,onFavourite,unreadTitles,progressByTitle,hideNsfw = false,smartCollections = [],onSmartCollection,libraryMeta = {},onRemoveTitles,onAddTitlesToCollection,openPlanner,openStats}) {
  const [filter,setFilter]=useState('all');
  const [search,setSearch]=useState('');
  const [sort,setSort]=useState('saved');
  const [personalStatus,setPersonalStatus]=useState('all');
  const [progressFilter,setProgressFilter]=useState('all');
  const [ratingFilter,setRatingFilter]=useState('all');
  const [selectingTitles,setSelectingTitles]=useState(false);
  const [selectedTitleKeys,setSelectedTitleKeys]=useState([]);
  const [bulkCollection,setBulkCollection]=useState(FAVOURITES_ID);
  useEffect(()=>{setFilter('all');setSearch('');setPersonalStatus('all');setProgressFilter('all');setRatingFilter('all');setSelectingTitles(false);setSelectedTitleKeys([]);},[activeCollection]);
  useEffect(()=>{if(!collections.some(c=>c.id===bulkCollection))setBulkCollection(collections[0]?.id||FAVOURITES_ID);},[bulkCollection,collections]);
  const catalog = hideNsfw ? items.filter(item=>!isNsfw(item)) : items;
  const keys = new Set(catalog.map(identity));
  const selected = collections.find(c=>c.id===activeCollection);
  const selectedKeys = new Set(selected?.items || []);
  const inCollection = activeCollection==='all' ? catalog : catalog.filter(x=>selectedKeys.has(identity(x)));
  const stats = libraryStats(catalog,progressByTitle,libraryMeta);
  const searchTerm = search.trim().toLocaleLowerCase();
  const filtered = inCollection.filter(item=>{
    if(filter!=='all'&&item.source!==filter)return false;
    if(searchTerm&&!`${item.title} ${sourceName(item.source)}`.toLocaleLowerCase().includes(searchTerm))return false;
    const meta=libraryMetaFor(libraryMeta,item);
    if(personalStatus==='unset'&&meta.status)return false;
    if(personalStatus!=='all'&&personalStatus!=='unset'&&meta.status!==personalStatus)return false;
    if(progressFilter!=='all'&&libraryProgressState(progressByTitle?.[identity(item)])!==progressFilter)return false;
    if(ratingFilter==='rated'&&!meta.rating)return false;
    if(ratingFilter==='unrated'&&meta.rating)return false;
    if(ratingFilter==='high'&&meta.rating<4)return false;
    if(ratingFilter==='five'&&meta.rating!==5)return false;
    return true;
  });
  const list = sortLibraryTitles(filtered,sort,progressByTitle,libraryMeta);
  const libraryFiltersActive = filter!=='all'||!!searchTerm||personalStatus!=='all'||progressFilter!=='all'||ratingFilter!=='all';
  const clearLibraryFilters = ()=>{setFilter('all');setSearch('');setPersonalStatus('all');setProgressFilter('all');setRatingFilter('all');};
  const selectedTitles = catalog.filter(item=>selectedTitleKeys.includes(identity(item)));
  const toggleTitleSelection = item=>{
    const key=identity(item);
    setSelectedTitleKeys(previous=>previous.includes(key)?previous.filter(x=>x!==key):[...previous,key]);
  };
  const favourites = new Set(collections.find(c=>c.id===FAVOURITES_ID)?.items || []);
  const count = c=>c.items.filter(key=>keys.has(key)).length;
  return <div className="content page-content library-page">
    <div className="page-heading"><div><div className="eyebrow">YOUR LITTLE CORNER</div><h1>Saved for later<span>.</span></h1><p>Keep your stories together, just the way you like. Saved on this device.</p></div><div className="heading-art"><Bookmark size={31}/><span>✦</span></div></div>
    {catalog.length>0&&<section className="library-stats" aria-label="Library overview">
      <div><strong>{stats.titles}</strong><span>saved titles</span></div>
      <div><strong>{stats.inProgress}</strong><span>in progress</span></div>
      <div><strong>{stats.caughtUp}</strong><span>caught up</span></div>
      <div><strong>{stats.watchedEpisodes}</strong><span>watched episodes</span></div>
      <div><strong>{stats.rated}</strong><span>rated by you</span></div>
      <div><strong>{stats.withNotes}</strong><span>with notes</span></div>
    </section>}
    {catalog.length>0&&<div className="library-insight-actions"><button className="btn secondary" onClick={openPlanner}><CalendarClock size={15}/> Catch-Up Planner</button><button className="btn secondary" onClick={openStats}><Flame size={15}/> Watch Stats &amp; Wrapped</button></div>}
    <div className="collections-heading"><div><span className="eyebrow">MADE BY YOU</span><h2>Your collections</h2></div><button className="btn secondary new-collection" onClick={onCreate}><Plus size={16}/> New collection</button></div>
    <div className="collection-tabs" role="tablist" aria-label="Library collections">
      <button role="tab" aria-selected={activeCollection==='all'} className={'collection-tab '+(activeCollection==='all'?'selected':'')} onClick={()=>setActiveCollection('all')}><Bookmark size={15}/> <span>All titles</span><b>{catalog.length}</b></button>
      {collections.map(c=><button key={c.id} role="tab" aria-selected={activeCollection===c.id} className={'collection-tab '+(activeCollection===c.id?'selected':'')} onClick={()=>setActiveCollection(c.id)}>{c.id===FAVOURITES_ID?<Heart size={15}/>:<Folder size={15}/>} <span>{c.name}</span><b>{count(c)}</b></button>)}
    </div>
    <div className="collection-toolbar"><div><span className="eyebrow">YOUR LIBRARY</span><h2>{selected?.name || 'All titles'}</h2><p>{inCollection.length} {inCollection.length===1?'title':'titles'} · {activeCollection==='all'?'All saved stories':'A collection of saved stories'}</p></div>
      {selected&&<div className="collection-tools"><button className={'btn secondary '+(smartCollections.includes(selected.id)?'is-saved':'')} onClick={()=>onSmartCollection?.(selected)} aria-pressed={smartCollections.includes(selected.id)} title={`Automatically download new episodes for ${selected.name}`}>{smartCollections.includes(selected.id)?<Check size={15}/> :<Download size={15}/>} Smart downloads</button><button className="btn secondary" onClick={()=>onMembers(selected.id)} disabled={!catalog.length}><Plus size={15}/> Add titles</button>{selected.id!==FAVOURITES_ID&&<><button className="icon-btn" onClick={()=>onRename(selected.id)} aria-label={`Rename ${selected.name}`} title="Rename collection"><Pencil size={16}/></button><button className="icon-btn" onClick={()=>onDelete(selected.id)} aria-label={`Delete ${selected.name}`} title="Delete collection"><Trash2 size={16}/></button></>}</div>}
    </div>
    <div className="library-tools" aria-label="Library tools">
      <label className="library-search"><Search size={16}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search your library" aria-label="Search your library"/></label>
      <label className="library-tool-field"><span>SORT</span><select aria-label="Sort library" value={sort} onChange={event=>setSort(event.target.value)}><option value="saved">Saved order</option><option value="title-az">Title A–Z</option><option value="title-za">Title Z–A</option><option value="progress-desc">Most progress</option><option value="unwatched-desc">Most unwatched</option><option value="rating-desc">Highest personal rating</option><option value="year-desc">Newest year</option><option value="year-asc">Oldest year</option></select></label>
      <label className="library-tool-field"><span>SHELF STATUS</span><select aria-label="Filter library by shelf status" value={personalStatus} onChange={event=>setPersonalStatus(event.target.value)}><option value="all">All shelf statuses</option><option value="unset">No shelf status</option>{PERSONAL_STATUSES.map(status=><option key={status.id} value={status.id}>{status.label}</option>)}</select></label>
      <label className="library-tool-field"><span>PROGRESS</span><select aria-label="Filter library by progress" value={progressFilter} onChange={event=>setProgressFilter(event.target.value)}><option value="all">All progress</option><option value="not-started">Not started</option><option value="in-progress">In progress</option><option value="caught-up">Caught up</option></select></label>
      <label className="library-tool-field"><span>YOUR RATING</span><select aria-label="Filter library by your rating" value={ratingFilter} onChange={event=>setRatingFilter(event.target.value)}><option value="all">All ratings</option><option value="high">4–5 stars</option><option value="five">5 stars</option><option value="rated">Rated</option><option value="unrated">Unrated</option></select></label>
      <button className={'btn secondary library-select-toggle '+(selectingTitles?'is-saved':'')} onClick={()=>{setSelectingTitles(value=>!value);setSelectedTitleKeys([]);}} aria-pressed={selectingTitles}><ListChecks size={15}/>{selectingTitles?'Done selecting':'Select titles'}</button>
      {libraryFiltersActive&&<button className="text-link muted library-clear-filters" onClick={clearLibraryFilters}><X size={14}/> Clear library filters</button>}
    </div>
    {selectingTitles&&<div className="library-bulk-bar" aria-label="Bulk library actions">
      <strong>{selectedTitles.length} selected</strong>
      <label><span>Add to</span><select aria-label="Collection for selected titles" value={bulkCollection} onChange={event=>setBulkCollection(event.target.value)}>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <button className="btn secondary" disabled={!selectedTitles.length||!bulkCollection} onClick={()=>{onAddTitlesToCollection?.(bulkCollection,selectedTitles);setSelectedTitleKeys([]);}}><FolderPlus size={15}/> Add to collection</button>
      <button className="text-link danger-link" disabled={!selectedTitles.length} onClick={()=>{if(onRemoveTitles?.(selectedTitles))setSelectedTitleKeys([]);}}><Trash2 size={14}/> Remove from library</button>
      <button className="text-link muted" disabled={!selectedTitles.length} onClick={()=>setSelectedTitleKeys([])}>Clear selection</button>
    </div>}
    <div className="filter-row library-filters"><div className="tabs" role="group" aria-label="Filter library by source">{[['all','All sources'],...Object.values(SOURCES).filter(src=>inCollection.some(item=>item.source===src.id)).map(src=>[src.id,src.name])].map(([id,label])=><button key={id} className={filter===id?'selected':''} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div><span className="results-label">{list.length} {list.length===1?'TITLE':'TITLES'} SHOWN</span></div>
    {list.length ? <div className="anime-grid">{list.map((item,i)=>{
        const key=identity(item);
        const chosen=selectedTitleKeys.includes(key);
        return <div className={'library-card-wrap'+(chosen?' selected':'')} key={key}>
          {selectingTitles&&<label className="library-card-select"><input type="checkbox" checked={chosen} onChange={()=>toggleTitleSelection(item)} aria-label={`Select ${item.title}`}/><span>{chosen?'Selected':'Select'}</span></label>}
          <AnimeCard item={item} index={i} onOpen={open} inLibrary={has(item)} toggle={toggle} favourite={favourites.has(key)} onFavourite={onFavourite} newCount={unreadTitles[key]||0} progress={progressByTitle?.[key]||null} personalMeta={libraryMetaFor(libraryMeta,item)}/>
        </div>;
      })}</div> :
      hideNsfw && items.length>0 && catalog.length===0 ? <Empty icon={EyeOff} title="Adult titles are hidden" body="Every saved title is currently hidden because NSFW content is turned off in Settings. Nothing has been removed from your library."/> :
      items.length && activeCollection!=='all' && inCollection.length===0 ? <Empty icon={FolderHeart} title={`Nothing in ${selected?.name || 'this collection'} yet`} body="Add stories you have already saved, or organize a title from its details page." action={()=>onMembers(activeCollection)} actionLabel="Add saved titles"/> :
      items.length && inCollection.length>0 && libraryFiltersActive ? <Empty icon={SlidersHorizontal} title="No titles match these library filters" body="Try a different search, shelf status, progress view, rating or source. Nothing has been removed from your library." action={clearLibraryFilters} actionLabel="Clear library filters"/> :
      <Empty icon={FolderHeart} title={items.length?'No titles from this source yet':'Your library is waiting'} body={items.length?'Pick another source to see the rest of your saved stories.':'Save an anime or donghua to keep it close. Your library and collections stay on this device.'} action={()=>browse('all')} actionLabel="Find something to watch"/>}
  </div>;
}
function DialogFrame({title,subtitle,close,children}) {
  return <div className="modal-backdrop" onClick={close}><section className="collection-dialog" role="dialog" aria-modal="true" aria-labelledby="collection-dialog-title" onClick={e=>e.stopPropagation()}>
    <div className="player-header"><div><span className="eyebrow">YOUR LIBRARY</span><h2 id="collection-dialog-title">{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="icon-btn" onClick={close} aria-label="Close"><X size={18}/></button></div>{children}
  </section></div>;
}
function CollectionNameDialog({value='',editing=false,close,submit}) {
  const [name,setName]=useState(value);const [error,setError]=useState('');
  const save=e=>{e.preventDefault();const message=submit(name);if(message)setError(message)};
  return <DialogFrame title={editing?'Rename collection':'New collection'} subtitle="Choose a name for your saved stories." close={close}>
    <form className="collection-dialog-body" onSubmit={save}><label className="collection-input-label" htmlFor="collection-name">COLLECTION NAME</label><input id="collection-name" className="collection-input" value={name} onChange={e=>{setName(e.target.value);setError('')}} maxLength={40} placeholder="For example, Weekend watches" autoFocus/>{error&&<p className="collection-error" role="alert">{error}</p>}<div className="collection-dialog-actions"><button type="button" className="btn secondary" onClick={close}>Cancel</button><button className="btn primary" type="submit">{editing?'Save name':'Create collection'}</button></div></form>
  </DialogFrame>;
}
function TitleCollectionsDialog({item,collections,close,submit}) {
  const [selected,setSelected]=useState(()=>new Set(collections.filter(c=>c.items.includes(identity(item))).map(c=>c.id)));
  const change=id=>setSelected(previous=>{const next=new Set(previous);next.has(id)?next.delete(id):next.add(id);return next});
  return <DialogFrame title="Add to collections" subtitle={item.title} close={close}>
    <div className="collection-dialog-body"><p className="collection-help">Select any collections. Choosing one also saves this title to All titles.</p><div className="collection-choice-list">{collections.map(c=><label className="collection-choice" key={c.id}><span className="collection-choice-icon">{c.id===FAVOURITES_ID?<Heart size={17}/>:<Folder size={17}/>}</span><span><strong>{c.name}</strong><small>{c.items.length} {c.items.length===1?'title':'titles'}</small></span><input type="checkbox" checked={selected.has(c.id)} onChange={()=>change(c.id)} aria-label={c.name}/></label>)}</div><p className="collection-hint">Create or manage collections in your Library.</p><div className="collection-dialog-actions"><button className="btn secondary" onClick={close}>Cancel</button><button className="btn primary" onClick={()=>submit([...selected])}>Save changes</button></div></div>
  </DialogFrame>;
}
function CollectionMembersDialog({collection,items,close,submit}) {
  const [selected,setSelected]=useState(()=>new Set(collection.items.filter(key=>items.some(item=>identity(item)===key))));
  const [search,setSearch]=useState('');
  const change=key=>setSelected(previous=>{const next=new Set(previous);next.has(key)?next.delete(key):next.add(key);return next});
  const visible=items.filter(item=>item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <DialogFrame title={`Edit ${collection.name}`} subtitle="Select or remove saved titles. Downloads are not affected." close={close}>
    <div className="collection-dialog-body"><label className="collection-search"><Search size={16}/><input aria-label="Find saved titles" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a saved title"/></label><div className="collection-choice-list title-picker-list">{visible.length?visible.map(item=><label className="collection-choice title-choice" key={identity(item)}><span className="collection-mini-cover"><Cover item={item}/></span><span><strong>{item.title}</strong><small>{sourceName(item.source)}</small></span><input type="checkbox" checked={selected.has(identity(item))} onChange={()=>change(identity(item))} aria-label={`Select ${item.title}`}/></label>):<p className="collection-help">No saved titles match your search.</p>}</div><p className="collection-hint">{selected.size} selected · Changes only affect this collection.</p><div className="collection-dialog-actions"><button className="btn secondary" onClick={close}>Cancel</button><button className="btn primary" onClick={()=>submit([...selected])}>Save changes</button></div></div>
  </DialogFrame>;
}
function bytesLabel(n) {
  if(!n || n<0)return '';
  if(n<1024*1024)return `${Math.max(1,Math.round(n/1024))} KB`;
  if(n<1024*1024*1024)return `${(n/1024/1024).toFixed(1)} MB`;
  return `${(n/1024/1024/1024).toFixed(2)} GB`;
}
function DownloadModal({request,close,submit}) {
  const englishOnly=['sogo','suge','anikoto','rulz','waves','bash'].includes(request.item.source);
  const sourceControlled=!englishOnly && request.item.source!=='xin';
  const initialChoice=request.initialChoice||{language:request.language||'english',server:request.serverChoice||'auto',quality:request.qualityChoice||'best',subtitleMode:request.subtitleMode||'auto',subtitleTracks:Array.isArray(request.subtitleSelection)?request.subtitleSelection:[]};
  const [language,setLanguage]=useState(englishOnly||sourceControlled?'english':initialChoice.language||'english');const [server,setServer]=useState('auto');const [quality,setQuality]=useState('best');
  const presetApplied=useRef(false);
  const [subtitleMode,setSubtitleMode]=useState('auto');const [subtitleSelection,setSubtitleSelection]=useState(()=>new Set());
  const [working,setWorking]=useState(false);const [attempt,setAttempt]=useState(0);
  const [options,setOptions]=useState({loading:true,servers:[],unavailable:0,error:''});
  const count=request.episodes.length, sample=request.episodes[0];
  useEffect(()=>{
    let alive=true;
    if(!hasNativeDownloads()){setOptions({loading:false,servers:[],unavailable:0,error:''});return()=>{alive=false}};
    setOptions({loading:true,servers:[],unavailable:0,error:''});
    const timer=setTimeout(()=>getDownloadOptions(request.item,sample,language).then(value=>{
      if(alive)setOptions({loading:false,servers:Array.isArray(value.servers)?value.servers:[],unavailable:Number(value.unavailable)||0,error:''});
    }).catch(e=>{if(alive)setOptions({loading:false,servers:[],unavailable:0,error:e.message||'Could not check server qualities. You can retry or use Automatic.'})}),180);
    return()=>{alive=false;clearTimeout(timer)};
  },[request.item.source,sample.url,sample.ids,language,attempt]);
  useEffect(()=>{
    if(options.loading||presetApplied.current||!request.initialChoice||options.error)return;
    presetApplied.current=true;
    const wanted=initialChoice.server||'auto';
    if(wanted==='auto')return;
    const match=options.servers.find(x=>x.id===wanted);
    if(!match)return;
    changeServer(wanted);
    const qualities=Array.isArray(match.qualities)?match.qualities:[];
    if(initialChoice.quality&&qualities.some(x=>x.id===initialChoice.quality))setQuality(initialChoice.quality);
  },[options.loading,options.servers]);
  const chosen=options.servers.find(x=>x.id===server);
  const qualityOptions=chosen?.qualities?.length?chosen.qualities:[{id:'best',label:'Best available (HLS up to 1080p)'}];
  const subtitleOptions=Array.isArray(chosen?.subtitles)?chosen.subtitles.filter(x=>x?.id&&x?.label):[];
  const selectedSubtitleTracks=subtitleMode==='custom'?subtitleOptions.filter(x=>subtitleSelection.has(x.id)).map(({id,label,language:trackLanguage})=>({id,label,language:trackLanguage||'und'})):[];
  const subtitleInvalid=subtitleMode==='custom'&&!selectedSubtitleTracks.length;
  async function confirm(){if(subtitleInvalid)return;setWorking(true);try{await submit({language,server,quality,subtitleMode,subtitleTracks:selectedSubtitleTracks})}finally{setWorking(false)}}
  function changeLanguage(value){setLanguage(value);setServer('auto');setQuality('best');setSubtitleMode('auto');setSubtitleSelection(new Set())}
  function changeServer(value){
    setServer(value);setQuality('best');
    if(value==='auto'){setSubtitleMode('auto');setSubtitleSelection(new Set());return;}
    const next=options.servers.find(x=>x.id===value), reported=Array.isArray(next?.subtitles)?next.subtitles:[];
    const defaults=new Set(reported.filter(x=>x.defaultSelected).map(x=>x.id));
    const available=new Set(reported.map(x=>x.id));
    const prior=initialChoice.server===value&&Array.isArray(initialChoice.subtitleTracks)?initialChoice.subtitleTracks.map(x=>x?.id).filter(id=>available.has(id)):[];
    if(initialChoice.server===value&&initialChoice.subtitleMode==='custom'&&prior.length){setSubtitleMode('custom');setSubtitleSelection(new Set(prior));}
    else if(initialChoice.server===value&&initialChoice.subtitleMode==='none'){setSubtitleMode('none');setSubtitleSelection(defaults);}
    else{setSubtitleMode('auto');setSubtitleSelection(defaults);}
  }
  function chooseSubtitleMode(value){
    setSubtitleMode(value);
    if(value==='custom'&&![...subtitleSelection].some(id=>subtitleOptions.some(x=>x.id===id)))setSubtitleSelection(new Set(subtitleOptions.filter(x=>x.defaultSelected).map(x=>x.id)));
  }
  function toggleSubtitle(id){setSubtitleSelection(previous=>{const next=new Set(previous);next.has(id)?next.delete(id):next.add(id);return next;})}
  return <div className="modal-backdrop" onMouseDown={close}><div className="download-modal" role="dialog" aria-modal="true" aria-label="Download episodes" onMouseDown={e=>e.stopPropagation()}>
    <div className="player-header"><div><span className="eyebrow">SAVE FOR OFFLINE</span><h2>{count===1?`Download episode ${sample.number}`:`Download ${count} episodes`}</h2><p>{request.item.title} · {sourceName(request.item.source)}</p></div><button className="icon-btn" onClick={close} aria-label="Close download dialog"><X size={20}/></button></div>
    <div className="download-dialog-body">{request.initialChoice&&<p className="remembered-choice-note"><Check size={14}/> Using this series’ remembered choices. You can change them for this download.</p>}<div className="download-fields">
      <label className="download-language">PREFERRED SUBTITLE LANGUAGE<select value={language} onChange={e=>changeLanguage(e.target.value)} disabled={englishOnly||sourceControlled}><option value="english">{sourceControlled?'Set by server':englishOnly?'English (automatic default)':'English'}</option>{!englishOnly&&!sourceControlled&&<option value="indonesian">Indonesian</option>}</select></label>
      <label className="download-language">DOWNLOAD SERVER<select value={server} onChange={e=>changeServer(e.target.value)}><option value="auto">Automatic · first compatible server</option>{options.servers.map(x=><option value={x.id} key={x.id}>{x.label}</option>)}</select></label>
      <label className="download-language">VIDEO QUALITY<select value={quality} onChange={e=>setQuality(e.target.value)}>{qualityOptions.map(x=><option value={x.id} key={x.id}>{x.label}</option>)}</select></label>
      <div className="download-language subtitle-selection"><span>SUBTITLE TRACKS</span>{server==='auto'?<p className="subtitle-selection-note">Automatic subtitles are used with Automatic server. Choose a download server to see the separate tracks it reports for episode {sample.number}.</p>:<div className="subtitle-choice-list">
        <label className="subtitle-choice"><input type="radio" name="download-subtitle-mode" checked={subtitleMode==='auto'} onChange={()=>chooseSubtitleMode('auto')}/><span><strong>Automatic</strong><small>{englishOnly?'Identifiable English tracks, as before':'Mikozora’s usual subtitle selection'}</small></span></label>
        <label className={'subtitle-choice '+(subtitleOptions.length?'':'disabled')}><input type="radio" name="download-subtitle-mode" checked={subtitleMode==='custom'} disabled={!subtitleOptions.length} onChange={()=>chooseSubtitleMode('custom')}/><span><strong>Choose tracks</strong><small>{subtitleOptions.length?(subtitleMode==='custom'?`${selectedSubtitleTracks.length} of ${subtitleOptions.length} selected`:`${subtitleOptions.length} reported`):'No separate tracks reported'}</small></span></label>
        {subtitleMode==='custom'&&<div className="subtitle-track-list" aria-label="Reported subtitle tracks">{subtitleOptions.map(track=><label className="subtitle-track" key={track.id}><span><strong>{track.label}</strong><small>{track.language||'und'}{track.preferred?' · Server default':''}</small></span><input type="checkbox" checked={subtitleSelection.has(track.id)} onChange={()=>toggleSubtitle(track.id)} aria-label={`Download ${track.label} subtitles`}/></label>)}</div>}
        <label className="subtitle-choice"><input type="radio" name="download-subtitle-mode" checked={subtitleMode==='none'} onChange={()=>chooseSubtitleMode('none')}/><span><strong>No separate subtitles</strong><small>Burned-in subtitles, if any, stay in the video</small></span></label>
        <p className="subtitle-selection-note">{chosen?.subtitleNote||'Tracks are matched by language and label on each episode; subtitle web addresses are never stored.'}</p>{subtitleInvalid&&<p className="subtitle-selection-error" role="alert">Choose at least one track, Automatic, or No separate subtitles.</p>}
      </div>}</div>
    </div>
      <div className="quality-hint" role="status">{options.loading?<><LoaderCircle size={14} className="spin"/> Checking available servers and qualities…</>:options.error?<><AlertCircle size={14}/> {options.error} <button onClick={()=>setAttempt(x=>x+1)}>Retry</button></>:<><Check size={14}/>{chosen?.note || (options.servers.length?`${options.servers.length} compatible server${options.servers.length===1?'':'s'} found for episode ${sample.number}.`:'No compatible servers were confirmed; Automatic may not work.')}{options.unavailable>0?' Some servers could not be checked.':''}</>}</div>
      {count>1&&<p className="quality-batch-hint">Choices are based on episode {sample.number}. Each episode must offer the selected server and quality{subtitleMode==='custom'?', and at least one selected subtitle track,':''} or that episode will fail rather than silently switch.</p>}
      <div className="download-explainer"><ShieldCheck size={18}/><p>{request.item.source==='xin'?'Only supported servers are shown. AnimeXin subtitles are usually burned into the video in the selected language.':englishOnly?`${sourceName(request.item.source)} uses identifiable English tracks with Automatic. Choose a server, then Choose tracks, to download different server-reported subtitles.`:'Only compatible servers are shown. Choose a server to pick its reported subtitle tracks; burned-in subtitles cannot be removed.'}</p></div>
      <p className="download-caution">Best HLS quality is capped at 1080p. Downloads use temporary app space; if you choose a folder, Mikozora removes its private copy after the saved video and subtitles are verified. Downloads can be large{isDesktopApp()?' and converting HLS can take a while.':' and may use mobile data.'}</p>
      {!hasNativeDownloads()&&<p className="preview-note"><AlertCircle size={15}/> {isDesktopApp()?'Downloads are unavailable in this Windows build.':'Downloads work in the Android app, not the browser preview.'}</p>}
      <div className="download-dialog-actions"><button className="btn secondary" onClick={close}>Cancel</button><button className="btn primary" disabled={!hasNativeDownloads()||working||subtitleInvalid} onClick={confirm}>{working?<LoaderCircle size={16} className="spin"/>:<Download size={16}/>} Add to queue</button></div>
    </div></div></div>;
}
function DownloadsPage({items,loading,remove,retry,change,browse,folder,saveCopy,openSettings,playOffline,watchedById={},managerPrefs,changeManagerPrefs=()=>{},cleanupCandidates=[],runCleanup=()=>{},removeMany=()=>{},moveQueue=()=>{}}) {
  const statusText={queued:'Waiting for network or a queue slot',resolving:'Finding a supported mirror',downloading:'Downloading',completed:'Ready to watch offline',failed:'Download failed',paused:'Waiting to resume',removing:'Removing'};
  const prefs=normalizeOfflineManager(managerPrefs);
  const [managerSearch,setManagerSearch]=useState('');
  const [managerStatus,setManagerStatus]=useState('all');
  const [managerSort,setManagerSort]=useState('queue');
  const [groupBySeries,setGroupBySeries]=useState(false);
  const [selectedDownloads,setSelectedDownloads]=useState([]);
  const summary=downloadStorageSummary(items,watchedById);
  const cleanupSize=cleanupBytes(cleanupCandidates);
  const effectiveQueueOrder=queueOrderIds(items,prefs);
  const queuePositions=new Map(effectiveQueueOrder.map((id,index)=>[id,index+1]));
  const searchTerm=managerSearch.trim().toLocaleLowerCase();
  const visibleItems=sortManagerDownloads((items||[]).filter(d=>{
    if(managerStatus!=='all'&&d.status!==managerStatus)return false;
    if(searchTerm&&!`${d.item?.title||''} ${d.episode?.number||''} ${sourceName(d.item?.source)}`.toLocaleLowerCase().includes(searchTerm))return false;
    return true;
  }),{sort:groupBySeries?'series':managerSort,queueOrder:effectiveQueueOrder});
  const selectedRecords=(items||[]).filter(d=>selectedDownloads.includes(d.id));
  const selectedBytes=selectedRecords.reduce((sum,d)=>sum+downloadBytes(d),0);
  const watchedCompleted=(items||[]).filter(d=>d.status==='completed'&&watchedInfoFor(watchedById,d).watched);
  const failedDownloads=(items||[]).filter(d=>d.status==='failed');
  const maxSeriesBytes=Math.max(1,...summary.bySeries.map(entry=>entry.bytes||0));
  const maxSourceBytes=Math.max(1,...summary.bySource.map(entry=>entry.bytes||0));
  useEffect(()=>{setSelectedDownloads(previous=>previous.filter(id=>(items||[]).some(d=>d.id===id)));},[items]);
  const toggleDownloadSelection=id=>setSelectedDownloads(previous=>previous.includes(id)?previous.filter(x=>x!==id):[...previous,id]);
  const sizeLabel=value=>bytesLabel(value)||'0 KB';
  return <div className="content page-content"><div className="page-heading"><div><div className="eyebrow">A LITTLE SOMETHING FOR LATER</div><h1>Ready when you are<span>.</span></h1><p>Your offline episodes and download queue, saved on this device.</p></div><div className="heading-art"><HardDrive size={32}/><span>✦</span></div></div>
    {!hasNativeDownloads()?<Empty icon={Download} title="Take your stories offline" body={isDesktopApp()?"Downloads are unavailable in this Windows build. Episodes still stream in the built-in player.":"Open Mikozora on Android to download individual episodes or select a batch. The browser preview cannot store episodes."} action={()=>browse('all')} actionLabel="Browse titles"/>:
      loading&&!items.length?<div className="episode-loading"><LoaderCircle size={18} className="spin"/> Loading downloads...</div>:
      items.length?<><section className="offline-manager-panel" aria-label="Offline download manager">
        <div className="manager-panel-heading"><div><span className="eyebrow">OFFLINE MANAGER 2.0</span><h2>Storage &amp; cleanup</h2><p>See what is using space, tidy watched episodes, and put the queue in the order you want.</p></div><div className="manager-heading-icon"><HardDrive size={22}/></div></div>
        <div className="manager-stat-grid">
          <div><strong>{sizeLabel(summary.totalBytes)}</strong><span>all downloads</span><small>{summary.totalRecords} {summary.totalRecords===1?'episode':'episodes'}</small></div>
          <div><strong>{summary.completedCount}</strong><span>ready offline</span><small>{sizeLabel(summary.completedBytes)}</small></div>
          <div><strong>{cleanupCandidates.length}</strong><span>safe to clean</span><small>{sizeLabel(cleanupSize)} watched</small></div>
          <div><strong>{summary.activeCount+summary.queuedCount}</strong><span>active or queued</span><small>{summary.failedCount} failed · {summary.folderCopies} folder {summary.folderCopies===1?'copy':'copies'}</small></div>
        </div>
        <div className="manager-breakdowns">
          <div className="manager-breakdown"><h3>Storage by series</h3>{summary.bySeries.slice(0,6).map(entry=><div className="manager-bar-row" key={entry.key}><div className="manager-bar-copy"><strong>{entry.title}</strong><span>{entry.completedCount}/{entry.count} ready{entry.watchedCount?` · ${entry.watchedCount} watched`:''}</span></div><div className="manager-bar" aria-hidden="true"><i style={{width:`${Math.max(2,Math.round((entry.bytes||0)/maxSeriesBytes*100))}%`}}/></div><b>{sizeLabel(entry.bytes)}</b></div>)}</div>
          <div className="manager-breakdown"><h3>Storage by source</h3>{summary.bySource.slice(0,6).map(entry=><div className="manager-bar-row" key={entry.source}><div className="manager-bar-copy"><strong>{sourceName(entry.source)}</strong><span>{entry.completedCount}/{entry.count} ready</span></div><div className="manager-bar" aria-hidden="true"><i style={{width:`${Math.max(2,Math.round((entry.bytes||0)/maxSourceBytes*100))}%`}}/></div><b>{sizeLabel(entry.bytes)}</b></div>)}</div>
        </div>
        <div className="manager-rules">
          <label>OFFLINE STORAGE LIMIT<select aria-label="Offline storage limit" value={prefs.storageLimitGb} onChange={event=>changeManagerPrefs({storageLimitGb:Number(event.target.value)})}>{OFFLINE_STORAGE_LIMITS_GB.map(value=><option key={value} value={value}>{value?`${value} GB`:'No limit'}</option>)}</select></label>
          <label>DELETE WATCHED AFTER<select aria-label="Delete watched downloads after" value={prefs.autoDeleteWatchedDays} onChange={event=>changeManagerPrefs({autoDeleteWatchedDays:Number(event.target.value)})}>{OFFLINE_AUTO_DELETE_DAYS.map(value=><option key={value} value={value}>{value?(value===1?'1 day':`${value} days`):'Off'}</option>)}</select></label>
          <div className="manager-auto-row"><div><strong>Automatic cleanup</strong><span>When Downloads opens</span></div><button type="button" aria-label="Automatic watched-download cleanup" aria-pressed={prefs.autoCleanup} onClick={()=>changeManagerPrefs({autoCleanup:!prefs.autoCleanup})}>{prefs.autoCleanup?'On':'Off'}</button></div>
          <button type="button" className="btn primary manager-clean-button" disabled={!cleanupCandidates.length} onClick={()=>runCleanup(false)}><Trash2 size={15}/> Clean watched downloads{cleanupCandidates.length?` · ${sizeLabel(cleanupSize)}`:''}</button>
        </div>
        <p className="manager-note">Cleanup only removes watched, completed Mikozora copies that match your rules. Verified folder-only files are left alone, because removing their Mikozora record would not delete the file in your folder.</p>
      </section>
      <section className="manager-toolbar" aria-label="Download list tools">
        <label className="manager-search"><Search size={16}/><input aria-label="Search downloads" value={managerSearch} onChange={event=>setManagerSearch(event.target.value)} placeholder="Search downloads"/></label>
        <label className="manager-field"><span>Status</span><select aria-label="Filter downloads by status" value={managerStatus} onChange={event=>setManagerStatus(event.target.value)}><option value="all">All statuses</option><option value="downloading">Downloading</option><option value="resolving">Resolving</option><option value="queued">Queued</option><option value="paused">Paused</option><option value="completed">Ready offline</option><option value="failed">Failed</option></select></label>
        <label className="manager-field"><span>Sort</span><select aria-label="Sort downloads" value={managerSort} onChange={event=>setManagerSort(event.target.value)}><option value="queue">Queue order</option><option value="size-desc">Largest first</option><option value="size-asc">Smallest first</option><option value="series">Series &amp; episode</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
        <button type="button" className={'btn secondary manager-group-toggle '+(groupBySeries?'is-saved':'')} aria-pressed={groupBySeries} onClick={()=>setGroupBySeries(value=>!value)}><ListChecks size={15}/> Group by series</button>
        <div className="manager-bulk-actions"><strong>{selectedRecords.length} selected{selectedRecords.length?` · ${sizeLabel(selectedBytes)}`:''}</strong><button type="button" className="text-link" disabled={!visibleItems.length} onClick={()=>setSelectedDownloads(visibleItems.map(d=>d.id))}>Select shown</button><button type="button" className="text-link" disabled={!watchedCompleted.length} onClick={()=>setSelectedDownloads(watchedCompleted.map(d=>d.id))}>Select watched</button><button type="button" className="text-link muted" disabled={!selectedRecords.length} onClick={()=>setSelectedDownloads([])}>Clear</button><button type="button" className="text-link danger-link" disabled={!selectedRecords.length} onClick={()=>{removeMany(selectedRecords);setSelectedDownloads([]);}}>Remove selected</button><button type="button" className="text-link danger-link" disabled={!failedDownloads.length} onClick={()=>removeMany(failedDownloads)}>Remove failed</button></div>
        <span className="manager-visible-count">{visibleItems.length} SHOWN</span>
      </section>
      {!visibleItems.length&&<p className="manager-no-results">No downloads match this search or status. Your files have not changed.</p>}
      <div className="downloads-list">{visibleItems.map((d,visibleIndex)=>{
        const progress=typeof d.progress==='number'?Math.max(0,Math.min(100,d.progress)):null;
        const exporting=d.exportStatus==='queued'||d.exportStatus==='exporting'||d.exportStatus==='verifying';
        const savedFolder=[d.exportFolder,d.exportSeriesFolder].filter(Boolean).join(' / ');
        const watched=watchedInfoFor(watchedById,d);
        const queuePosition=queuePositions.get(d.id)||0;
        const canMoveQueue=['queued','paused'].includes(d.status);
        const isSelected=selectedDownloads.includes(d.id);
        const groupKey=downloadTitleKey(d)||d.id;
        const previousGroupKey=visibleIndex?(downloadTitleKey(visibleItems[visibleIndex-1])||visibleItems[visibleIndex-1].id):'';
        const showGroup=groupBySeries&&groupKey!==previousGroupKey;
        const group=summary.bySeries.find(entry=>entry.key===groupKey);
        return <React.Fragment key={d.id}>{showGroup&&<div className="download-group-heading"><div><span className="eyebrow">SERIES</span><h3>{group?.title||d.item?.title||'Downloaded episode'}</h3></div><span>{group?`${group.completedCount}/${group.count} ready · ${sizeLabel(group.bytes)}`:''}</span></div>}<article className="download-card"><div className="download-card-art"><Cover item={d.item||{}}/></div><div className="download-card-main"><div className="download-card-top"><SourcePill source={d.item?.source} compact/><span className={'download-status '+(d.status||'queued')}><i/>{statusText[d.status]||'Preparing'}</span>{watched.watched&&<span className="download-watched-badge"><Check size={12}/> Watched</span>}{d.storageMode==='folder'&&d.exportVerified&&<span className="download-folder-badge"><FolderHeart size={12}/> Folder copy</span>}<label className="download-select"><input type="checkbox" checked={isSelected} onChange={()=>toggleDownloadSelection(d.id)} aria-label={`Select episode ${d.episode?.number||''} of ${d.item?.title||'download'}`}/><span>Select</span></label></div><h3>{d.item?.title||'Episode'}</h3><p>Episode {d.episode?.number} {d.serverLabel?`· ${d.serverLabel}`:d.host?`· ${d.host}`:''} {d.qualityLabel?`· ${d.qualityLabel}`:''} {d.bytes?`· ${bytesLabel(d.bytes)}`:''}</p>
          {d.status==='downloading'&&<div className="download-progress"><div><span style={{width:progress==null?'38%':`${progress}%`}} className={progress==null?'indeterminate':''}/></div><small>{progress==null?'In progress':`${progress}%`}</small></div>}
          <p className="subtitle-status"><Check size={13}/> {d.subtitleDescription||'Preparing subtitles'}</p>{d.autoDownload&&<p className="export-status"><Sparkles size={13}/> Smart download{d.smartWifiOnly&&!isDesktopApp()?' · Wi‑Fi only':''}</p>}{d.status==='failed'&&<p className="download-error"><AlertCircle size={14}/> {d.error||'This host did not provide a downloadable stream.'}</p>}
          {d.exportStatus==='queued'&&<p className="export-status"><Clock3 size={13}/> Playable copy queued{d.exportNextFolder?` · ${d.exportNextFolder}`:''}</p>}
          {d.exportStatus==='exporting'&&<p className="export-status"><LoaderCircle size={13} className="spin"/> Saving playable copy{d.exportNextFolder?` · ${d.exportNextFolder}`:''}…</p>}
          {d.exportStatus==='verifying'&&<p className="export-status"><LoaderCircle size={13} className="spin"/> Verifying video and subtitles before freeing app space…</p>}
          {d.exportStatus==='completed'&&<p className="export-status success"><Check size={13}/> Saved to {savedFolder||'selected folder'}{d.exportSubtitleCount?` · ${d.exportSubtitleCount} subtitle file${d.exportSubtitleCount===1?'':'s'}`:''}{d.cleanupStatus==='complete'?' · Private copy removed':''}</p>}
          {d.cleanupStatus==='pending'&&<p className="export-status"><LoaderCircle size={13} className="spin"/> Freeing private app storage…</p>}
          {(d.cleanupStatus==='waiting'||d.cleanupStatus==='retained')&&<p className="download-error"><AlertCircle size={14}/> {d.cleanupMessage||'The private copy is being kept for safety.'}</p>}
          {d.exportStatus==='failed'&&<p className="download-error"><AlertCircle size={14}/> Folder copy failed: {d.exportError||'Try again.'}</p>}
          {queuePosition>0&&<div className="download-queue-tools"><span>Queue #{queuePosition}</span>{canMoveQueue?<><button type="button" disabled={queuePosition<=1} onClick={()=>moveQueue(d,-1)} aria-label={`Move episode ${d.episode?.number||''} earlier in the download queue`}><ArrowUp size={13}/> Earlier</button><button type="button" disabled={queuePosition>=effectiveQueueOrder.length} onClick={()=>moveQueue(d,1)} aria-label={`Move episode ${d.episode?.number||''} later in the download queue`}><ArrowDown size={13}/> Later</button><button type="button" disabled={queuePosition<=1} onClick={()=>moveQueue(d,'front')}>Move to front</button></>:<small>{d.status==='downloading'||d.status==='resolving'?'Already started':'Waiting its turn'}</small>}</div>}
          <div className="download-card-actions">{d.status==='completed'&&<><button className="btn primary" onClick={()=>playOffline?.(d)}><Play size={14} fill="currentColor"/> Play offline</button>{d.exportUri&&<button className="text-link" onClick={()=>openExport(d.id)}><ExternalLink size={14}/> Open file</button>}{folder?.granted?<button className="text-link" disabled={exporting} onClick={()=>saveCopy(d)}><FolderHeart size={14}/> {exporting?'Saving…':d.exportUri?'Save another copy':'Save to folder'}</button>:<button className="text-link" onClick={openSettings}><FolderHeart size={14}/> Choose folder</button>}</>}{d.status==='failed'&&<><button className="btn secondary" onClick={()=>retry(d)}><RotateCcw size={14}/> Retry</button><button className="text-link" onClick={()=>change(d)}><SlidersHorizontal size={14}/> Change server</button></>}<button className="text-link muted" onClick={()=>remove(d)}><Trash2 size={14}/> Remove</button></div>
        </div></article></React.Fragment>;
      })}</div></>:<Empty icon={Download} title="Your offline shelf is empty" body="Open a series, then download one episode or select a batch to watch later." action={()=>browse('all')} actionLabel="Find a series"/>}
    <p className="privacy-footnote"><ShieldCheck size={15}/> Mikozora uses private space during downloading and conversion. After a verified folder save, it removes the private copy; folder files stay if you remove an episode or uninstall Mikozora.</p>
  </div>;
}
function PlannerPage({progress=[],history=[],libraryMeta={},plans={},relatedKeysByTitle={},open,resumeNext,queueEpisodes,changePlan,browse}) {
  const [sort,setSort]=useState('smart');
  const [episodeGoal,setEpisodeGoal]=useState(6);
  const queue=useMemo(()=>buildCatchUpQueue({progress,history,libraryMeta,plans,relatedKeysByTitle,sort,limit:50}),[progress,history,libraryMeta,plans,relatedKeysByTitle,sort]);
  const summary=useMemo(()=>plannerSummary(queue),[queue]);
  const session=useMemo(()=>buildBingeSession(queue,{episodeGoal}),[queue,episodeGoal]);
  const sessionGroups=useMemo(()=>{
    const groups=[];const byKey=new Map();
    for(const entry of session){
      if(!byKey.has(entry.key)){const group={key:entry.key,item:entry.item,episodes:[]};byKey.set(entry.key,group);groups.push(group);}
      byKey.get(entry.key).episodes.push(entry.episode);
    }
    return groups;
  },[session]);
  return <div className="content page-content planner-page">
    <div className="page-heading"><div><div className="eyebrow">CATCH-UP &amp; BINGE PLANNER</div><h1>Your next sitting<span>.</span></h1><p>Series you have started, how far behind they are, and a practical order for tonight or the weekend.</p></div><div className="heading-art"><CalendarClock size={32}/><span>✦</span></div></div>
    <section className="planner-summary" aria-label="Catch-up overview">
      <div><strong>{summary.titlesBehind}</strong><span>series waiting</span></div>
      <div><strong>{summary.episodesBehind}</strong><span>episodes behind</span></div>
      <div><strong>{summary.plannedTonight}</strong><span>for tonight</span></div>
      <div><strong>{summary.plannedWeekend}</strong><span>for the weekend</span></div>
      <div><strong>{summary.nearlyFinished}</strong><span>nearly finished</span></div>
    </section>
    <section className="planner-controls" aria-label="Planner controls">
      <label><span>QUEUE ORDER</span><select aria-label="Catch-up queue order" value={sort} onChange={event=>setSort(event.target.value)}><option value="smart">Smart mix</option><option value="planned">Planned first</option><option value="finish">Finish soonest</option><option value="behind">Most behind</option><option value="recent">Recently watched</option></select></label>
      <label><span>SESSION GOAL</span><select aria-label="Binge session episode goal" value={episodeGoal} onChange={event=>setEpisodeGoal(Number(event.target.value))}>{[3,6,9,12,18,24].map(value=><option key={value} value={value}>{value} episodes</option>)}</select></label>
      <p>Plans and catch-up order stay with your local library data. Episode counts come from the snapshots Mikozora already keeps when you watch or open a series.</p>
    </section>
    {session.length>0&&<section className="binge-session" aria-label="Suggested binge session">
      <div className="binge-session-heading"><div><span className="eyebrow">READY-MADE BINGE ORDER</span><h2>{session.length} episode{session.length===1?'':'s'} for this sitting</h2><p>Built from your queue and the episodes-per-sitting choices below.</p></div><button className="btn primary" onClick={()=>resumeNext(session[0])}><Play size={15} fill="currentColor"/> Start session</button></div>
      <div className="binge-session-list">{sessionGroups.map((group,index)=><div className="binge-session-row" key={group.key}><span className="binge-session-index">{index+1}</span><div className="binge-session-copy"><button onClick={()=>open(group.item)}>{group.item.title}</button><span>Episode{group.episodes.length===1?'':'s'} {group.episodes.map(episode=>episode.number).join(', ')}</span></div><button className="text-link" onClick={()=>queueEpisodes(group.item,group.episodes)}><Download size={14}/> Download these</button></div>)}</div>
    </section>}
    {queue.length?<div className="planner-list">{queue.map(entry=>{
      const downloadCount=Math.min(3,entry.behindCount);
      return <article className="planner-card" key={entry.key}>
        <button className="planner-cover" onClick={()=>open(entry.item)} aria-label={`Open ${entry.item.title}`}><Cover item={entry.item}/></button>
        <div className="planner-card-main">
          <div className="planner-card-top"><SourcePill source={entry.item.source} compact/><span className="planner-behind">{entry.behindCount} behind</span>{entry.plan&&<span className="planner-plan-badge"><CalendarClock size={12}/> {watchPlanLabel(entry.plan.mode)}</span>}</div>
          <h3><button onClick={()=>open(entry.item)}>{entry.item.title}</button></h3>
          <p>Next: Episode {entry.episode.number}{entry.episode.title?` · ${entry.episode.title}`:''} · {entry.watchedCount} of {entry.total} watched{entry.updatedAt?` · last watched ${prettyTime(entry.updatedAt)}`:''}</p>
          <span className="planner-progress" aria-hidden="true"><i style={{width:`${Math.min(100,Math.round((entry.percent||0)*100))}%`}}/></span>
          <div className="planner-plan-controls">
            <label><span>PLAN</span><select aria-label={`Plan for ${entry.item.title}`} value={entry.plan?.mode||''} onChange={event=>changePlan(entry.item,{mode:event.target.value})}><option value="">Not planned</option>{WATCH_PLAN_MODES.map(mode=><option key={mode.id} value={mode.id}>{mode.label}</option>)}</select></label>
            {entry.plan&&<label><span>PER SITTING</span><select aria-label={`Episodes per sitting for ${entry.item.title}`} value={entry.plan.episodesPerSession||3} onChange={event=>changePlan(entry.item,{episodesPerSession:Number(event.target.value)})}>{[1,2,3,4,5,8,10].map(value=><option key={value} value={value}>{value} episode{value===1?'':'s'}</option>)}</select></label>}
          </div>
          <div className="planner-actions"><button className="btn primary" onClick={()=>resumeNext(entry)}><Play size={14} fill="currentColor"/> Play next</button><button className="btn secondary" onClick={()=>queueEpisodes(entry.item,entry.upNextEpisodes.slice(0,downloadCount))}><Download size={14}/> Download next {downloadCount}</button><button className="text-link" onClick={()=>open(entry.item)}>Open series <ArrowRight size={14}/></button></div>
        </div>
      </article>;
    })}</div>:<Empty icon={CalendarClock} title="Nothing waiting right now" body="When you start a series and newer unwatched episodes are in its snapshot, Mikozora will line them up here. Opening a series refreshes its episode snapshot." action={()=>browse('all')} actionLabel="Find a series"/>}
    <p className="privacy-footnote"><ShieldCheck size={15}/> The planner uses this device’s saved progress snapshots and history. It does not invent airing dates, and a series may need opening once to refresh its episode list.</p>
  </div>;
}
function StatsPage({history=[],progress=[],library=[],libraryMeta={},relatedKeysByTitle={},open,browse,notify,saveShareCard=null}) {
  const stats=useMemo(()=>computeWatchStats({history,progress,library,libraryMeta,relatedKeysByTitle}),[history,progress,library,libraryMeta,relatedKeysByTitle]);
  const [selectedMonth,setSelectedMonth]=useState('');
  const activeMonth=stats.availableMonths.includes(selectedMonth)?selectedMonth:(stats.availableMonths[0]||'');
  const wrapped=useMemo(()=>buildWrapped({history,month:activeMonth}),[history,activeMonth]);
  const statuses=statusBreakdown(stats);
  const maxWeekly=Math.max(1,...stats.weekly.map(bucket=>bucket.count||0));
  const maxMonthly=Math.max(1,...stats.monthly.map(bucket=>bucket.count||0));
  const maxGenre=Math.max(1,...stats.topGenres.map(entry=>entry.count||0));
  const maxSource=Math.max(1,...stats.topSources.map(entry=>entry.count||0));
  const maxSeries=Math.max(1,...stats.topSeries.map(entry=>entry.count||0));
  const completionPercent=Math.round((stats.progress.completionRate||0)*100);
  const busiestLabel=wrapped.busiestDay?new Date(`${wrapped.busiestDay.day}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'—';
  const hasData=stats.historyEpisodes>0||stats.progress.titlesStarted>0;
  const copyWrapped=async()=>{
    const lines=[
      `My Mikozora ${wrapped.label} recap`,
      `${wrapped.episodes} episodes opened · about ${formatWatchDuration(wrapped.estimatedMinutes)} of watch time`,
      wrapped.topSeries[0]?`Most watched: ${wrapped.topSeries[0].label} (${wrapped.topSeries[0].count})`:null,
      wrapped.topGenres[0]?`Favourite genre: ${wrapped.topGenres[0].label}`:null,
      wrapped.topSources[0]?`Favourite source: ${sourceName(wrapped.topSources[0].id)}`:null,
      wrapped.newSeries.length?`New series started: ${wrapped.newSeries.length}`:null,
    ].filter(Boolean).join('\n');
    try{await navigator.clipboard.writeText(lines);notify?.('Monthly recap copied');}
    catch{notify?.('Could not copy the recap on this device');}
  };
  const saveWrappedCard=()=>{
    if(!saveShareCard)return;
    void saveShareCard({
      kind:'wrapped-card',
      eyebrow:'MIKOZORA WRAPPED',
      title:wrapped.label,
      subtitle:`${wrapped.episodes} episodes · about ${formatWatchDuration(wrapped.estimatedMinutes)}`,
      stats:[
        {label:'Most watched',value:wrapped.topSeries[0]?.label||'—'},
        {label:'Favourite genre',value:wrapped.topGenres[0]?.label||'—'},
        {label:'Favourite source',value:wrapped.topSources[0]?sourceName(wrapped.topSources[0].id):'—'},
        {label:'Active days',value:String(wrapped.activeDays||0)},
      ],
    });
  };
  return <div className="content page-content stats-page">
    <div className="page-heading"><div><div className="eyebrow">WATCH STATS &amp; WRAPPED</div><h1>Your watching story<span>.</span></h1><p>Streaks, favourites, completions, and a monthly recap—built locally from your Mikozora history.</p></div><div className="heading-art"><Flame size={32}/><span>✦</span></div></div>
    {!hasData?<Empty icon={Flame} title="Your stats will grow here" body="Open a few episodes and Mikozora will start building streaks, favourite genres and monthly recaps from this device’s history." action={()=>browse('all')} actionLabel="Explore anime"/>:<>
      <section className="stats-overview" aria-label="Watching overview">
        <div><strong>{stats.currentStreak}</strong><span>current streak</span><small>days</small></div>
        <div><strong>{stats.longestStreak}</strong><span>longest streak</span><small>days</small></div>
        <div><strong>{stats.activeDays}</strong><span>active days</span><small>{stats.historyEpisodes} episodes recorded</small></div>
        <div><strong>{stats.last7Days}</strong><span>last 7 days</span><small>{stats.last30Days} in 30 days</small></div>
        <div><strong>{formatWatchDuration(stats.estimatedMinutes)}</strong><span>estimated time</span><small>recorded history</small></div>
        <div><strong>{completionPercent}%</strong><span>completion</span><small>{stats.progress.titlesCompleted} series finished</small></div>
      </section>
      <section className="wrapped-panel" aria-label="Monthly wrapped recap">
        <div className="wrapped-heading"><div><span className="eyebrow">MONTHLY WRAPPED</span><h2>{wrapped.label}</h2><p>{wrapped.episodes} episodes across {wrapped.activeDays} active {wrapped.activeDays===1?'day':'days'} · about {formatWatchDuration(wrapped.estimatedMinutes)}</p></div><label className="wrapped-month"><span>MONTH</span><select aria-label="Wrapped month" value={activeMonth} onChange={event=>setSelectedMonth(event.target.value)}>{stats.availableMonths.map(month=><option key={month} value={month}>{monthLabel(month)}</option>)}</select></label></div>
        <div className="wrapped-facts">
          <div><span>Most watched</span><strong>{wrapped.topSeries[0]?.label||'—'}</strong><small>{wrapped.topSeries[0]?`${wrapped.topSeries[0].count} episodes`:''}</small></div>
          <div><span>Favourite genre</span><strong>{wrapped.topGenres[0]?.label||'—'}</strong><small>{wrapped.topGenres[0]?`${wrapped.topGenres[0].count} episodes`:''}</small></div>
          <div><span>Favourite source</span><strong>{wrapped.topSources[0]?sourceName(wrapped.topSources[0].id):'—'}</strong><small>{wrapped.topSources[0]?`${wrapped.topSources[0].count} episodes`:''}</small></div>
          <div><span>Busiest day</span><strong>{busiestLabel}</strong><small>{wrapped.busiestDay?`${wrapped.busiestDay.count} episodes`:''}</small></div>
          <div><span>New series</span><strong>{wrapped.newSeries.length}</strong><small>started this month</small></div>
          <div><span>Vs last month</span><strong>{wrapped.episodeChange>0?`+${wrapped.episodeChange}`:wrapped.episodeChange}</strong><small>episodes</small></div>
        </div>
        <div className="wrapped-actions"><button className="btn primary" onClick={copyWrapped}><Sparkles size={15}/> Copy monthly recap</button><button className="btn secondary" type="button" onClick={saveWrappedCard} disabled={!saveShareCard}><Download size={15}/> Save Wrapped card</button><span>Based only on the history still stored on this device. Cards are generated locally as SVG images.</span></div>
      </section>
      <div className="stats-columns">
        <section className="stats-panel"><span className="eyebrow">EPISODES PER WEEK</span><h2>Last 8 weeks</h2><div className="stats-bars">{stats.weekly.map(bucket=><div className="stats-bar-row" key={bucket.key}><span>{bucket.label}</span><div><i style={{width:`${Math.round((bucket.count||0)/maxWeekly*100)}%`}}/></div><b>{bucket.count}</b></div>)}</div></section>
        <section className="stats-panel"><span className="eyebrow">EPISODES PER MONTH</span><h2>Last 6 months</h2><div className="stats-bars">{stats.monthly.map(bucket=><div className="stats-bar-row" key={bucket.key}><span>{bucket.label}</span><div><i style={{width:`${Math.round((bucket.count||0)/maxMonthly*100)}%`}}/></div><b>{bucket.count}</b></div>)}</div></section>
      </div>
      <div className="stats-columns three">
        <section className="stats-panel"><span className="eyebrow">FAVOURITE GENRES</span><h2>What you return to</h2>{stats.topGenres.length?<div className="stats-bars">{stats.topGenres.map(entry=><div className="stats-bar-row" key={entry.id}><span>{entry.label}</span><div><i style={{width:`${Math.round((entry.count||0)/maxGenre*100)}%`}}/></div><b>{entry.count}</b></div>)}</div>:<p className="stats-empty">Genres appear when history entries include them.</p>}</section>
        <section className="stats-panel"><span className="eyebrow">FAVOURITE SOURCES</span><h2>Where you watch</h2>{stats.topSources.length?<div className="stats-bars">{stats.topSources.map(entry=><div className="stats-bar-row" key={entry.id}><span>{sourceName(entry.id)}</span><div><i style={{width:`${Math.round((entry.count||0)/maxSource*100)}%`}}/></div><b>{entry.count}</b></div>)}</div>:<p className="stats-empty">No source history yet.</p>}</section>
        <section className="stats-panel"><span className="eyebrow">TOP SERIES</span><h2>Most opened</h2>{stats.topSeries.length?<div className="stats-top-series">{stats.topSeries.map(entry=><button key={entry.id} onClick={()=>entry.item&&open(entry.item)}><span>{entry.label}</span><div><i style={{width:`${Math.round((entry.count||0)/maxSeries*100)}%`}}/></div><b>{entry.count}</b></button>)}</div>:<p className="stats-empty">No series history yet.</p>}</section>
      </div>
      <section className="stats-panel completion-panel"><span className="eyebrow">COMPLETION &amp; YOUR SHELF</span><h2>Progress at a glance</h2><div className="completion-grid">
        <div><strong>{stats.progress.titlesStarted}</strong><span>series started</span></div>
        <div><strong>{stats.progress.titlesInProgress}</strong><span>in progress</span></div>
        <div><strong>{stats.progress.titlesCompleted}</strong><span>finished</span></div>
        <div><strong>{stats.progress.watchedEpisodes}</strong><span>watched in progress records</span></div>
        <div><strong>{stats.shelf.averageRating?stats.shelf.averageRating.toFixed(1):'—'}</strong><span>average personal rating</span></div>
        <div><strong>{stats.shelf.withNotes}</strong><span>with notes</span></div>
      </div>{statuses.length>0&&<div className="stats-statuses">{statuses.map(status=><span key={status.id}>{status.label}: <b>{status.count}</b></span>)}</div>}</section>
    </>}
    <p className="privacy-footnote"><ShieldCheck size={15}/> {stats.historyLimitNote} Watch time is estimated at 24 minutes per episode unless a stored record includes a duration.</p>
  </div>;
}
function HistoryPage({items,resume,open,clear,browse,onlinePositions={}}) {
  return <div className="content page-content"><div className="page-heading"><div><div className="eyebrow">PICK IT BACK UP</div><h1>Your story so far<span>.</span></h1><p>Episodes you’ve opened recently, saved locally on this device.</p></div><div className="heading-art"><History size={33}/><span>✦</span></div></div><div className="history-head"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Recently opened <small className="count">{items.length}</small></h2></div>{items.length>0&&<button className="text-link muted" onClick={clear}><Trash2 size={15}/> Clear history</button>}</div>{items.length?<div className="history-list">{items.map((entry,i)=><div className="history-item" key={`${identity(entry.item)}-${entry.episode.number}-${i}`}><button className="history-art" onClick={()=>open(entry.item)} aria-label={`Open ${entry.item.title}`}><Cover item={entry.item}/></button><div className="history-copy"><SourcePill source={entry.item.source} compact/><button onClick={()=>open(entry.item)}>{entry.item.title}</button><span>Episode {entry.episode.number} <b>·</b> {prettyTime(entry.time)}{onlinePositionFor(onlinePositions,entry.item,entry.episode)?<> <b>·</b> Resume {formatPlaybackClock(onlinePositionFor(onlinePositions,entry.item,entry.episode).seconds)}</>:null}</span></div><button className="round-play" onClick={()=>resume(entry)} aria-label={`Open episode ${entry.episode.number}`}><Play size={16} fill="currentColor"/></button></div>)}</div>:<Empty icon={Clock3} title="Nothing here just yet" body="When you open an episode, it will show up here so you can find it again." action={()=>browse('all')} actionLabel="Explore anime"/>}<p className="privacy-footnote"><ShieldCheck size={15}/> History records episodes opened. Exact resume times appear only for episodes played in Mikozora’s direct player; embedded players cannot report a timestamp.</p></div>;
}
function SourcesPage({browse}) {
  return <div className="content page-content sources-page"><div className="page-heading"><div><div className="eyebrow">YOUR DOORWAYS TO MORE</div><h1>More worlds, one space<span>.</span></h1><p>Your chosen sources, organized by Anime and Donghua.</p></div><div className="heading-art"><Layers3 size={33}/><span>✦</span></div></div>
    {['Anime','Donghua'].map(category=>{const entries=Object.values(SOURCES).filter(src=>src.category===category);return <section className="source-category" key={category} aria-label={`${category} sources`}><div className="source-category-heading"><div><span className="eyebrow">EXPLORE {category.toUpperCase()}</span><h2>{category} <small className="count">{entries.length}</small></h2></div><button className="text-link" onClick={()=>browse(category.toLowerCase())}>Browse all {category.toLowerCase()} <ArrowRight size={15}/></button></div><div className="source-grid">{entries.map(src=><article className={'source-card '+src.id} style={{'--source-accent':src.accent}} key={src.id}><div className="source-card-top"><div className="source-symbol">{src.name[0]}</div><button className="source-open" onClick={()=>external(src.homepage || src.base)} aria-label={`Open ${src.name} website`}><ArrowUpRight size={19}/></button></div><div className="source-tag"><i/> ADDED SOURCE</div><h2>{src.name}</h2><p>{src.description}</p><div className="source-details"><span><Film size={15}/> {src.category}</span><span>·</span><span>{src.language}</span></div><button className="source-browse" onClick={()=>browse(src.id)}>Browse this source <ArrowRight size={16}/></button></article>)}</div></section>})}
    <div className="sources-note"><CircleHelp size={19}/><div><strong>About your sources</strong><p>Mikozora doesn’t host videos. Episodes and availability are provided by these third-party sites and their video hosts; their layouts and servers may change. Download support depends on each server.</p></div></div></div>;
}
function UpdatesPage({state,available,syncError,actionError,check,readAll,openUpdate,openLibrary,openSettings,radar=null,releaseRadar={},onReleaseRadarRule=()=>{},dismissRadarEntry=()=>{},openDownloads=()=>{}}) {
  const updates=state.updates||[],errors=state.errors||[];
  const [view,setView]=useState('inbox');
  const radarView=radar||{entries:[],digest:[],calendar:[],activity:[],visibleUnread:state.unreadCount||0,episodeUnread:state.unreadCount||0,readyDownloads:0,suppressedCount:0};
  const inboxEntries=(radarView.entries&&radarView.entries.length)?radarView.entries:updates.map(update=>({id:update.id,type:'episode',key:update.titleId||identity(update.item||{}),item:update.item,episode:update.episode,time:update.discoveredAt||0,read:!!update.read,suppressed:false,rule:effectiveReleaseRadarRule(releaseRadar,update.item),update}));
  const waiting=Math.max(0,(state.watchedCount||0)-(state.initializedCount||0));
  const lastRun=Number(state.lastRun)||0;
  const progress=state.checking?'Checking your collection titles…':state.queued?(isDesktopApp()?'Check queued · waiting for a connection':'Check queued · waiting for a connection or Android to start it'):!state.automatic?'Automatic checks are off · you can still check manually':state.lastSuccess?`Latest successful check ${prettyTime(state.lastSuccess)}${lastRun&&lastRun!==state.lastSuccess?` · Last run ${prettyTime(lastRun)}`:''}`:'No successful check yet';
  const patternLabel=activity=>activity?.pattern?`Observed only: usually found about every ${activity.pattern.typicalDays} day${activity.pattern.typicalDays===1?'':'s'} (${activity.pattern.basedOnDays} discovery days). Not a source schedule.`:'No reliable observed pattern yet.';
  return <div className="content page-content updates-page">
    <div className="page-heading"><div><div className="eyebrow">RELEASE RADAR · UPDATES INBOX 2.0</div><h1>New episodes &amp; ready downloads<span>.</span></h1><p>A local inbox for what Mikozora actually found—never an invented airing schedule.</p></div><div className="heading-art"><Bell size={31}/><span>✦</span></div></div>
    <section className="updates-overview" aria-label="Episode check status"><div className="updates-overview-icon"><RefreshCw size={20} className={state.checking?'spin':''}/></div><div className="updates-overview-copy"><div className="updates-status-title"><strong>{available?`${state.watchedCount||0} ${(state.watchedCount||0)===1?'title':'titles'} being followed`:(isDesktopApp()?'Episode checks are unavailable in this Windows build':'Episode checks are available in the Android app')}</strong><span className={'updates-live-dot '+(state.automatic?'':'muted')}/></div><p>{available?progress:(isDesktopApp()?'Update Mikozora for Windows to check your collections in the background.':'Install Mikozora on Android to check your collections in the background.')}</p>{available&&waiting>0&&<small>First checks set a starting point for {waiting} {waiting===1?'title':'titles'}; existing episodes won’t trigger alerts.</small>}<small>{isDesktopApp()?'Favourites and personal collections are checked once per title while Mikozora is open or resting in the system tray.':'Favourites and personal collections are checked once per title. Android may delay background work.'}</small></div><button className="btn secondary updates-check" onClick={check} disabled={!available||!state.watchedCount||state.checking}><RefreshCw size={15}/> Check now</button></section>
    {(syncError||actionError)&&<div className="updates-error" role="alert"><AlertCircle size={16}/><span>{syncError||actionError}</span></div>}
    {errors.length>0&&<section className="updates-failures" aria-label="Unavailable sources"><div><AlertCircle size={18}/><span><strong>Some sources couldn’t be checked</strong><small>Your previous episode lists are safe. Try again later.</small></span></div><ul>{errors.map((error,i)=><li key={`${identity(error.item)}-${i}`}><strong>{error.item?.title}</strong><span>{sourceName(error.item?.source)} · {error.message}</span></li>)}</ul></section>}
    <section className="radar-summary" aria-label="Release Radar summary">
      <div><strong>{radarView.visibleUnread||0}</strong><span>visible unread</span></div>
      <div><strong>{radarView.episodeUnread||0}</strong><span>new episodes</span></div>
      <div><strong>{radarView.readyDownloads||0}</strong><span>ready downloads</span></div>
      <div><strong>{radarView.suppressedCount||0}</strong><span>muted or snoozed</span></div>
      <div><strong>{state.lastSuccess?prettyTime(state.lastSuccess):'—'}</strong><span>last successful check</span></div>
    </section>
    <div className="updates-heading"><div><span className="eyebrow">THE LATEST FROM YOUR COLLECTIONS</span><h2>Updates inbox <small className="count">{radarView.visibleUnread||0} new</small></h2></div><div className="updates-heading-actions">{(state.unreadCount>0||radarView.readyDownloads>0)&&<button className="text-link muted" onClick={readAll}><Check size={15}/> Mark all read</button>}<button className="text-link" onClick={openDownloads}>Downloads <ArrowRight size={15}/></button><button className="text-link" onClick={openSettings}>Alert settings <ArrowRight size={15}/></button></div></div>
    <div className="tabs radar-tabs" role="tablist" aria-label="Release Radar views">
      {[['inbox','Inbox'],['digest','Digest by series'],['calendar','Last 14 days'],['activity','Alert history']].map(([id,label])=><button key={id} role="tab" aria-selected={view===id} className={view===id?'selected':''} onClick={()=>setView(id)}>{label}</button>)}
    </div>
    {view==='inbox'&&(inboxEntries.length?<div className="updates-list radar-inbox-list">{inboxEntries.map(entry=>{
      const isDownload=entry.type==='download';
      return <article className={'update-row radar-row '+(!entry.read?'unread':'')+(entry.suppressed?' suppressed':'')} key={entry.id}>
        <button className="update-open" onClick={()=>openUpdate(entry)} aria-label={`${isDownload?'Play downloaded':'Open'} ${entry.item?.title}, episode ${entry.episode?.number||entry.episode?.title}`}>
          <div className="update-cover"><Cover item={entry.item||{}}/></div>
          <span className="update-copy">
            <span className="update-eyebrow"><SourcePill source={entry.item?.source} compact/><b>{isDownload?'READY OFFLINE':'NEW EPISODE'}</b>{entry.suppressed?<b className="radar-muted-badge">MUTED/SNOOZED</b>:entry.rule?.mode==='inbox'&&<b>INBOX ONLY</b>}</span>
            <strong>{entry.item?.title}</strong>
            <span>{entry.episode?.number?`Episode ${entry.episode.number}`:entry.episode?.title||'New episode'} <i>·</i> {entry.time?prettyTime(entry.time):'Time not recorded'} <i>·</i> {isDownload?'Smart Download ready':'Found by Mikozora'}</span>
          </span><ChevronRight size={18} className="update-chevron"/>
        </button>
        <div className="radar-row-tools">
          <ReleaseRadarRuleControls item={entry.item} radar={releaseRadar} onChange={onReleaseRadarRule} compact/>
          {isDownload&&!entry.read&&<button className="text-link muted" type="button" onClick={()=>dismissRadarEntry(entry.id)}>Mark seen</button>}
        </div>
      </article>;
    })}</div>:<Empty icon={Bell} title={!state.watchedCount?'Nothing to check yet':waiting?'Getting your list ready':'All caught up'} body={!state.watchedCount?'Add titles to Favourites or a personal collection to follow their episodes.':waiting?'The first successful check records the episodes already available, so you only hear about later additions.':'New episodes and ready Smart Downloads will appear here after Mikozora finds them. Source availability can change.'} action={!state.watchedCount?openLibrary:undefined} actionLabel="Open library"/>)}
    {view==='digest'&&<section className="radar-digest" aria-label="Release Radar digest by series">
      {(radarView.digest||[]).length?(radarView.digest||[]).map(group=><article className="radar-digest-card" key={group.key}>
        <button className="radar-digest-main" type="button" onClick={()=>group.episodes?.[0]&&openUpdate(group.episodes[0])}><div className="update-cover"><Cover item={group.item||{}}/></div><span><strong>{group.item?.title}</strong><small>{group.count} discovered episode{group.count===1?'':'s'} · {group.visibleUnreadCount} visible unread · latest {group.latestEpisode?.number?`Episode ${group.latestEpisode.number}`:'episode'} {group.latestAt?prettyTime(group.latestAt):''}</small></span><ChevronRight size={18}/></button>
        <ReleaseRadarRuleControls item={group.item} radar={releaseRadar} onChange={onReleaseRadarRule} compact/>
      </article>):<Empty icon={Bell} title="No digest yet" body="When Mikozora finds new episodes, they will be grouped here by series."/>}
    </section>}
    {view==='calendar'&&<section className="radar-calendar" aria-label="Release Radar last fourteen days">
      <p className="radar-calendar-note">This is when Mikozora discovered episodes or finished Smart Downloads. It is not a source-provided airing calendar.</p>
      <div className="radar-calendar-grid">{(radarView.calendar||[]).map(day=><div key={day.key} className={day.count?'has-activity':''}><span>{day.label}</span><strong>{day.count}</strong><small>{day.episodeCount} episodes · {day.downloadCount} downloads</small></div>)}</div>
    </section>}
    {view==='activity'&&<section className="radar-activity" aria-label="Release Radar alert history by series">
      {(radarView.activity||[]).length?(radarView.activity||[]).map(activity=><article className="radar-activity-card" key={activity.key}>
        <div className="radar-activity-main"><div className="update-cover"><Cover item={activity.item||{}}/></div><div><strong>{activity.item?.title}</strong><p>{activity.latestAt?`Latest found ${prettyTime(activity.latestAt)}${activity.latestEpisode?.number?` · Episode ${activity.latestEpisode.number}`:''}`:'No discoveries recorded yet'} · {activity.last7Days} in 7 days · {activity.last30Days} in 30 days · {activity.totalKnown} total</p><small>{patternLabel(activity)}</small></div></div>
        <ReleaseRadarRuleControls item={activity.item} radar={releaseRadar} onChange={onReleaseRadarRule} compact/>
      </article>):<Empty icon={Bell} title="No followed series yet" body="Follow titles through Favourites or a personal collection and their local discovery history will appear here." action={openLibrary} actionLabel="Open library"/>}
    </section>}
    <p className="privacy-footnote"><ShieldCheck size={15}/> Updates stay on this device. Checks use the internet, and sources may change or be unavailable.</p>
  </div>;
}
function AppearanceSettings({appearance,changeAppearance}) {
  const current=ACCENTS.find(color=>color.id===appearance.accent);
  return <section className="settings-group appearance-settings" aria-labelledby="appearance-title">
    <div className="settings-title" id="appearance-title">APPEARANCE <span>YOUR STYLE</span></div>
    <div className="appearance-body">
      <div className="appearance-intro"><div className="appearance-intro-icon"><Sparkles size={19}/></div><div><strong>Make Mikozora feel like you</strong><p>Pick a look and a color. Changes appear right away.</p></div><span className="appearance-current">{appearance.mode==='dark'?'Dark':'Light'} · {current.label}</span></div>
      <fieldset className="appearance-field"><legend>MODE</legend><div className="appearance-modes">{MODES.map(mode=>{const Icon=mode.id==='dark'?Moon:Sun;return <button key={mode.id} type="button" className={'appearance-mode '+(appearance.mode===mode.id?'selected':'')} aria-label={`${mode.label} mode`} aria-pressed={appearance.mode===mode.id} onClick={()=>changeAppearance({mode:mode.id})}><span className="mode-icon"><Icon size={18}/></span><span className="mode-copy"><strong>{mode.label}</strong><small>{mode.detail}</small></span><span className="mode-check" aria-hidden="true">{appearance.mode===mode.id&&<Check size={13}/>}</span></button>})}</div></fieldset>
      <fieldset className="appearance-field"><legend>ACCENT COLOR</legend><div className="appearance-colors">{ACCENTS.map(color=><button key={color.id} type="button" className={'appearance-color '+(appearance.accent===color.id?'selected':'')} aria-label={`${color.label} accent`} aria-pressed={appearance.accent===color.id} onClick={()=>changeAppearance({accent:color.id})}><span className="color-swatch" style={{'--swatch':appearance.mode==='light'?color.light:color.dark,'--swatch-ink':appearance.mode==='light'?'#fff':'#18231a'}}>{appearance.accent===color.id&&<Check size={15} strokeWidth={3} aria-hidden="true"/>}</span><span>{color.label}</span></button>)}</div></fieldset>
    </div>
  </section>;
}
function DeviceSyncSettings({available=false,folder={},meta={},status={},choose=()=>{},disconnect=()=>{},syncNow=()=>{},changeAuto=()=>{}}) {
  const busy=['syncing','choosing','disconnecting'].includes(status.phase);
  const otherDevice=isDesktopApp()?'Android phone or tablet':'Windows PC';
  const updateText=isDesktopApp()?'Update Mikozora for Windows to use device sync':'Available in the Android app';
  const folderText=!available?updateText
    :!folder.configured?'No shared folder selected'
      :folder.granted?(folder.name||'Selected folder'):'Folder access lost · choose it again';
  const peerText=`${status.peerCount||0} other ${status.peerCount===1?'device':'devices'} found`;
  const deviceText=meta.deviceName||(isDesktopApp()?'This Windows PC':'This Android device');
  const statusText=status.phase==='syncing'?'Syncing now…'
    :status.phase==='choosing'?'Waiting for a folder choice…'
      :status.phase==='disconnecting'?'Disconnecting…'
        :meta.lastSyncAt?`Last synced ${prettyTime(meta.lastSyncAt)}`
          :folder.granted?'Not synced yet':`Choose the same shared folder here and on your ${otherDevice}.`;
  const ignoredText=status.ignoredPeerFiles?` · ${status.ignoredPeerFiles} unreadable sync ${status.ignoredPeerFiles===1?'file':'files'} ignored`:'';
  return <div className="settings-group device-sync-settings">
    <div className="settings-title">DEVICE SYNC <span>ANDROID ↔ WINDOWS</span></div>
    <div className="setting-row"><div className="setting-icon"><FolderHeart size={19}/></div><div><strong>Shared sync folder</strong><p className="folder-name">{folderText}</p></div><button onClick={choose} disabled={!available||busy}>{status.phase==='choosing'?'Choosing…':folder.configured?'Change':'Choose folder'}</button></div>
    <div className="setting-row"><div className="setting-icon"><RefreshCw size={19} className={status.phase==='syncing'?'spin':''}/></div><div><strong>Sync now</strong><p>{statusText}{folder.configured?<> · {peerText} · This device: {deviceText}{ignoredText}</>:''}</p></div><button onClick={syncNow} disabled={!available||!folder.granted||busy}>{status.phase==='syncing'?'Syncing…':'Sync'}</button></div>
    <div className="setting-row"><div className="setting-icon"><CheckCircle2 size={19}/></div><div><strong>Automatic sync</strong><p>When Mikozora opens, when you return to it, and shortly after your library or settings change.</p></div><button aria-label="Automatic device sync" aria-pressed={meta.autoSync!==false} disabled={!available||busy} onClick={()=>changeAuto(meta.autoSync===false)}>{meta.autoSync===false?'Off':'On'}</button></div>
    {status.phase==='error'&&status.message&&<div className="updates-error" role="alert"><AlertCircle size={16}/><span>{status.message}</span></div>}
    <div className="folder-explainer device-sync-explainer">
      <p>Choose a folder that Syncthing, OneDrive, Dropbox, a NAS, or another file-sync service already keeps on both devices. Mikozora writes only its own small JSON sync file there; your chosen service carries it between devices, so they do not need to be online at the same time. Choose that same folder on your {otherDevice} too.</p>
      <p><strong>Privacy:</strong> anyone or any service that can read this folder can see the title and watch metadata in Mikozora’s sync files; they are not end-to-end encrypted. Use only a folder and sync service you trust. Disconnecting stops future reads and writes, but leaves files already in the folder untouched.</p>
      <p>Library titles, collections, history, watch progress, personal ratings, shelf statuses and private notes, appearance, content preferences and Smart Downloads settings merge both ways—including later deletions, collection changes and episodes marked unwatched. Downloaded episodes and queues, download/export folder choices, app-update choices, offline playback positions, and episode-alert state stay on each device.</p>
      {folder.configured&&<button className="text-link" onClick={disconnect} disabled={busy}>{status.phase==='disconnecting'?'Disconnecting…':'Disconnect this device'}</button>}
    </div>
  </div>;
}
function SettingsPage({library,history,clearLibrary,clearHistory,openLicenses,openReleaseNotes,folder,chooseFolder,usePrivate,updates,updatesAvailable,changeAutomatic,changeAlerts,notificationPermission,appearance,changeAppearance,contentPrefs,changeContentPrefs,appUpdate,pendingUpdate,updateStatus,checkUpdate,changeAutoCheck,downloadUpdate,exportBackup,importBackup,smartDownloads,changeSmartDownloads,deviceSync,offlinePlayback,changeOfflinePlayback=()=>{},openDownloads,onlinePlayback,changeOnlinePlayback=()=>{},onlinePlayerAvailable=false,collections=[],progress=[],libraryMeta={},portability={},canUseTextFiles=false,saveTextFile,readTextFile,applyPortabilityResult=()=>{},notify=()=>{}}) {
  const current=!hasNativeDownloads()?(isDesktopApp()?'Unavailable in this Windows build':'Available in the Android app'):!folder?.configured?'Mikozora only · no external folder selected':folder.granted?folder.name||'Selected folder':'Folder access lost · choose it again';
  const notificationText=!updatesAvailable?'Available in the Android app':updates.notificationStatus==='allowed'?(isDesktopApp()?'Allowed in Windows':'Allowed in Android'):updates.notificationStatus==='permission'?'Android notification permission is needed':updates.notificationStatus==='channel-blocked'?'New episode channel is blocked in Android':(isDesktopApp()?'Notifications are blocked in Windows':'Notifications are blocked in Android');
  const updateText=pendingUpdate?`Mikozora ${pendingUpdate.version} is ready — you’re on ${APP_VERSION}.`:updateStatus.phase==='checking'?'Checking GitHub for a newer version…':updateStatus.phase==='error'?(updateStatus.message||'Could not check just now. Try again in a moment.'):appUpdate.lastCheck?`You’re up to date · Checked ${prettyTime(appUpdate.lastCheck)}`:`You’re on Mikozora ${APP_VERSION} · Not checked yet`;
  const smart=smartDownloads||{enabled:false,wifiOnly:true,maxUnwatchedPerSeries:3,notifyWhenReady:true,titleKeys:[],collectionIds:[],presets:{}};
  const smartAvailable=updatesAvailable&&hasNativeDownloads();
  const smartSelectionText=`${smart.titleKeys.length} ${smart.titleKeys.length===1?'series':'series'} · ${smart.collectionIds.length} ${smart.collectionIds.length===1?'collection':'collections'} selected`;
  const playback=normalizeOfflinePlayback(offlinePlayback);
  return <div className="content page-content"><div className="page-heading"><div><div className="eyebrow">MAKE YOURSELF AT HOME</div><h1>Your space, your way<span>.</span></h1><p>A simple little place for your anime.</p></div><div className="heading-art"><Settings2 size={32}/><span>✦</span></div></div>
    <AppearanceSettings appearance={appearance} changeAppearance={changeAppearance}/>
    <OnlinePlayerSettings onlinePlayback={onlinePlayback} changeOnlinePlayback={changeOnlinePlayback} playback={offlinePlayback} changeOfflinePlayback={changeOfflinePlayback} available={onlinePlayerAvailable}/>
    <div className="settings-group content-settings"><div className="settings-title">CONTENT <span>AGE RATINGS &amp; NSFW</span></div><div className="setting-row"><div className="setting-icon"><EyeOff size={19}/></div><div><strong>Hide NSFW content</strong><p>{contentPrefs.hideNsfw?'On · Adult-marked titles are hidden':'Off · Adult-marked titles can appear'}</p></div><button aria-label="Hide NSFW content" aria-pressed={!!contentPrefs.hideNsfw} onClick={()=>changeContentPrefs({hideNsfw:!contentPrefs.hideNsfw})}>{contentPrefs.hideNsfw?'On':'Off'}</button></div>
      <div className="folder-explainer content-explainer"><p>When on, titles a source marks 18+ or with adult genres such as Ecchi or Hentai are completely hidden — from Discover, Browse, search results, your Library and History — and cannot be opened. This is separate from the Browse content filter and stays on until you turn it off.</p><p>Nothing is deleted: your library, collections, history and downloads stay exactly as they are. Every card shows the age rating its source provides, or NR when it provides none. Sources do not label every title, so hiding NSFW cannot guarantee everything shown is suitable for all ages.</p></div>
    </div>
    <div className="settings-group episode-settings"><div className="settings-title">EPISODE UPDATES <span>YOUR COLLECTIONS</span></div><div className="setting-row"><div className="setting-icon"><RefreshCw size={19}/></div><div><strong>Automatic checks</strong><p>{isDesktopApp()?'On open and about every 6 hours while Mikozora is open or resting in the system tray. Closing the window keeps checks running in the tray.':'On open and about every 6 hours while connected. Android can delay checks or pause them after a force-stop.'}</p></div><button aria-label="Automatic episode checks" aria-pressed={!!updates.automatic} disabled={!updatesAvailable} onClick={()=>changeAutomatic(!updates.automatic)}>{updates.automatic?'On':'Off'}</button></div><div className="setting-row"><div className="setting-icon"><Bell size={19}/></div><div><strong>{isDesktopApp()?'Windows':'Android'} episode alerts</strong><p>{updates.alerts?'On in Mikozora':'Off in Mikozora'} · New episodes still appear in Updates.</p></div><button aria-label={isDesktopApp()?'Windows episode alerts':'Android episode alerts'} aria-pressed={!!updates.alerts} disabled={!updatesAvailable} onClick={()=>changeAlerts(!updates.alerts)}>{updates.alerts?'On':'Off'}</button></div><div className="setting-row"><div className="setting-icon"><ShieldCheck size={19}/></div><div><strong>{isDesktopApp()?'Windows':'Android'} notification access</strong><p>{notificationText}</p></div><button disabled={!updatesAvailable} onClick={notificationPermission}>{updates.notificationStatus==='permission'?'Allow':'Manage'}</button></div></div>
    <div className="settings-group smart-download-settings"><div className="settings-title">SMART DOWNLOADS <span>NEW EPISODES</span></div>
      <div className="setting-row"><div className="setting-icon"><Sparkles size={19}/></div><div><strong>Download new episodes automatically</strong><p>{isDesktopApp()?'For selected series while Mikozora is open or resting in the system tray.':'For selected series after episode checks, including Android background checks.'}</p></div><button aria-label="Smart downloads" aria-pressed={!!smart.enabled} disabled={!smartAvailable} onClick={()=>changeSmartDownloads({enabled:!smart.enabled})}>{smart.enabled?'On':'Off'}</button></div>
      <div className="setting-row"><div className="setting-icon"><FolderHeart size={19}/></div><div><strong>Selected stories</strong><p>{smartSelectionText}. Choose a series from its page, or a whole collection in Library.</p></div></div>
      <div className="setting-row"><div className="setting-icon"><ShieldCheck size={19}/></div><div><strong>Wi‑Fi only on Android</strong><p>{isDesktopApp()?'Applies on Android. Windows cannot reliably report a metered connection, so Smart downloads may use any connection here.':'Automatic downloads wait for an unmetered connection and pause if you switch to mobile data. Manual downloads are unchanged.'}</p></div><button aria-label="Smart downloads on Wi-Fi only" aria-pressed={!!smart.wifiOnly} disabled={!smartAvailable} onClick={()=>changeSmartDownloads({wifiOnly:!smart.wifiOnly})}>{smart.wifiOnly?'On':'Off'}</button></div>
      <div className="setting-row"><div className="setting-icon"><HardDrive size={19}/></div><div><strong>Unwatched limit per series</strong><p>Keep at most this many unwatched auto-downloaded episodes. Newer episodes wait until you watch one.</p></div><select className="smart-select" aria-label="Maximum unwatched Smart downloads per series" value={smart.maxUnwatchedPerSeries} disabled={!smartAvailable} onChange={e=>changeSmartDownloads({maxUnwatchedPerSeries:Number(e.target.value)})}>{[1,2,3,5,10].map(value=><option key={value} value={value}>{value} {value===1?'episode':'episodes'}</option>)}</select></div>
      <div className="setting-row"><div className="setting-icon"><Bell size={19}/></div><div><strong>Ready notifications</strong><p>Tell me when an automatically downloaded episode is ready offline.{smart.notifyWhenReady&&updates.notificationStatus!=='allowed'?' Notification access is needed above.':''}</p></div><button aria-label="Smart download ready notifications" aria-pressed={!!smart.notifyWhenReady} disabled={!smartAvailable} onClick={()=>changeSmartDownloads({notifyWhenReady:!smart.notifyWhenReady})}>{smart.notifyWhenReady?'On':'Off'}</button></div>
      <div className="folder-explainer smart-explainer"><p>Use <strong>Smart downloads</strong> on a series page or in a collection’s Library toolbar. A standalone series is added to Favourites so Mikozora can follow its episodes. The first check quietly records what already exists, so Smart downloads never fetch a backlog.</p><p>Each series reuses the server, quality and subtitle choices from the last manual download Mikozora successfully queued for it. Invalid saved choices fall back to Automatic and Best; a valid server that is unavailable for a particular episode fails clearly rather than silently switching, just like a manual download.</p></div>
    </div>
    <div className="settings-group folder-settings"><div className="settings-title">DOWNLOAD LOCATION <span>EXTERNAL PLAYER</span></div><div className="setting-row"><div className="setting-icon"><FolderHeart size={19}/></div><div><strong>Playable copies</strong><p className="folder-name">{current}</p></div><button onClick={chooseFolder} disabled={!hasNativeDownloads()}>{folder?.configured?'Change':'Choose folder'}</button></div>
      <div className="folder-explainer"><p>New playable MP4 copies are organized into a folder for each anime or donghua. Existing downloads can be saved from Downloads; earlier exported files stay where they are.</p><p>After Mikozora verifies the saved video and subtitle files, it removes its private copy to free space. Mikozora then plays the file from your folder. If verification fails or subtitles cannot be safely copied, the private copy stays. Downloading and conversion still need extra storage temporarily.</p>{folder?.configured&&<button className="text-link" onClick={usePrivate}>Stop saving folder copies</button>}</div>
    </div>
    <div className="settings-group offline-playback-settings"><div className="settings-title">OFFLINE PLAYBACK <span>ANDROID &amp; WINDOWS</span></div>
      <div className="setting-row"><div className="setting-icon"><Gauge size={19}/></div><div><strong>Remembered speed</strong><p>Saved episodes open at this playback speed.</p></div><select className="smart-select" aria-label="Remembered offline playback speed" value={playback.playbackRate} onChange={event=>changeOfflinePlayback({playbackRate:Number(event.target.value)})}>{OFFLINE_PLAYBACK_RATES.map(rate=><option key={rate} value={rate}>{rate}×</option>)}</select></div>
      <div className="setting-row"><div className="setting-icon"><Clock3 size={19}/></div><div><strong>Seek buttons</strong><p>How far the back and forward buttons move in the offline player. On Windows, the arrow keys use it too.</p></div><select className="smart-select" aria-label="Offline seek length" value={playback.seekSeconds} onChange={event=>changeOfflinePlayback({seekSeconds:Number(event.target.value)})}>{OFFLINE_SEEK_SECONDS.map(seconds=><option key={seconds} value={seconds}>±{seconds} seconds</option>)}</select></div>
      <div className="setting-row"><div className="setting-icon"><Film size={19}/></div><div><strong>Subtitle size</strong><p>Text size for separate subtitle files saved with downloads.</p></div><select className="smart-select" aria-label="Offline subtitle size" value={playback.subtitleSize} onChange={event=>changeOfflinePlayback({subtitleSize:Number(event.target.value)})}>{OFFLINE_SUBTITLE_SIZES.map(size=><option key={size} value={size}>{size}px</option>)}</select></div>
      <div className="setting-row"><div className="setting-icon"><Sparkles size={19}/></div><div><strong>Subtitle color</strong><p>Choose the text color used by the offline players.</p></div><select className="smart-select" aria-label="Offline subtitle color" value={playback.subtitleColor} onChange={event=>changeOfflinePlayback({subtitleColor:event.target.value})}>{OFFLINE_SUBTITLE_COLORS.map(color=><option key={color.id} value={color.id}>{color.label}</option>)}</select></div>
      <div className="setting-row"><div className="setting-icon"><ShieldCheck size={19}/></div><div><strong>Subtitle background</strong><p>Keep captions readable over bright scenes, or turn the background off.</p></div><select className="smart-select" aria-label="Offline subtitle background" value={playback.subtitleBackground} onChange={event=>changeOfflinePlayback({subtitleBackground:event.target.value})}>{OFFLINE_SUBTITLE_BACKGROUNDS.map(background=><option key={background.id} value={background.id}>{background.label}</option>)}</select></div>
      <div className="setting-row"><div className="setting-icon"><Moon size={19}/></div><div><strong>Sleep timer</strong><p>Pause a downloaded episode after this long, starting when the offline player opens.</p></div><select className="smart-select" aria-label="Offline sleep timer" value={playback.sleepTimerMinutes} onChange={event=>changeOfflinePlayback({sleepTimerMinutes:Number(event.target.value)})}>{OFFLINE_SLEEP_MINUTES.map(minutes=><option key={minutes} value={minutes}>{minutes?`${minutes} minutes`:'Off'}</option>)}</select></div>
      <div className="setting-row"><div className="setting-icon"><Play size={19}/></div><div><strong>Auto-play next download</strong><p>Continue with the next completed episode from the same series when one is already saved.</p></div><button aria-label="Auto-play next downloaded episode" aria-pressed={playback.autoPlayNext} onClick={()=>changeOfflinePlayback({autoPlayNext:!playback.autoPlayNext})}>{playback.autoPlayNext?'On':'Off'}</button></div>
      <div className="setting-row"><div className="setting-icon"><HardDrive size={19}/></div><div><strong>Offline Manager</strong><p>Storage by series and source, watched cleanup, bulk actions, and queue order.</p></div><button onClick={openDownloads}>Open</button></div>
      <div className="folder-explainer"><p>Mikozora opens saved episodes with these choices on Android and Windows. Changing speed inside the Windows player updates the remembered speed; Android carries a speed change through an auto-play chain. Burned-in subtitles are part of the video and cannot be restyled.</p></div>
    </div>
    <DeviceSyncSettings {...deviceSync}/>
    <LibraryPortabilitySettings library={library} collections={collections} libraryMeta={libraryMeta} progress={progress} portability={portability} canUseFiles={canUseTextFiles} saveText={saveTextFile} readText={readTextFile} onApply={applyPortabilityResult} notify={notify}/>
    <div className="settings-group"><div className="settings-title">YOUR DATA <span>ON THIS DEVICE</span></div><div className="setting-row"><div className="setting-icon"><Bookmark size={19}/></div><div><strong>Saved library</strong><p>{library.length} {library.length===1?'title':'titles'} saved locally</p></div><button onClick={clearLibrary} disabled={!library.length}>Clear</button></div><div className="setting-row"><div className="setting-icon"><History size={19}/></div><div><strong>Watch history</strong><p>{history.length} recently opened {history.length===1?'episode':'episodes'}</p></div><button onClick={clearHistory} disabled={!history.length}>Clear</button></div><div className="setting-row"><div className="setting-icon"><HardDrive size={19}/></div><div><strong>Back up your data</strong><p>Save your library, collections, personal ratings, notes and shelf statuses, history, watch progress, linked source versions and settings to a file you keep. Downloaded videos are not included.</p></div><button onClick={exportBackup}>Export</button></div><div className="setting-row"><div className="setting-icon"><RotateCcw size={19}/></div><div><strong>Restore a backup</strong><p>Replace this device's library, collections, personal shelf, history, progress, linked source versions and settings with a backup file.</p></div><button onClick={importBackup}>Import</button></div></div><div className="settings-group"><div className="settings-title">ABOUT <span>MIKOZORA {APP_VERSION}</span></div><div className="setting-row"><div className="setting-icon"><Download size={19}/></div><div><strong>App updates</strong><p>{updateText}</p></div>{pendingUpdate?<button onClick={downloadUpdate}>Download</button>:<button onClick={()=>checkUpdate(true)} disabled={updateStatus.phase==='checking'}>{updateStatus.phase==='checking'?'Checking…':updateStatus.phase==='error'?'Try again':'Check'}</button>}</div><div className="setting-row"><div className="setting-icon"><RefreshCw size={19}/></div><div><strong>Check automatically</strong><p>Check GitHub when Mikozora starts, when you return to it, and periodically while it stays open.</p></div><button aria-label="Automatic update checks" aria-pressed={!!appUpdate.autoCheck} onClick={()=>changeAutoCheck(!appUpdate.autoCheck)}>{appUpdate.autoCheck?'On':'Off'}</button></div><div className="setting-row"><div className="setting-icon"><ShieldCheck size={19}/></div><div><strong>Private by default</strong><p>Your library, collections and history stay on this device. No account is required.</p></div></div><div className="setting-row"><div className="setting-icon"><Film size={19}/></div><div><strong>Player availability</strong><p>Video hosts may restrict embedding or be unavailable. Try another server or open the source page.</p></div></div><div className="setting-row"><div className="setting-icon"><Sparkles size={19}/></div><div><strong>What’s new</strong><p>See the latest changes to Mikozora.</p></div><button onClick={openReleaseNotes}>View</button></div><div className="setting-row"><div className="setting-icon"><CircleHelp size={19}/></div><div><strong>Open source licenses</strong><p>Credits and licenses for Mikozora and its dependencies.</p></div><button onClick={openLicenses}>View</button></div></div></div>;
}
function PlayerModal({player,close,onEpisode,watched,markWatched,onlinePrefs,playbackPrefs,onPlaybackRateChange=()=>{},onPosition=()=>{},onEnded=()=>{},onFallback=()=>{},notify=()=>{}}) {
  const servers=Array.isArray(player.servers)?player.servers:[];
  const direct=player.mode==='direct'&&!!player.stream;
  const [current,setCurrent]=useState(0);
  const [switching,setSwitching]=useState(false);
  const [episodeJump,setEpisodeJump]=useState('');
  const [jumpError,setJumpError]=useState('');
  const episodeRail=useRef(null);
  const episodes=Array.isArray(player.episodes)&&player.episodes.length?player.episodes:[player.episode];
  const episodeIndex=Number.isInteger(player.episodeIndex)&&episodes[player.episodeIndex]?.url===player.episode.url
    ? player.episodeIndex
    : Math.max(0,episodes.findIndex(episode=>episode.url===player.episode.url));
  const previous=episodeIndex>0?episodes[episodeIndex-1]:null;
  const next=episodeIndex>=0&&episodeIndex<episodes.length-1?episodes[episodeIndex+1]:null;
  const watchedSet=watched || new Set();
  const watchedCount=episodes.filter(episode=>watchedSet.has(episode.url)).length;
  const currentWatched=watchedSet.has(player.episode.url);
  const unwatchedCandidate=firstUnwatchedEpisode(episodes,watchedSet);
  const nextUnwatched=unwatchedCandidate?.url===player.episode.url?null:unwatchedCandidate;

  useEffect(()=>{setCurrent(0);setSwitching(false);setEpisodeJump('');setJumpError('');},[player.episode.url]);
  useEffect(()=>{
    const frame=requestAnimationFrame(()=>{
      episodeRail.current?.querySelector(`[data-episode-index="${episodeIndex}"]`)
        ?.scrollIntoView({block:'nearest',inline:'center'});
    });
    return()=>cancelAnimationFrame(frame);
  },[episodeIndex,episodes.length]);

  const choose=async episode=>{
    if(!episode||episode.url===player.episode.url||switching||typeof onEpisode!=='function')return;
    setSwitching(true);
    try{await onEpisode(episode);}finally{setSwitching(false);}
  };
  const cycleServer=delta=>{if(servers.length)setCurrent(previousIndex=>wrappedIndex(previousIndex,delta,servers.length));};
  const jumpToEpisode=event=>{
    event.preventDefault();
    const target=findEpisodeByNumber(episodes,episodeJump);
    if(!target){setJumpError(episodeJump?`Episode ${episodeJump} is not in this list.`:'Enter an episode number.');return;}
    setJumpError('');
    void choose(target);
  };
  const toggleCurrentWatched=()=>markWatched?.(player.item,[player.episode],!currentWatched);
  useEffect(()=>{
    const onKey=event=>{
      const active=document.activeElement;
      if(active&&(active.tagName==='INPUT'||active.tagName==='TEXTAREA'||active.tagName==='SELECT'||active.isContentEditable))return;
      if(event.key==='Escape'){event.preventDefault();close();}
      else if(!direct&&event.key==='ArrowLeft'&&previous){event.preventDefault();void choose(previous);}
      else if(!direct&&event.key==='ArrowRight'&&next){event.preventDefault();void choose(next);}
      else if(event.key==='['&&servers.length>1){event.preventDefault();cycleServer(-1);}
      else if(event.key===']'&&servers.length>1){event.preventDefault();cycleServer(1);}
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[close,previous,next,player.episode.url,servers.length,switching,direct]);

  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><div className="player-modal" role="dialog" aria-modal="true" aria-label="Episode player" onMouseDown={e=>e.stopPropagation()}>
    <div className="player-header"><div><span className="eyebrow">{direct?'NOW PLAYING · DIRECT STREAM':'NOW PLAYING · EMBEDDED PLAYER'}</span><h2>{player.item.title}</h2><p>Episode {player.episode.number} · {sourceName(player.item.source)}{direct?' · Mikozora player: exact resume, speed, seeking and sleep timer available':' · Embedded: the server keeps control of position and playback'}</p></div><button className="icon-btn" onClick={close} aria-label="Close player"><X size={20}/></button></div>
    {direct?<DirectOnlinePlayer stream={player.stream} episode={player.episode} startSeconds={player.startSeconds||0} onlinePrefs={onlinePrefs} playbackPrefs={playbackPrefs} onPlaybackRateChange={onPlaybackRateChange} onPosition={onPosition} onEnded={onEnded} onFallback={onFallback} notify={notify}/>:<div className="iframe-wrap"><iframe key={`${player.episode.url}|${servers[current]?.url||''}`} src={servers[current]?.url} title={`${player.item.title} episode ${player.episode.number}`} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen referrerPolicy="no-referrer-when-downgrade"/></div>}
    {episodes.length>1&&<section className="player-episode-browser" aria-label="Episode navigation">
      <div className="player-episode-heading"><span>EPISODES</span><strong aria-live="polite">{episodeIndex+1} of {episodes.length}{watchedCount>0?` · ${watchedCount} watched`:''}</strong></div>
      <div className="player-episode-nav">
        <button className="btn secondary player-nav-button" disabled={!previous||switching} onClick={()=>choose(previous)} aria-label={previous?`Previous episode ${previous.number}`:'Previous episode'}><ChevronLeft size={16}/> Previous</button>
        <div className="player-episode-rail" ref={episodeRail} aria-label="Scrollable episode list">{episodes.map((episode,index)=><button key={`${episode.url}-${index}`} type="button" data-episode-index={index} className={'player-episode-chip'+(index===episodeIndex?' current':'')+(index!==episodeIndex&&watchedSet.has(episode.url)?' watched':'')} disabled={switching} onClick={()=>choose(episode)} aria-label={`Play episode ${episode.number}`} aria-current={index===episodeIndex?'true':undefined} title={episode.title||`Episode ${episode.number}`}>{index!==episodeIndex&&watchedSet.has(episode.url)&&<Check size={11}/>}{episode.number}</button>)}</div>
        <button className="btn secondary player-nav-button" disabled={!next||switching} onClick={()=>choose(next)} aria-label={next?`Next episode ${next.number}`:'Next episode'}>Next <ChevronRight size={16}/></button>
      </div>
      <div className="player-episode-actions">
        <button className="btn secondary" disabled={!nextUnwatched||switching} onClick={()=>nextUnwatched&&choose(nextUnwatched)}><Play size={14} fill="currentColor"/>{nextUnwatched?`Next unwatched · ${nextUnwatched.number}`:'All watched'}</button>
        <form className="player-jump" onSubmit={jumpToEpisode}><label htmlFor="player-episode-jump">EPISODE #</label><input id="player-episode-jump" inputMode="decimal" value={episodeJump} onChange={event=>{setEpisodeJump(event.target.value);setJumpError('');}} placeholder="Jump" aria-label="Jump to episode number"/><button className="btn secondary" type="submit" disabled={switching}>Go</button></form>
        <button className={'btn secondary '+(currentWatched?'is-saved':'')} onClick={toggleCurrentWatched} disabled={!markWatched} aria-pressed={currentWatched}><Check size={14}/>{currentWatched?'Mark unwatched':'Mark watched'}</button>
      </div>
      {jumpError&&<p className="player-jump-error" role="alert">{jumpError}</p>}
      {switching&&<p className="player-switching" role="status"><LoaderCircle size={14} className="spin"/> Finding servers for the selected episode…</p>}
    </section>}
    {direct?<div className="player-controls direct-mode-controls"><span className="direct-mode-label"><CheckCircle2 size={16}/> Direct stream · exact position saved by Mikozora</span>{episodes.length===1&&<button className={'btn secondary '+(currentWatched?'is-saved':'')} onClick={toggleCurrentWatched} disabled={!markWatched} aria-pressed={currentWatched}><Check size={14}/>{currentWatched?'Mark unwatched':'Mark watched'}</button>}<button className="btn secondary" type="button" onClick={onFallback}>Use embedded player</button><button className="btn secondary" onClick={()=>external(player.episode.url)}>Open source <ExternalLink size={15}/></button></div>:<div className="player-controls"><label>VIDEO SERVER<select value={current} onChange={e=>setCurrent(Number(e.target.value))}>{servers.map((s,i)=><option value={i} key={i}>{s.name}</option>)}</select></label>{servers.length>1&&<div className="server-cycle" aria-label="Switch video server"><button type="button" onClick={()=>cycleServer(-1)} aria-label="Previous video server"><ChevronLeft size={15}/></button><span>{current+1}/{servers.length}</span><button type="button" onClick={()=>cycleServer(1)} aria-label="Next video server"><ChevronRight size={15}/></button></div>}{episodes.length===1&&<button className={'btn secondary '+(currentWatched?'is-saved':'')} onClick={toggleCurrentWatched} disabled={!markWatched} aria-pressed={currentWatched}><Check size={14}/>{currentWatched?'Mark unwatched':'Mark watched'}</button>}<button className="btn secondary" onClick={()=>external(player.episode.url)}>Open source <ExternalLink size={15}/></button></div>}
    <p className="player-shortcuts">{direct?'Shortcuts: use the video controls for seeking · Esc close':'Shortcuts: ←/→ episodes · [ / ] servers · Esc close'}</p>
    {direct?<p className="player-disclaimer">This episode is playing from a direct stream in Mikozora’s own player. Exact position, remembered speed, configurable seeking, separate subtitle styling, sleep timer and auto-next are handled by Mikozora on this device.</p>:<p className="player-disclaimer"><strong>Embedded player.</strong> {player.directError?`${player.directError} `:''}Video is provided by the selected third-party server. If it doesn’t load here, try another server or open the original site. Playback position, speed and seeking inside an embedded episode stay with that server’s player and cannot be reported to Mikozora; Mikozora’s controls handle episodes, servers and watched marks.</p>}
  </div></div>;
}
function OfflinePlayerModal({entry,close,prefs,changePrefs=()=>{},downloads=[],playOffline,notify}) {
  const cleanPrefs=normalizeOfflinePlayback(prefs);
  const videoRef=useRef(null); const wrapRef=useRef(null); const saveTick=useRef(0); const endedRef=useRef(false);
  const [failed,setFailed]=useState(false); const [playbackRate,setPlaybackRate]=useState(cleanPrefs.playbackRate);
  const [sleepEndsAt,setSleepEndsAt]=useState(0); const [sleepRemainingSeconds,setSleepRemainingSeconds]=useState(0);
  const download=entry.download||downloads.find(d=>d.id===entry.id)||{};
  const nextDownloads=useMemo(()=>nextDownloadedEpisodes(downloads,download,20),[downloads,download.id,download.episode?.url]);
  const nextDownload=nextDownloads[0]||null;
  const tracks=download.storageMode==='folder'?(Array.isArray(download.exportTracks)?download.exportTracks:[]):(Array.isArray(download.tracks)?download.tracks:[]);
  const token=encodeURIComponent(entry.token||'');
  const positionKey='moku.offlinePositions.v1';
  const sleepKey='moku.offlineSleepDeadline.v1';
  const savePosition=()=>{
    const video=videoRef.current;if(!video||!Number.isFinite(video.duration)||!video.duration)return;
    try{
      const all=JSON.parse(localStorage.getItem(positionKey)||'{}');
      if(video.currentTime>5&&video.currentTime<video.duration-10)all[entry.id]=Math.floor(video.currentTime);else delete all[entry.id];
      localStorage.setItem(positionKey,JSON.stringify(all));
    }catch{/* position memory is best-effort */}
  };
  const clearSleepDeadline=()=>{try{sessionStorage.removeItem(sleepKey);}catch{/* best effort */}};
  const closePlayer=()=>{savePosition();clearSleepDeadline();close();};
  const applyPlaybackRate=value=>{
    const next=normalizeOfflinePlayback({...cleanPrefs,playbackRate:value}).playbackRate;
    setPlaybackRate(next);
    if(videoRef.current)videoRef.current.playbackRate=next;
    changePrefs({playbackRate:next});
  };
  const seekBy=seconds=>{
    const video=videoRef.current;if(!video)return;
    const duration=Number.isFinite(video.duration)&&video.duration>0?video.duration:Number.POSITIVE_INFINITY;
    video.currentTime=Math.max(0,Math.min(duration,video.currentTime+seconds));
    savePosition();
  };
  const restart=()=>{
    const video=videoRef.current;if(!video)return;
    video.currentTime=0;
    void video.play?.().catch(()=>{});
    savePosition();
  };
  const toggleFullscreen=async()=>{
    try{
      if(document.fullscreenElement)await document.exitFullscreen();
      else await wrapRef.current?.requestFullscreen?.();
    }catch{/* the video element's own fullscreen control remains available */}
  };
  const cyclePlaybackRate=delta=>{
    const index=Math.max(0,OFFLINE_PLAYBACK_RATES.indexOf(playbackRate));
    applyPlaybackRate(OFFLINE_PLAYBACK_RATES[wrappedIndex(index,delta,OFFLINE_PLAYBACK_RATES.length)]);
  };
  const cancelSleepTimer=()=>{
    clearSleepDeadline();
    setSleepEndsAt(0);
    setSleepRemainingSeconds(0);
    notify?.('Sleep timer off for this episode');
  };
  const handleEnded=()=>{
    savePosition();
    if(endedRef.current)return;
    endedRef.current=true;
    if(cleanPrefs.autoPlayNext&&nextDownload){
      notify?.(`Next offline episode ${nextDownload.episode?.number||''}`);
      playOffline?.(nextDownload);
    }
  };
  const playNextDownload=()=>{
    if(!nextDownload||endedRef.current)return;
    endedRef.current=true;
    savePosition();
    playOffline?.(nextDownload);
  };
  useEffect(()=>{endedRef.current=false;setFailed(false);},[entry.id]);
  useEffect(()=>{
    if(cleanPrefs.sleepTimerMinutes<=0){setSleepEndsAt(0);setSleepRemainingSeconds(0);return;}
    let deadline=0;
    try{deadline=Number(sessionStorage.getItem(sleepKey))||0;}catch{/* start a fresh timer */}
    if(deadline<=Date.now()){
      deadline=Date.now()+cleanPrefs.sleepTimerMinutes*60000;
      try{sessionStorage.setItem(sleepKey,String(deadline));}catch{/* this session only */}
    }
    setSleepEndsAt(deadline);
    setSleepRemainingSeconds(Math.max(0,Math.ceil((deadline-Date.now())/1000)));
  },[entry.id,cleanPrefs.sleepTimerMinutes]);
  useEffect(()=>{
    if(!sleepEndsAt)return;
    const tick=()=>{
      const remaining=Math.ceil((sleepEndsAt-Date.now())/1000);
      setSleepRemainingSeconds(Math.max(0,remaining));
      if(remaining<=0){
        const video=videoRef.current;
        if(video){savePosition();video.pause();}
        clearSleepDeadline();
        setSleepEndsAt(0);
        notify?.('Sleep timer paused playback');
      }
    };
    tick();
    const timer=setInterval(tick,1000);
    return()=>clearInterval(timer);
  },[sleepEndsAt,entry.id]);
  useEffect(()=>{
    const key=e=>{
      const active=document.activeElement;
      if(active&&(active.tagName==='INPUT'||active.tagName==='TEXTAREA'||active.tagName==='SELECT'||active.isContentEditable))return;
      if(e.key==='Escape'&&!document.fullscreenElement)closePlayer();
      else if(e.key==='ArrowLeft'){e.preventDefault();seekBy(-cleanPrefs.seekSeconds);}
      else if(e.key==='ArrowRight'){e.preventDefault();seekBy(cleanPrefs.seekSeconds);}
      else if(e.key==='Home'){e.preventDefault();restart();}
      else if(e.key.toLowerCase()==='f'){e.preventDefault();void toggleFullscreen();}
      else if(e.key==='['){e.preventDefault();cyclePlaybackRate(-1);}
      else if(e.key===']'){e.preventDefault();cyclePlaybackRate(1);}
    };
    window.addEventListener('keydown',key);
    return()=>window.removeEventListener('keydown',key);
  },[entry.id,playbackRate,cleanPrefs.seekSeconds]);
  const restorePosition=()=>{
    const video=videoRef.current;if(!video||!Number.isFinite(video.duration))return;
    video.playbackRate=playbackRate;
    try{
      const all=JSON.parse(localStorage.getItem(positionKey)||'{}');
      const saved=Number(all[entry.id])||0;
      if(saved>5&&saved<video.duration-10)video.currentTime=saved;
    }catch{/* start at the beginning */}
  };
  const rememberPosition=()=>{
    const now=Date.now();if(now-saveTick.current<5000)return;saveTick.current=now;savePosition();
  };
  const sleepLabel=sleepEndsAt?`${Math.floor(sleepRemainingSeconds/60)}:${String(sleepRemainingSeconds%60).padStart(2,'0')}`:'';
  return <div className="modal-backdrop" role="presentation" onMouseDown={closePlayer}><div className="player-modal offline-player-modal" role="dialog" aria-modal="true" aria-label="Offline episode player" onMouseDown={e=>e.stopPropagation()}>
    <div className="player-header"><div><span className="eyebrow">OFFLINE · SAVED ON THIS PC</span><h2>{download.item?.title||'Downloaded episode'}</h2><p>Episode {download.episode?.number||''}{download.item?.source?` · ${sourceName(download.item.source)}`:''}</p></div><button className="icon-btn" onClick={closePlayer} aria-label="Close offline player"><X size={20}/></button></div>
    <div className="offline-video-wrap" ref={wrapRef} style={offlineSubtitleStyle(cleanPrefs)}><video ref={videoRef} controls autoPlay playsInline preload="metadata" onLoadedMetadata={restorePosition} onTimeUpdate={rememberPosition} onPause={savePosition} onEnded={handleEnded} onError={()=>setFailed(true)}>
      <source src={`mikozora://app/api/download/${entry.id}/video?token=${token}`} type="video/mp4"/>
      {tracks.map((track,index)=><track key={`${track.file||track.path||index}-${index}`} kind="subtitles" src={`mikozora://app/api/download/${entry.id}/subtitle/${index}?token=${token}`} srcLang={track.language||'und'} label={track.label||`Subtitles ${index+1}`} default={!!track.preferred||index===0}/>)}
    </video></div>
    <div className="offline-controls" aria-label="Offline playback tools">
      <button type="button" onClick={()=>seekBy(-cleanPrefs.seekSeconds)} aria-label={`Back ${cleanPrefs.seekSeconds} seconds`}>−{cleanPrefs.seekSeconds}s</button>
      <button type="button" onClick={restart}><RotateCcw size={14}/> Restart</button>
      <label>SPEED<select aria-label="Offline playback speed" value={playbackRate} onChange={event=>applyPlaybackRate(event.target.value)}>{OFFLINE_PLAYBACK_RATES.map(rate=><option key={rate} value={rate}>{rate}×</option>)}</select></label>
      <button type="button" onClick={()=>seekBy(cleanPrefs.seekSeconds)} aria-label={`Forward ${cleanPrefs.seekSeconds} seconds`}>+{cleanPrefs.seekSeconds}s</button>
      {nextDownload&&<button type="button" onClick={playNextDownload}><Play size={14} fill="currentColor"/> Next EP {nextDownload.episode?.number||''}</button>}
      {sleepEndsAt>0&&<button type="button" onClick={cancelSleepTimer} aria-label="Cancel sleep timer"><Moon size={14}/> Sleep {sleepLabel} · Cancel</button>}
      <button type="button" onClick={toggleFullscreen}><Maximize size={14}/> Fullscreen</button>
    </div>
    {failed?<p className="offline-player-note offline-player-error"><AlertCircle size={14}/> Could not play this saved file. Check that it still exists, or remove and download the episode again.</p>:<p className="offline-player-note"><Check size={14}/> Playing only from this computer. Your place is remembered on this device. Shortcuts: ←/→ seek {cleanPrefs.seekSeconds} seconds · [ / ] speed · F fullscreen.{sleepEndsAt?` Sleep timer pauses in ${sleepLabel}.`:''}{nextDownload&&cleanPrefs.autoPlayNext?` Next downloaded episode ${nextDownload.episode?.number||''} will play automatically.`:''}</p>}
  </div></div>;
}
function LicenseModal({close}) {
  const [text,setText]=useState('Loading licenses...');
  useEffect(()=>{fetch('/licenses.txt').then(r=>{if(!r.ok)throw new Error();return r.text()}).then(setText).catch(()=>setText('Licenses are available in the source distribution.'));},[]);
  return <div className="modal-backdrop" onMouseDown={close}><div className="license-modal" role="dialog" aria-modal="true" aria-label="Open source licenses" onMouseDown={e=>e.stopPropagation()}><div className="player-header"><div><span className="eyebrow">CREDITS &amp; LICENSES</span><h2>Open source licenses</h2></div><button className="icon-btn" onClick={close} aria-label="Close licenses"><X size={20}/></button></div><pre>{text}</pre></div></div>;
}
function WelcomeScreen({mode,manual,onContinue}) {
  const heading=useRef(null), isNew=mode==='intro';
  useEffect(()=>{
    window.scrollTo(0,0);
    heading.current?.focus({preventScroll:true});
    const key=e=>{if(e.key==='Escape'){e.preventDefault();onContinue();}};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[]);
  const tour=[
    {icon:Compass,title:'Find your next favorite',detail:'Browse anime and donghua from your chosen sources.'},
    {icon:Heart,title:'Make it yours',detail:'Keep favourites, collections and watch history together.'},
    {icon:Download,title:'Watch on your terms',detail:'Save supported episodes and available subtitles for offline viewing.'},
  ];
  return <main className="intro-screen" aria-labelledby="intro-title">
    <div className="intro-card">
      <header className="intro-header"><div className="intro-brand"><Mark small/><div><strong>Mikozora<span>.</span></strong><small>YOUR ANIME SPACE</small></div></div><div className="intro-version"><i/> VERSION {APP_VERSION}</div></header>
      <div className="intro-columns">
        <section className="intro-story">
          <div className="intro-eyebrow"><Sparkles size={13}/>{isNew?'A LITTLE SPACE FOR BIG STORIES':'A FRESH CHAPTER'}</div>
          <h1 id="intro-title" ref={heading} tabIndex="-1">{isNew?<>Welcome to<br/><span>your space.</span></>:<>Welcome<br/><span>back.</span></>}</h1>
          <p className="intro-lead">{isNew?'Your anime and donghua, all together in a place that feels like yours.':'Your stories are right where you left them. Here’s what’s new in Mikozora.'}</p>
          {isNew ? <div className="intro-tour" aria-label="Explore Mikozora">{tour.map(({icon:Icon,title,detail})=><div className="intro-tour-item" key={title}><span className="intro-tour-icon"><Icon size={17}/></span><div><strong>{title}</strong><p>{detail}</p></div></div>)}</div> : <div className="intro-update-note"><CheckCircle2 size={18}/><div><strong>Your space is still yours</strong><p>Your library and settings stay on this device.</p></div></div>}
        </section>
        <section className="release-card" aria-labelledby="release-title">
          <div className="release-heading"><div><span className="intro-eyebrow">THE LITTLE DETAILS</span><h2 id="release-title">What’s new<span>.</span></h2></div><span className="release-spark"><Sparkles size={19}/></span></div>
          {RELEASES.slice(0,1).map((release)=><div className="release-group" key={release.version}>
            <div className="release-group-heading"><span>{release.label}</span><strong>v{release.version}</strong></div>
            <ul>{release.entries.map(entry=><li key={entry.title}><span className="release-bullet"><Check size={13}/></span><div><strong>{entry.title}</strong><p>{entry.description}</p></div></li>)}</ul>
          </div>)}
        </section>
      </div>
      <footer className="intro-footer"><div><ShieldCheck size={16}/><span>Your library stays on this device.</span><button className="intro-release-link" aria-label="Jump to release notes" onClick={()=>document.getElementById('release-title')?.scrollIntoView({behavior:'auto',block:'start'})}>See changes <ChevronRight size={13}/></button></div><button className="btn primary intro-continue" onClick={onContinue}>{manual?'Back to settings':isNew?'Get started':'Continue to Mikozora'} <ArrowRight size={16}/></button></footer>
    </div>
    <p className="intro-bottom-note">MADE FOR YOUR WATCH TIME <span>✦</span></p>
  </main>;
}
function UpdateBanner({info,download,dismiss}) {
  const target=updateDownloadUrl(info,isDesktopApp()?'desktop':'android');
  return <div className="content update-banner-wrap"><div className="update-banner" role="status"><div className="setting-icon"><Sparkles size={19}/></div><div className="update-banner-text"><strong>Mikozora {info.version} is available</strong><p>You’re on {APP_VERSION}. The update installs over this one — your library, history and downloads stay put.</p></div><button className="btn primary" onClick={download}>{target&&target!==info.pageUrl?'Download update':'View update'}</button><button className="update-banner-close" aria-label="Dismiss update notice" onClick={dismiss}><X size={16}/></button></div></div>;
}
function App() {
  // Read before the library/history effects initialize storage on a fresh install.
  const [experience,setExperience]=useState(()=>{try{return startupExperience(window.localStorage)}catch{return {mode:'intro'}}});
  const finishExperience=()=>{if(!experience?.manual)try{completeExperience(window.localStorage)}catch{} setExperience(null);};
  const [appUpdate,setAppUpdate]=useState(()=>{try{return readUpdateState(window.localStorage)}catch{return {...DEFAULT_UPDATE_STATE}}});
  const [updateStatus,setUpdateStatus]=useState({phase:'idle',message:''});
  const updateCheckPromise=useRef(null);
  const updateCheckAttempted=useRef(false);
  const launchUpdateCheckStarted=useRef(false);
  const storeAppUpdate=next=>{setAppUpdate(next);try{saveUpdateState(window.localStorage,next)}catch{/* The current session still remembers the choice. */}};
  const checkAppUpdate=(manual=false)=>{
    if(updateCheckPromise.current)return updateCheckPromise.current;
    updateCheckAttempted.current=true;
    const run=(async()=>{
      setUpdateStatus({phase:'checking',message:''});
      try{
        const info=await fetchLatestRelease();
        setAppUpdate(prev=>{const next=withCheckResult(prev,info,Date.now());try{saveUpdateState(window.localStorage,next)}catch{}return next;});
        setUpdateStatus({phase:'idle',message:''});
      }catch(e){
        setAppUpdate(prev=>{const next=withCheckResult(prev,null,Date.now());try{saveUpdateState(window.localStorage,next)}catch{}return next;});
        setUpdateStatus(manual?{phase:'error',message:e?.message||'Could not check for updates.'}:{phase:'idle',message:''});
      }
    })();
    const tracked=run.finally(()=>{if(updateCheckPromise.current===tracked)updateCheckPromise.current=null;});
    updateCheckPromise.current=tracked;
    return tracked;
  };
  useEffect(()=>{
    if(experience||launchUpdateCheckStarted.current)return;
    let stored=appUpdate;
    try{stored=readUpdateState(window.localStorage)}catch{}
    if(!shouldCheckOnLaunch(stored))return;
    // Let the main shell and native bridge settle, then make the one launch
    // check for this JS session. Manually replaying What's new later uses
    // the same experience state but must not trigger this a second time.
    const timer=setTimeout(()=>{
      if(updateCheckAttempted.current){launchUpdateCheckStarted.current=true;return;}
      let current=stored;
      try{current=readUpdateState(window.localStorage)}catch{}
      if(!shouldCheckOnLaunch(current))return;
      launchUpdateCheckStarted.current=true;
      void checkAppUpdate(false);
    },800);
    return ()=>clearTimeout(timer);
  },[experience]);
  useEffect(()=>{
    if(experience)return;
    const checkIfDue=()=>{
      if(document.hidden)return;
      let stored=appUpdate;
      try{stored=readUpdateState(window.localStorage)}catch{}
      if(shouldCheckOnForeground(stored,Date.now()))void checkAppUpdate(false);
    };
    const onVisible=()=>{if(!document.hidden)checkIfDue();};
    window.addEventListener('focus',checkIfDue);
    document.addEventListener('visibilitychange',onVisible);
    // This local timer only evaluates the persisted timestamps; actual
    // network checks remain gated by shouldCheckOnForeground above.
    const timer=setInterval(checkIfDue,60000);
    return ()=>{window.removeEventListener('focus',checkIfDue);document.removeEventListener('visibilitychange',onVisible);clearInterval(timer);};
  },[experience]);
  const pendingUpdate=visibleUpdate(appUpdate,APP_VERSION);
  const downloadAppUpdate=()=>{const target=updateDownloadUrl(pendingUpdate,isDesktopApp()?'desktop':'android');if(target)external(target);};
  const dismissAppUpdate=()=>storeAppUpdate(dismissUpdate(appUpdate));
  const changeAutoCheck=enabled=>{storeAppUpdate({...appUpdate,autoCheck:enabled});if(enabled)void checkAppUpdate(false);};
  const [appearance,setAppearance]=useState(initialAppearance);
  const changeAppearance=patch=>{
    const root=document.documentElement;
    root.classList.add('appearance-changing');
    const next=applyAppearance(document,{...appearance,...patch});
    setAppearance(next);
    try{saveAppearance(window.localStorage,next)}catch{/* The current session still uses the chosen look. */}
    syncNativeAppearance(next);
    // Avoid a brief low-contrast cross-fade between opposite palettes.
    requestAnimationFrame(()=>requestAnimationFrame(()=>root.classList.remove('appearance-changing')));
  };
  const [route,setRoute]=useState({page:'home'});
  const [library,setLibrary]=useStored(LIBRARY_KEY); const [history,setHistory]=useStored(HISTORY_KEY);
  const [storedProgress,setStoredProgress]=useStored(PROGRESS_KEY); const progress=useMemo(()=>normalizeProgress(storedProgress),[storedProgress]);
  const [collections,setCollections]=useState(()=>normalizeCollections(readStored(COLLECTIONS_KEY)));
  const [activeCollection,setActiveCollection]=useState('all'); const [collectionDialog,setCollectionDialog]=useState(null);
  useEffect(()=>{try{localStorage.setItem(COLLECTIONS_KEY,JSON.stringify(collections))}catch{/* storage can be disabled */}},[collections]);
  const [libraryMeta,setLibraryMetaState]=useState(()=>{try{return readLibraryMeta(window.localStorage);}catch{return {};}});
  useEffect(()=>{try{saveLibraryMeta(window.localStorage,libraryMeta);}catch{/* storage can be disabled */}},[libraryMeta]);
  const [sourceMatches,setSourceMatchesState]=useState(()=>{try{return readSourceMatches(window.localStorage);}catch{return normalizeSourceMatches(null);}});
  useEffect(()=>{try{saveSourceMatches(window.localStorage,sourceMatches);}catch{/* storage can be disabled */}},[sourceMatches]);
  const sourceRelatedKeys=useMemo(()=>relatedKeysByTitle(sourceMatches),[sourceMatches]);
  const [offlineManager,setOfflineManagerState]=useState(()=>{try{return readOfflineManager(window.localStorage);}catch{return normalizeOfflineManager(null);}});
  useEffect(()=>{try{saveOfflineManager(window.localStorage,offlineManager);}catch{/* storage can be disabled */}},[offlineManager]);
  const [offlinePlayback,setOfflinePlaybackState]=useState(()=>{try{return readOfflinePlayback(window.localStorage);}catch{return normalizeOfflinePlayback(null);}});
  useEffect(()=>{try{saveOfflinePlayback(window.localStorage,offlinePlayback);}catch{/* storage can be disabled */}},[offlinePlayback]);
  const [watchPlanner,setWatchPlannerState]=useState(()=>{try{return readWatchPlanner(window.localStorage);}catch{return {};}});
  useEffect(()=>{try{saveWatchPlanner(window.localStorage,watchPlanner);}catch{/* storage can be disabled */}},[watchPlanner]);
  const [onlinePlayback,setOnlinePlaybackState]=useState(()=>{try{return readOnlinePlayback(window.localStorage);}catch{return normalizeOnlinePlayback(null);}});
  useEffect(()=>{try{saveOnlinePlayback(window.localStorage,onlinePlayback);}catch{/* storage can be disabled */}},[onlinePlayback]);
  const [onlinePositions,setOnlinePositionsState]=useState(()=>{try{return readOnlinePositions(window.localStorage);}catch{return {};}});
  useEffect(()=>{try{saveOnlinePositions(window.localStorage,onlinePositions);}catch{/* position memory is best-effort */}},[onlinePositions]);
  const onlinePositionsRef=useRef(onlinePositions);
  useEffect(()=>{onlinePositionsRef.current=onlinePositions;},[onlinePositions]);
  const [releaseRadar,setReleaseRadarState]=useState(()=>{try{return readReleaseRadar(window.localStorage);}catch{return normalizeReleaseRadar(null);}});
  useEffect(()=>{try{saveReleaseRadar(window.localStorage,releaseRadar);}catch{/* storage can be disabled */}},[releaseRadar]);
  const [searchCentre,setSearchCentreState]=useState(()=>{try{return readSearchCentre(window.localStorage);}catch{return normalizeSearchCentre(null);}});
  useEffect(()=>{try{saveSearchCentre(window.localStorage,searchCentre);}catch{/* storage can be disabled */}},[searchCentre]);
  const [portability,setPortabilityState]=useState(()=>{try{return readPortabilityState(window.localStorage);}catch{return normalizePortabilityState(null);}});
  useEffect(()=>{try{savePortabilityState(window.localStorage,portability);}catch{/* storage can be disabled */}},[portability]);
  const [commandCentreOpen,setCommandCentreOpen]=useState(false);
  const autoCleanupAttempted=useRef('');
  const changeOfflineManager=patch=>setOfflineManagerState(previous=>normalizeOfflineManager({...previous,...patch}));
  const changeOfflinePlayback=patch=>setOfflinePlaybackState(previous=>normalizeOfflinePlayback({...previous,...patch}));
  const changeWatchPlan=(item,patch)=>setWatchPlannerState(previous=>setWatchPlan(previous,item,patch));
  const changeOnlinePlayback=patch=>setOnlinePlaybackState(previous=>normalizeOnlinePlayback({...previous,...patch}));
  const saveTextFile=async(name,text,mime='text/plain')=>{
    if(hasTextFiles())return exportTextToFile(name,text,mime);
    const url=URL.createObjectURL(new Blob([text],{type:mime}));
    const link=document.createElement('a');
    link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    return {saved:true};
  };
  const readTextFile=async()=>{
    if(hasTextFiles())return readTextFromFile();
    return new Promise(resolve=>{
      const input=document.createElement('input');
      input.type='file';input.accept='.json,.csv,.tsv,.xml,.txt,application/json,text/csv,application/xml,text/xml,text/plain';
      input.onchange=async()=>{
        const file=input.files?.[0];
        if(!file){resolve(null);return;}
        try{resolve({text:await file.text(),name:file.name});}
        catch{resolve(null);}
      };
      input.oncancel=()=>resolve(null);
      input.click();
    });
  };
  const applyPortabilityResult=result=>{
    if(!result)return;
    if(Array.isArray(result.library))setLibrary(result.library);
    if(Array.isArray(result.collections))setCollections(normalizeCollections(result.collections));
    if(result.libraryMeta&&typeof result.libraryMeta==='object')setLibraryMetaState(result.libraryMeta);
    if(Array.isArray(result.progress))setStoredProgress(result.progress);
    if(result.portability)setPortabilityState(normalizePortabilityState(result.portability));
    const applied=result.applied||{};
    const parts=[];
    if(applied.added)parts.push(`${applied.added} added`);
    if(applied.updated)parts.push(`${applied.updated} updated`);
    if(applied.collectionsCreated)parts.push(`${applied.collectionsCreated} collection${applied.collectionsCreated===1?'':'s'} created`);
    if(applied.progressSnapshots)parts.push(`${applied.progressSnapshots} watched counts applied`);
    if(applied.pendingProgress)parts.push(`${applied.pendingProgress} waiting for an episode list`);
    setToast(parts.length?`Library merged · ${parts.join(' · ')}`:'Library merge applied');
  };
  const saveShareCard=async({kind='wrapped-card',eyebrow,title,subtitle='',stats=[]}={})=>{
    try{
      const svg=buildShareCardSvg({eyebrow,title,subtitle,stats});
      const result=await saveTextFile(portableFileName(kind),svg,'image/svg+xml');
      if(!result?.canceled)setToast('Share card saved as an SVG image');
      return true;
    }catch(error){
      setToast(error.message||'Could not save the share card');
      return false;
    }
  };
  useEffect(()=>{
    setLibraryMetaState(previous=>{
      const next=pruneLibraryMeta(previous,new Set(library.map(identity)));
      return stableStringify(previous)===stableStringify(next)?previous:next;
    });
  },[library]);
  const [browseSource,setBrowseSource]=useState('all'); const [query,setQuery]=useState('');
  const [refreshKey,setRefreshKey]=useState(0); const [player,setPlayer]=useState(null); const [offlinePlayer,setOfflinePlayer]=useState(null); const [licenses,setLicenses]=useState(false); const [downloadModal,setDownloadModal]=useState(null); const [downloads,setDownloads]=useState([]); const [downloadsLoading,setDownloadsLoading]=useState(true); const [busy,setBusy]=useState(''); const [toast,setToast]=useState('');
  const [contentPrefs,setContentPrefs]=useState(initialContent);
  const hideNsfw=contentPrefs.hideNsfw;
  const changeContentPrefs=patch=>{
    const next={...contentPrefs,...patch};
    setContentPrefs(next);
    try{saveContentPrefs(window.localStorage,next)}catch{/* The current session still uses the choice. */}
    setToast(next.hideNsfw?'NSFW content is now hidden':'NSFW content can now appear');
  };
  const [smartDownloads,setSmartDownloadsState]=useState(()=>readSmartDownloads(window.localStorage));
  const [folder,setFolder]=useState({configured:false,granted:false,name:''});
  const deviceSyncPlatform=isDesktopApp()?'windows':'android';
  const folderSyncAvailable=hasDeviceSync();
  const deviceSyncAvailable=folderSyncAvailable;
  const [deviceSyncFolder,setDeviceSyncFolder]=useState({configured:false,granted:false,name:''});
  const [deviceSyncMeta,setDeviceSyncMeta]=useState(()=>{
    const fallback={deviceId:'',deviceName:'',platform:deviceSyncPlatform,autoSync:true,revision:0,lastSyncAt:0,lastPublishedAt:0};
    if(!deviceSyncAvailable)return fallback;
    try{return publicDeviceSyncMeta(readDeviceSyncMeta(window.localStorage,deviceSyncPlatform,{create:true}));}catch{return fallback;}
  });
  const [deviceSyncStatus,setDeviceSyncStatus]=useState({phase:'idle',message:'',peerCount:0,ignoredPeerFiles:0});
  const deviceSyncPromise=useRef(null);
  const deviceSyncQueued=useRef(false);
  const deviceSyncAction=useRef(false);
  const deviceSyncStartedAt=useRef(0);
  const deviceSyncError=useRef('');
  const deviceSyncRun=useRef(null);
  const deviceSyncChangeReady=useRef(false);
  const syncInputsRef=useRef({library,history,storedProgress,progress,collections,libraryMeta,sourceMatches,appearance,contentPrefs,smartDownloads});
  useEffect(()=>{syncInputsRef.current={library,history,storedProgress,progress,collections,libraryMeta,sourceMatches,appearance,contentPrefs,smartDownloads};},[library,history,storedProgress,progress,collections,libraryMeta,sourceMatches,appearance,contentPrefs,smartDownloads]);
  useEffect(()=>{if(activeCollection!=='all'&&!collections.some(c=>c.id===activeCollection))setActiveCollection('all');},[activeCollection,collections]);
  const updatesAvailable=hasEpisodeUpdates();
  const [updates,setUpdates]=useState({automatic:true,alerts:true,watchedCount:0,initializedCount:0,unreadCount:0,updates:[],errors:[],checking:false,queued:false,notificationStatus:'unknown'});
  const [updatesSyncError,setUpdatesSyncError]=useState(''); const [updatesActionError,setUpdatesActionError]=useState('');
  const [notificationRoute,setNotificationRoute]=useState(false);
  const [downloadsRoute,setDownloadsRoute]=useState(false);
  const firstEpisodeSync=useRef(true);
  const playbackSession=useRef(null);
  const playbackRequest=useRef(0);
  const nativeEpisodePending=useRef(false);
  const nativeFallbackPending=useRef(false);
  const nativeFallbackIgnoreCloseUntil=useRef(0);
  const playRef=useRef(null);
  const markWatchedRef=useRef(null);
  const downloadsRef=useRef([]);
  useEffect(()=>{downloadsRef.current=downloads;},[downloads]);
  const monitored=useMemo(()=>monitoredTitles(library,collections,smartDownloads,progress,history,releaseRadar),[library,collections,smartDownloads,progress,history,releaseRadar]);
  const knownSourceItems=useMemo(()=>{
    const byKey=new Map();
    const add=item=>{
      if(!item?.source||!item?.url)return;
      const key=identity(item);
      byKey.set(key,{...(byKey.get(key)||{}),...item});
    };
    library.forEach(add);
    progress.forEach(entry=>add(entry.item));
    history.forEach(entry=>add(entry.item));
    downloads.forEach(entry=>add(entry.item));
    return [...byKey.values()];
  },[library,progress,history,downloads]);
  const unreadTitles=useMemo(()=>unreadByTitle(updates.updates),[updates.updates]);
  const releaseRadarView=useMemo(()=>buildReleaseRadar({updates:updates.updates||[],downloads,monitoredItems:monitored,radar:releaseRadar}),[updates.updates,downloads,monitored,releaseRadar]);
  const inboxUnread=useMemo(()=>{
    const hasRadarEpisodes=releaseRadarView.entries.some(entry=>entry.type==='episode');
    return hasRadarEpisodes?releaseRadarView.visibleUnread:(updates.unreadCount||0)+releaseRadarView.readyDownloads;
  },[releaseRadarView,updates.unreadCount]);
  useEffect(()=>{ window.history.replaceState({page:'home'},'',location.pathname+location.search+'#home'); const listener=e=>setRoute(e.state||{page:'home'});window.addEventListener('popstate',listener);return()=>window.removeEventListener('popstate',listener); },[]);
  useEffect(()=>{
    if(!updatesAvailable)return;
    let active=true;const onOpen=firstEpisodeSync.current;firstEpisodeSync.current=false;
    syncEpisodeTitles(monitored,onOpen,smartDownloadsForSync(smartDownloads)).then(value=>{if(active){setUpdates(value);setUpdatesSyncError('')}}).catch(e=>{if(active)setUpdatesSyncError(e.message||'Could not update collection checks. Previous data is unchanged.')});
    return()=>{active=false};
  },[updatesAvailable,monitored]);
  useEffect(()=>{
    if(!updatesAvailable)return;
    let active=true;
    const load=()=>getEpisodeUpdates().then(value=>{if(active){setUpdates(value);setUpdatesActionError('')}}).catch(e=>{if(active)setUpdatesActionError(e.message||'Could not read episode updates.')});
    const onVisible=()=>{if(!document.hidden)load()};
    load();window.addEventListener('moku-updates-changed',load);window.addEventListener('focus',load);document.addEventListener('visibilitychange',onVisible);
    return()=>{active=false;window.removeEventListener('moku-updates-changed',load);window.removeEventListener('focus',load);document.removeEventListener('visibilitychange',onVisible)};
  },[updatesAvailable]);
  useEffect(()=>{
    if(!updatesAvailable)return;
    const requestRoute=()=>{try{if(window.MokuBridge.takeOpenUpdates?.())setNotificationRoute(true)}catch{}};
    window.addEventListener('moku-open-updates',requestRoute);requestRoute();
    return()=>window.removeEventListener('moku-open-updates',requestRoute);
  },[updatesAvailable]);
  useEffect(()=>{
    if(experience||!notificationRoute)return;
    const next={page:'updates'};window.history.pushState(next,'','#updates');setRoute(next);setNotificationRoute(false);window.scrollTo({top:0,behavior:'instant'});
  },[experience,notificationRoute]);
  useEffect(()=>{
    if(!updatesAvailable)return;
    const requestRoute=()=>{try{if(window.MokuBridge.takeOpenDownloads?.())setDownloadsRoute(true)}catch{}};
    window.addEventListener('moku-open-downloads',requestRoute);requestRoute();
    return()=>window.removeEventListener('moku-open-downloads',requestRoute);
  },[updatesAvailable]);
  useEffect(()=>{
    if(experience||!downloadsRoute)return;
    const next={page:'downloads'};window.history.pushState(next,'','#downloads');setRoute(next);setDownloadsRoute(false);window.scrollTo({top:0,behavior:'instant'});
  },[experience,downloadsRoute]);
  useEffect(()=>{
    if(!experience&&updatesAvailable&&updates.watchedCount>0&&updates.alerts&&updates.notificationStatus==='permission'&&!updates.permissionAsked)
      try{window.MokuBridge.episodeNotificationPermission(true)}catch{}
  },[experience,updatesAvailable,updates.watchedCount,updates.alerts,updates.notificationStatus,updates.permissionAsked]);
  useEffect(()=>{window.__handleAndroidBack=()=>{if(experience){finishExperience();return true;}if(commandCentreOpen){setCommandCentreOpen(false);return true;}if(collectionDialog){setCollectionDialog(null);return true;}if(downloadModal){setDownloadModal(null);return true;}if(offlinePlayer){setOfflinePlayer(null);return true;}if(player){setPlayer(null);return true;}if(licenses){setLicenses(false);return true;}if(route.page!=='home'){window.history.back();return true;}return false;};},[experience,player,offlinePlayer,route,licenses,downloadModal,collectionDialog,commandCentreOpen]);
  useEffect(()=>{
    const report=message=>{try{window.MokuBridge?.playerNavigationError?.(message);}catch{}};
    const handler=async(index,url)=>{
      const session=playbackSession.current;
      if(!session||typeof playRef.current!=='function'){
        report('This episode list is no longer available. Return to the series and choose an episode again.');
        return false;
      }
      let target=session.episodes[Number(index)];
      if(!target||(url&&target.url!==url)) target=session.episodes.find(episode=>episode.url===url);
      if(!target){
        report('That episode could not be found in this series.');
        return false;
      }
      if(target.url===session.currentUrl) return true;
      nativeEpisodePending.current=true;
      try{
        return await playRef.current(session.item,target,{playlist:session.episodes,reportNativeError:true});
      }finally{
        nativeEpisodePending.current=false;
      }
    };
    const watchedHandler=(url,watched)=>{
      const session=playbackSession.current;
      if(!session||typeof markWatchedRef.current!=='function')return false;
      const target=session.episodes.find(episode=>episode.url===url);
      if(!target)return false;
      markWatchedRef.current(session.item,[target],!!watched);
      return true;
    };
    const onlinePositionHandler=(url,positionMs,durationMs,rateMilli,ended)=>{
      const session=playbackSession.current;
      if(!session||!url)return false;
      const target=session.episodes.find(episode=>episode.url===url);
      if(!target)return false;
      session.currentUrl=url;
      const seconds=Math.max(0,Number(positionMs)||0)/1000;
      const duration=Math.max(0,Number(durationMs)||0)/1000;
      setOnlinePositionsState(previous=>rememberOnlinePosition(previous,session.item,target,seconds,duration,Date.now(),!!ended));
      const rate=(Number(rateMilli)||1000)/1000;
      if(rate>=0.25&&rate<=4)setOfflinePlaybackState(previous=>{
        const next=normalizeOfflinePlayback({...previous,playbackRate:rate});
        return next.playbackRate===previous.playbackRate?previous:next;
      });
      return true;
    };
    const fallbackHandler=(url,reason)=>{
      const session=playbackSession.current;
      if(!session||typeof playRef.current!=='function')return false;
      const target=session.episodes.find(episode=>episode.url===url);
      if(!target)return false;
      if(reason)setToast(String(reason).slice(0,300));
      nativeFallbackPending.current=true;
      // DirectPlayerActivity finishes itself 900ms after this request. Its
      // close can land either before or after the embedded activity opens,
      // so ignore exactly that one handoff close in both orders.
      nativeFallbackIgnoreCloseUntil.current=Date.now()+15000;
      Promise.resolve(playRef.current(session.item,target,{playlist:session.episodes,forceEmbedded:true,reportNativeError:true}))
        .then(opened=>{
          if(opened===false){
            nativeFallbackIgnoreCloseUntil.current=0;
            if(playbackSession.current===session)playbackSession.current=null;
          }
        })
        .finally(()=>{nativeFallbackPending.current=false;});
      return true;
    };
    const closed=()=>{
      // DirectPlayerActivity closes itself shortly after asking for the
      // embedded player. That close is part of the handoff, not a user
      // backing out, so it must not cancel the server lookup in progress or
      // clear the session now owned by the embedded activity.
      if(nativeFallbackPending.current||Date.now()<nativeFallbackIgnoreCloseUntil.current){
        nativeFallbackIgnoreCloseUntil.current=0;
        return true;
      }
      // Backing out while a native switch is resolving should not reopen it.
      if(nativeEpisodePending.current){
        nativeEpisodePending.current=false;
        playbackRequest.current++;
        setBusy('');
      }
      playbackSession.current=null;
      return true;
    };
    window.__mokuPlayerEpisode=handler;
    window.__mokuPlayerWatched=watchedHandler;
    window.__mokuOnlinePosition=onlinePositionHandler;
    window.__mokuPlayerFallback=fallbackHandler;
    window.__mokuPlayerClosed=closed;
    return()=>{
      if(window.__mokuPlayerEpisode===handler)delete window.__mokuPlayerEpisode;
      if(window.__mokuPlayerWatched===watchedHandler)delete window.__mokuPlayerWatched;
      if(window.__mokuOnlinePosition===onlinePositionHandler)delete window.__mokuOnlinePosition;
      if(window.__mokuPlayerFallback===fallbackHandler)delete window.__mokuPlayerFallback;
      if(window.__mokuPlayerClosed===closed)delete window.__mokuPlayerClosed;
    };
  },[]);
  useEffect(()=>{
    const openOffline=entry=>{
      if(!entry?.id||!entry?.token)return;
      setOfflinePlayer({...entry,download:downloadsRef.current.find(d=>d.id===entry.id)||null});
      getDownloads().then(items=>{
        setDownloads(items);
        setOfflinePlayer(prev=>prev?.id===entry.id?{...prev,download:items.find(d=>d.id===entry.id)||prev.download}:prev);
      }).catch(()=>{});
    };
    const offlineError=message=>setToast(message||'Could not open the offline episode.');
    window.__mokuOpenOfflineDownload=openOffline;
    window.__mokuOfflineDownloadError=offlineError;
    return()=>{
      if(window.__mokuOpenOfflineDownload===openOffline)delete window.__mokuOpenOfflineDownload;
      if(window.__mokuOfflineDownloadError===offlineError)delete window.__mokuOfflineDownloadError;
    };
  },[]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),3200);return()=>clearTimeout(t)},[toast]);
  useEffect(()=>{
    const onKey=event=>{
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){
        event.preventDefault();
        setCommandCentreOpen(true);
      }
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[]);
  useEffect(()=>{
    if(!commandCentreOpen||!hasNativeDownloads())return;
    let active=true;
    getDownloads().then(items=>{if(active){setDownloads(items);setDownloadsLoading(false);}}).catch(()=>{if(active)setDownloadsLoading(false);});
    return()=>{active=false;};
  },[commandCentreOpen]);
  useEffect(()=>{
    if(!hasNativeDownloads()){setDownloadsLoading(false);return;}
    if(!['downloads','detail','updates'].includes(route.page))return;
    let active=true;const load=()=>getDownloads().then(items=>{if(active){setDownloads(items);setDownloadsLoading(false)}}).catch(()=>{if(active)setDownloadsLoading(false)});
    load();const timer=setInterval(load,2500);return()=>{active=false;clearInterval(timer)};
  },[route.page]);
  useEffect(()=>{
    if(!hasNativeDownloads()||!['settings','downloads'].includes(route.page))return;
    let active=true;const load=()=>getExportSettings().then(value=>{if(active)setFolder(value)}).catch(()=>{});
    load();window.addEventListener('focus',load);return()=>{active=false;window.removeEventListener('focus',load)};
  },[route.page]);
  const go=(page,item)=>{ const r={page,...(item?{item}: {})};window.history.pushState(r,'',`#${page}`);setRoute(r);window.scrollTo({top:0,behavior:'instant'}); };
  const back=()=>window.history.back();
  const browse=(src)=>{if(src==='history'){go('history');return}setBrowseSource(src);setQuery('');go('browse');};
  const open=item=>go('detail',item);
  const updateAction=async(action,message)=>{
    try{const next=await action();setUpdates(next);setUpdatesActionError('');if(message)setToast(message);return next;}
    catch(e){const error=e.message||'Could not update episode checks.';setUpdatesActionError(error);setToast(error);return null;}
  };
  const checkNow=()=>updateAction(()=>checkEpisodes(),'Episode check queued');
  const readAllUpdates=async()=>{
    setReleaseRadarState(previous=>releaseRadarView.entries
      .filter(entry=>entry.type==='download'&&!entry.read)
      .reduce((state,entry)=>dismissReleaseRadarEntry(state,entry.id),normalizeReleaseRadar(previous)));
    await updateAction(()=>markEpisodeRead('all'),'Updates marked read');
  };
  const viewUpdate=entry=>{
    const update=entry?.update||entry;
    if(update&&!update.read)updateAction(()=>markEpisodeRead(update.id));
    if(entry?.item)open(entry.item);
  };
  const viewRadarEntry=entry=>{
    if(!entry)return;
    if(entry.type==='download'){
      setReleaseRadarState(previous=>dismissReleaseRadarEntry(previous,entry.id));
      if(entry.download)playOffline(entry.download);
      else go('downloads');
      return;
    }
    viewUpdate(entry);
  };
  const dismissRadarEntry=id=>setReleaseRadarState(previous=>dismissReleaseRadarEntry(previous,id));
  const changeReleaseRadarRule=(item,patch,quiet=false)=>{
    if(!item)return;
    setReleaseRadarState(previous=>setReleaseRadarRule(previous,item,patch));
    if(!quiet){
      const label=patch?.mode?releaseRadarModeLabel(patch.mode):'rule updated';
      setToast(`Release Radar ${label.toLowerCase()} for ${item.title||'this title'}`);
    }
  };
  const changeAutomatic=enabled=>updateAction(()=>setEpisodeAutomatic(enabled),enabled?'Automatic checks on':'Automatic checks off');
  const changeAlerts=enabled=>updateAction(()=>setEpisodeAlerts(enabled),enabled?'Episode alerts on':'Episode alerts off');
  const notificationPermission=()=>{if(updatesAvailable)try{window.MokuBridge.episodeNotificationPermission(false)}catch{setToast(isDesktopApp()?'Could not open Windows notification settings':'Could not open Android notification settings');}};
  const has=item=>library.some(x=>identity(x)===identity(item));
  const toggle=item=>{
    const exists=has(item);const key=identity(item);
    if(exists&&collections.some(c=>c.items.includes(key))&&!window.confirm(`Remove “${item.title}” from your library and all its collections? Downloads and folder files will remain.`))return;
    setLibrary(x=>exists?x.filter(i=>identity(i)!==key):[savedSummary(item),...x]);
    if(exists){
      setCollections(x=>removeTitleFromCollections(x,key));
      setLibraryMetaState(previous=>removeLibraryMeta(previous,[key]));
    }
    setToast(exists?'Removed from your library and collections':'Saved to your library');
  };
  const updateLibraryMeta=(item,patch)=>{
    if(!item?.source||!item?.url)return;
    const key=identity(item);
    const exists=has(item);
    const hadRecord=!!libraryMeta[key];
    const next=setLibraryMetaRecord(libraryMeta,item,patch);
    const hasRecord=!!next[key];
    if(hasRecord&&!exists)setLibrary(previous=>previous.some(x=>identity(x)===key)?previous:[savedSummary(item),...previous]);
    setLibraryMetaState(next);
    if(hasRecord)setToast(exists?(hadRecord?'Your shelf was updated':'Saved to your shelf'):'Saved to your library and shelf');
    else if(hadRecord)setToast('Your shelf was cleared');
  };
  const removeLibraryTitles=itemsToRemove=>{
    const unique=[...new Map((Array.isArray(itemsToRemove)?itemsToRemove:[]).filter(item=>item?.source&&item?.url).map(item=>[identity(item),item])).values()];
    if(!unique.length)return false;
    if(!window.confirm(`Remove ${unique.length} saved ${unique.length===1?'title':'titles'} from your library and all collections?\n\nPersonal ratings, notes and shelf statuses for those titles will also be removed. Downloads and folder files will remain.`))return false;
    const keys=new Set(unique.map(identity));
    setLibrary(previous=>previous.filter(item=>!keys.has(identity(item))));
    setCollections(previous=>previous.map(c=>({...c,items:c.items.filter(key=>!keys.has(key))})));
    setLibraryMetaState(previous=>removeLibraryMeta(previous,[...keys]));
    setToast(`Removed ${unique.length} ${unique.length===1?'title':'titles'} from your library`);
    return true;
  };
  const addTitlesToCollection=(collectionId,itemsToAdd)=>{
    const collection=collections.find(c=>c.id===collectionId);
    const keys=[...new Set((Array.isArray(itemsToAdd)?itemsToAdd:[]).filter(item=>item?.source&&item?.url&&has(item)).map(identity))];
    if(!collection||!keys.length)return;
    setCollections(previous=>{
      const current=previous.find(c=>c.id===collectionId);
      return current?setCollectionItems(previous,collectionId,[...keys,...current.items]):previous;
    });
    setToast(`Added ${keys.length} ${keys.length===1?'title':'titles'} to ${collection.name}`);
  };
  const favourite=item=>{
    const exists=collections.find(c=>c.id===FAVOURITES_ID)?.items.includes(identity(item));
    if(!has(item))setLibrary(previous=>[savedSummary(item),...previous]);
    setCollections(previous=>toggleFavourite(previous,identity(item)));
    setToast(exists?'Removed from Favourites':'Added to Favourites');
  };
  const applySmartDownloads=next=>{
    const wasEnabled=smartDownloads.enabled;
    const normalized=saveSmartDownloads(window.localStorage,next);
    setSmartDownloadsState(normalized);
    if(!wasEnabled&&normalized.enabled&&updatesAvailable&&!updates.automatic)void updateAction(()=>setEpisodeAutomatic(true));
    return normalized;
  };
  const changeSmartDownloads=patch=>applySmartDownloads({...smartDownloads,...patch});
  useEffect(()=>{
    const valid=new Set(collections.map(c=>c.id));
    if(smartDownloads.collectionIds.some(id=>!valid.has(id)))applySmartDownloads({...smartDownloads,collectionIds:smartDownloads.collectionIds.filter(id=>valid.has(id))});
  },[collections,smartDownloads]);
  const flushDeviceSyncState=()=>{
    const current=syncInputsRef.current;
    try{
      window.localStorage.setItem(LIBRARY_KEY,JSON.stringify(current.library||[]));
      window.localStorage.setItem(HISTORY_KEY,JSON.stringify(current.history||[]));
      window.localStorage.setItem(PROGRESS_KEY,JSON.stringify(current.storedProgress||[]));
      window.localStorage.setItem(COLLECTIONS_KEY,JSON.stringify(current.collections||[]));
      saveLibraryMeta(window.localStorage,current.libraryMeta||{});
      saveSourceMatches(window.localStorage,current.sourceMatches||normalizeSourceMatches(null));
      // Do not materialize these stores here: prepareDeviceSync treats a
      // never-written scalar store as an implicit default rather than a
      // competing user choice during a first cross-device merge.
      if(window.localStorage.getItem(APPEARANCE_KEY)!=null)saveAppearance(window.localStorage,current.appearance);
      if(window.localStorage.getItem(CONTENT_KEY)!=null)saveContentPrefs(window.localStorage,current.contentPrefs);
      if(window.localStorage.getItem(SMART_DOWNLOADS_KEY)!=null)saveSmartDownloads(window.localStorage,current.smartDownloads);
    }catch{/* prepareDeviceSync will surface storage failures when it saves metadata. */}
  };
  const applyDeviceSyncSnapshot=data=>{
    if(!data)return;
    const current=syncInputsRef.current;
    if(stableStringify(current.library)!==stableStringify(data.library))setLibrary(data.library);
    if(stableStringify(current.collections)!==stableStringify(data.collections))setCollections(normalizeCollections(data.collections));
    if(stableStringify(current.history)!==stableStringify(data.history))setHistory(data.history);
    if(stableStringify(current.progress)!==stableStringify(data.progress))setStoredProgress(data.progress);
    if(stableStringify(current.libraryMeta||{})!==stableStringify(data.libraryMeta||{}))setLibraryMetaState(data.libraryMeta||{});
    if(stableStringify(current.sourceMatches||normalizeSourceMatches(null))!==stableStringify(data.sourceMatches||normalizeSourceMatches(null)))setSourceMatchesState(normalizeSourceMatches(data.sourceMatches));
    if(stableStringify(current.appearance)!==stableStringify(data.appearance)){
      const nextAppearance=applyAppearance(document,data.appearance);
      setAppearance(nextAppearance);
      syncNativeAppearance(nextAppearance);
    }
    if(stableStringify(current.contentPrefs)!==stableStringify(data.content))setContentPrefs(data.content);
    if(stableStringify(current.smartDownloads)!==stableStringify(data.smartDownloads)){
      const wasEnabled=!!current.smartDownloads?.enabled;
      const normalized=saveSmartDownloads(window.localStorage,data.smartDownloads);
      setSmartDownloadsState(normalized);
      if(!wasEnabled&&normalized.enabled&&updatesAvailable&&!updates.automatic)void updateAction(()=>setEpisodeAutomatic(true));
    }
  };
  const runDeviceSync=async({manual=false,reason='auto'}={})=>{
    if(!deviceSyncAvailable)return null;
    if(deviceSyncPromise.current){
      if(manual||reason==='change')deviceSyncQueued.current=true;
      return deviceSyncPromise.current;
    }
    if(deviceSyncAction.current){
      if(manual||reason==='change')deviceSyncQueued.current=true;
      return null;
    }
    const startedAt=Date.now();
    if(!manual&&reason==='focus'&&startedAt-deviceSyncStartedAt.current<30000)return null;
    if(!manual&&reason==='periodic'&&startedAt-deviceSyncStartedAt.current<60000)return null;
    deviceSyncStartedAt.current=startedAt;
    deviceSyncQueued.current=false;
    const task=(async()=>{
      setDeviceSyncStatus(previous=>({...previous,phase:'syncing',message:''}));
      try{
        const identity=publicDeviceSyncMeta(readDeviceSyncMeta(window.localStorage,deviceSyncPlatform,{create:true}));
        setDeviceSyncMeta(identity);
        if(!folderSyncAvailable)throw new Error('Shared-folder sync is unavailable in this Mikozora build.');
        const settings=await getDeviceSyncSettings();
        setDeviceSyncFolder(settings);
        if(!settings.configured){
          const message='Choose a sync folder first.';
          if(manual){
            deviceSyncError.current=message;
            setDeviceSyncStatus(previous=>({...previous,phase:'error',message}));
          }else{
            setDeviceSyncStatus(previous=>({...previous,phase:'idle',message:''}));
          }
          return null;
        }
        if(!settings.granted){
          throw new Error('Sync folder access was lost. Choose the folder again in Settings.');
        }
        if(!manual&&!identity.autoSync){
          setDeviceSyncStatus(previous=>({...previous,phase:'idle',message:''}));
          return null;
        }

        const listing=await readDeviceSyncFolder();
        // Flush and prepare in the same synchronous turn so an edit made while
        // the native folder was being read is included in this merge rather
        // than overwritten by it. Applying to React follows immediately.
        flushDeviceSyncState();
        const prepared=prepareDeviceSync(window.localStorage,listing.files||[],{platform:deviceSyncPlatform,now:Date.now()});
        applyDeviceSyncSnapshot(prepared.data);
        let publishedIdentity=prepared.identity;
        if(prepared.shouldWrite){
          await writeDeviceSyncFile(prepared.fileName,prepared.payloadText);
          publishedIdentity=markDeviceSyncPublished(window.localStorage,prepared.signature,prepared.revision,Date.now());
        }
        deviceSyncError.current='';
        setDeviceSyncMeta(publishedIdentity);
        setDeviceSyncStatus({phase:'idle',message:'',peerCount:prepared.peerCount,ignoredPeerFiles:prepared.ignoredPeerFiles});
        return prepared;
      }catch(e){
        const message=e?.message||'Could not sync devices.';
        deviceSyncError.current=message;
        try{setDeviceSyncMeta(publicDeviceSyncMeta(readDeviceSyncMeta(window.localStorage,deviceSyncPlatform,{create:true})));}catch{}
        setDeviceSyncStatus(previous=>({...previous,phase:'error',message}));
        return null;
      }
    })();
    deviceSyncPromise.current=task;
    try{return await task;}
    finally{
      if(deviceSyncPromise.current===task)deviceSyncPromise.current=null;
      if(deviceSyncQueued.current){
        deviceSyncQueued.current=false;
        setTimeout(()=>{void deviceSyncRun.current?.({reason:'change'});},600);
      }
    }
  };
  deviceSyncRun.current=runDeviceSync;
  useEffect(()=>{
    if(!deviceSyncAvailable)return;
    let active=true;
    try{setDeviceSyncMeta(publicDeviceSyncMeta(readDeviceSyncMeta(window.localStorage,deviceSyncPlatform,{create:true})));}catch{}
    const report=(e,fallback)=>{if(active&&route.page==='settings'){const message=e?.message||fallback;deviceSyncError.current=message;setDeviceSyncStatus(previous=>({...previous,phase:'error',message}));}};
    const load=()=>{
      if(folderSyncAvailable)getDeviceSyncSettings()
        .then(value=>{if(active)setDeviceSyncFolder(value);})
        .catch(e=>report(e,'Could not read sync folder settings.'));
    };
    load();
    if(route.page==='settings')window.addEventListener('focus',load);
    return ()=>{active=false;window.removeEventListener('focus',load);};
  },[deviceSyncAvailable,folderSyncAvailable,route.page]);
  useEffect(()=>{
    if(experience||!deviceSyncAvailable)return;
    const timer=setTimeout(()=>{void deviceSyncRun.current?.({reason:'startup'});},1200);
    const onFocus=()=>{void deviceSyncRun.current?.({reason:'focus'});};
    const onVisible=()=>{if(!document.hidden)onFocus();};
    const interval=setInterval(()=>{void deviceSyncRun.current?.({reason:'periodic'});},300000);
    window.addEventListener('focus',onFocus);
    document.addEventListener('visibilitychange',onVisible);
    return ()=>{clearTimeout(timer);clearInterval(interval);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onVisible);};
  },[experience,deviceSyncAvailable]);
  useEffect(()=>{
    if(!deviceSyncChangeReady.current){deviceSyncChangeReady.current=true;return;}
    if(experience||!deviceSyncAvailable||!deviceSyncMeta.autoSync)return;
    const timer=setTimeout(()=>{void deviceSyncRun.current?.({reason:'change'});},2500);
    return ()=>clearTimeout(timer);
  },[library,history,storedProgress,collections,libraryMeta,sourceMatches,appearance,contentPrefs,smartDownloads,experience,deviceSyncAvailable,deviceSyncMeta.autoSync]);
  const waitForDeviceSyncIdle=async()=>{
    while(deviceSyncPromise.current){
      try{await deviceSyncPromise.current;}catch{break;}
    }
  };
  const chooseSyncFolder=async()=>{
    if(!folderSyncAvailable||deviceSyncAction.current)return;
    deviceSyncAction.current=true;
    setDeviceSyncStatus(previous=>({...previous,phase:'choosing',message:''}));
    try{
      await waitForDeviceSyncIdle();
      const next=await chooseDeviceSyncFolder();
      setDeviceSyncFolder(next);
      if(next?.canceled){
        setDeviceSyncStatus(previous=>({...previous,phase:'idle',message:''}));
        return;
      }
      if(!next?.granted)throw new Error('The folder did not grant read and write access.');
      try{
        setDeviceSyncMeta(resetDeviceSyncPublication(window.localStorage,deviceSyncPlatform));
      }catch{}
      deviceSyncAction.current=false;
      const result=await deviceSyncRun.current?.({manual:true,reason:'folder'});
      if(result)setToast(result.changed?'Devices synced · updates applied':'Sync folder connected');
      else if(deviceSyncError.current)setToast(deviceSyncError.current);
    }catch(e){
      const message=e?.message||'Could not select a sync folder.';
      deviceSyncError.current=message;
      setDeviceSyncStatus(previous=>({...previous,phase:'error',message}));
      setToast(message);
    }finally{
      deviceSyncAction.current=false;
    }
  };
  const disconnectSyncFolder=async()=>{
    if(!folderSyncAvailable||deviceSyncAction.current)return;
    if(!window.confirm('Disconnect this device from the sync folder?\n\nMikozora will stop reading and writing that folder. Sync files already there will stay there.'))return;
    deviceSyncAction.current=true;
    setDeviceSyncStatus(previous=>({...previous,phase:'disconnecting',message:''}));
    try{
      await waitForDeviceSyncIdle();
      const next=await clearDeviceSyncFolder();
      setDeviceSyncFolder(next);
      setDeviceSyncStatus({phase:'idle',message:'',peerCount:0,ignoredPeerFiles:0});
      setToast('Device sync disconnected · shared files were left in place');
    }catch(e){
      const message=e?.message||'Could not disconnect device sync.';
      deviceSyncError.current=message;
      setDeviceSyncStatus(previous=>({...previous,phase:'error',message}));
      setToast(message);
    }finally{
      deviceSyncAction.current=false;
    }
  };
  const changeDeviceSyncAuto=enabled=>{
    try{
      const next=setDeviceSyncAuto(window.localStorage,enabled,deviceSyncPlatform);
      setDeviceSyncMeta(next);
      setToast(enabled?'Automatic device sync on':'Automatic device sync off');
      if(enabled)void deviceSyncRun.current?.({reason:'change'});
    }catch(e){setToast(e?.message||'Could not change automatic device sync.');}
  };
  const syncDevicesNow=async()=>{
    const result=await deviceSyncRun.current?.({manual:true,reason:'manual'});
    if(result)setToast(result.changed?'Devices synced · updates applied':result.shouldWrite?'Devices synced · this device published':'Devices synced · already up to date');
    else if(deviceSyncError.current)setToast(deviceSyncError.current);
  };
  const ensureFollowedForSmart=item=>{
    const key=identity(item);let followed=false;
    if(!has(item))setLibrary(previous=>previous.some(x=>identity(x)===key)?previous:[savedSummary(item),...previous]);
    if(!collections.some(c=>Array.isArray(c.items)&&c.items.includes(key))){setCollections(previous=>toggleFavourite(previous,key));followed=true;}
    return followed;
  };
  const toggleSmartTitle=item=>{
    const key=identity(item);const selection=smartTitleSelection(smartDownloads,key,collections);
    const active=smartDownloads.enabled&&selection.selected;
    if(active&&selection.direct){
      applySmartDownloads({...smartDownloads,titleKeys:smartDownloads.titleKeys.filter(x=>x!==key)});
      setToast(selection.collections.length?`Smart downloads are still on through ${selection.collections[0].name}`:'Smart downloads off for this series');
      return;
    }
    if(active&&selection.collections.length){setToast(`Smart downloads are on through ${selection.collections[0].name}; turn that collection off in Library to stop them`);return;}
    const followed=selection.collections.length?false:ensureFollowedForSmart(item);
    applySmartDownloads({...smartDownloads,enabled:true,titleKeys:selection.direct||selection.collections.length?smartDownloads.titleKeys:[...smartDownloads.titleKeys,key]});
    setToast(followed?'Smart downloads on · Added to Favourites so Mikozora can follow it':'Smart downloads on for this series');
  };
  const toggleSmartCollection=collection=>{
    const on=smartDownloads.collectionIds.includes(collection.id);
    applySmartDownloads({...smartDownloads,enabled:on?smartDownloads.enabled:true,collectionIds:on?smartDownloads.collectionIds.filter(id=>id!==collection.id):[...smartDownloads.collectionIds,collection.id]});
    setToast(on?`Smart downloads off for ${collection.name}`:`Smart downloads on for ${collection.name}`);
  };
  const saveTitleCollectionChoices=(item,selected)=>{
    if(selected.length)setLibrary(previous=>previous.some(x=>identity(x)===identity(item))?previous:[savedSummary(item),...previous]);
    setCollections(previous=>setTitleCollections(previous,identity(item),selected));
    setCollectionDialog(null);setToast('Collections updated');
  };
  const saveCollectionMembers=(id,keys)=>{
    const known = new Set(library.map(identity));
    setCollections(previous=>{
      const old = previous.find(c=>c.id===id);
      const preserved = (old?.items||[]).filter(key=>!known.has(key));
      return setCollectionItems(previous,id,[...keys,...preserved]);
    });
    setCollectionDialog(null);setToast('Collection updated');
  };
  const saveCollectionName=name=>{
    const id=collectionDialog?.kind==='rename'?collectionDialog.id:'';
    const error=collectionNameError(name,collections,id);if(error)return error;
    if(id){setCollections(previous=>renameCollection(previous,id,name));setToast('Collection renamed');}
    else {
      let next;do{next=`collection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;}while(collections.some(c=>c.id===next));
      setCollections(previous=>createCollection(previous,name,next));setActiveCollection(next);setToast('Collection created');
    }
    setCollectionDialog(null);return '';
  };
  const removeCollection=id=>{
    const collection=collections.find(c=>c.id===id);if(!collection||id===FAVOURITES_ID)return;
    if(!window.confirm(`Delete “${collection.name}”? Its titles stay in your library, and downloads and folder files will not be deleted.`))return;
    setCollections(previous=>deleteCollection(previous,id));if(activeCollection===id)setActiveCollection('all');setToast('Collection deleted');
  };
  const rememberSearch=(value,source='all')=>{
    const clean=String(value||'').trim();
    if(clean)setSearchCentreState(previous=>recordSearch(previous,clean,source));
  };
  const saveCurrentSearch=(value,source='all')=>{
    const clean=String(value||'').trim();
    if(!clean)return;
    setSearchCentreState(previous=>saveSearch(previous,clean,source));
    setToast('Search saved');
  };
  const removeSavedSearchEntry=id=>{
    setSearchCentreState(previous=>removeSavedSearch(previous,id));
    setToast('Saved search removed');
  };
  const clearSearchHistoryEntries=()=>{
    setSearchCentreState(previous=>clearSearchHistory(previous));
    setToast('Search history cleared');
  };
  const submitSearch=(value,source='all')=>{
    const clean=String(value||'').trim();
    rememberSearch(clean,source);
    setQuery(clean);setBrowseSource(source);if(route.page!=='browse')go('browse');
  };
  const refresh=()=>{clearNetworkCache();setRefreshKey(x=>x+1);setToast('Refreshing your sources');};
  const remember=(item,episode)=>setHistory(prev=>[{item:{source:item.source,url:item.url,title:item.title,image:item.image,type:item.type,badge:item.badge,status:item.status,genres:item.genres,aired:item.aired,year:item.year,rating:item.rating,nsfw:item.nsfw},episode:{number:episode.number,url:episode.url,title:episode.title},time:Date.now()},...prev.filter(x=>!(identity(x.item)===identity(item)&&String(x.episode.number)===String(episode.number)))].slice(0,100));
  const playOffline=download=>{
    if(!download?.id)return;
    if(download?.item&&download?.episode?.url){
      remember(download.item,download.episode);
      setStoredProgress(prev=>recordWatch(prev,download.item,download.episode,[],Date.now()));
    }
    const availableDownloads=downloadsRef.current.some(record=>record.id===download.id)
      ? downloadsRef.current
      : [download,...downloadsRef.current];
    const nextDownloads=offlinePlayback.autoPlayNext
      ? nextDownloadedEpisodes(availableDownloads,download,50)
      : nextDownloadedEpisodes(availableDownloads,download,1);
    openDownload(download.id,offlinePlaybackPayload(offlinePlayback,nextDownloads));
  };
  const play=async(item,episode,options={})=>{
    const request=++playbackRequest.current;
    const cleanOnline=normalizeOnlinePlayback(onlinePlayback);
    const tryDirect=!options.forceEmbedded&&cleanOnline.directFirst&&hasOnlinePlayerPro();
    setBusy(tryDirect?`Looking for a direct stream for episode ${episode.number}...`:`Finding servers for episode ${episode.number}...`);
    try{
      const playlist=buildPlaybackPlaylist(options.playlist||item.episodes||[],episode);
      const episodeIndex=Math.max(0,playlist.currentIndex);
      const startSeconds=cleanOnline.resume?(onlinePositionFor(onlinePositionsRef.current,item,episode)?.seconds||0):0;
      const watchedSet=watchedUrlSetForEpisodes(progress,history,item,playlist.episodes,linkedTitleKeys(sourceMatches,item));
      watchedSet.add(episode.url);
      const nativePlaylist=compactPlaybackPlaylist(playlist.episodes,episodeIndex,260000,watchedSet);

      if(tryDirect&&isAndroid()&&!isDesktopApp()){
        const directPayload={
          item:{source:item.source,url:item.url,title:item.title,image:item.image||'',type:item.type||''},
          episode:{number:episode.number,url:episode.url,title:episode.title||'',ids:episode.ids||''},
          episodes:nativePlaylist.episodes,
          episodeIndex:nativePlaylist.episodeIndex,
          startPositionSeconds:startSeconds,
          online:{...cleanOnline,language:cleanOnline.subtitleLanguage,startPositionSeconds:startSeconds},
          playback:{...normalizeOfflinePlayback(offlinePlayback),startPositionSeconds:startSeconds},
        };
        let raw=JSON.stringify(directPayload);
        if(raw.length>290000&&directPayload.episodes.length>1){
          directPayload.episodes=[directPayload.episodes[directPayload.episodeIndex]];
          directPayload.episodeIndex=0;
          raw=JSON.stringify(directPayload);
        }
        if(raw.length<=300000){
          openOnlinePlayerPro(directPayload);
          remember(item,episode);
          setStoredProgress(prev=>recordWatch(prev,item,episode,playlist.episodes,Date.now()));
          playbackSession.current={item,episodes:playlist.episodes,currentUrl:episode.url};
          return true;
        }
      }

      let directStream=null;
      let directError='';
      if(tryDirect&&isDesktopApp()){
        try{
          const resolved=await resolveOnlineStream(item,episode,{
            language:cleanOnline.subtitleLanguage,
            server:options.server||'auto',
            quality:options.quality||'best',
          });
          if(request!==playbackRequest.current){
            if(resolved?.token)void clearOnlineStream(resolved.token);
            return false;
          }
          directStream=cleanDirectStream(resolved);
          if(!directStream)directError='This server did not provide a direct stream Mikozora can play.';
        }catch(error){
          if(request!==playbackRequest.current)return false;
          directError=error.message||'Direct playback was not available for this server.';
        }
      }

      if(directStream){
        remember(item,episode);
        setStoredProgress(prev=>recordWatch(prev,item,episode,playlist.episodes,Date.now()));
        setPlayer({
          mode:'direct',
          item,
          episode,
          episodes:playlist.episodes,
          episodeIndex,
          servers:[],
          stream:directStream,
          startSeconds,
        });
        playbackSession.current={item,episodes:playlist.episodes,currentUrl:episode.url};
        return true;
      }

      const servers=await getServers(item.source,episode);
      if(request!==playbackRequest.current)return false;
      if(!servers.length)throw new Error(directError?`${directError} No embedded video servers were found either.`:'No available video servers were found. Try the original site.');
      await setPlayerReferer(episode.url);
      if(request!==playbackRequest.current)return false;
      remember(item,episode);
      setStoredProgress(prev=>recordWatch(prev,item,episode,playlist.episodes,Date.now()));
      const payload={
        mode:'embedded',
        item:{title:item.title,source:item.source},
        episode:{number:episode.number,url:episode.url},
        episodes:nativePlaylist.episodes,
        episodeIndex:nativePlaylist.episodeIndex,
        servers,
        directError,
        directAttempted:tryDirect,
      };
      if(isAndroid()&&!isDesktopApp()&&typeof window.MokuBridge.openPlayer==='function'){
        let raw=JSON.stringify(payload);
        if(raw.length>290000&&payload.episodes.length>1){
          // Never let an unusually long rail prevent the episode itself opening.
          payload.episodes=[payload.episodes[payload.episodeIndex]];
          payload.episodeIndex=0;
          raw=JSON.stringify(payload);
        }
        window.MokuBridge.openPlayer(raw);
      }
      else setPlayer({...payload,item,episode,episodes:playlist.episodes,episodeIndex});
      playbackSession.current={item,episodes:playlist.episodes,currentUrl:episode.url};
      return true;
    }catch(e){
      if(request!==playbackRequest.current)return false;
      const message=e.message||'Could not load this episode.';
      if(options.reportNativeError){try{window.MokuBridge?.playerNavigationError?.(message);}catch{}}
      setToast(message);
      return false;
    }finally{
      if(request===playbackRequest.current)setBusy('');
    }
  };
  playRef.current=play;
  const closePlayer=()=>{
    const token=player?.stream?.token||'';
    setPlayer(null);
    if(token)void clearOnlineStream(token);
  };
  const playPlayerEpisode=episode=>{
    if(!player||!episode)return;
    const token=player?.stream?.token||'';
    if(token)void clearOnlineStream(token);
    return play(player.item,episode,{playlist:player.episodes});
  };
  const recordDirectPosition=(seconds,duration,ended=false,rate=offlinePlayback.playbackRate)=>{
    if(!player?.item||!player?.episode)return;
    setOnlinePositionsState(previous=>rememberOnlinePosition(previous,player.item,player.episode,seconds,duration,Date.now(),!!ended));
    const nextRate=Number(rate);
    if(Number.isFinite(nextRate)&&nextRate>0)changeOfflinePlayback({playbackRate:nextRate});
  };
  const directEnded=()=>{
    if(!player)return;
    recordDirectPosition(0,0,true);
    const episodes=Array.isArray(player.episodes)?player.episodes:[];
    const index=episodes.findIndex(episode=>episode.url===player.episode?.url);
    const next=index>=0?episodes[index+1]:null;
    if(normalizeOnlinePlayback(onlinePlayback).autoPlayNext&&next){
      const token=player?.stream?.token||'';
      if(token)void clearOnlineStream(token);
      void play(player.item,next,{playlist:episodes});
    }
  };
  const fallbackDirectToEmbedded=()=>{
    if(!player)return;
    const token=player?.stream?.token||'';
    if(token)void clearOnlineStream(token);
    void play(player.item,player.episode,{playlist:player.episodes,forceEmbedded:true});
  };
  const watchedDownloadInfo=useMemo(()=>{
    const directByTitle=new Map();
    const addDirect=(key,url)=>{
      if(!key||!url)return;
      if(!directByTitle.has(key))directByTitle.set(key,new Set());
      directByTitle.get(key).add(url);
    };
    for(const entry of progress)for(const url of entry.watched||[])addDirect(entry.key,url);
    const latestByUrl=new Map();
    const latestByNumber=new Map();
    for(const entry of history){
      if(!entry?.item||!entry?.episode?.url)continue;
      const key=identity(entry.item);
      const time=Number(entry.time)||0;
      addDirect(key,entry.episode.url);
      const urlKey=`${key}\n${entry.episode.url}`;
      latestByUrl.set(urlKey,Math.max(latestByUrl.get(urlKey)||0,time));
      const number=episodeNumberKey(entry.episode);
      if(number){
        const numberKey=`${key}\n${number}`;
        latestByNumber.set(numberKey,Math.max(latestByNumber.get(numberKey)||0,time));
      }
    }
    const updatedByKey=new Map(progress.map(entry=>[entry.key,entry.updatedAt||0]));
    const numbersByComponent=new Map();
    const out={};
    for(const download of downloads){
      if(!download?.id||!download?.item||!download?.episode?.url)continue;
      const ownKey=identity(download.item);
      let related=linkedTitleKeys(sourceMatches,download.item);
      if(!Array.isArray(related)||!related.length)related=[ownKey];
      if(!related.includes(ownKey))related=[ownKey,...related];
      const component=[...related].sort().join('\n');
      if(!numbersByComponent.has(component))numbersByComponent.set(component,watchedEpisodeNumbers(progress,history,related));
      const numbers=numbersByComponent.get(component);
      const number=episodeNumberKey(download.episode);
      const watched=!!(directByTitle.get(ownKey)?.has(download.episode.url)||(number&&numbers.has(number)));
      let watchedAt=latestByUrl.get(`${ownKey}\n${download.episode.url}`)||0;
      if(watched)for(const key of related){
        if(number)watchedAt=Math.max(watchedAt,latestByNumber.get(`${key}\n${number}`)||0);
        watchedAt=Math.max(watchedAt,updatedByKey.get(key)||0);
      }
      out[download.id]={watched,watchedAt};
    }
    return out;
  },[downloads,progress,history,sourceMatches]);
  const offlineCleanupCandidates=useMemo(()=>downloadCleanupCandidates(downloads,offlineManager,watchedDownloadInfo),[downloads,offlineManager,watchedDownloadInfo]);
  const catchUpQueue=useMemo(()=>buildCatchUpQueue({progress,history,libraryMeta,plans:watchPlanner,relatedKeysByTitle:sourceRelatedKeys,sort:'smart',limit:50}),[progress,history,libraryMeta,watchPlanner,sourceRelatedKeys]);
  const catchUpSummary=useMemo(()=>plannerSummary(catchUpQueue),[catchUpQueue]);
  const continueItems=useMemo(()=>continueWatching(progress,history,12,sourceRelatedKeys),[progress,history,sourceRelatedKeys]);
  const libraryProgress=useMemo(()=>progressByTitle(progress,history,sourceRelatedKeys),[progress,history,sourceRelatedKeys]);
  const resumeNext=entry=>play(entry.item,entry.episode,{playlist:entry.episodes});
  const commandIndex=useMemo(()=>buildCommandIndex({
    actions:[
      {id:'action:home',title:'Discover',subtitle:'Open Home',keywords:'home discover start',page:'home',actionId:'go-home'},
      {id:'action:browse',title:'Browse all sources',subtitle:'Search and filter every source',keywords:'browse search all sources anime donghua',page:'browse',actionId:'go-browse'},
      {id:'action:library',title:'Library',subtitle:'Saved titles and collections',keywords:'library saved collections favourites',page:'library',actionId:'go-library'},
      {id:'action:planner',title:'Catch-Up & Binge Planner',subtitle:`${catchUpSummary.episodesBehind||0} episodes waiting`,keywords:'planner catch up binge behind stats',page:'planner',actionId:'go-planner'},
      {id:'action:updates',title:'Release Radar & Updates Inbox',subtitle:inboxUnread?`${inboxUnread} unread`:'New episodes and ready downloads',keywords:'updates inbox release radar new episode alerts calendar digest',page:'updates',actionId:'go-updates'},
      {id:'action:downloads',title:'Downloads & Offline Manager',subtitle:`${downloads.length} local records`,keywords:'downloads offline manager storage queue',page:'downloads',actionId:'go-downloads'},
      {id:'action:stats',title:'Watch Stats & Wrapped',subtitle:'Streaks, favourites and share cards',keywords:'stats wrapped streak share card history',page:'stats',actionId:'go-stats'},
      {id:'action:history',title:'History',subtitle:'Recently opened episodes',keywords:'history recent watched',page:'history',actionId:'go-history'},
      {id:'action:sources',title:'Sources',subtitle:'Your Anime and Donghua source list',keywords:'sources providers sites',page:'sources',actionId:'go-sources'},
      {id:'action:settings',title:'Settings',subtitle:'Online Player Pro, Release Radar and Library Portability',keywords:'settings preferences online player pro portability import export alerts',page:'settings',actionId:'go-settings'},
      {id:'action:random',title:'Pick something for me',subtitle:'A deterministic surprise from your library',keywords:'random surprise decide pick shuffle',actionId:'random-library'},
    ],
    library,
    history,
    progress,
    downloads,
    updates:updates.updates||[],
    planner:catchUpQueue,
  }),[library,history,progress,downloads,updates.updates,catchUpQueue,catchUpSummary,inboxUnread]);
  const runCommand=command=>{
    if(!command)return;
    if(command.actionId==='random-library'){
      const pool=(hideNsfw?library.filter(item=>!isNsfw(item)):library);
      const pick=pickRandomTitle(pool,{seed:`command-${Date.now()}`});
      if(pick)open(pick);else setToast('Save a title first and Mikozora can pick from your library');
      return;
    }
    if(command.kind==='planner-episode'&&command.item&&command.episode){
      const entry=catchUpQueue.find(candidate=>identity(candidate.item)===identity(command.item)&&candidate.episode?.url===command.episode.url);
      if(entry){resumeNext(entry);return;}
      void play(command.item,command.episode);
      return;
    }
    if(command.kind==='download'&&command.downloadId){
      const download=downloads.find(candidate=>candidate.id===command.downloadId);
      if(download?.status==='completed')playOffline(download);else go('downloads');
      return;
    }
    if(command.kind==='update'){
      const entry=releaseRadarView.entries.find(candidate=>candidate.id===command.updateId)
        || (updates.updates||[]).find(candidate=>candidate.id===command.updateId);
      if(entry){viewRadarEntry(entry.type?entry:{...entry,type:'episode',update:entry});return;}
    }
    if(command.item){open(command.item);return;}
    if(command.page)go(command.page);
  };
  const removeContinue=item=>setStoredProgress(prev=>removeProgressTitles(prev,linkedTitleKeys(sourceMatches,item)));
  const syncProgress=detail=>{
    const episodes=detail?.episodes||[];
    const pending=pendingProgressFor(portability,detail);
    setStoredProgress(prev=>{
      let next=refreshSnapshot(prev,detail,episodes);
      if(pending?.count&&episodes.length){
        const urls=chronologicalEpisodes(episodes).slice(0,pending.count).map(episode=>episode.url).filter(Boolean);
        if(urls.length)next=setEpisodesWatched(next,detail,episodes,urls,true,Date.now());
      }
      return next;
    });
    if(pending?.count&&episodes.length){
      setPortabilityState(previous=>clearPendingProgress(previous,detail));
      setToast(`Imported watched count applied to ${detail.title}`);
    }
  };
  const linkSourceVersion=(current,candidate)=>{
    setSourceMatchesState(previous=>linkSourceTitles(previous,current,candidate));
    setToast(`Linked ${sourceName(candidate.source)} version · watched episode numbers now carry over`);
  };
  const unlinkSourceVersion=candidate=>{
    setSourceMatchesState(previous=>unlinkSourceTitle(previous,candidate));
    setToast(`Unlinked ${sourceName(candidate.source)} version`);
  };
  const markWatched=(item,episodes,flag)=>{
    const targets=(Array.isArray(episodes)?episodes:[]).filter(episode=>episode?.url);
    if(!targets.length)return;
    const relatedKeys=linkedTitleKeys(sourceMatches,item);
    const relatedKeySet=new Set(relatedKeys);
    const targetNumbers=new Set(targets.map(episodeNumberKey).filter(Boolean));
    setStoredProgress(prev=>setLinkedEpisodesWatched(prev,item,item.episodes||[],targets,flag,relatedKeys,Date.now()));
    if(!flag){
      const urls=new Set(targets.map(episode=>episode.url));
      setHistory(prev=>prev.filter(entry=>{
        const key=identity(entry.item);
        if(key===identity(item))return !urls.has(entry.episode.url);
        return !(relatedKeySet.has(key)&&targetNumbers.has(episodeNumberKey(entry.episode)));
      }));
    }
    setToast(`${flag?'Marked':'Unmarked'} ${targets.length} episode${targets.length===1?'':'s'}${flag?' as watched':''}${relatedKeys.length>1?' · linked versions updated':''}`);
  };
  markWatchedRef.current=markWatched;
  const exportBackup=async()=>{
    try{
      const text=JSON.stringify(buildBackup(window.localStorage),null,2);
      const name=backupFileName();
      if(isAndroid()){const result=await exportBackupToFile(name,text);if(!result?.canceled)setToast('Backup saved');}
      else{downloadBackupInBrowser(name,text);setToast('Backup downloaded');}
    }catch(e){setToast(e.message||'Could not create the backup.');}
  };
  const importBackup=async()=>{
    try{
      const text=isAndroid()?(await readBackupFromFile())?.text:await pickBackupInBrowser();
      if(text==null)return;
      const backup=parseBackup(text);
      const when=backup.createdAt?new Date(backup.createdAt).toLocaleString():'an unknown date';
      const s=backup.summary;
      const facts=`${s.library} library titles · ${s.collections} collections · ${s.history} history entries · progress for ${s.progress} series${s.sourceMatches?` · ${s.sourceMatches} linked source version${s.sourceMatches===1?'':'s'}`:''}`;
      if(!window.confirm(`Restore the backup from ${when}?\n\n${facts}\n\nThis replaces your current library, collections, personal ratings, notes and shelf statuses, history, watch progress, linked source versions and settings on this device.`))return;
      applyBackup(window.localStorage,backup.data);
      setToast('Backup restored — restarting…');
      setTimeout(()=>window.location.reload(),400);
    }catch(e){setToast(e.message||'Could not restore that backup.');}
  };
  const resume=async entry=>{setBusy('Finding your episode...');try{const d=await getDetail(entry.item);const ep=d.episodes.find(e=>String(e.number)===String(entry.episode.number));if(!ep)throw new Error('Episode not found. Open the series or original source.');setBusy('');await play(d,ep);}catch(e){setBusy('');setToast(e.message||'Could not open this episode.')}};
  const clearHistory=()=>{if(window.confirm('Clear recently opened episodes from this device?')){setHistory([]);setStoredProgress([]);setToast('History cleared');}};
  const clearLibrary=()=>{if(window.confirm('Remove all saved titles from this device, their collection memberships, and their personal ratings, notes and shelf statuses? Your collections, downloads and folder files will remain.')){setLibrary([]);setCollections(previous=>previous.map(c=>({...c,items:[]})));setLibraryMetaState({});setToast('Library cleared');}};
  const queueEpisodes=(item,episodes)=>{if(!episodes.length)return;setDownloadModal({item,episodes,initialChoice:smartDownloads.presets[identity(item)]||null});};
  const submitDownload=async ({language,server,quality,subtitleMode='auto',subtitleTracks=[]})=>{
    if(!downloadModal)return;
    try{
      const item=downloadModal.item;
      const summary={source:item.source,url:item.url,title:item.title,image:item.image,type:item.type};
      const episodes=downloadModal.episodes.map(ep=>({item:summary,episode:{url:ep.url,number:ep.number,title:ep.title,ids:ep.ids||''}}));
      const result=await enqueueDownloads(episodes,language,server,quality,subtitleMode,subtitleTracks);
      if(result.added)applySmartDownloads(withDownloadPreset(smartDownloads,identity(item),{language,server,quality,subtitleMode,subtitleTracks}));
      setDownloadModal(null);setToast(result.added?`${result.added} episode${result.added===1?'':'s'} added to the queue`:'Already in your downloads');
      try{setDownloads(await getDownloads())}catch{} go('downloads');
    }catch(e){setToast(e.message||'Could not add episodes to the queue');}
  };
  const deleteDownload=async d=>{
    if(!window.confirm(`Remove episode ${d.episode?.number} from Mikozora? Any playable copies in your chosen folder will remain.`))return;
    try{await removeDownload(d.id);setDownloads(await getDownloads());setToast('Download removed');}
    catch(e){setToast(e.message||'Could not remove this download');}
  };
  const performBulkRemove=async records=>{
    const unique=[...new Map((Array.isArray(records)?records:[]).filter(d=>d?.id).map(d=>[d.id,d])).values()];
    let removed=0;
    let lastError='';
    for(const d of unique){
      try{await removeDownload(d.id);removed++;}
      catch(e){lastError=e.message||'Could not remove a download';}
    }
    try{setDownloads(await getDownloads());}catch{/* the Downloads page will refresh again shortly */}
    return {removed,failed:unique.length-removed,lastError,total:unique.length};
  };
  const removeDownloadsBulk=async records=>{
    const unique=[...new Map((Array.isArray(records)?records:[]).filter(d=>d?.id).map(d=>[d.id,d])).values()];
    if(!unique.length)return;
    const size=bytesLabel(unique.reduce((sum,d)=>sum+downloadBytes(d),0));
    if(!window.confirm(`Remove ${unique.length} ${unique.length===1?'download':'downloads'} from Mikozora${size?` (${size})`:''}?\n\nAny playable copies in your chosen folder will remain.`))return;
    const result=await performBulkRemove(unique);
    setToast(result.failed?`Removed ${result.removed}; ${result.failed} could not be removed${result.lastError?`: ${result.lastError}`:''}`:`Removed ${result.removed} ${result.removed===1?'download':'downloads'}`);
  };
  const cleanupWatchedDownloads=async(automatic=false)=>{
    const candidates=downloadCleanupCandidates(downloadsRef.current,offlineManager,watchedDownloadInfo);
    const records=candidates.map(candidate=>candidate.record);
    if(!records.length){
      if(!automatic)setToast('No watched downloads match your cleanup rules');
      return;
    }
    const size=bytesLabel(cleanupBytes(candidates));
    if(!automatic&&!window.confirm(`Remove ${records.length} watched ${records.length===1?'download':'downloads'}${size?` (${size})`:''}?\n\nOnly completed Mikozora copies that match your storage rules are included. Verified folder-only files stay where they are.`))return;
    const result=await performBulkRemove(records);
    if(result.removed)setToast(`${automatic?'Offline cleanup removed':'Cleaned'} ${result.removed} watched ${result.removed===1?'download':'downloads'}${size?` · ${size}`:''}`);
    else if(!automatic||result.failed)setToast(result.lastError||'Could not clean watched downloads');
  };
  const moveDownloadQueue=async(d,move)=>{
    const current=queueOrderIds(downloadsRef.current,offlineManager);
    const next=moveQueueOrder(current,d.id,move);
    if(next.join(',')===current.join(','))return;
    changeOfflineManager({queueOrder:next});
    try{
      const result=await setDownloadQueueOrder(next);
      if(Array.isArray(result?.queueOrder)&&result.queueOrder.length)changeOfflineManager({queueOrder:result.queueOrder});
      try{setDownloads(await getDownloads());}catch{/* polling will refresh the list */}
      setToast('Download queue updated');
    }catch(e){
      setToast(e.message||'Queue order saved here, but the native download queue could not be updated');
    }
  };
  useEffect(()=>{
    if(route.page!=='downloads'||downloadsLoading||!offlineManager.autoCleanup||offlinePlayer)return;
    if(!offlineCleanupCandidates.length)return;
    const signature=[offlineManager.storageLimitGb,offlineManager.autoDeleteWatchedDays,...offlineCleanupCandidates.map(candidate=>candidate.record.id)].join('|');
    if(autoCleanupAttempted.current===signature)return;
    autoCleanupAttempted.current=signature;
    void cleanupWatchedDownloads(true);
  },[route.page,downloadsLoading,offlineManager,offlineCleanupCandidates,offlinePlayer]);
  const retryDownload=async d=>{
    try{await enqueueDownloads([{item:d.item,episode:d.episode}],d.language||'english',d.serverChoice||'auto',d.qualityChoice||'best',d.subtitleMode||'auto',Array.isArray(d.subtitleSelection)?d.subtitleSelection:[]);setDownloads(await getDownloads());setToast('Added back to the queue');}
    catch(e){setToast(e.message||'Could not retry this download');}
  };
  const chooseFolder=async()=>{
    try{const next=await chooseDownloadFolder();setFolder(next);if(!next.canceled)setToast('Download folder updated');}
    catch(e){setToast(e.message||'Could not select a folder');}
  };
  const usePrivate=async()=>{
    if(!window.confirm('Stop saving new folder copies? Existing files and already queued copies will remain.'))return;
    try{setFolder(await clearDownloadFolder());setToast('New downloads will stay in Mikozora only');}
    catch(e){setToast(e.message||'Could not change the folder');}
  };
  const saveCopy=async d=>{
    if(d.exportUri&&!window.confirm('Save another playable copy? This uses additional storage.'))return;
    try{const result=await exportDownload(d.id);setToast(result.queued?'Playable copy added to the queue':'A copy is already being saved');setDownloads(await getDownloads());}
    catch(e){setToast(e.message||'Could not save the copy');}
  };
  if(experience) return <WelcomeScreen mode={experience.mode} manual={!!experience.manual} onContinue={finishExperience}/>;
  const common={open,has,toggle,browse};
  return <div className="app-shell"><SideNav page={route.page} go={go} unread={inboxUnread}/><div className="main-shell"><TopBar page={route.page} go={go} submitSearch={submitSearch} refresh={refresh} unread={inboxUnread} openCommandCentre={()=>setCommandCentreOpen(true)}/>{pendingUpdate&&<UpdateBanner info={pendingUpdate} download={downloadAppUpdate} dismiss={dismissAppUpdate}/>}<main key={route.page==='detail'?identity(route.item):route.page}>
    {route.page==='home'&&<HomePage {...common} recent={history} refreshKey={refreshKey} hideNsfw={hideNsfw} continueItems={continueItems} resumeNext={resumeNext} removeContinue={removeContinue} library={library} progress={progress} libraryMeta={libraryMeta} catchUpItems={catchUpQueue} catchUpSummary={catchUpSummary} openPlanner={()=>go('planner')}/>}
    {route.page==='browse'&&<BrowsePage {...common} query={query} setQuery={setQuery} source={browseSource} setSource={setBrowseSource} refreshKey={refreshKey} hideNsfw={hideNsfw} openSettings={()=>go('settings')} library={library} history={history} progress={progress} libraryMeta={libraryMeta} sourceMatches={sourceMatches} searchCentre={searchCentre} submitSearch={submitSearch} saveCurrentSearch={saveCurrentSearch} removeSavedSearchEntry={removeSavedSearchEntry} clearSearchHistoryEntries={clearSearchHistoryEntries}/>}
    {route.page==='detail'&&<DetailPage item={route.item} openEpisode={play} has={has} toggle={toggle} organize={item=>setCollectionDialog({kind:'title',item})} back={back} history={history} refreshKey={refreshKey} queueEpisodes={queueEpisodes} downloads={downloads} showDownloads={()=>go('downloads')} notify={setToast} hideNsfw={hideNsfw} openSettings={()=>go('settings')} watched={watchedUrlSet(progress,history,route.item)} onEpisodesReady={syncProgress} markWatched={markWatched} smartSelection={smartTitleSelection(smartDownloads,identity(route.item),collections)} smartEnabled={smartDownloads.enabled} toggleSmartDownload={toggleSmartTitle} libraryMeta={libraryMeta} updateLibraryMeta={updateLibraryMeta} openItem={open} linkedItems={linkedTitleItems(sourceMatches,route.item,knownSourceItems)} linkedKeys={linkedTitleKeys(sourceMatches,route.item)} watchedNumbers={watchedEpisodeNumbers(progress,history,linkedTitleKeys(sourceMatches,route.item))} onLinkSource={linkSourceVersion} onUnlinkSource={unlinkSourceVersion} releaseRadar={releaseRadar} onReleaseRadarRule={changeReleaseRadarRule} radarActivity={releaseRadarView.activity.find(entry=>entry.key===identity(route.item))||null} onlinePositions={onlinePositions} similarCandidates={knownSourceItems} pendingImported={pendingProgressFor(portability,route.item)} saveShareCard={saveShareCard}/>}
    {route.page==='library'&&<LibraryPage {...common} items={library} collections={collections} activeCollection={activeCollection} setActiveCollection={setActiveCollection} onCreate={()=>setCollectionDialog({kind:'new'})} onRename={id=>setCollectionDialog({kind:'rename',id})} onDelete={removeCollection} onMembers={id=>setCollectionDialog({kind:'members',id})} onFavourite={favourite} unreadTitles={unreadTitles} progressByTitle={libraryProgress} hideNsfw={hideNsfw} smartCollections={smartDownloads.collectionIds} onSmartCollection={toggleSmartCollection} libraryMeta={libraryMeta} onRemoveTitles={removeLibraryTitles} onAddTitlesToCollection={addTitlesToCollection} openPlanner={()=>go('planner')} openStats={()=>go('stats')}/>}
    {route.page==='planner'&&<PlannerPage progress={progress} history={history} libraryMeta={libraryMeta} plans={watchPlanner} relatedKeysByTitle={sourceRelatedKeys} open={open} resumeNext={resumeNext} queueEpisodes={queueEpisodes} changePlan={changeWatchPlan} browse={browse}/>}
    {route.page==='stats'&&<StatsPage history={history} progress={progress} library={library} libraryMeta={libraryMeta} relatedKeysByTitle={sourceRelatedKeys} open={open} browse={browse} notify={setToast} saveShareCard={saveShareCard}/>}
    {route.page==='updates'&&<UpdatesPage state={updates} available={updatesAvailable} syncError={updatesSyncError} actionError={updatesActionError} check={checkNow} readAll={readAllUpdates} openUpdate={viewRadarEntry} openLibrary={()=>go('library')} openSettings={()=>go('settings')} radar={releaseRadarView} releaseRadar={releaseRadar} onReleaseRadarRule={changeReleaseRadarRule} dismissRadarEntry={dismissRadarEntry} openDownloads={()=>go('downloads')}/>}
    {route.page==='downloads'&&<DownloadsPage items={downloads} loading={downloadsLoading} remove={deleteDownload} retry={retryDownload} change={d=>setDownloadModal({item:d.item,episodes:[d.episode],language:d.language||'english',serverChoice:d.serverChoice||'auto',subtitleMode:d.subtitleMode||'auto',subtitleSelection:Array.isArray(d.subtitleSelection)?d.subtitleSelection:[]})} browse={browse} folder={folder} saveCopy={saveCopy} openSettings={()=>go('settings')} playOffline={playOffline} watchedById={watchedDownloadInfo} managerPrefs={offlineManager} changeManagerPrefs={changeOfflineManager} cleanupCandidates={offlineCleanupCandidates} runCleanup={cleanupWatchedDownloads} removeMany={removeDownloadsBulk} moveQueue={moveDownloadQueue}/>}
    {route.page==='history'&&<HistoryPage items={history.filter(entry=>!hideNsfw||!isNsfw(entry.item))} resume={resume} open={open} clear={clearHistory} browse={browse} onlinePositions={onlinePositions}/>}
    {route.page==='sources'&&<SourcesPage browse={browse}/>}
    {route.page==='settings'&&<SettingsPage library={library} history={history} clearLibrary={clearLibrary} clearHistory={clearHistory} openLicenses={()=>setLicenses(true)} openReleaseNotes={()=>setExperience({mode:'update',manual:true})} folder={folder} chooseFolder={chooseFolder} usePrivate={usePrivate} updates={updates} updatesAvailable={updatesAvailable} changeAutomatic={changeAutomatic} changeAlerts={changeAlerts} notificationPermission={notificationPermission} appearance={appearance} changeAppearance={changeAppearance} contentPrefs={contentPrefs} changeContentPrefs={changeContentPrefs} appUpdate={appUpdate} pendingUpdate={pendingUpdate} updateStatus={updateStatus} checkUpdate={checkAppUpdate} changeAutoCheck={changeAutoCheck} downloadUpdate={downloadAppUpdate} exportBackup={exportBackup} importBackup={importBackup} smartDownloads={smartDownloads} changeSmartDownloads={changeSmartDownloads} deviceSync={{available:deviceSyncAvailable,folder:deviceSyncFolder,meta:deviceSyncMeta,status:deviceSyncStatus,choose:chooseSyncFolder,disconnect:disconnectSyncFolder,syncNow:syncDevicesNow,changeAuto:changeDeviceSyncAuto}} offlinePlayback={offlinePlayback} changeOfflinePlayback={changeOfflinePlayback} openDownloads={()=>go('downloads')} onlinePlayback={onlinePlayback} changeOnlinePlayback={changeOnlinePlayback} onlinePlayerAvailable={hasOnlinePlayerPro()} collections={collections} progress={progress} libraryMeta={libraryMeta} portability={portability} canUseTextFiles={hasTextFiles()||typeof document!=='undefined'} saveTextFile={saveTextFile} readTextFile={readTextFile} applyPortabilityResult={applyPortabilityResult} notify={setToast}/>}
  </main></div><BottomNav page={route.page} go={go}/>{collectionDialog?.kind==='new'&&<CollectionNameDialog close={()=>setCollectionDialog(null)} submit={saveCollectionName}/>}{collectionDialog?.kind==='rename'&&<CollectionNameDialog editing value={collections.find(c=>c.id===collectionDialog.id)?.name||''} close={()=>setCollectionDialog(null)} submit={saveCollectionName}/>}{collectionDialog?.kind==='title'&&<TitleCollectionsDialog item={collectionDialog.item} collections={collections} close={()=>setCollectionDialog(null)} submit={selected=>saveTitleCollectionChoices(collectionDialog.item,selected)}/>}{collectionDialog?.kind==='members'&&collections.find(c=>c.id===collectionDialog.id)&&<CollectionMembersDialog collection={collections.find(c=>c.id===collectionDialog.id)} items={hideNsfw?library.filter(item=>!isNsfw(item)):library} close={()=>setCollectionDialog(null)} submit={keys=>saveCollectionMembers(collectionDialog.id,keys)}/>} {offlinePlayer&&<OfflinePlayerModal key={offlinePlayer.id} entry={offlinePlayer} close={()=>setOfflinePlayer(null)} prefs={offlinePlayback} changePrefs={changeOfflinePlayback} downloads={downloads} playOffline={playOffline} notify={setToast}/>}{commandCentreOpen&&<CommandCentre commands={commandIndex} close={()=>setCommandCentreOpen(false)} run={runCommand}/>}{player&&<PlayerModal key={`${player.episode.url}|${player.mode||'embedded'}|${player.stream?.token||''}`} player={player} close={closePlayer} onEpisode={playPlayerEpisode} watched={watchedUrlSetForEpisodes(progress,history,player.item,player.episodes||[],linkedTitleKeys(sourceMatches,player.item))} markWatched={markWatched} onlinePrefs={onlinePlayback} playbackPrefs={offlinePlayback} onPlaybackRateChange={rate=>changeOfflinePlayback({playbackRate:rate})} onPosition={recordDirectPosition} onEnded={directEnded} onFallback={fallbackDirectToEmbedded} notify={setToast}/>}{licenses&&<LicenseModal close={()=>setLicenses(false)}/>}{downloadModal&&<DownloadModal request={downloadModal} close={()=>setDownloadModal(null)} submit={submitDownload}/>}{busy&&<div className="busy-overlay"><div><LoaderCircle size={20} className="spin"/><span>{busy}</span></div></div>}{toast&&<div className="toast"><Check size={16}/>{toast}</div>}</div>;
}

createRoot(document.getElementById('root')).render(<App/>);
