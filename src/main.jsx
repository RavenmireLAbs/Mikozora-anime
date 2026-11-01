import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Home, Compass, Bookmark, History, Layers3, Settings2, Search, ArrowRight,
  ArrowUpRight, ChevronLeft, ChevronRight, Play, Check, RefreshCw, X, Clock3,
  ExternalLink, Sparkles, SlidersHorizontal, Film, LoaderCircle, AlertCircle,
  Trash2, RotateCcw, FolderHeart, CircleHelp, ShieldCheck, Plus, ListVideo, Download, HardDrive, ListChecks, CheckCircle2, Heart, FolderPlus, Pencil, Folder, Flame, Bell, Sun, Moon, EyeOff
} from 'lucide-react';
import { SOURCES, getCatalog, getDetail, getFeatured, getTrending, getDiscoverAnime, getServers, imageUrl, isAndroid, clearNetworkCache, getDownloads, getDownloadOptions, enqueueDownloads, removeDownload, openDownload, getExportSettings, chooseDownloadFolder, clearDownloadFolder, exportDownload, openExport, hasEpisodeUpdates, syncEpisodeTitles, getEpisodeUpdates, checkEpisodes, setEpisodeAutomatic, setEpisodeAlerts, markEpisodeRead, fetchLatestRelease, exportBackupToFile, readBackupFromFile } from './data';
import { buildPlaybackPlaylist, compactPlaybackPlaylist } from './playback';
import { monitoredTitles, unreadByTitle } from './episode-updates';
import { COLLECTIONS_KEY, FAVOURITES_ID, titleKey, normalizeCollections, collectionNameError, createCollection, renameCollection, deleteCollection, setCollectionItems, setTitleCollections, toggleFavourite, removeTitleFromCollections } from './collections';
import { PROGRESS_KEY, normalizeProgress, recordWatch, refreshSnapshot, setEpisodesWatched, removeProgressTitle, watchedUrlSet, continueWatching, progressByTitle } from './progress';
import { backupFileName, buildBackup, parseBackup, applyBackup, downloadBackupInBrowser, pickBackupInBrowser } from './backup';
import { APP_VERSION, RELEASES, startupExperience, completeExperience } from './releases';
import { DEFAULT_UPDATE_STATE, readUpdateState, saveUpdateState, shouldAutoCheck, withCheckResult, visibleUpdate, dismissUpdate } from './update';
import { ACCENTS, MODES, DEFAULT_APPEARANCE, readAppearance, saveAppearance, applyAppearance, syncNativeAppearance } from './appearance';
import { GENRES, DEFAULT_CONTENT_PREFS, readContentPrefs, saveContentPrefs, isNsfw, ratingOf, yearOf, filterTitles } from './content';
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
function TopBar({ page, go, submitSearch, refresh, unread = 0 }) {
  const [input, setInput] = useState('');
  const labels = { home:'Discover', browse:'Browse', library:'Library', updates:'Updates', history:'History', downloads:'Downloads', sources:'Sources', settings:'Settings', detail:'Anime details' };
  function submit(e) { e.preventDefault(); submitSearch(input.trim()); }
  return <header className="topbar">
    <div className="mobile-brand"><Brand onClick={() => go('home')}/></div>
    <div className="breadcrumbs"><span>YOUR SPACE</span><ChevronRight size={14}/><strong>{labels[page] || 'Discover'}</strong></div>
    <div className="top-actions"><form className="top-search" onSubmit={submit}><Search size={17}/><input aria-label="Search anime" value={input} onChange={e=>setInput(e.target.value)} placeholder="Search anime..."/><kbd>↵</kbd></form><button className="icon-btn refresh" onClick={refresh} title="Refresh source data" aria-label="Refresh source data"><RefreshCw size={18}/></button><button className={'icon-btn updates-button '+(page==='updates'?'active':'')} onClick={()=>go('updates')} title="Episode updates" aria-label={unread?`Updates, ${unread} unread`:'Updates'}><Bell size={18}/>{unread>0&&<span className="updates-badge">{unread>99?'99+':unread}</span>}</button><button className="mobile-settings icon-btn" onClick={() => go('settings')} aria-label="Settings"><Settings2 size={19}/></button></div>
  </header>;
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
function AnimeCard({ item, onOpen, inLibrary, toggle, index = 0, favourite, onFavourite, newCount = 0, progress = null }) {
  const year = yearOf(item);
  return <article className="anime-card">
    <div className="card-cover">
      <button className="cover-hit" onClick={() => onOpen(item)} aria-label={`Open ${item.title}`}><Cover item={item} eager={index<4}/><span className="card-shade"/><span className="card-play"><Play size={16} fill="currentColor"/></span></button>
      <div className="cover-top"><div className="cover-badges"><span className="cover-badge">{item.badge || 'SUB'}</span><RatingBadge item={item}/></div><div className="cover-buttons">{onFavourite&&<button className={'save-mini favourite-mini '+(favourite?'saved':'')} onClick={()=>onFavourite(item)} aria-label={favourite?`Remove ${item.title} from Favourites`:`Add ${item.title} to Favourites`} title={favourite?'Remove from Favourites':'Add to Favourites'}><Heart size={15} fill={favourite?'currentColor':'none'}/></button>}<button className={'save-mini '+(inLibrary?'saved':'')} onClick={() => toggle(item)} aria-label={inLibrary ? `Remove ${item.title} from library` : `Save ${item.title} to library`} title={inLibrary?'Remove from library':'Save to library'}><Bookmark size={15} fill={inLibrary?'currentColor':'none'}/></button></div></div>
      {progress?.total>0 ? <span className="cover-status">{progress.watchedCount}/{progress.total} watched</span> : item.status && <span className="cover-status">{item.status}</span>}
      {newCount>0&&<span className="cover-new" aria-label={`${newCount} new episode${newCount===1?'':'s'}`}>{newCount} NEW</span>}
      {progress?.total>0&&progress.watchedCount>0&&<span className="cover-progress"><i style={{width:`${Math.min(100,Math.round(progress.watchedCount/progress.total*100))}%`}}/></span>}
    </div>
    <button className="card-title" onClick={() => onOpen(item)} title={item.title}>{item.title}</button>
    <div className="card-meta">{year>0&&<><span>{year}</span><b>·</b></>}<span>{item.type || 'ANIME'}</span><b>·</b><span>{sourceName(item.source)}</span></div>
  </article>;
}
function Empty({ icon: Icon = Sparkles, title, body, action, actionLabel }) {
  return <div className="empty"><div className="empty-icon"><Icon size={25}/></div><h3>{title}</h3><p>{body}</p>{action && <button className="btn primary" onClick={action}>{actionLabel}<ArrowRight size={16}/></button>}</div>;
}
function SkeletonRail() { return <div className="card-rail skeleton-rail">{Array.from({length:7}).map((_,i)=><div className="skeleton-card" key={i}><div className="skeleton shimmer"/><span className="skeleton shimmer"/><span className="skeleton shimmer"/></div>)}</div>; }
function SectionHeading({ eyebrow, title, link, action, count }) {
  return <div className="section-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}{count != null && <small className="count">{count}</small>}</h2></div>{action && <button className="text-link" onClick={action}>{link || 'See all'} <ArrowRight size={15}/></button>}</div>;
}
function Rail({ items, open, has, toggle }) {
  return <div className="card-rail">{items.map((item,i)=><AnimeCard key={identity(item)} item={item} index={i} onOpen={open} inLibrary={has(item)} toggle={toggle}/>)}</div>;
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
function HomePage({open, has, toggle, browse, recent, refreshKey, hideNsfw = false, continueItems = [], resumeNext, removeContinue}) {
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
  const date = new Intl.DateTimeFormat(undefined, { weekday:'long', month:'short', day:'numeric' }).format(new Date()).toUpperCase();
  return <div className="content home-page">
    <div className="welcome-row"><div><div className="date-line"><span className="date-star">✦</span> {date} <span className="date-separator"/> A GOOD DAY FOR ANIME</div><h1>Your next story starts here<span>.</span></h1><p>Good to have you here. What are we watching today?</p></div><div className="source-count"><div className="source-count-icon"><Layers3 size={17}/></div><div><strong>{Object.keys(SOURCES).length} sources</strong><small>One cozy place</small></div><i/></div></div>
    <Hero featured={shown(state.featured)} fallback={shown(state.sogo)} open={x=>x?open(x):browse('all')} has={has} toggle={toggle}/>
    {shownContinue.length>0 ? <section className="content-section continue-section"><SectionHeading eyebrow="PICK UP WHERE YOU LEFT OFF" title="Continue watching" link="View history" action={()=>browse('history')}/><div className="continue-rail">{shownContinue.slice(0,8).map((entry)=><div className="continue-card" key={identity(entry.item)}><button className="continue-main" onClick={()=>resumeNext(entry)} aria-label={`Play episode ${entry.episode.number} of ${entry.item.title}`}><div className="continue-cover"><Cover item={entry.item}/></div><div className="continue-info"><span>NEXT · EPISODE {entry.episode.number}</span><strong>{entry.item.title}</strong><small>{sourceName(entry.item.source)} · {entry.watchedCount} of {entry.total} watched</small><span className="continue-progress"><i style={{width:`${Math.min(100,Math.round(entry.watchedCount/entry.total*100))}%`}}/></span></div><span className="continue-play"><Play size={14} fill="currentColor"/></span></button><button className="continue-remove" onClick={()=>removeContinue(entry.item)} aria-label={`Remove ${entry.item.title} from Continue watching`} title="Remove from Continue watching"><X size={13}/></button></div>)}</div></section> : shownRecent.length>0 && <section className="content-section continue-section"><SectionHeading eyebrow="PICK UP WHERE YOU LEFT OFF" title="Recently opened" link="View history" action={()=>browse('history')}/><div className="continue-rail">{shownRecent.slice(0,4).map((entry)=><button className="continue-card" key={`${identity(entry.item)}|${entry.episode.number}`} onClick={()=>open(entry.item)}><div className="continue-cover"><Cover item={entry.item}/></div><div className="continue-info"><span>EPISODE {entry.episode.number}</span><strong>{entry.item.title}</strong><small>{sourceName(entry.item.source)} · {prettyTime(entry.time)}</small></div><span className="continue-play"><Play size={14} fill="currentColor"/></span></button>)}</div></section>}
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
function BrowsePage({open,has,toggle, query, setQuery, source, setSource, refreshKey, hideNsfw = false, openSettings}) {
  const [draft,setDraft] = useState(query);
  const [status,setStatus] = useState('all');
  const [genre,setGenre] = useState('');
  const [year,setYear] = useState('');
  const [nsfw,setNsfw] = useState('all');
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
  const visibleItems = filterTitles(data.items, { genre:activeGenre, year:activeYear, status:activeStatus, nsfw, hideNsfw });
  const hiddenCount = data.items.length - visibleItems.length;
  const activeFilterCount = [!!activeGenre, !!activeYear, activeStatus!=='all', nsfw!=='all'].filter(Boolean).length;
  const clearFilters = ()=>{setStatus('all');setGenre('');setYear('');setNsfw('all');};
  const moreButton = data.more && <div className="more-wrap"><button className="btn secondary" onClick={more} disabled={data.loading||data.loadingMore}>{data.loadingMore?<LoaderCircle className="spin" size={16}/>:null} Load more <ChevronRight size={16}/></button></div>;
  const extraValue=['all','sogo','xin'].includes(source)?'':source;
  return <div className="content page-content"><div className="page-heading"><div><div className="eyebrow">SOMETHING FOR EVERY MOOD</div><h1>Find your next favorite<span>.</span></h1><p>Search across your sources or just see where the story takes you.</p></div><div className="heading-art"><Compass size={35}/><span>✦</span></div></div>
    <form className="browse-search" onSubmit={e=>{e.preventDefault();setQuery(draft.trim())}}><Search size={20}/><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Search titles, adventures, worlds..." aria-label="Search titles"/><button className="btn primary" type="submit">Search <ArrowRight size={15}/></button></form>
    <div className="filter-row source-filter-row"><div className="browse-source-controls"><div className="tabs" role="group" aria-label="Filter by source">{[['all','All sources'],['sogo','AnimeSogo'],['xin','AnimeXin']].map(([id,label])=><button key={id} className={source===id?'selected':''} aria-pressed={source===id} onClick={()=>setSource(id)}>{id!=='all'&&<i className={'tab-dot '+id}/>} {label}</button>)}</div><label className="source-select"><span className="sr-only">More sources</span><select aria-label="More sources" value={extraValue} onChange={e=>setSource(e.target.value || 'all')}><option value="">More sources…</option><option value="anime">All Anime sources</option><option value="donghua">All Donghua sources</option>{['Anime','Donghua'].map(category=><optgroup key={category} label={category}>{Object.values(SOURCES).filter(x=>x.category===category && !['sogo','xin'].includes(x.id)).map(src=><option key={src.id} value={src.id}>{src.name}</option>)}</optgroup>)}</select></label></div><span className="results-label">{data.loading&&!data.items.length?'LOOKING FOR STORIES':`${visibleItems.length} TITLES SHOWN${hiddenCount>0?` · ${hiddenCount} HIDDEN BY FILTERS`:''}${data.loading?' · LOADING':''}`}</span></div>
    <div className="status-filter"><span className="status-filter-label">STATUS</span>{query ? <button className="text-link muted" onClick={()=>{setQuery('');setDraft('')}}>Clear search to filter by status, genre or year <X size={14}/></button> : <div className="tabs status-tabs" role="group" aria-label="Filter by status">{[['all','All statuses'],['ongoing','Ongoing'],['completed','Completed'],['upcoming','Upcoming']].map(([id,label])=><button key={id} className={status===id?'selected':''} aria-pressed={status===id} onClick={()=>setStatus(id)}>{label}</button>)}</div>}</div>
    <div className="browse-filters">
      <div className="filter-field genre-field"><span className="status-filter-label" id="genre-filter-label">GENRE</span><div className="tabs genre-tabs" role="group" aria-labelledby="genre-filter-label"><button className={!genre?'selected':''} aria-pressed={!genre} disabled={searching} onClick={()=>setGenre('')}>All genres</button>{GENRES.map(name=><button key={name} className={genre===name?'selected':''} aria-pressed={genre===name} disabled={searching} onClick={()=>setGenre(genre===name?'':name)}>{name}</button>)}</div></div>
      <div className="filter-field-row">
        <label className="filter-field year-field"><span className="status-filter-label">YEAR</span><select aria-label="Filter by year" value={year} disabled={searching} onChange={e=>setYear(e.target.value)}><option value="">All years</option>{BROWSE_YEARS.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
        <div className="filter-field content-field"><span className="status-filter-label" id="content-filter-label">CONTENT</span>{hideNsfw ? <div className="nsfw-hidden-note"><EyeOff size={14}/><span>NSFW is turned off in Settings.</span>{openSettings&&<button className="text-link" onClick={openSettings}>Change</button>}</div> : <div className="tabs status-tabs" role="group" aria-labelledby="content-filter-label">{[['all','All content'],['safe','Safe only'],['only','NSFW only']].map(([id,label])=><button key={id} className={nsfw===id?'selected':''} aria-pressed={nsfw===id} onClick={()=>setNsfw(id)}>{label}</button>)}</div>}</div>
        {activeFilterCount>0&&<button className="text-link muted clear-filters" onClick={clearFilters}><X size={14}/> Clear filters</button>}
      </div>
      <p className="filter-hint">Genre and year use each source’s own listings where available; sources without them are noted below. Cards show the age rating a source provides, or NR when it provides none.</p>
    </div>
    <div className="browse-title"><div><span className="eyebrow">{query?'SEARCH RESULTS':activeFilterCount>0||hideNsfw?'FILTERED CATALOG':'THE LATEST'}</span><h2>{query?`Results for “${query}”`:activeGenre?`${activeGenre} titles`:'Explore the catalog'}</h2></div><SlidersHorizontal size={17}/></div>
    {data.errors.length>0&&<div className="inline-error"><AlertCircle size={16}/> Some sources could not be reached or do not support this filter: {data.errors.map(sourceName).join(', ')}.</div>}
    {data.loading && !data.items.length ? <div className="anime-grid">{Array.from({length:12}).map((_,i)=><div className="skeleton-card" key={i}><div className="skeleton shimmer"/><span className="skeleton shimmer"/><span className="skeleton shimmer"/></div>)}</div> : visibleItems.length ? <><div className="anime-grid">{visibleItems.map((item,i)=><AnimeCard key={identity(item)} item={item} index={i} onOpen={open} inLibrary={has(item)} toggle={toggle}/>)}</div>{moreButton}</> : data.items.length ? <><Empty icon={hideNsfw?EyeOff:SlidersHorizontal} title="No titles match these filters" body={hideNsfw?'Everything loaded so far is hidden by your filters, or marked NSFW while NSFW is turned off in Settings. Load more titles or clear a filter.':'Everything loaded so far is filtered out. Load more titles from the sources, or clear a filter to see more.'} action={activeFilterCount>0?clearFilters:undefined} actionLabel="Clear filters"/>{moreButton}</> : <Empty icon={Search} title={query?'No titles found':'Nothing to show yet'} body={query?'Try a different title or select another source.':'The source may be unavailable. Try refreshing.'} action={()=>{setQuery('');setDraft('');setSource('all');clearFilters();}} actionLabel="Browse everything"/>}
  </div>;
}
function DetailPage({item, openEpisode, has, toggle, organize, back, history, refreshKey, queueEpisodes, downloads, showDownloads, notify, hideNsfw = false, openSettings, watched, onEpisodesReady, markWatched}) {
  const [state,setState]=useState({detail:null,loading:true,error:''});
  const [order,setOrder]=useState('newest'); const [filter,setFilter]=useState(''); const [visible,setVisible]=useState(40);
  const [selecting,setSelecting]=useState(false); const [selected,setSelected]=useState([]);
  useEffect(()=>{let alive=true;setState({detail:null,loading:true,error:''});setVisible(40);setFilter('');setSelected([]);setSelecting(false);getDetail(item).then(detail=>alive&&setState({detail,loading:false,error:''})).catch(e=>alive&&setState({detail:null,loading:false,error:e.message||'Could not load this title.'}));return()=>{alive=false}},[item.source,item.url,refreshKey]);
  useEffect(()=>{if(state.detail?.episodes?.length)onEpisodesReady?.(state.detail);},[state.detail]);
  const detail=state.detail || item;
  const episodes=useMemo(()=>{ const list=[...(state.detail?.episodes||[])];list.sort((a,b)=>{const n=(parseFloat(a.number)||0)-(parseFloat(b.number)||0);return order==='newest'?-n:n});return filter?list.filter(e=>`${e.number} ${e.title}`.toLowerCase().includes(filter.toLowerCase())):list; },[state.detail,order,filter]);
  const recent=history.find(x=>identity(x.item)===identity(item));
  const first=[...(state.detail?.episodes||[])].sort((a,b)=>(parseFloat(a.number)||0)-(parseFloat(b.number)||0))[0];
  const resume=recent && state.detail?.episodes.find(e=>String(e.number)===String(recent.episode.number));
  const watchedCount=(state.detail?.episodes||[]).filter(e=>watched?.has(e.url)).length;
  const chooseEpisode=ep=>{
    if(!selected.includes(ep.url)&&selected.length>=50){notify('Choose up to 50 episodes in one batch');return;}
    setSelected(previous=>previous.includes(ep.url)?previous.filter(x=>x!==ep.url):[...previous,ep.url]);
  };
  const selectedEpisodes=(state.detail?.episodes||[]).filter(ep=>selected.includes(ep.url));
  const rating=ratingOf(detail);
  const releasedYear=yearOf(detail);
  // With NSFW turned off in Settings, an adult-marked title cannot be opened at
  // all, even from the library or an update notice. Nothing is deleted.
  if (hideNsfw && isNsfw(detail)) return <div className="detail-page"><button className="back-link" onClick={back}><ChevronLeft size={17}/> Back <span>TO YOUR SPACE</span></button><div className="content page-content detail-blocked"><Empty icon={EyeOff} title="This title is hidden" body="This title is marked as NSFW (18+) content, and NSFW content is turned off in Settings. Your saved titles and downloads are unchanged; turn it back on there to view this title again." action={openSettings} actionLabel="Open content settings"/></div></div>;
  return <div className="detail-page"><button className="back-link" onClick={back}><ChevronLeft size={17}/> Back <span>TO YOUR SPACE</span></button>
    <div className="detail-banner" style={detail.banner?{backgroundImage:`linear-gradient(90deg,rgba(16,19,18,.88),rgba(16,19,18,.25)),linear-gradient(0deg,#101214,transparent 85%),url("${imageUrl(detail.banner)}")`}:undefined}><div className="banner-text">A STORY AWAITS <span>✦</span></div></div>
    <div className="detail-body"><div className="detail-intro"><div className="detail-cover"><Cover item={detail}/></div><div className="detail-copy"><div className="detail-badges"><SourcePill source={detail.source}/><span className={'plain-badge rating-badge'+(rating?.adult?' rating-badge-adult':'')} title={rating?`Age rating reported by ${sourceName(detail.source)}`:'Not rated — the source does not provide an age rating'}>{rating?rating.label:'NR'}</span>{detail.type&&<span className="plain-badge">{detail.type}</span>}{detail.status&&<span className="plain-badge">{detail.status}</span>}{releasedYear>0&&<span className="plain-badge">{releasedYear}</span>}</div><h1>{detail.title}</h1><div className="genre-line">{detail.genres?.length?detail.genres.join('  ·  '):'Anime  ·  Adventure awaits'}</div><p>{detail.synopsis || (state.loading?'Loading the story...':'A title from your selected source. Open the source page for more information.')}</p><div className="detail-actions"><button className="btn primary" disabled={!first} onClick={()=>openEpisode(detail,resume||first)}><Play size={16} fill="currentColor"/>{resume?`Continue episode ${resume.number}`:'Watch first episode'}</button><button className={'btn secondary '+(has(detail)?'is-saved':'')} onClick={()=>toggle(detail)}><Bookmark size={17} fill={has(detail)?'currentColor':'none'}/>{has(detail)?'In your library':'Add to library'}</button><button className="btn secondary organize-detail" onClick={()=>organize(detail)} aria-label={`Organize ${detail.title} in collections`}><FolderPlus size={17}/> Collections</button><button className="icon-btn detail-external" onClick={()=>external(detail.url)} aria-label="Open original website" title="Open original website"><ExternalLink size={18}/></button></div></div></div>
      {state.error && <div className="detail-error"><AlertCircle size={18}/><span>{state.error}</span><button onClick={()=>external(item.url)}>Open source <ExternalLink size={14}/></button></div>}
      {state.detail && <section className="detail-facts" aria-label="Source details"><div><span>STATUS</span><strong>{displayStatus(detail.status)}</strong>{detail.status && displayStatus(detail.status)!==detail.status && <small>Source: {detail.status}</small>}</div><div><span>{SOURCES[detail.source]?.category==='Donghua'?'RELEASED':'DATE AIRED'}</span><strong>{detail.aired || 'Not provided'}</strong></div><div><span>EPISODES REPORTED</span><strong>{detail.episodeCount || 'Not provided'}</strong></div><div><span>AGE RATING</span><strong>{rating ? rating.label : 'Not provided'}</strong>{rating?.adult&&<small>Marked as adult (NSFW) content</small>}{!rating&&<small>Shown as NR on cards</small>}</div><p>Reported by {sourceName(detail.source)} · Details may change.</p></section>}
      <div className="episode-section"><div className="episode-head"><div><span className="eyebrow">THE STORY SO FAR</span><h2>Episodes <small>{state.detail?.episodes.length ?? '—'}</small>{watchedCount>0&&<small>{watchedCount} watched</small>}</h2></div><div className="episode-tools"><label className="episode-search"><Search size={15}/><input value={filter} onChange={e=>{setFilter(e.target.value);setVisible(40)}} placeholder="Find episode" aria-label="Find episode"/></label><button className="sort-button" onClick={()=>setOrder(x=>x==='newest'?'oldest':'newest')}>{order==='newest'?'Newest first':'Oldest first'} <SlidersHorizontal size={15}/></button></div></div>
      {state.detail?.source==='bash' && Number(detail.episodeCount)>detail.episodes.length && detail.episodes.length>0 && <p className="batch-hint">AnimeBash reports {detail.episodeCount} episodes but currently lists {detail.episodes.length}. Availability may vary.</p>}
      {!state.loading && episodes.length>0 && <div className="batch-tools">
        <button className="text-link" onClick={()=>{setSelecting(x=>!x);setSelected([])}}><ListChecks size={16}/>{selecting?'Cancel selection':'Select episodes'}</button>
        {selecting&&<><button className="text-link muted" onClick={()=>setSelected(episodes.slice(0,50).map(ep=>ep.url))}>{episodes.length>50?'Select first 50':'Select all matching'}</button><button className="btn primary batch-download" disabled={!selected.length} onClick={()=>queueEpisodes(detail,selectedEpisodes)}><Download size={15}/> Download {selected.length||''}</button><button className="text-link" disabled={!selected.length} onClick={()=>markWatched(detail,selectedEpisodes,true)}>Mark watched</button><button className="text-link muted" disabled={!selected.length} onClick={()=>markWatched(detail,selectedEpisodes,false)}>Mark unwatched</button></>}
        {!selecting&&<button className="text-link muted" onClick={showDownloads}>Your downloads <ArrowRight size={15}/></button>}
      </div>}
      {selecting&&<p className="batch-hint">Choose up to 50 per batch. Search or change the order to find a range.</p>}
      {state.loading?<div className="episode-loading"><LoaderCircle className="spin" size={19}/> Fetching episodes from {sourceName(item.source)}...</div>:episodes.length ? <><div className="episode-list">{episodes.slice(0,visible).map((ep,i)=>{
        const offline=downloads.find(d=>d.episode?.url===ep.url && d.item?.source===detail.source && d.status==='completed');
        const seen=watched?.has(ep.url);
        return <div className={'episode-row'+(seen?' watched':'')} key={`${ep.url}-${i}`}>
          {selecting&&<input className="episode-check" type="checkbox" checked={selected.includes(ep.url)} onChange={()=>chooseEpisode(ep)} aria-label={`Select episode ${ep.number}`}/>}
          <button className="episode-open" onClick={()=>selecting?chooseEpisode(ep):openEpisode(detail,ep)}><span className="episode-number">{String(ep.number).padStart(2,'0')}</span><span className="episode-info"><strong>{ep.title}</strong><small>{ep.date || sourceName(item.source)}{ep.sub?' · SUB':''}{ep.dub?' · DUB':''}{seen?' · WATCHED':''}{offline?' · DOWNLOADED':''}</small></span><span className="episode-play"><Play size={14} fill="currentColor"/></span></button>
          {!selecting&&<button className={'episode-watched-toggle'+(watched?.has(ep.url)?' on':'')} onClick={()=>markWatched(detail,[ep],!watched?.has(ep.url))} aria-pressed={!!watched?.has(ep.url)} aria-label={watched?.has(ep.url)?`Mark episode ${ep.number} as not watched`:`Mark episode ${ep.number} as watched`} title={watched?.has(ep.url)?'Watched — tap to undo':'Mark as watched'}><Check size={15}/></button>}{!selecting&&<button className={'episode-download '+(offline?'downloaded':'')} onClick={()=>offline?showDownloads():queueEpisodes(detail,[ep])} aria-label={offline?`View downloaded episode ${ep.number}`:`Download episode ${ep.number}`} title={offline?'View download':'Download episode'}>{offline?<CheckCircle2 size={18}/>:<Download size={18}/>}</button>}
        </div>;
      })}</div>{visible<episodes.length&&<div className="more-wrap"><button className="btn secondary" onClick={()=>setVisible(x=>x+40)}>Show more episodes <ChevronRight size={16}/></button></div>}</> : !state.error&&<Empty icon={ListVideo} title="No episodes found" body="This source may have changed its layout, or there are no matching episodes." action={()=>external(item.url)} actionLabel="Open source"/>}
      </div>
    </div>
  </div>;
}
function LibraryPage({items,open,has,toggle,browse,collections,activeCollection,setActiveCollection,onCreate,onRename,onDelete,onMembers,onFavourite,unreadTitles,progressByTitle,hideNsfw = false}) {
  const [filter,setFilter]=useState('all');
  useEffect(()=>setFilter('all'),[activeCollection]);
  const catalog = hideNsfw ? items.filter(item=>!isNsfw(item)) : items;
  const keys = new Set(catalog.map(identity));
  const selected = collections.find(c=>c.id===activeCollection);
  const selectedKeys = new Set(selected?.items || []);
  const inCollection = activeCollection==='all' ? catalog : catalog.filter(x=>selectedKeys.has(identity(x)));
  const list = filter==='all' ? inCollection : inCollection.filter(x=>x.source===filter);
  const favourites = new Set(collections.find(c=>c.id===FAVOURITES_ID)?.items || []);
  const count = c=>c.items.filter(key=>keys.has(key)).length;
  return <div className="content page-content library-page">
    <div className="page-heading"><div><div className="eyebrow">YOUR LITTLE CORNER</div><h1>Saved for later<span>.</span></h1><p>Keep your stories together, just the way you like. Saved on this device.</p></div><div className="heading-art"><Bookmark size={31}/><span>✦</span></div></div>
    <div className="collections-heading"><div><span className="eyebrow">MADE BY YOU</span><h2>Your collections</h2></div><button className="btn secondary new-collection" onClick={onCreate}><Plus size={16}/> New collection</button></div>
    <div className="collection-tabs" role="tablist" aria-label="Library collections">
      <button role="tab" aria-selected={activeCollection==='all'} className={'collection-tab '+(activeCollection==='all'?'selected':'')} onClick={()=>setActiveCollection('all')}><Bookmark size={15}/> <span>All titles</span><b>{catalog.length}</b></button>
      {collections.map(c=><button key={c.id} role="tab" aria-selected={activeCollection===c.id} className={'collection-tab '+(activeCollection===c.id?'selected':'')} onClick={()=>setActiveCollection(c.id)}>{c.id===FAVOURITES_ID?<Heart size={15}/>:<Folder size={15}/>} <span>{c.name}</span><b>{count(c)}</b></button>)}
    </div>
    <div className="collection-toolbar"><div><span className="eyebrow">YOUR LIBRARY</span><h2>{selected?.name || 'All titles'}</h2><p>{inCollection.length} {inCollection.length===1?'title':'titles'} · {activeCollection==='all'?'All saved stories':'A collection of saved stories'}</p></div>
      {selected&&<div className="collection-tools"><button className="btn secondary" onClick={()=>onMembers(selected.id)} disabled={!catalog.length}><Plus size={15}/> Add titles</button>{selected.id!==FAVOURITES_ID&&<><button className="icon-btn" onClick={()=>onRename(selected.id)} aria-label={`Rename ${selected.name}`} title="Rename collection"><Pencil size={16}/></button><button className="icon-btn" onClick={()=>onDelete(selected.id)} aria-label={`Delete ${selected.name}`} title="Delete collection"><Trash2 size={16}/></button></>}</div>}
    </div>
    <div className="filter-row library-filters"><div className="tabs" role="group" aria-label="Filter library by source">{[['all','All sources'],...Object.values(SOURCES).filter(src=>inCollection.some(item=>item.source===src.id)).map(src=>[src.id,src.name])].map(([id,label])=><button key={id} className={filter===id?'selected':''} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div><span className="results-label">{list.length} {list.length===1?'TITLE':'TITLES'} SHOWN</span></div>
    {list.length ? <div className="anime-grid">{list.map((item,i)=><AnimeCard key={identity(item)} item={item} index={i} onOpen={open} inLibrary={has(item)} toggle={toggle} favourite={favourites.has(identity(item))} onFavourite={onFavourite} newCount={unreadTitles[identity(item)]||0} progress={progressByTitle?.[identity(item)]||null}/>)}</div> :
      hideNsfw && items.length>0 && catalog.length===0 ? <Empty icon={EyeOff} title="Adult titles are hidden" body="Every saved title is currently hidden because NSFW content is turned off in Settings. Nothing has been removed from your library."/> :
      items.length && activeCollection!=='all' && inCollection.length===0 ? <Empty icon={FolderHeart} title={`Nothing in ${selected?.name || 'this collection'} yet`} body="Add stories you have already saved, or organize a title from its details page." action={()=>onMembers(activeCollection)} actionLabel="Add saved titles"/> :
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
  const [language,setLanguage]=useState(englishOnly||sourceControlled?'english':request.language||'english');const [server,setServer]=useState('auto');const [quality,setQuality]=useState('best');
  const [working,setWorking]=useState(false);const [attempt,setAttempt]=useState(0);
  const [options,setOptions]=useState({loading:true,servers:[],unavailable:0,error:''});
  const count=request.episodes.length, sample=request.episodes[0];
  useEffect(()=>{
    let alive=true;
    if(!isAndroid()){setOptions({loading:false,servers:[],unavailable:0,error:''});return()=>{alive=false}};
    setOptions({loading:true,servers:[],unavailable:0,error:''});
    const timer=setTimeout(()=>getDownloadOptions(request.item,sample,language).then(value=>{
      if(alive)setOptions({loading:false,servers:Array.isArray(value.servers)?value.servers:[],unavailable:Number(value.unavailable)||0,error:''});
    }).catch(e=>{if(alive)setOptions({loading:false,servers:[],unavailable:0,error:e.message||'Could not check server qualities. You can retry or use Automatic.'})}),180);
    return()=>{alive=false;clearTimeout(timer)};
  },[request.item.source,sample.url,sample.ids,language,attempt]);
  const chosen=options.servers.find(x=>x.id===server);
  const qualityOptions=chosen?.qualities?.length?chosen.qualities:[{id:'best',label:'Best available (HLS up to 1080p)'}];
  async function confirm(){setWorking(true);try{await submit({language,server,quality})}finally{setWorking(false)}}
  function changeLanguage(value){setLanguage(value);setServer('auto');setQuality('best')}
  function changeServer(value){setServer(value);setQuality('best')}
  return <div className="modal-backdrop" onMouseDown={close}><div className="download-modal" role="dialog" aria-modal="true" aria-label="Download episodes" onMouseDown={e=>e.stopPropagation()}>
    <div className="player-header"><div><span className="eyebrow">SAVE FOR OFFLINE</span><h2>{count===1?`Download episode ${sample.number}`:`Download ${count} episodes`}</h2><p>{request.item.title} · {sourceName(request.item.source)}</p></div><button className="icon-btn" onClick={close} aria-label="Close download dialog"><X size={20}/></button></div>
    <div className="download-dialog-body"><div className="download-fields">
      <label className="download-language">PREFERRED SUBTITLE LANGUAGE<select value={language} onChange={e=>changeLanguage(e.target.value)} disabled={englishOnly||sourceControlled}><option value="english">{sourceControlled?'Set by server':englishOnly?'English only':'English'}</option>{!englishOnly&&!sourceControlled&&<option value="indonesian">Indonesian</option>}</select></label>
      <label className="download-language">DOWNLOAD SERVER<select value={server} onChange={e=>changeServer(e.target.value)}><option value="auto">Automatic · first compatible server</option>{options.servers.map(x=><option value={x.id} key={x.id}>{x.label}</option>)}</select></label>
      <label className="download-language">VIDEO QUALITY<select value={quality} onChange={e=>setQuality(e.target.value)}>{qualityOptions.map(x=><option value={x.id} key={x.id}>{x.label}</option>)}</select></label>
    </div>
      <div className="quality-hint" role="status">{options.loading?<><LoaderCircle size={14} className="spin"/> Checking available servers and qualities…</>:options.error?<><AlertCircle size={14}/> {options.error} <button onClick={()=>setAttempt(x=>x+1)}>Retry</button></>:<><Check size={14}/>{chosen?.note || (options.servers.length?`${options.servers.length} compatible server${options.servers.length===1?'':'s'} found for episode ${sample.number}.`:'No compatible servers were confirmed; Automatic may not work.')}{options.unavailable>0?' Some servers could not be checked.':''}</>}</div>
      {count>1&&<p className="quality-batch-hint">Choices are based on episode {sample.number}. Each episode must offer the selected server and quality, or that episode will fail rather than silently switch.</p>}
      <div className="download-explainer"><ShieldCheck size={18}/><p>{request.item.source==='xin'?'Only supported servers are shown. AnimeXin subtitles are usually burned into the video in the selected language.':englishOnly?`${sourceName(request.item.source)} downloads identifiable English subtitle tracks only. If English is unavailable, the video may be saved without subtitles.`:'Only compatible servers are shown. Subtitles and languages depend on the selected third-party server.'}</p></div>
      <p className="download-caution">Best HLS quality is capped at 1080p. Downloads use temporary app space; if you choose a folder, Mikozora removes its private copy after the saved video and subtitles are verified. Downloads can be large and may use mobile data.</p>
      {!isAndroid()&&<p className="preview-note"><AlertCircle size={15}/> Downloads work in the Android app, not the browser preview.</p>}
      <div className="download-dialog-actions"><button className="btn secondary" onClick={close}>Cancel</button><button className="btn primary" disabled={!isAndroid()||working} onClick={confirm}>{working?<LoaderCircle size={16} className="spin"/>:<Download size={16}/>} Add to queue</button></div>
    </div></div></div>;
}
function DownloadsPage({items,loading,remove,retry,change,browse,folder,saveCopy,openSettings}) {
  const statusText={queued:'Waiting for network or a queue slot',resolving:'Finding a supported mirror',downloading:'Downloading',completed:'Ready to watch offline',failed:'Download failed',paused:'Waiting to resume',removing:'Removing'};
  return <div className="content page-content"><div className="page-heading"><div><div className="eyebrow">A LITTLE SOMETHING FOR LATER</div><h1>Ready when you are<span>.</span></h1><p>Your offline episodes and download queue, saved on this device.</p></div><div className="heading-art"><HardDrive size={32}/><span>✦</span></div></div>
    {!isAndroid()?<Empty icon={Download} title="Take your stories offline" body="Open Mikozora on Android to download individual episodes or select a batch. The browser preview cannot store episodes." action={()=>browse('all')} actionLabel="Browse titles"/>:
      loading&&!items.length?<div className="episode-loading"><LoaderCircle size={18} className="spin"/> Loading downloads...</div>:
      items.length?<div className="downloads-list">{items.map(d=>{
        const progress=typeof d.progress==='number'?Math.max(0,Math.min(100,d.progress)):null;
        const exporting=d.exportStatus==='queued'||d.exportStatus==='exporting'||d.exportStatus==='verifying';
        const savedFolder=[d.exportFolder,d.exportSeriesFolder].filter(Boolean).join(' / ');
        return <article className="download-card" key={d.id}><div className="download-card-art"><Cover item={d.item||{}}/></div><div className="download-card-main"><div className="download-card-top"><SourcePill source={d.item?.source} compact/><span className={'download-status '+(d.status||'queued')}><i/>{statusText[d.status]||'Preparing'}</span></div><h3>{d.item?.title||'Episode'}</h3><p>Episode {d.episode?.number} {d.serverLabel?`· ${d.serverLabel}`:d.host?`· ${d.host}`:''} {d.qualityLabel?`· ${d.qualityLabel}`:''} {d.bytes?`· ${bytesLabel(d.bytes)}`:''}</p>
          {d.status==='downloading'&&<div className="download-progress"><div><span style={{width:progress==null?'38%':`${progress}%`}} className={progress==null?'indeterminate':''}/></div><small>{progress==null?'In progress':`${progress}%`}</small></div>}
          <p className="subtitle-status"><Check size={13}/> {d.subtitleDescription||'Preparing subtitles'}</p>{d.status==='failed'&&<p className="download-error"><AlertCircle size={14}/> {d.error||'This host did not provide a downloadable stream.'}</p>}
          {d.exportStatus==='queued'&&<p className="export-status"><Clock3 size={13}/> Playable copy queued{d.exportNextFolder?` · ${d.exportNextFolder}`:''}</p>}
          {d.exportStatus==='exporting'&&<p className="export-status"><LoaderCircle size={13} className="spin"/> Saving playable copy{d.exportNextFolder?` · ${d.exportNextFolder}`:''}…</p>}
          {d.exportStatus==='verifying'&&<p className="export-status"><LoaderCircle size={13} className="spin"/> Verifying video and subtitles before freeing app space…</p>}
          {d.exportStatus==='completed'&&<p className="export-status success"><Check size={13}/> Saved to {savedFolder||'selected folder'}{d.exportSubtitleCount?` · ${d.exportSubtitleCount} subtitle file${d.exportSubtitleCount===1?'':'s'}`:''}{d.cleanupStatus==='complete'?' · Private copy removed':''}</p>}
          {d.cleanupStatus==='pending'&&<p className="export-status"><LoaderCircle size={13} className="spin"/> Freeing private app storage…</p>}
          {(d.cleanupStatus==='waiting'||d.cleanupStatus==='retained')&&<p className="download-error"><AlertCircle size={14}/> {d.cleanupMessage||'The private copy is being kept for safety.'}</p>}
          {d.exportStatus==='failed'&&<p className="download-error"><AlertCircle size={14}/> Folder copy failed: {d.exportError||'Try again.'}</p>}
          <div className="download-card-actions">{d.status==='completed'&&<><button className="btn primary" onClick={()=>openDownload(d.id)}><Play size={14} fill="currentColor"/> Play offline</button>{d.exportUri&&<button className="text-link" onClick={()=>openExport(d.id)}><ExternalLink size={14}/> Open file</button>}{folder?.granted?<button className="text-link" disabled={exporting} onClick={()=>saveCopy(d)}><FolderHeart size={14}/> {exporting?'Saving…':d.exportUri?'Save another copy':'Save to folder'}</button>:<button className="text-link" onClick={openSettings}><FolderHeart size={14}/> Choose folder</button>}</>}{d.status==='failed'&&<><button className="btn secondary" onClick={()=>retry(d)}><RotateCcw size={14}/> Retry</button><button className="text-link" onClick={()=>change(d)}><SlidersHorizontal size={14}/> Change server</button></>}<button className="text-link muted" onClick={()=>remove(d)}><Trash2 size={14}/> Remove</button></div>
        </div></article>;
      })}</div>:<Empty icon={Download} title="Your offline shelf is empty" body="Open a series, then download one episode or select a batch to watch later." action={()=>browse('all')} actionLabel="Find a series"/>}
    <p className="privacy-footnote"><ShieldCheck size={15}/> Mikozora uses private space during downloading and conversion. After a verified folder save, it removes the private copy; folder files stay if you remove an episode or uninstall Mikozora.</p>
  </div>;
}
function HistoryPage({items,resume,open,clear,browse}) {
  return <div className="content page-content"><div className="page-heading"><div><div className="eyebrow">PICK IT BACK UP</div><h1>Your story so far<span>.</span></h1><p>Episodes you’ve opened recently, saved locally on this device.</p></div><div className="heading-art"><History size={33}/><span>✦</span></div></div><div className="history-head"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Recently opened <small className="count">{items.length}</small></h2></div>{items.length>0&&<button className="text-link muted" onClick={clear}><Trash2 size={15}/> Clear history</button>}</div>{items.length?<div className="history-list">{items.map((entry,i)=><div className="history-item" key={`${identity(entry.item)}-${entry.episode.number}-${i}`}><button className="history-art" onClick={()=>open(entry.item)} aria-label={`Open ${entry.item.title}`}><Cover item={entry.item}/></button><div className="history-copy"><SourcePill source={entry.item.source} compact/><button onClick={()=>open(entry.item)}>{entry.item.title}</button><span>Episode {entry.episode.number} <b>·</b> {prettyTime(entry.time)}</span></div><button className="round-play" onClick={()=>resume(entry)} aria-label={`Open episode ${entry.episode.number}`}><Play size={16} fill="currentColor"/></button></div>)}</div>:<Empty icon={Clock3} title="Nothing here just yet" body="When you open an episode, it will show up here so you can find it again." action={()=>browse('all')} actionLabel="Explore anime"/>}<p className="privacy-footnote"><ShieldCheck size={15}/> History records episodes opened, not exact playback position.</p></div>;
}
function SourcesPage({browse}) {
  return <div className="content page-content sources-page"><div className="page-heading"><div><div className="eyebrow">YOUR DOORWAYS TO MORE</div><h1>More worlds, one space<span>.</span></h1><p>Your chosen sources, organized by Anime and Donghua.</p></div><div className="heading-art"><Layers3 size={33}/><span>✦</span></div></div>
    {['Anime','Donghua'].map(category=>{const entries=Object.values(SOURCES).filter(src=>src.category===category);return <section className="source-category" key={category} aria-label={`${category} sources`}><div className="source-category-heading"><div><span className="eyebrow">EXPLORE {category.toUpperCase()}</span><h2>{category} <small className="count">{entries.length}</small></h2></div><button className="text-link" onClick={()=>browse(category.toLowerCase())}>Browse all {category.toLowerCase()} <ArrowRight size={15}/></button></div><div className="source-grid">{entries.map(src=><article className={'source-card '+src.id} style={{'--source-accent':src.accent}} key={src.id}><div className="source-card-top"><div className="source-symbol">{src.name[0]}</div><button className="source-open" onClick={()=>external(src.homepage || src.base)} aria-label={`Open ${src.name} website`}><ArrowUpRight size={19}/></button></div><div className="source-tag"><i/> ADDED SOURCE</div><h2>{src.name}</h2><p>{src.description}</p><div className="source-details"><span><Film size={15}/> {src.category}</span><span>·</span><span>{src.language}</span></div><button className="source-browse" onClick={()=>browse(src.id)}>Browse this source <ArrowRight size={16}/></button></article>)}</div></section>})}
    <div className="sources-note"><CircleHelp size={19}/><div><strong>About your sources</strong><p>Mikozora doesn’t host videos. Episodes and availability are provided by these third-party sites and their video hosts; their layouts and servers may change. Download support depends on each server.</p></div></div></div>;
}
function UpdatesPage({state,available,syncError,actionError,check,readAll,openUpdate,openLibrary,openSettings}) {
  const updates=state.updates||[],errors=state.errors||[];
  const waiting=Math.max(0,(state.watchedCount||0)-(state.initializedCount||0));
  const progress=state.checking?'Checking your collection titles…':state.queued?'Check queued · waiting for a connection or Android to start it':!state.automatic?'Automatic checks are off · you can still check manually':state.lastSuccess?`Latest successful check ${prettyTime(state.lastSuccess)}`:'No successful check yet';
  return <div className="content page-content updates-page">
    <div className="page-heading"><div><div className="eyebrow">YOUR STORIES, UP TO DATE</div><h1>New episodes<span>.</span></h1><p>A little heads-up when your saved stories have something new.</p></div><div className="heading-art"><Bell size={31}/><span>✦</span></div></div>
    <section className="updates-overview" aria-label="Episode check status"><div className="updates-overview-icon"><RefreshCw size={20} className={state.checking?'spin':''}/></div><div className="updates-overview-copy"><div className="updates-status-title"><strong>{available?`${state.watchedCount||0} ${(state.watchedCount||0)===1?'title':'titles'} being followed`:'Episode checks are available in the Android app'}</strong><span className={'updates-live-dot '+(state.automatic?'':'muted')}/></div><p>{available?progress:'Install Mikozora on Android to check your collections in the background.'}</p>{available&&waiting>0&&<small>First checks set a starting point for {waiting} {waiting===1?'title':'titles'}; existing episodes won’t trigger alerts.</small>}<small>Favourites and personal collections are checked once per title. Android may delay background work.</small></div><button className="btn secondary updates-check" onClick={check} disabled={!available||!state.watchedCount||state.checking}><RefreshCw size={15}/> Check now</button></section>
    {(syncError||actionError)&&<div className="updates-error" role="alert"><AlertCircle size={16}/><span>{syncError||actionError}</span></div>}
    {errors.length>0&&<section className="updates-failures" aria-label="Unavailable sources"><div><AlertCircle size={18}/><span><strong>Some sources couldn’t be checked</strong><small>Your previous episode lists are safe. Try again later.</small></span></div><ul>{errors.map((error,i)=><li key={`${identity(error.item)}-${i}`}><strong>{error.item?.title}</strong><span>{sourceName(error.item?.source)} · {error.message}</span></li>)}</ul></section>}
    <div className="updates-heading"><div><span className="eyebrow">THE LATEST FROM YOUR COLLECTIONS</span><h2>Episode updates <small className="count">{state.unreadCount||0} new</small></h2></div><div className="updates-heading-actions">{state.unreadCount>0&&<button className="text-link muted" onClick={readAll}><Check size={15}/> Mark all read</button>}<button className="text-link" onClick={openSettings}>Alert settings <ArrowRight size={15}/></button></div></div>
    {updates.length?<div className="updates-list">{updates.map(entry=><article className={'update-row '+(!entry.read?'unread':'')} key={entry.id}><button className="update-open" onClick={()=>openUpdate(entry)} aria-label={`Open ${entry.item?.title}, episode ${entry.episode?.number||entry.episode?.title}`}><div className="update-cover"><Cover item={entry.item||{}}/></div><span className="update-copy"><span className="update-eyebrow"><SourcePill source={entry.item?.source} compact/>{!entry.read&&<b>NEW</b>}</span><strong>{entry.item?.title}</strong><span>{entry.episode?.number?`Episode ${entry.episode.number}`:entry.episode?.title||'New episode'} <i>·</i> {prettyTime(entry.discoveredAt)}</span></span><ChevronRight size={18} className="update-chevron"/></button></article>)}</div>:<Empty icon={Bell} title={!state.watchedCount?'Nothing to check yet':waiting?'Getting your list ready':'All caught up'} body={!state.watchedCount?'Add titles to Favourites or a personal collection to follow their episodes.':waiting?'The first successful check records the episodes already available, so you only hear about later additions.':'New episodes will appear here after Mikozora finds them. Source availability can change.'} action={!state.watchedCount?openLibrary:undefined} actionLabel="Open library"/>}
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
function SettingsPage({library,history,clearLibrary,clearHistory,openLicenses,openReleaseNotes,folder,chooseFolder,usePrivate,updates,updatesAvailable,changeAutomatic,changeAlerts,notificationPermission,appearance,changeAppearance,contentPrefs,changeContentPrefs,appUpdate,pendingUpdate,updateStatus,checkUpdate,changeAutoCheck,downloadUpdate,exportBackup,importBackup}) {
  const current=!isAndroid()?'Available in the Android app':!folder?.configured?'Mikozora only · no external folder selected':folder.granted?folder.name||'Selected folder':'Folder access lost · choose it again';
  const notificationText=!updatesAvailable?'Available in the Android app':updates.notificationStatus==='allowed'?'Allowed in Android':updates.notificationStatus==='permission'?'Android notification permission is needed':updates.notificationStatus==='channel-blocked'?'New episode channel is blocked in Android':'Notifications are blocked in Android';
  const updateText=pendingUpdate?`Mikozora ${pendingUpdate.version} is ready — you’re on ${APP_VERSION}.`:updateStatus.phase==='checking'?'Checking GitHub for a newer version…':updateStatus.phase==='error'?(updateStatus.message||'Could not check just now. Try again in a moment.'):appUpdate.lastCheck?`You’re up to date · Checked ${prettyTime(appUpdate.lastCheck)}`:`You’re on Mikozora ${APP_VERSION} · Not checked yet`;
  return <div className="content page-content"><div className="page-heading"><div><div className="eyebrow">MAKE YOURSELF AT HOME</div><h1>Your space, your way<span>.</span></h1><p>A simple little place for your anime.</p></div><div className="heading-art"><Settings2 size={32}/><span>✦</span></div></div>
    <AppearanceSettings appearance={appearance} changeAppearance={changeAppearance}/>
    <div className="settings-group content-settings"><div className="settings-title">CONTENT <span>AGE RATINGS &amp; NSFW</span></div><div className="setting-row"><div className="setting-icon"><EyeOff size={19}/></div><div><strong>Hide NSFW content</strong><p>{contentPrefs.hideNsfw?'On · Adult-marked titles are hidden':'Off · Adult-marked titles can appear'}</p></div><button aria-label="Hide NSFW content" aria-pressed={!!contentPrefs.hideNsfw} onClick={()=>changeContentPrefs({hideNsfw:!contentPrefs.hideNsfw})}>{contentPrefs.hideNsfw?'On':'Off'}</button></div>
      <div className="folder-explainer content-explainer"><p>When on, titles a source marks 18+ or with adult genres such as Ecchi or Hentai are completely hidden — from Discover, Browse, search results, your Library and History — and cannot be opened. This is separate from the Browse content filter and stays on until you turn it off.</p><p>Nothing is deleted: your library, collections, history and downloads stay exactly as they are. Every card shows the age rating its source provides, or NR when it provides none. Sources do not label every title, so hiding NSFW cannot guarantee everything shown is suitable for all ages.</p></div>
    </div>
    <div className="settings-group episode-settings"><div className="settings-title">EPISODE UPDATES <span>YOUR COLLECTIONS</span></div><div className="setting-row"><div className="setting-icon"><RefreshCw size={19}/></div><div><strong>Automatic checks</strong><p>On open and about every 6 hours while connected. Android can delay checks or pause them after a force-stop.</p></div><button aria-label="Automatic episode checks" aria-pressed={!!updates.automatic} disabled={!updatesAvailable} onClick={()=>changeAutomatic(!updates.automatic)}>{updates.automatic?'On':'Off'}</button></div><div className="setting-row"><div className="setting-icon"><Bell size={19}/></div><div><strong>Android episode alerts</strong><p>{updates.alerts?'On in Mikozora':'Off in Mikozora'} · New episodes still appear in Updates.</p></div><button aria-label="Android episode alerts" aria-pressed={!!updates.alerts} disabled={!updatesAvailable} onClick={()=>changeAlerts(!updates.alerts)}>{updates.alerts?'On':'Off'}</button></div><div className="setting-row"><div className="setting-icon"><ShieldCheck size={19}/></div><div><strong>Android notification access</strong><p>{notificationText}</p></div><button disabled={!updatesAvailable} onClick={notificationPermission}>{updates.notificationStatus==='permission'?'Allow':'Manage'}</button></div></div>
    <div className="settings-group folder-settings"><div className="settings-title">DOWNLOAD LOCATION <span>EXTERNAL PLAYER</span></div><div className="setting-row"><div className="setting-icon"><FolderHeart size={19}/></div><div><strong>Playable copies</strong><p className="folder-name">{current}</p></div><button onClick={chooseFolder} disabled={!isAndroid()}>{folder?.configured?'Change':'Choose folder'}</button></div>
      <div className="folder-explainer"><p>New playable MP4 copies are organized into a folder for each anime or donghua. Existing downloads can be saved from Downloads; earlier exported files stay where they are.</p><p>After Mikozora verifies the saved video and subtitle files, it removes its private copy to free space. Mikozora then plays the file from your folder. If verification fails or subtitles cannot be safely copied, the private copy stays. Downloading and conversion still need extra storage temporarily.</p>{folder?.configured&&<button className="text-link" onClick={usePrivate}>Stop saving folder copies</button>}</div>
    </div>
    <div className="settings-group"><div className="settings-title">YOUR DATA <span>ON THIS DEVICE</span></div><div className="setting-row"><div className="setting-icon"><Bookmark size={19}/></div><div><strong>Saved library</strong><p>{library.length} {library.length===1?'title':'titles'} saved locally</p></div><button onClick={clearLibrary} disabled={!library.length}>Clear</button></div><div className="setting-row"><div className="setting-icon"><History size={19}/></div><div><strong>Watch history</strong><p>{history.length} recently opened {history.length===1?'episode':'episodes'}</p></div><button onClick={clearHistory} disabled={!history.length}>Clear</button></div><div className="setting-row"><div className="setting-icon"><HardDrive size={19}/></div><div><strong>Back up your data</strong><p>Save your library, collections, history, watch progress and settings to a file you keep. Downloaded videos are not included.</p></div><button onClick={exportBackup}>Export</button></div><div className="setting-row"><div className="setting-icon"><RotateCcw size={19}/></div><div><strong>Restore a backup</strong><p>Replace this device's library, collections, history, progress and settings with a backup file.</p></div><button onClick={importBackup}>Import</button></div></div><div className="settings-group"><div className="settings-title">ABOUT <span>MIKOZORA {APP_VERSION}</span></div><div className="setting-row"><div className="setting-icon"><Download size={19}/></div><div><strong>App updates</strong><p>{updateText}</p></div>{pendingUpdate?<button onClick={downloadUpdate}>Download</button>:<button onClick={()=>checkUpdate(true)} disabled={updateStatus.phase==='checking'}>{updateStatus.phase==='checking'?'Checking…':updateStatus.phase==='error'?'Try again':'Check'}</button>}</div><div className="setting-row"><div className="setting-icon"><RefreshCw size={19}/></div><div><strong>Check automatically</strong><p>Look for new versions on GitHub when Mikozora opens, at most twice a day.</p></div><button aria-label="Automatic update checks" aria-pressed={!!appUpdate.autoCheck} onClick={()=>changeAutoCheck(!appUpdate.autoCheck)}>{appUpdate.autoCheck?'On':'Off'}</button></div><div className="setting-row"><div className="setting-icon"><ShieldCheck size={19}/></div><div><strong>Private by default</strong><p>Your library, collections and history stay on this device. No account is required.</p></div></div><div className="setting-row"><div className="setting-icon"><Film size={19}/></div><div><strong>Player availability</strong><p>Video hosts may restrict embedding or be unavailable. Try another server or open the source page.</p></div></div><div className="setting-row"><div className="setting-icon"><Sparkles size={19}/></div><div><strong>What’s new</strong><p>See the latest changes to Mikozora.</p></div><button onClick={openReleaseNotes}>View</button></div><div className="setting-row"><div className="setting-icon"><CircleHelp size={19}/></div><div><strong>Open source licenses</strong><p>Credits and licenses for Mikozora and its dependencies.</p></div><button onClick={openLicenses}>View</button></div></div></div>;
}
function PlayerModal({player,close,onEpisode,watched}) {
  const [current,setCurrent]=useState(0);
  const [switching,setSwitching]=useState(false);
  const episodeRail=useRef(null);
  const episodes=Array.isArray(player.episodes)&&player.episodes.length?player.episodes:[player.episode];
  const episodeIndex=Number.isInteger(player.episodeIndex)&&episodes[player.episodeIndex]?.url===player.episode.url
    ? player.episodeIndex
    : Math.max(0,episodes.findIndex(episode=>episode.url===player.episode.url));
  const previous=episodeIndex>0?episodes[episodeIndex-1]:null;
  const next=episodeIndex>=0&&episodeIndex<episodes.length-1?episodes[episodeIndex+1]:null;

  useEffect(()=>{setCurrent(0);setSwitching(false);},[player.episode.url]);
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

  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><div className="player-modal" role="dialog" aria-modal="true" aria-label="Episode player" onMouseDown={e=>e.stopPropagation()}>
    <div className="player-header"><div><span className="eyebrow">NOW PLAYING</span><h2>{player.item.title}</h2><p>Episode {player.episode.number} · {sourceName(player.item.source)}</p></div><button className="icon-btn" onClick={close} aria-label="Close player"><X size={20}/></button></div>
    <div className="iframe-wrap"><iframe key={`${player.episode.url}|${player.servers[current]?.url||''}`} src={player.servers[current]?.url} title={`${player.item.title} episode ${player.episode.number}`} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="no-referrer-when-downgrade"/></div>
    {episodes.length>1&&<section className="player-episode-browser" aria-label="Episode navigation">
      <div className="player-episode-heading"><span>EPISODES</span><strong aria-live="polite">{episodeIndex+1} of {episodes.length}</strong></div>
      <div className="player-episode-nav">
        <button className="btn secondary player-nav-button" disabled={!previous||switching} onClick={()=>choose(previous)} aria-label={previous?`Previous episode ${previous.number}`:'Previous episode'}><ChevronLeft size={16}/> Previous</button>
        <div className="player-episode-rail" ref={episodeRail} aria-label="Scrollable episode list">{episodes.map((episode,index)=><button key={`${episode.url}-${index}`} type="button" data-episode-index={index} className={'player-episode-chip'+(index===episodeIndex?' current':'')+(index!==episodeIndex&&watched?.has(episode.url)?' watched':'')} disabled={switching} onClick={()=>choose(episode)} aria-label={`Play episode ${episode.number}`} aria-current={index===episodeIndex?'true':undefined} title={episode.title||`Episode ${episode.number}`}>{index!==episodeIndex&&watched?.has(episode.url)&&<Check size={11}/>}{episode.number}</button>)}</div>
        <button className="btn secondary player-nav-button" disabled={!next||switching} onClick={()=>choose(next)} aria-label={next?`Next episode ${next.number}`:'Next episode'}>Next <ChevronRight size={16}/></button>
      </div>
      {switching&&<p className="player-switching" role="status"><LoaderCircle size={14} className="spin"/> Finding servers for the selected episode…</p>}
    </section>}
    <div className="player-controls"><label>VIDEO SERVER<select value={current} onChange={e=>setCurrent(Number(e.target.value))}>{player.servers.map((s,i)=><option value={i} key={i}>{s.name}</option>)}</select></label><button className="btn secondary" onClick={()=>external(player.episode.url)}>Open source <ExternalLink size={15}/></button></div>
    <p className="player-disclaimer">Video is provided by the selected third-party server. If it doesn’t load here, try another server or open the original site.</p>
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
          {RELEASES.map((release,index)=><div className={'release-group '+(index?'previous-release':'')} key={release.version}>
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
  return <div className="content update-banner-wrap"><div className="update-banner" role="status"><div className="setting-icon"><Sparkles size={19}/></div><div className="update-banner-text"><strong>Mikozora {info.version} is available</strong><p>You’re on {APP_VERSION}. The update installs over this one — your library, history and downloads stay put.</p></div><button className="btn primary" onClick={download}>{info.apkUrl?'Download update':'View update'}</button><button className="update-banner-close" aria-label="Dismiss update notice" onClick={dismiss}><X size={16}/></button></div></div>;
}
function App() {
  // Read before the library/history effects initialize storage on a fresh install.
  const [experience,setExperience]=useState(()=>{try{return startupExperience(window.localStorage)}catch{return {mode:'intro'}}});
  const finishExperience=()=>{if(!experience?.manual)try{completeExperience(window.localStorage)}catch{} setExperience(null);};
  const [appUpdate,setAppUpdate]=useState(()=>{try{return readUpdateState(window.localStorage)}catch{return {...DEFAULT_UPDATE_STATE}}});
  const [updateStatus,setUpdateStatus]=useState({phase:'idle',message:''});
  const storeAppUpdate=next=>{setAppUpdate(next);try{saveUpdateState(window.localStorage,next)}catch{/* The current session still remembers the choice. */}};
  const checkAppUpdate=async(manual=false)=>{
    setUpdateStatus({phase:'checking',message:''});
    try{
      const info=await fetchLatestRelease();
      setAppUpdate(prev=>{const next=withCheckResult(prev,info,Date.now());try{saveUpdateState(window.localStorage,next)}catch{}return next;});
      setUpdateStatus({phase:'idle',message:''});
    }catch(e){
      setAppUpdate(prev=>{const next=withCheckResult(prev,null,Date.now());try{saveUpdateState(window.localStorage,next)}catch{}return next;});
      setUpdateStatus(manual?{phase:'error',message:e?.message||'Could not check for updates.'}:{phase:'idle',message:''});
    }
  };
  useEffect(()=>{
    if(experience)return;
    let stored=appUpdate;
    try{stored=readUpdateState(window.localStorage)}catch{}
    if(shouldAutoCheck(stored,Date.now()))checkAppUpdate(false);
  },[experience]);
  const pendingUpdate=visibleUpdate(appUpdate,APP_VERSION);
  const downloadAppUpdate=()=>{const target=pendingUpdate?.apkUrl||pendingUpdate?.pageUrl;if(target)external(target);};
  const dismissAppUpdate=()=>storeAppUpdate(dismissUpdate(appUpdate));
  const changeAutoCheck=enabled=>storeAppUpdate({...appUpdate,autoCheck:enabled});
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
  const [browseSource,setBrowseSource]=useState('all'); const [query,setQuery]=useState('');
  const [refreshKey,setRefreshKey]=useState(0); const [player,setPlayer]=useState(null); const [licenses,setLicenses]=useState(false); const [downloadModal,setDownloadModal]=useState(null); const [downloads,setDownloads]=useState([]); const [downloadsLoading,setDownloadsLoading]=useState(true); const [busy,setBusy]=useState(''); const [toast,setToast]=useState('');
  const [contentPrefs,setContentPrefs]=useState(initialContent);
  const hideNsfw=contentPrefs.hideNsfw;
  const changeContentPrefs=patch=>{
    const next={...contentPrefs,...patch};
    setContentPrefs(next);
    try{saveContentPrefs(window.localStorage,next)}catch{/* The current session still uses the choice. */}
    setToast(next.hideNsfw?'NSFW content is now hidden':'NSFW content can now appear');
  };
  const [folder,setFolder]=useState({configured:false,granted:false,name:''});
  const updatesAvailable=hasEpisodeUpdates();
  const [updates,setUpdates]=useState({automatic:true,alerts:true,watchedCount:0,initializedCount:0,unreadCount:0,updates:[],errors:[],checking:false,queued:false,notificationStatus:'unknown'});
  const [updatesSyncError,setUpdatesSyncError]=useState(''); const [updatesActionError,setUpdatesActionError]=useState('');
  const [notificationRoute,setNotificationRoute]=useState(false);
  const firstEpisodeSync=useRef(true);
  const playbackSession=useRef(null);
  const playbackRequest=useRef(0);
  const nativeEpisodePending=useRef(false);
  const playRef=useRef(null);
  const monitored=useMemo(()=>monitoredTitles(library,collections),[library,collections]);
  const unreadTitles=useMemo(()=>unreadByTitle(updates.updates),[updates.updates]);
  useEffect(()=>{ window.history.replaceState({page:'home'},'',location.pathname+location.search+'#home'); const listener=e=>setRoute(e.state||{page:'home'});window.addEventListener('popstate',listener);return()=>window.removeEventListener('popstate',listener); },[]);
  useEffect(()=>{
    if(!updatesAvailable)return;
    let active=true;const onOpen=firstEpisodeSync.current;firstEpisodeSync.current=false;
    syncEpisodeTitles(monitored,onOpen).then(value=>{if(active){setUpdates(value);setUpdatesSyncError('')}}).catch(e=>{if(active)setUpdatesSyncError(e.message||'Could not update collection checks. Previous data is unchanged.')});
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
    if(!experience&&updatesAvailable&&updates.watchedCount>0&&updates.alerts&&updates.notificationStatus==='permission'&&!updates.permissionAsked)
      try{window.MokuBridge.episodeNotificationPermission(true)}catch{}
  },[experience,updatesAvailable,updates.watchedCount,updates.alerts,updates.notificationStatus,updates.permissionAsked]);
  useEffect(()=>{window.__handleAndroidBack=()=>{if(experience){finishExperience();return true;}if(collectionDialog){setCollectionDialog(null);return true;}if(downloadModal){setDownloadModal(null);return true;}if(player){setPlayer(null);return true;}if(licenses){setLicenses(false);return true;}if(route.page!=='home'){window.history.back();return true;}return false;};},[experience,player,route,licenses,downloadModal,collectionDialog]);
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
    const closed=()=>{
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
    window.__mokuPlayerClosed=closed;
    return()=>{
      if(window.__mokuPlayerEpisode===handler)delete window.__mokuPlayerEpisode;
      if(window.__mokuPlayerClosed===closed)delete window.__mokuPlayerClosed;
    };
  },[]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),3200);return()=>clearTimeout(t)},[toast]);
  useEffect(()=>{
    if(!isAndroid()){setDownloadsLoading(false);return;}
    if(!['downloads','detail'].includes(route.page))return;
    let active=true;const load=()=>getDownloads().then(items=>{if(active){setDownloads(items);setDownloadsLoading(false)}}).catch(()=>{if(active)setDownloadsLoading(false)});
    load();const timer=setInterval(load,2500);return()=>{active=false;clearInterval(timer)};
  },[route.page]);
  useEffect(()=>{
    if(!isAndroid()||!['settings','downloads'].includes(route.page))return;
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
  const readAllUpdates=()=>updateAction(()=>markEpisodeRead('all'),'Updates marked read');
  const viewUpdate=entry=>{if(!entry.read)updateAction(()=>markEpisodeRead(entry.id));if(entry.item)open(entry.item);};
  const changeAutomatic=enabled=>updateAction(()=>setEpisodeAutomatic(enabled),enabled?'Automatic checks on':'Automatic checks off');
  const changeAlerts=enabled=>updateAction(()=>setEpisodeAlerts(enabled),enabled?'Episode alerts on':'Episode alerts off');
  const notificationPermission=()=>{if(updatesAvailable)try{window.MokuBridge.episodeNotificationPermission(false)}catch{setToast('Could not open Android notification settings');}};
  const has=item=>library.some(x=>identity(x)===identity(item));
  const toggle=item=>{const exists=has(item);const key=identity(item);if(exists&&collections.some(c=>c.items.includes(key))&&!window.confirm(`Remove “${item.title}” from your library and all its collections? Downloads and folder files will remain.`))return;setLibrary(x=>exists?x.filter(i=>identity(i)!==key):[savedSummary(item),...x]);if(exists)setCollections(x=>removeTitleFromCollections(x,key));setToast(exists?'Removed from your library and collections':'Saved to your library');};
  const favourite=item=>{
    const exists=collections.find(c=>c.id===FAVOURITES_ID)?.items.includes(identity(item));
    if(!has(item))setLibrary(previous=>[savedSummary(item),...previous]);
    setCollections(previous=>toggleFavourite(previous,identity(item)));
    setToast(exists?'Removed from Favourites':'Added to Favourites');
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
  const submitSearch=value=>{setQuery(value);setBrowseSource('all');if(route.page!=='browse')go('browse');};
  const refresh=()=>{clearNetworkCache();setRefreshKey(x=>x+1);setToast('Refreshing your sources');};
  const remember=(item,episode)=>setHistory(prev=>[{item:{source:item.source,url:item.url,title:item.title,image:item.image,type:item.type,badge:item.badge,status:item.status,genres:item.genres,aired:item.aired,year:item.year,rating:item.rating,nsfw:item.nsfw},episode:{number:episode.number,url:episode.url,title:episode.title},time:Date.now()},...prev.filter(x=>!(identity(x.item)===identity(item)&&String(x.episode.number)===String(episode.number)))].slice(0,100));
  const play=async(item,episode,options={})=>{
    const request=++playbackRequest.current;
    setBusy(`Finding servers for episode ${episode.number}...`);
    try{
      const playlist=buildPlaybackPlaylist(options.playlist||item.episodes||[],episode);
      const servers=await getServers(item.source,episode);
      if(request!==playbackRequest.current)return false;
      if(!servers.length)throw new Error('No available video servers were found. Try the original site.');
      remember(item,episode);
      setStoredProgress(prev=>recordWatch(prev,item,episode,playlist.episodes,Date.now()));
      const episodeIndex=Math.max(0,playlist.currentIndex);
      const watchedSet=watchedUrlSet(progress,history,item);
      watchedSet.add(episode.url);
      const nativePlaylist=compactPlaybackPlaylist(playlist.episodes,episodeIndex,260000,watchedSet);
      const payload={
        item:{title:item.title,source:item.source},
        episode:{number:episode.number,url:episode.url},
        episodes:nativePlaylist.episodes,
        episodeIndex:nativePlaylist.episodeIndex,
        servers,
      };
      if(isAndroid()){
        let raw=JSON.stringify(payload);
        if(raw.length>290000&&payload.episodes.length>1){
          // Never let an unusually long rail prevent the episode itself opening.
          payload.episodes=[payload.episodes[payload.episodeIndex]];
          payload.episodeIndex=0;
          raw=JSON.stringify(payload);
        }
        window.MokuBridge.openPlayer(raw);
      }
      else setPlayer({...payload,item,episodes:playlist.episodes,episodeIndex});
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
  const continueItems=useMemo(()=>continueWatching(progress,history),[progress,history]);
  const libraryProgress=useMemo(()=>progressByTitle(progress,history),[progress,history]);
  const resumeNext=entry=>play(entry.item,entry.episode,{playlist:entry.episodes});
  const removeContinue=item=>setStoredProgress(prev=>removeProgressTitle(prev,item));
  const syncProgress=detail=>setStoredProgress(prev=>refreshSnapshot(prev,detail,detail?.episodes||[]));
  const markWatched=(item,episodes,flag)=>{
    const targets=(Array.isArray(episodes)?episodes:[]).filter(episode=>episode?.url);
    if(!targets.length)return;
    setStoredProgress(prev=>setEpisodesWatched(prev,item,item.episodes||[],targets.map(episode=>episode.url),flag,Date.now()));
    if(!flag){const urls=new Set(targets.map(episode=>episode.url));setHistory(prev=>prev.filter(entry=>!(identity(entry.item)===identity(item)&&urls.has(entry.episode.url))));}
    setToast(`${flag?'Marked':'Unmarked'} ${targets.length} episode${targets.length===1?'':'s'}${flag?' as watched':''}`);
  };
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
      const facts=`${s.library} library titles · ${s.collections} collections · ${s.history} history entries · progress for ${s.progress} series`;
      if(!window.confirm(`Restore the backup from ${when}?\n\n${facts}\n\nThis replaces your current library, collections, history, watch progress and settings on this device.`))return;
      applyBackup(window.localStorage,backup.data);
      setToast('Backup restored — restarting…');
      setTimeout(()=>window.location.reload(),400);
    }catch(e){setToast(e.message||'Could not restore that backup.');}
  };
  const resume=async entry=>{setBusy('Finding your episode...');try{const d=await getDetail(entry.item);const ep=d.episodes.find(e=>String(e.number)===String(entry.episode.number));if(!ep)throw new Error('Episode not found. Open the series or original source.');setBusy('');await play(d,ep);}catch(e){setBusy('');setToast(e.message||'Could not open this episode.')}};
  const clearHistory=()=>{if(window.confirm('Clear recently opened episodes from this device?')){setHistory([]);setStoredProgress([]);setToast('History cleared');}};
  const clearLibrary=()=>{if(window.confirm('Remove all saved titles from this device and their collection memberships? Your collections, downloads and folder files will remain.')){setLibrary([]);setCollections(previous=>previous.map(c=>({...c,items:[]})));setToast('Library cleared');}};
  const queueEpisodes=(item,episodes)=>{if(!episodes.length)return;setDownloadModal({item,episodes});};
  const submitDownload=async ({language,server,quality})=>{
    if(!downloadModal)return;
    try{
      const item=downloadModal.item;
      const summary={source:item.source,url:item.url,title:item.title,image:item.image,type:item.type};
      const episodes=downloadModal.episodes.map(ep=>({item:summary,episode:{url:ep.url,number:ep.number,title:ep.title,ids:ep.ids||''}}));
      const result=await enqueueDownloads(episodes,language,server,quality);
      setDownloadModal(null);setToast(result.added?`${result.added} episode${result.added===1?'':'s'} added to the queue`:'Already in your downloads');
      try{setDownloads(await getDownloads())}catch{} go('downloads');
    }catch(e){setToast(e.message||'Could not add episodes to the queue');}
  };
  const deleteDownload=async d=>{
    if(!window.confirm(`Remove episode ${d.episode?.number} from Mikozora? Any playable copies in your chosen folder will remain.`))return;
    try{await removeDownload(d.id);setDownloads(await getDownloads());setToast('Download removed');}
    catch(e){setToast(e.message||'Could not remove this download');}
  };
  const retryDownload=async d=>{
    try{await enqueueDownloads([{item:d.item,episode:d.episode}],d.language||'english',d.serverChoice||'auto',d.qualityChoice||'best');setDownloads(await getDownloads());setToast('Added back to the queue');}
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
  return <div className="app-shell"><SideNav page={route.page} go={go} unread={updates.unreadCount}/><div className="main-shell"><TopBar page={route.page} go={go} submitSearch={submitSearch} refresh={refresh} unread={updates.unreadCount}/>{pendingUpdate&&<UpdateBanner info={pendingUpdate} download={downloadAppUpdate} dismiss={dismissAppUpdate}/>}<main key={route.page==='detail'?identity(route.item):route.page}>
    {route.page==='home'&&<HomePage {...common} recent={history} refreshKey={refreshKey} hideNsfw={hideNsfw} continueItems={continueItems} resumeNext={resumeNext} removeContinue={removeContinue}/>}
    {route.page==='browse'&&<BrowsePage {...common} query={query} setQuery={setQuery} source={browseSource} setSource={setBrowseSource} refreshKey={refreshKey} hideNsfw={hideNsfw} openSettings={()=>go('settings')}/>}
    {route.page==='detail'&&<DetailPage item={route.item} openEpisode={play} has={has} toggle={toggle} organize={item=>setCollectionDialog({kind:'title',item})} back={back} history={history} refreshKey={refreshKey} queueEpisodes={queueEpisodes} downloads={downloads} showDownloads={()=>go('downloads')} notify={setToast} hideNsfw={hideNsfw} openSettings={()=>go('settings')} watched={watchedUrlSet(progress,history,route.item)} onEpisodesReady={syncProgress} markWatched={markWatched}/>}
    {route.page==='library'&&<LibraryPage {...common} items={library} collections={collections} activeCollection={activeCollection} setActiveCollection={setActiveCollection} onCreate={()=>setCollectionDialog({kind:'new'})} onRename={id=>setCollectionDialog({kind:'rename',id})} onDelete={removeCollection} onMembers={id=>setCollectionDialog({kind:'members',id})} onFavourite={favourite} unreadTitles={unreadTitles} progressByTitle={libraryProgress} hideNsfw={hideNsfw}/>}
    {route.page==='updates'&&<UpdatesPage state={updates} available={updatesAvailable} syncError={updatesSyncError} actionError={updatesActionError} check={checkNow} readAll={readAllUpdates} openUpdate={viewUpdate} openLibrary={()=>go('library')} openSettings={()=>go('settings')}/>}
    {route.page==='downloads'&&<DownloadsPage items={downloads} loading={downloadsLoading} remove={deleteDownload} retry={retryDownload} change={d=>setDownloadModal({item:d.item,episodes:[d.episode],language:d.language||'english'})} browse={browse} folder={folder} saveCopy={saveCopy} openSettings={()=>go('settings')}/>}
    {route.page==='history'&&<HistoryPage items={history.filter(entry=>!hideNsfw||!isNsfw(entry.item))} resume={resume} open={open} clear={clearHistory} browse={browse}/>}
    {route.page==='sources'&&<SourcesPage browse={browse}/>}
    {route.page==='settings'&&<SettingsPage library={library} history={history} clearLibrary={clearLibrary} clearHistory={clearHistory} openLicenses={()=>setLicenses(true)} openReleaseNotes={()=>setExperience({mode:'update',manual:true})} folder={folder} chooseFolder={chooseFolder} usePrivate={usePrivate} updates={updates} updatesAvailable={updatesAvailable} changeAutomatic={changeAutomatic} changeAlerts={changeAlerts} notificationPermission={notificationPermission} appearance={appearance} changeAppearance={changeAppearance} contentPrefs={contentPrefs} changeContentPrefs={changeContentPrefs} appUpdate={appUpdate} pendingUpdate={pendingUpdate} updateStatus={updateStatus} checkUpdate={checkAppUpdate} changeAutoCheck={changeAutoCheck} downloadUpdate={downloadAppUpdate} exportBackup={exportBackup} importBackup={importBackup}/>}
  </main></div><BottomNav page={route.page} go={go}/>{collectionDialog?.kind==='new'&&<CollectionNameDialog close={()=>setCollectionDialog(null)} submit={saveCollectionName}/>}{collectionDialog?.kind==='rename'&&<CollectionNameDialog editing value={collections.find(c=>c.id===collectionDialog.id)?.name||''} close={()=>setCollectionDialog(null)} submit={saveCollectionName}/>}{collectionDialog?.kind==='title'&&<TitleCollectionsDialog item={collectionDialog.item} collections={collections} close={()=>setCollectionDialog(null)} submit={selected=>saveTitleCollectionChoices(collectionDialog.item,selected)}/>}{collectionDialog?.kind==='members'&&collections.find(c=>c.id===collectionDialog.id)&&<CollectionMembersDialog collection={collections.find(c=>c.id===collectionDialog.id)} items={hideNsfw?library.filter(item=>!isNsfw(item)):library} close={()=>setCollectionDialog(null)} submit={keys=>saveCollectionMembers(collectionDialog.id,keys)}/>} {player&&<PlayerModal key={player.episode.url} player={player} close={()=>setPlayer(null)} onEpisode={episode=>play(player.item,episode,{playlist:player.episodes})} watched={watchedUrlSet(progress,history,player.item)}/>}{licenses&&<LicenseModal close={()=>setLicenses(false)}/>}{downloadModal&&<DownloadModal request={downloadModal} close={()=>setDownloadModal(null)} submit={submitDownload}/>}{busy&&<div className="busy-overlay"><div><LoaderCircle size={20} className="spin"/><span>{busy}</span></div></div>}{toast&&<div className="toast"><Check size={16}/>{toast}</div>}</div>;
}

createRoot(document.getElementById('root')).render(<App/>);
