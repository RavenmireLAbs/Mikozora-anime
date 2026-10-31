import test from 'node:test';
import assert from 'node:assert/strict';

// Tiny inert fixtures model each requested site's actual catalog, episode and server shapes.
const sites={
  suge:['animesuge.cz','/anime/show'], anikoto:['anikototv.to','/watch/show'],
  rulz:['animerulz.com.in','/anime/show/'], waves:['aniwaves.ru','/watch/show-42'],
  bash:['animebash.in','/anime/42'], narul:['naruldonghua.com','/show/'],
  stream:['donghuastream.org','/anime/show/'], world:['donghuaworld.com','/anime/show/']
};
const byHost=Object.fromEntries(Object.entries(sites).map(([id,[host,path]])=>[host,{id,path}]));
const hash=html=>Buffer.from(html).toString('base64');
const calls=[];
let bashWatchOverride=null, bashDetailOverride=null;
function fixture(raw){
  const u=new URL(raw); const site=byHost[u.hostname];
  if(!site)throw new Error('Unknown host: '+u.hostname);
  const {id,path}=site, base=u.origin;
  if(id==='bash'){
    if(u.pathname==='/api/search')return JSON.stringify({success:true,media:[{id:42,title:{english:'Bash Title'},coverImage:{large:'https://s4.anilist.co/show.jpg'},format:'TV',status:'FINISHED',genres:['Action','Fantasy'],seasonYear:2024,isAdult:false}],pageInfo:{hasNextPage:true}});
    if(u.pathname==='/api/anime/42')return JSON.stringify({id:42,title:{english:'Bash Title'},description:'Bash synopsis',coverImage:{large:'https://s4.anilist.co/show.jpg'},bannerImage:'https://s4.anilist.co/banner.jpg',genres:['Action'],format:'TV',status:'FINISHED',episodes:2,startDate:{year:2024,month:1,day:2},...bashDetailOverride});
    if(u.pathname==='/api/watch/42')return JSON.stringify(bashWatchOverride || {episodes:[{number:2,title:'Second',airDate:'2024-01-09'},{number:1,title:'First',airDate:'2024-01-02'}]});
    if(u.pathname==='/api/watch/42/1')return JSON.stringify({sub:{MEG1:'https://megaplay.buzz/stream/mal/42/1/sub',BAD:'javascript:alert(1)'},dub:{MEG1:'https://megaplay.buzz/stream/mal/42/1/dub'}});
  }
  if(['suge','anikoto','waves'].includes(id)){
    if(['/latest-updated','/updated/page/1','/filter','/genre/action','/status/finished-airing'].includes(u.pathname)){
      if(id==='suge')return `<div class="inner"><div class="item-top"><a class="poster" href="${path}/ep-1"><img src="https://cdn.anipixcdn.co/show.jpg" alt="Suge Title"></a><div class="item-status"><span class="type">TV</span></div></div><div class="item-bottom"><div class="dub-sub-total"><span class="sub">12</span></div><div class="name"><a href="${path}/ep-1">Suge Title</a></div></div></div><ul class="pagination"><li class="active"></li><li><a href="?page=2">2</a></li></ul>`;
      return `<div class="ani items"><div class="item"><div class="ani poster"><a href="${path}/ep-1"><img src="https://static.aniwaves.ru/show.jpg" alt="Title"></a><div class="meta"><span class="ep-status sub">12</span><div class="right">TV</div></div></div><div class="info"><a class="name" href="${path}/ep-1">${id} Title</a></div></div></div><ul class="pagination"><li class="active"></li><li><a href="?page=2">2</a></li></ul>`;
    }
    if(u.pathname===path){
      const idAttr=id==='suge'?'class="watch-wrap" data-id="42"':'id="watch-main" data-id="42"';
      return `<div ${idAttr}><div id="player" style="background-image:url('https://static.aniwaves.ru/banner.jpg')"></div><section id="w-info"><div class="poster"><img src="https://static.aniwaves.ru/show.jpg"></div><h1 class="title">${id} Title</h1><div class="synopsis"><div class="content">A synopsis</div></div><div class="bmeta"><div class="meta"><div>Type: <span>TV</span></div><div>Aired: <span>Jan 2, 2024</span></div><div>Status: <span>Finished Airing</span></div><div>Rating: <span>TV-14</span></div><div>Episodes: <span>2</span></div><div>Genres: <span><a href="/genre/action">Action</a></span></div></div></div></section></div>`;
    }
    if(u.pathname==='/ajax/episode/list/42')return JSON.stringify({status:200,result:id==='waves'?'<ul><li><a href="/watch/42/ep-1" data-num="1" data-slug="1" data-ids="42&amp;eps=1" data-sub="1">1</a></li></ul>':'<ul><li><a href="#" data-num="1" data-slug="1" data-ids="episode-token" data-sub="1" data-dub="1">1</a></li></ul>'});
    if(u.pathname==='/ajax/server/list'){
      if(id==='waves'){assert.equal(u.searchParams.get('servers'),'42');assert.equal(u.searchParams.get('eps'),'1');}
      else assert.equal(u.searchParams.get('servers'),'episode-token');
      return JSON.stringify({status:200,result:'<div class="type" data-type="sub"><div data-link-id="server-token"><span>Server A</span></div></div>'});
    }
    if(u.pathname==='/ajax/server'||u.pathname==='/ajax/sources')return JSON.stringify({status:200,result:{url:'https://player.example.org/embed/show'}});
  }
  if(['rulz','narul','stream','world'].includes(id)){
    if(u.pathname==='/anime/' || (u.pathname==='/'&&u.searchParams.has('s'))){
      const image=id==='narul'?`https://i2.wp.com/${u.hostname}/wp-content/uploads/show.jpg?resize=247,350`:`${base}/wp-content/uploads/show.jpg`;
      return `<div class="postbody"><div class="listupd"><article class="bs"><a href="${path}" title="${id} Title"><div class="typez">TV</div><span class="sb">Sub</span><span class="epx">Ongoing</span><img src="data:image/svg+xml,blank" data-src="${image}"></a></article></div><a class="r" href="?page=2">Next</a></div>`;
    }
    if(u.pathname===path){
      const episode=`${base}/show-episode-1/`;
      const entries=id==='rulz'?`<div class="episodes-ul"><a class="ep-item" data-number="1" href="${episode}">1</a></div>`:`<div class="eplister"><ul><li><a href="${episode}"><div class="epl-num">1 (4K)</div><div class="epl-title">Episode 1</div><div class="epl-date">Yesterday</div></a></li></ul></div>`;
      return `<h1 class="entry-title">${id} Title</h1><div class="thumbook"><div class="thumb"><img src="data:image/svg+xml,blank" data-src="${base}/wp-content/uploads/show.jpg"></div></div><div class="spe"><span><b>Released on:</b> A post date</span><span><b>Released:</b> 2024</span><span><b>Status:</b> Ongoing</span><span><b>Type:</b> TV</span></div><div class="synp"><div class="entry-content"><p>A synopsis</p></div></div>${entries}`;
    }
    if(u.pathname==='/show-episode-1/')return `<select class="mirror"><option value="${hash('<iframe src="https://geo.dailymotion.com/player/x.html?video=abc123"></iframe>')}">Dailymotion</option></select><div class="server-item"><a data-hash="${hash('<iframe src="//ok.ru/videoembed/123"></iframe>')}">Second mirror</a><a data-hash="${hash('<iframe src="https://127.0.0.1/secret"></iframe>')}">Invalid</a></div><div id="pembed"><iframe src="about:blank" data-litespeed-src="https://geo.dailymotion.com/player/x.html?video=abc123"></iframe></div>`;
  }
  throw new Error(`No fixture for ${raw}`);
}
globalThis.window={MokuBridge:{request(id,url){calls.push(url);setTimeout(()=>{try{window.__mokuNativeChunk(id,fixture(url),true,null)}catch(e){window.__mokuNativeChunk(id,'',true,e.message)}},0)}}};
const {SOURCES,getCatalog,getDetail,getServers,clearNetworkCache}=await import('../src/data.js');

