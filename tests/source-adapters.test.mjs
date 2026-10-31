import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';

globalThis.DOMParser = DOMParser;
const xinMirror = Buffer.from('<iframe src="https://player.example.org/video/one"></iframe>').toString('base64');
const fixture = url => {
  const u = new URL(url);
  if (u.hostname === 'animesogo.to' && u.pathname === '/home') return `<div class="swiper-slide item" style="background-image: url('https://cdn.anipixcdn.co/thumbnail/hero.jpg')"><a href="/watch/test-show"><div class="title">Test Show</div><div class="genre">Action, Fantasy</div></a></div><div id="top-anime"><div class="tab-content" data-name="day"><a class="item" href="/watch/day-only"><div class="name">Day only</div></a></div><div class="tab-content" data-name="week"><a class="item" href="/watch/test-show/ep-2"><div class="poster"><span style="background-image: url('https://media.themoviedb.org/t/p/test.jpg');"></span></div><div class="name">Weekly Test Show</div></a><a class="item" href="https://example.org/watch/invalid"><div class="name">Bad source</div></a></div></div>`;
  if (u.hostname === 'animesogo.to' && ['/latest-updated','/filter','/status/currently-airing','/status/finished-airing','/status/not-yet-aired'].includes(u.pathname)) return `<div class="ani items"><div class="item"><div class="type">TV</div><a class="poster" href="/watch/test-show/ep-2"><img src="https://cdn.anipixcdn.co/thumbnail/test.jpg"></a><div class="ep-status sub">2</div><a class="name" href="/watch/test-show/ep-2">Test Show</a></div></div><ul class="pagination"><li class="active"><a>1</a></li><li><a href="?page=2">2</a></li></ul>`;
  if (u.hostname === 'animesogo.to' && u.pathname === '/watch/test-show') return `<div id="watch-page" data-id="123"><div id="player"><div class="backdrop" style="background-image:url('https://s4.anilist.co/banner.jpg')"></div></div><section id="w-info"><div class="poster"><img src="https://cdn.anipixcdn.co/thumbnail/test.jpg"></div><h1 class="title">Test Show</h1><div class="synopsis"><div class="content">A real synopsis.</div></div><div class="bl-meta"><div class="meta"><div>Type: <span>TV</span></div><div>Status: <span>Finished Airing</span></div><div>Date aired: <span>Oct 3, 2002 to Feb 8, 2007</span></div><div>Episodes: <span>220</span></div><div>Genres: <span><a href="/genre/action">Action</a></span></div></div></div></section></div>`;
  if (u.hostname === 'animesogo.to' && u.pathname === '/ajax/episode/list/123') return JSON.stringify({status:200,result:'<ul class="episodes"><li><a data-num="1" data-ids="episode-token" data-sub="1" data-dub="1">1</a></li><li><a data-num="2" data-ids="episode-token-2" data-sub="1">2</a></li></ul>'});
  if (u.hostname === 'animesogo.to' && u.pathname === '/ajax/server/list') return JSON.stringify({status:200,result:'<div class="type" data-type="sub"><a class="server" data-link-id="sid-A"><span>HD-1</span></a></div>'});
  if (u.hostname === 'animesogo.to' && u.pathname === '/ajax/server') return JSON.stringify({status:200,result:{url:'https://player.example.org/embed/test'}});
  if (u.hostname === 'animexin.dev' && (u.pathname === '/anime/' || u.pathname === '/')) return `<div class="popularslider"><a href="/test-episode-2/">A recent episode, not a series</a></div><ul class="wpop-weekly"><li><div class="ctr">1</div><div class="imgseries"><a class="series" href="https://animexin.dev/test-donghua/"><img src="https://animexin.dev/test.jpg" alt="Test Donghua"></a></div><h4><a class="series" href="https://animexin.dev/test-donghua/">Test Donghua</a></h4></li></ul><div class="postbody"><div class="listupd"><article class="bs"><a href="https://animexin.dev/test-donghua/" title="Test Donghua"><div class="typez">ONA</div><span class="sb">Sub</span><span class="epx">Ongoing</span><img src="https://animexin.dev/test.jpg"></a></article></div></div><div class="hpage"><a class="r" href="?page=2">Next</a></div>`;
  if (u.hostname === 'animexin.dev' && u.pathname === '/test-donghua/') return `<h1 class="entry-title">Test Donghua</h1><div class="thumbook"><div class="thumb"><img src="https://animexin.dev/test.jpg"></div></div><div class="spe"><span><b>Released on:</b> June 14, 2023</span><span><b>Released:</b> Jun 24, 2023</span><span><b>Status:</b> Ongoing</span><span><b>Episodes:</b> 182</span><span><b>Type:</b> ONA</span></div><div class="genxed"><a>Fantasy</a></div><div class="synp"><div class="entry-content"><p>English</p><p>A fantasy synopsis.</p></div></div><div class="eplister"><ul><li><a href="https://animexin.dev/test-episode-2/"><div class="epl-num">2</div><div class="epl-title">Episode 2</div><div class="epl-date">Yesterday</div></a></li></ul></div>`;
  if (u.hostname === 'animexin.dev' && u.pathname === '/post-only/') return `<h1 class="entry-title">Post only</h1><div class="spe"><span><b>Released on:</b> June 14, 2023</span></div>`;
  if (u.hostname === 'animexin.dev' && u.pathname === '/test-episode-2/') return `<select class="mirror"><option value="">Select</option><option value="${xinMirror}">English mirror</option><option value="${Buffer.from('<iframe src="//ok.ru/videoembed/123?nochat=1"></iframe>').toString('base64')}">OK.ru mirror</option><option value="${Buffer.from('<iframe data-src="/player/relative"></iframe>').toString('base64')}">Relative mirror</option><option value="${Buffer.from('<iframe src="javascript:alert(1)"></iframe>').toString('base64')}">Invalid</option><option value="${Buffer.from('<iframe src="https://127.0.0.1/private"></iframe>').toString('base64')}">Private IP</option></select>`;
  throw new Error(`No fixture for ${url}`);
};
const requests=[];
globalThis.window = { MokuBridge: { request(id,url) {
  requests.push(url);
  setTimeout(()=>{
    try {
      const body=fixture(url); const middle=Math.min(37,body.length);
      window.__mokuNativeChunk(id,body.slice(0,middle),false,null);
      window.__mokuNativeChunk(id,body.slice(middle),true,null);
    } catch(e) { window.__mokuNativeChunk(id,'',true,e.message); }
  },0);
}}};
const { getFeatured,getTrending,getDiscoverAnime,getCatalog,getDetail,getServers,imageUrl,clearNetworkCache } = await import('../src/data.js');

