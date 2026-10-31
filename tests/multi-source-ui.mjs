// Simulated Android/CSP end-to-end test of the ten source cards and new-source flows.
// Run after npm run build: node tests/multi-source-ui.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import { chromium } from 'playwright';
import { APP_VERSION, EXPERIENCE_KEY } from '../src/releases.js';
const ROOT=resolve('dist');
const names={sogo:'AnimeSogo',suge:'AnimeSuge',anikoto:'Anikoto',rulz:'Animerulz',waves:'Aniwaves',bash:'AnimeBash',xin:'AnimeXin',narul:'NarulDonghua',stream:'DonghuaStream',world:'DonghuaWorld'};
const sites={suge:['animesuge.cz','/anime/show'],anikoto:['anikototv.to','/watch/show'],rulz:['animerulz.com.in','/anime/show/'],waves:['aniwaves.ru','/watch/show-42'],bash:['animebash.in','/anime/42'],narul:['naruldonghua.com','/show/'],stream:['donghuastream.org','/anime/show/'],world:['donghuaworld.com','/anime/show/']};
const byHost=Object.fromEntries(Object.entries(sites).map(([id,[host,path]])=>[host,{id,path}]));
const hash=html=>Buffer.from(html).toString('base64');
function fixture(raw){
 const u=new URL(raw), found=byHost[u.hostname];
 if(!found)return '<html></html>'; // Existing sources are tested by the separate regression suite.
 const {id,path}=found, base=u.origin, title=`${names[id]} fixture`;
 if(id==='bash'){
  if(u.pathname==='/api/search')return JSON.stringify({media:[{id:42,title:{english:title},coverImage:{large:'https://s4.anilist.co/test.jpg'},format:'TV'}],pageInfo:{hasNextPage:false}});
  if(u.pathname==='/api/anime/42')return JSON.stringify({id:42,title:{english:title},description:'A test title',coverImage:{large:'https://s4.anilist.co/test.jpg'},status:'FINISHED',episodes:2,startDate:{year:2024}});
  if(u.pathname==='/api/watch/42')return JSON.stringify({episodes:[{number:1,title:'First'},{number:2,title:'Second'}]});
  if(u.pathname==='/api/watch/42/1')return JSON.stringify({sub:{MEG1:'https://megaplay.buzz/stream/mal/42/1/sub'},dub:{}});
 }
 if(['suge','anikoto','waves'].includes(id)){
  if(['/latest-updated','/updated/page/1','/filter'].includes(u.pathname)){
   if(id==='suge')return `<div class="inner"><div class="item-top"><a class="poster" href="${path}/ep-1"><img alt="${title}" src="https://cdn.anipixcdn.co/test.jpg"></a></div><div class="item-bottom"><div class="name"><a href="${path}/ep-1">${title}</a></div></div></div>`;
   return `<div class="ani items"><div class="item"><div class="poster"><a href="${path}/ep-1"><img alt="${title}" src="https://cdn.anipixcdn.co/test.jpg"></a></div><a class="name" href="${path}/ep-1">${title}</a></div></div>`;
  }
  if(u.pathname===path){const marker=id==='suge'?'class="watch-wrap" data-id="42"':'id="watch-main" data-id="42"';return `<div ${marker}><section id="w-info"><div class="poster"><img src="https://cdn.anipixcdn.co/test.jpg"></div><h1 class="title">${title}</h1><div class="bmeta"><div class="meta"><div>Status: <span>Finished</span></div></div></div></section></div>`;}
  if(u.pathname==='/ajax/episode/list/42')return JSON.stringify({status:200,result:`<ul><li><a href="${id==='waves'?'/watch/42/ep-1':'#'}" data-num="1" data-slug="1" data-ids="${id==='waves'?'42&amp;eps=1':'token'}" data-sub="1">1</a></li><li><a href="${id==='waves'?'/watch/42/ep-2':'#'}" data-num="2" data-slug="2" data-ids="${id==='waves'?'42&amp;eps=2':'token2'}" data-sub="1">2</a></li></ul>`});
  if(u.pathname==='/ajax/server/list')return JSON.stringify({status:200,result:'<div class="type" data-type="sub"><div data-link-id="abc"><span>Test server</span></div></div>'});
  if(u.pathname==='/ajax/server'||u.pathname==='/ajax/sources')return JSON.stringify({status:200,result:{url:'https://player.example.org/embed/test'}});
 }
 if(['rulz','narul','stream','world'].includes(id)){
  if(u.pathname==='/anime/' || (u.pathname==='/'&&u.searchParams.has('s')))return `<div class="postbody"><div class="listupd"><article class="bs"><a href="${path}" title="${title}"><div class="typez">TV</div><img src="${base}/wp-content/uploads/test.jpg"></a></article></div></div>`;
  if(u.pathname===path){const ep=`${base}/show-episode-1/`;const rows=id==='rulz'?`<a class="ep-item" data-number="1" href="${ep}">1</a>`:`<div class="eplister"><ul><li><a href="${ep}"><div class="epl-num">1</div><div class="epl-title">Episode 1</div></a></li></ul></div>`;return `<h1 class="entry-title">${title}</h1><div class="spe"><span><b>Status:</b> Ongoing</span><span><b>Released:</b> 2024</span></div>${rows}`;}
  if(u.pathname==='/show-episode-1/')return `<select class="mirror"><option value="${hash('<iframe src="https://geo.dailymotion.com/player/x.html?video=abc"></iframe>')}">Dailymotion</option></select>`;
 }
 throw new Error('No UI fixture for '+raw);
}
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'";
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.ttf':'font/ttf','.svg':'image/svg+xml','.txt':'text/plain'};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const ctx=await browser.newContext({viewport:{width:320,height:780},isMobile:true,hasTouch:true});
await ctx.route('https://app.moku.local/**',async route=>{
 const u=new URL(route.request().url());
 if(u.pathname==='/api/image'){await route.fulfill({status:200,contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64')});return;}
 const path=resolve(ROOT,'.'+(u.pathname==='/'?'/index.html':u.pathname));
 if(!path.startsWith(ROOT+'/')){await route.fulfill({status:403});return;}
 try{await route.fulfill({status:200,headers:{'Content-Type':types[extname(path)]||'application/octet-stream','Content-Security-Policy':csp},body:await readFile(path)})}catch{await route.fulfill({status:404})}
});
const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.exposeBinding('__fixture',(_s,url)=>fixture(url));
await page.addInitScript(({ version, experienceKey })=>{
 if(!localStorage.getItem('multi.seed')){
  localStorage.setItem(experienceKey,JSON.stringify({version,status:'seen'}));
  const old={source:'sogo',url:'https://animesogo.to/watch/old',title:'Existing saved title',image:'',type:'TV'};
  localStorage.setItem('moku.library.v1',JSON.stringify([old]));
  localStorage.setItem('moku.history.v1',JSON.stringify([{item:old,episode:{number:'1',url:'https://animesogo.to/watch/old/ep-1'},time:1}]));
  localStorage.setItem('multi.seed','yes');
 }
 window.__players=[];window.__queued=[];window.__oldDownloads=[{id:'legacy',item:{source:'sogo',title:'Existing saved title'},episode:{number:'1'},status:'completed',storageMode:'folder'}];
 const reply=(id,obj)=>window.__mokuNativeChunk(id,typeof obj==='string'?obj:JSON.stringify(obj),true,null);
 window.MokuBridge={
  request(id,url){window.__fixture(url).then(v=>reply(id,v)).catch(e=>window.__mokuNativeChunk(id,'',true,e.message));},
  downloads(id){reply(id,window.__oldDownloads)},exportSettings(id){reply(id,{configured:true,granted:true,name:'My folder'})},
  openPlayer(raw){window.__players.push(JSON.parse(raw))},openExternal(){},openDownload(){},openExport(){},
  downloadOptions(id,raw){let p=JSON.parse(raw);reply(id,{servers:[{id:`${p.item.source}-server-0`,label:'Test server',qualities:[{id:'best',label:'Best'},{id:'v:1280x720',label:'720p'}]}],unavailable:0})},
  enqueueDownloads(id,raw){let p=JSON.parse(raw);window.__queued.push(p);reply(id,{added:p.episodes.length,skipped:0})}
 };
},{version:APP_VERSION,experienceKey:EXPERIENCE_KEY});
const nav=()=>page.locator('.bottom-nav').getByRole('button',{name:'Sources'});
const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at mobile size');
try{
 await page.goto('https://app.moku.local/index.html',{waitUntil:'domcontentloaded'});await nav().click();
 const anime=page.locator('section[aria-label="Anime sources"]'),donghua=page.locator('section[aria-label="Donghua sources"]');
 assert.deepEqual(await anime.locator('.source-card h2').allTextContents(),['AnimeSogo','AnimeSuge','Anikoto','Animerulz','Aniwaves','AnimeBash']);
 assert.deepEqual(await donghua.locator('.source-card h2').allTextContents(),['AnimeXin','NarulDonghua','DonghuaStream','DonghuaWorld']);await noOverflow();
 for(const id of Object.keys(sites)){
  const card=page.locator('.source-card').filter({has:page.getByRole('heading',{name:names[id],exact:true})});
  await card.getByRole('button',{name:'Browse this source'}).click();
  const title=`${names[id]} fixture`;
  await page.getByRole('button',{name:`Open ${title}`}).first().click({timeout:10000});
  await page.locator('.episode-row').first().waitFor({timeout:10000});
  await page.getByRole('button',{name:'Watch first episode'}).click();
  await page.waitForFunction(src=>window.__players.some(p=>p.item.source===src),id,{timeout:10000});
  let player=(await page.evaluate(()=>window.__players)).find(p=>p.item.source===id);
  assert.ok(player.servers.length>0);assert.equal(player.episode.number,'1');
  if(id==='waves'||id==='narul'){
   await page.getByRole('button',{name:'Download episode 1'}).click();
   const language=page.getByLabel('PREFERRED SUBTITLE LANGUAGE');
   assert.equal(await language.isDisabled(),true);
   if(id==='waves')assert.equal(await language.locator('option:checked').innerText(),'English only');
   else assert.equal(await language.locator('option:checked').innerText(),'Set by server');
   await page.getByRole('button',{name:'Cancel',exact:true}).click();
  }
  if(id==='suge'){
   await page.getByRole('button',{name:'Add to library'}).click();
   await page.getByRole('button',{name:'Select episodes'}).click();
   await page.getByRole('button',{name:'Select all matching'}).click();
   await page.getByRole('button',{name:/Download 2/}).click();
   await page.locator('select').filter({has:page.locator('option[value="suge-server-0"]')}).waitFor();
   await page.getByLabel('DOWNLOAD SERVER').selectOption('suge-server-0');await page.getByLabel('VIDEO QUALITY').selectOption('v:1280x720');
   await page.getByRole('button',{name:'Add to queue'}).click();
   const queued=await page.evaluate(()=>window.__queued[0]);assert.equal(queued.episodes.length,2);assert.equal(queued.server,'suge-server-0');assert.equal(queued.quality,'v:1280x720');assert.equal(queued.language,'english');
  }
  await nav().click();
 }
 assert.ok((await page.evaluate(()=>JSON.parse(localStorage.getItem('moku.library.v1')))).some(x=>x.title==='Existing saved title'));
 assert.ok((await page.evaluate(()=>JSON.parse(localStorage.getItem('moku.history.v1')))).some(x=>x.item.title==='Existing saved title'));
 assert.equal((await page.evaluate(()=>window.__oldDownloads)).length,1);
 await page.locator('.bottom-nav').getByRole('button',{name:'Browse'}).click();await page.getByLabel('More sources').selectOption('world');
 await page.getByRole('button',{name:'Open DonghuaWorld fixture'}).first().waitFor({timeout:10000});await noOverflow();
 await page.locator('.bottom-nav').getByRole('button',{name:'Library'}).click();assert.ok(await page.getByRole('button',{name:'AnimeSuge',exact:true}).isVisible());await noOverflow();
 assert.deepEqual(errors,[]);console.log('PASS multi-source UI: 6 Anime + 4 Donghua, 8 catalog/detail/player flows, batch server/quality queue, legacy data, folder setting, 320px.');
}finally{await browser.close()}