test('the ten exact sources are grouped without changing legacy source IDs',()=>{
  const anime=Object.values(SOURCES).filter(x=>x.category==='Anime').map(x=>x.id);
  const donghua=Object.values(SOURCES).filter(x=>x.category==='Donghua').map(x=>x.id);
  assert.deepEqual(anime,['sogo','suge','anikoto','rulz','waves','bash']);
  assert.deepEqual(donghua,['xin','narul','stream','world']);
  assert.equal(SOURCES.sogo.base,'https://animesogo.to');assert.equal(SOURCES.xin.base,'https://animexin.dev');
});
for(const id of Object.keys(sites))test(`${id}: catalog, search, title, episodes and video mirrors`,async()=>{
  const catalog=await getCatalog(id), search=await getCatalog(id,{query:'show'});
  assert.equal(catalog.items.length,1);assert.equal(search.items.length,1);
  assert.equal(catalog.items[0].source,id);assert.equal(catalog.items[0].url,`https://${sites[id][0]}${sites[id][1]}`);
  assert.ok(catalog.items[0].title);assert.equal(catalog.hasMore,true);
  if(id==='narul')assert.equal(catalog.items[0].image,'https://naruldonghua.com/wp-content/uploads/show.jpg');
  const detail=await getDetail(catalog.items[0]);
  assert.ok(detail.episodes.length>0);assert.equal(detail.episodes[0].number,'1');
  assert.ok(detail.episodes[0].url.startsWith(`https://${sites[id][0]}/`));
  assert.ok(detail.status);assert.ok(detail.aired);assert.ok(detail.image);assert.equal(detail.year,2024);
  const servers=await getServers(id,detail.episodes[0]);
  assert.ok(servers.length>=1);assert.ok(servers.every(s=>s.url.startsWith('https://')));
  assert.ok(servers.every(s=>!s.url.includes('127.0.0.1')));
  if(id==='world'||id==='stream'||id==='rulz'||id==='narul')assert.deepEqual(servers.map(s=>s.name),['Dailymotion','Second mirror']);
  if(id==='bash'){assert.equal(servers.length,2);assert.equal(detail.episodes[0].title,'First');assert.deepEqual(catalog.items[0].genres,['Action','Fantasy']);assert.equal(catalog.items[0].year,2024);assert.equal(catalog.items[0].nsfw,undefined);}
  if(['suge','anikoto','waves'].includes(id))assert.equal(detail.rating,'PG-13','TV-14 is normalized to PG-13');
  if(id==='waves')assert.equal(detail.episodes[0].ids,'42&eps=1');
});