test('AnimeSogo featured and catalog normalize episode links to series', async()=>{
  const featured=await getFeatured(); assert.equal(featured[0].title,'Test Show');assert.equal(featured[0].url,'https://animesogo.to/watch/test-show');
  const list=await getCatalog('sogo');assert.equal(list.items.length,1);assert.equal(list.items[0].url,'https://animesogo.to/watch/test-show');assert.equal(list.items[0].badge,'EP 2');assert.equal(list.hasMore,true);
});
test('AnimeSogo metadata, episodes and SUB/DUB server resolver', async()=>{
  const item=(await getCatalog('sogo')).items[0];const d=await getDetail(item);
  assert.equal(d.title,'Test Show');assert.equal(d.type,'TV');assert.equal(d.status,'Finished Airing');assert.equal(d.aired,'Oct 3, 2002 to Feb 8, 2007');assert.equal(d.episodeCount,'220');assert.deepEqual(d.genres,['Action']);assert.equal(d.episodes.length,2);assert.equal(d.episodes[0].dub,true);
  const servers=await getServers('sogo',d.episodes[0]);assert.deepEqual(servers,[{name:'HD-1 · SUB',url:'https://player.example.org/embed/test'}]);
});
test('AnimeXin list, detail and base64 mirror parsing',async()=>{
  const item=(await getCatalog('xin')).items[0];assert.equal(item.title,'Test Donghua');assert.equal(item.status,'Ongoing');
  const d=await getDetail(item);assert.equal(d.type,'ONA');assert.equal(d.status,'Ongoing');assert.equal(d.aired,'Jun 24, 2023');assert.equal(d.episodeCount,'182');assert.equal(d.synopsis,'A fantasy synopsis.');assert.equal(d.episodes[0].number,'2');
  const servers=await getServers('xin',d.episodes[0]);assert.deepEqual(servers,[{name:'English mirror',url:'https://player.example.org/video/one'},{name:'OK.ru mirror',url:'https://ok.ru/videoembed/123?nochat=1'},{name:'Relative mirror',url:'https://animexin.dev/player/relative'}]);
});

test('Missing source metadata does not substitute a publication date',async()=>{
  const d=await getDetail({source:'xin',url:'https://animexin.dev/post-only/',title:'Post only'});
  assert.equal(d.aired,'');assert.equal(d.status,'');assert.equal(d.episodeCount,'');
});
test('Weekly rankings use each source leaderboard, never the latest episode feed',async()=>{
  const sogo=await getTrending('sogo');
  assert.deepEqual(sogo.map(x=>[x.rank,x.title,x.url]),[[1,'Weekly Test Show','https://animesogo.to/watch/test-show']]);
  assert.equal(sogo[0].image,'https://media.themoviedb.org/t/p/test.jpg');
  const xin=await getTrending('xin');
  assert.deepEqual(xin.map(x=>[x.rank,x.title,x.url]),[[1,'Test Donghua','https://animexin.dev/test-donghua/']]);
  assert.ok(!xin.some(x=>x.url.includes('episode')));
  await assert.rejects(()=>getTrending('unknown'),/Unknown source/);
});
test('Discover anime and status filters use source routes; search never pretends to filter',async()=>{
  await getDiscoverAnime();
  assert.ok(requests.some(x=>new URL(x).searchParams.get('sort')==='most-viewed'));
  await getCatalog('sogo',{status:'completed'});
  assert.ok(requests.some(x=>new URL(x).pathname==='/status/finished-airing'));
  await getCatalog('xin',{status:'ongoing'});
  assert.ok(requests.some(x=>new URL(x).hostname==='animexin.dev'&&new URL(x).searchParams.get('status')==='ongoing'));
  await assert.rejects(()=>getCatalog('xin',{query:'test',status:'ongoing'}),/Clear the search/);
  await assert.rejects(()=>getCatalog('xin',{status:'invented'}),/Unknown status/);
});
test('Parallel featured and weekly ranking requests share a source response',async()=>{
  clearNetworkCache();const before=requests.length;
  await Promise.all([getFeatured(),getTrending('sogo')]);
  assert.equal(requests.slice(before).filter(x=>new URL(x).pathname==='/home').length,1);
});
test('Artwork is routed through the local Android image bridge',()=>{
  assert.match(imageUrl('https://animexin.dev/test.jpg'),/^https:\/\/app\.moku\.local\/api\/image\?url=/);
});
test('Failed network requests reject instead of returning fake results',async()=>{
  clearNetworkCache();await assert.rejects(()=>getCatalog('unknown'),/Unknown source/);assert.ok(requests.length>=7);
});