test('AnimeBash follows its own fallback only when its list is empty; partial lists are not fabricated',async()=>{
  const item={source:'bash',url:'https://animebash.in/anime/42',title:'Bash Title'};
  try {
    bashWatchOverride={episodes:[]};bashDetailOverride={status:'RELEASING',episodes:220,nextAiringEpisode:{episode:4}};clearNetworkCache();
    assert.equal((await getDetail(item)).episodes.length,3,'empty list uses source reported aired count');
    bashDetailOverride={status:'NOT_YET_RELEASED',episodes:12};clearNetworkCache();
    assert.equal((await getDetail(item)).episodes.length,0,'upcoming show gets no episodes');
    bashWatchOverride={episodes:[{number:1},{number:2}]};bashDetailOverride={status:'FINISHED',episodes:220};clearNetworkCache();
    assert.equal((await getDetail(item)).episodes.length,2,'partial source list is not completed with imaginary records');
  } finally {bashWatchOverride=null;bashDetailOverride=null;clearNetworkCache();}
});

test('genre browsing uses each source listing; WordPress sources report that they have no year filter',async()=>{
  for(const id of ['suge','anikoto','waves']){
    const before=calls.length;await getCatalog(id,{genre:'Action'});
    assert.ok(calls.slice(before).some(x=>new URL(x).pathname==='/genre/action'),`${id} genre listing`);
  }
  for(const id of ['rulz','narul','stream','world']){
    const before=calls.length;await getCatalog(id,{genre:'Action'});
    assert.ok(calls.slice(before).some(x=>new URL(x).searchParams.get('genre[]')==='action'),`${id} genre parameter`);
    await assert.rejects(()=>getCatalog(id,{year:'2024'}),/does not offer a year filter/);
  }
  const before=calls.length;await getCatalog('bash',{genre:'Action',year:'2024'});
  assert.ok(calls.slice(before).some(x=>new URL(x).searchParams.get('genre')==='Action'&&new URL(x).searchParams.get('year')==='2024'));
  await assert.rejects(()=>getCatalog('suge',{genre:'Invented'}),/Unknown genre/);
});
test('source identities and episode parameters are validated, with unsupported filters reported',async()=>{
  await assert.rejects(()=>getDetail({source:'narul',url:'https://evil.example/show/',title:'Invalid'}),/invalid source URL/);
  await assert.rejects(()=>getCatalog('waves',{status:'upcoming'}),/does not offer/);
  await assert.rejects(()=>getServers('waves',{ids:'42&eps=1&admin=1'}),/valid episode/);
  assert.ok(calls.some(x=>x.includes('/ajax/sources?id=')));
});
