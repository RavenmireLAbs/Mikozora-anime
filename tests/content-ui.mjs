// Browse genre/year/content filters, age-rating chips and the global hide-NSFW
// setting, with the Android bridge and CSP simulated.
// Run after npm run build: node tests/content-ui.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { APP_VERSION, EXPERIENCE_KEY } from '../src/releases.js';
const ROOT=resolve('dist');
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'";
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.ttf':'font/ttf','.svg':'image/svg+xml','.txt':'text/plain'};
const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64');
const safeCard='<div class="item"><div class="type">TV</div><a class="poster" href="/watch/safe-show/ep-2"><img src="https://cdn.anipixcdn.co/safe.jpg"></a><div class="ep-status sub">2</div><div class="meta"><span>2024</span><span>PG-13</span><a href="/genre/action">Action</a></div><a class="name" href="/watch/safe-show/ep-2">Safe Show</a></div>';
const adultCard='<div class="item"><div class="type">TV</div><a class="poster" href="/watch/adult-show/ep-1"><img src="https://cdn.anipixcdn.co/adult.jpg"></a><div class="ep-status sub">1</div><div class="meta"><span>2024</span><span>18+</span><a href="/genre/ecchi">Ecchi</a></div><a class="name" href="/watch/adult-show/ep-1">Adult Show</a></div>';
const xinCard='<div class="postbody"><div class="listupd"><article class="bs"><a href="https://animexin.dev/calm-donghua/" title="Calm Donghua"><div class="typez">ONA</div><span class="sb">Sub</span><span class="epx">Ongoing</span><span class="rating">PG</span><img src="https://animexin.dev/calm.jpg"></a></article></div></div>';
function detail(id,title,genre,rating){
 return `<div id="watch-page" data-id="${id}"><div id="player"><div class="backdrop" style="background-image:url('https://cdn.anipixcdn.co/banner.jpg')"></div></div><section id="w-info"><div class="poster"><img src="https://cdn.anipixcdn.co/poster.jpg"></div><h1 class="title">${title}</h1><div class="bl-meta"><div class="meta"><div>Status: <span>Finished Airing</span></div><div>Date aired: <span>Jan 2, 2024</span></div><div>Episodes: <span>2</span></div><div>Rating: <span>${rating}</span></div><div>Type: <span>TV</span></div><div>Genres: <span><a href="/genre/${genre.toLowerCase()}">${genre}</a></span></div></div></div></section></div>`;
}
function fixture(raw){
 const u=new URL(raw);
 if(u.hostname==='animesogo.to'&&u.pathname==='/home')return `<div class="swiper-slide item" style="background-image:url('https://cdn.anipixcdn.co/hero.jpg')"><a href="/watch/safe-show"><div class="title">Safe Show</div><div class="genre">Action, Fantasy</div></a></div><div id="top-anime"><div class="tab-content" data-name="week"><a class="item" href="/watch/safe-show"><div class="poster"><span style="background-image:url('https://cdn.anipixcdn.co/safe.jpg')"></span></div><div class="name">Safe Show</div></a></div></div>`;
 if(u.hostname==='animesogo.to'&&u.pathname==='/genre/action')return `<div class="ani items">${safeCard}</div>`;
 if(u.hostname==='animesogo.to'&&(['/latest-updated','/filter'].includes(u.pathname)||u.pathname.startsWith('/status/')))return `<div class="ani items">${safeCard}${adultCard}</div>`;
 if(u.hostname==='animesogo.to'&&u.pathname==='/watch/safe-show')return detail(123,'Safe Show','Action','PG-13');
 if(u.hostname==='animesogo.to'&&u.pathname==='/watch/adult-show')return detail(456,'Adult Show','Ecchi','18+');
 if(u.hostname==='animesogo.to'&&['/ajax/episode/list/123','/ajax/episode/list/456'].includes(u.pathname))return JSON.stringify({status:200,result:'<ul class="episodes"><li><a data-num="1" data-ids="s1" data-sub="1">1</a></li></ul>'});
 if(u.hostname==='animexin.dev'&&u.pathname==='/')return `<ul class="wpop-weekly"><li><div class="ctr">1</div><div class="imgseries"><a class="series" href="https://animexin.dev/calm-donghua/"><img src="https://animexin.dev/calm.jpg" alt="Calm Donghua"></a></div><h4><a class="series" href="https://animexin.dev/calm-donghua/">Calm Donghua</a></h4></li></ul>${xinCard}`;
 if(u.hostname==='animexin.dev'&&u.pathname==='/anime/')return xinCard;
 if(u.hostname==='animexin.dev'&&u.pathname==='/calm-donghua/')return `<h1 class="entry-title">Calm Donghua</h1><div class="spe"><span><b>Status:</b> Ongoing</span></div><div class="eplister"><ul></ul></div>`;
 throw new Error('Unexpected request '+raw);
}
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
await context.route('https://app.moku.local/**',async route=>{
 const u=new URL(route.request().url());
 if(u.pathname==='/api/image'){await route.fulfill({status:200,contentType:'image/gif',body:gif});return;}
 const path=resolve(ROOT,'.'+(u.pathname==='/'?'/index.html':u.pathname));
 if(!path.startsWith(ROOT+'/')){await route.fulfill({status:403});return;}
 try{await route.fulfill({status:200,headers:{'Content-Type':types[extname(path)]||'application/octet-stream','Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff'},body:await readFile(path)})}catch{await route.fulfill({status:404,body:'not found'})}
});
const page=await context.newPage();
page.on('dialog',dialog=>dialog.accept());
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error'&&msg.text().includes('Content Security Policy'))errors.push(msg.text())});
await page.exposeBinding('__nativeFetch',async (_source,url)=>fixture(url));
await page.addInitScript(({ version, experienceKey })=>{
 if(!localStorage.getItem('moku.test.seeded')){
  localStorage.setItem(experienceKey,JSON.stringify({version,status:'seen'}));
  localStorage.setItem('moku.test.seeded','yes');
 }
 window.__requests=[];
 const reply=(id,value)=>window.__mokuNativeChunk(id,typeof value==='string'?value:JSON.stringify(value),true,null);
 window.MokuBridge={
  request(id,url){window.__requests.push(url);window.__nativeFetch(url).then(body=>reply(id,body)).catch(e=>window.__mokuNativeChunk(id,'',true,e.message));},
  downloads(id){reply(id,[])},exportSettings(id){reply(id,{configured:false,granted:false,name:''})},openPlayer(){},openExternal(){},openDownload(){},openExport(){}
 };
},{version:APP_VERSION,experienceKey:EXPERIENCE_KEY});
const storage=async key=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page must fit the mobile viewport');
const card=title=>page.locator('.anime-card').filter({hasText:title});
try{
 await page.goto('https://app.moku.local/index.html',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Trending now'}).waitFor();
 await page.locator('.bottom-nav').getByRole('button',{name:'Browse'}).click();
 await card('Safe Show').first().waitFor();await card('Adult Show').first().waitFor();
 // Every card shows its source age rating (or NR), on anime and donghua alike.
 assert.equal(await card('Safe Show').first().locator('.card-rating').innerText(),'PG-13');
 assert.equal(await card('Adult Show').first().locator('.card-rating').innerText(),'18+');
 assert.equal(await card('Calm Donghua').first().locator('.card-rating').innerText(),'PG');
 assert.match(await card('Safe Show').first().locator('.card-meta').innerText(),/2024/);
 await page.getByRole('button',{name:'Save Adult Show to library'}).click();
 assert.equal((await storage('moku.library.v1')).length,1);
 assert.equal((await storage('moku.library.v1'))[0].nsfw,true,'saved summaries keep the adult marking');

 // Genre uses the source's own genre listing.
 await page.getByRole('group',{name:'GENRE'}).getByRole('button',{name:'Action',exact:true}).click();
 await page.waitForFunction(()=>window.__requests.some(x=>x.includes('/genre/action')));
 await page.waitForFunction(()=>![...document.querySelectorAll('.anime-card')].some(x=>x.textContent.includes('Adult Show')));
 assert.ok(await card('Safe Show').first().isVisible());
 await page.getByRole('button',{name:'Clear filters'}).first().click();
 await card('Adult Show').first().waitFor();

 // Content filter: safe only hides adult-marked cards; NSFW only keeps just them.
 await page.getByRole('group',{name:'CONTENT'}).getByRole('button',{name:'Safe only'}).click();
 await page.locator('.results-label',{hasText:'HIDDEN BY FILTERS'}).waitFor();
 assert.equal(await card('Adult Show').count(),0);
 await page.getByRole('group',{name:'CONTENT'}).getByRole('button',{name:'NSFW only'}).click();
 await card('Adult Show').first().waitFor();
 assert.equal(await card('Safe Show').count(),0);
 await page.getByRole('button',{name:'Clear filters'}).first().click();
 await card('Safe Show').first().waitFor();

 // Year: a year both cards contradict leaves the honest empty state.
 await page.locator('.source-filter-row').getByRole('button',{name:'AnimeSogo',exact:true}).click();
 await page.waitForFunction(()=>![...document.querySelectorAll('.anime-card')].some(x=>x.textContent.includes('Calm Donghua')));
 assert.equal(await card('Calm Donghua').count(),0);await card('Safe Show').first().waitFor();
 await page.getByLabel('Filter by year').selectOption('2002');
 await page.getByRole('heading',{name:'No titles match these filters'}).waitFor();await noOverflow();
 await page.getByRole('button',{name:'Clear filters'}).first().click();
 await card('Safe Show').first().waitFor();

 // Detail facts carry the age rating too.
 await page.getByRole('button',{name:'Open Safe Show'}).first().click();
 const facts=page.getByLabel('Source details');await facts.waitFor();
 assert.match(await facts.innerText(),/AGE RATING\s*PG-13/);
 assert.equal(await page.locator('.rating-badge').innerText(),'PG-13');
 await page.goBack();await card('Adult Show').first().waitFor();
 await page.getByRole('button',{name:'Open Adult Show'}).first().click();
 await page.getByLabel('Source details').waitFor();
 assert.match(await page.getByLabel('Source details').innerText(),/AGE RATING\s*18\+/);
 assert.match(await page.getByLabel('Source details').innerText(),/Marked as adult/);

 // Turn NSFW completely off in Settings, then return: the title cannot be opened.
 await page.locator('.mobile-settings').click();
 await page.getByRole('button',{name:'Hide NSFW content'}).click();
 assert.equal(await page.getByRole('button',{name:'Hide NSFW content'}).getAttribute('aria-pressed'),'true');
 assert.deepEqual(await storage('moku.content.v1'),{hideNsfw:true});
 await page.goBack();
 await page.getByRole('heading',{name:'This title is hidden'}).waitFor();await noOverflow();
 await page.locator('.bottom-nav').getByRole('button',{name:'Browse'}).click();
 await card('Safe Show').first().waitFor();
 assert.equal(await card('Adult Show').count(),0,'adult titles disappear from Browse');
 assert.ok(await page.getByText('NSFW is turned off in Settings.').isVisible());
 await page.locator('.bottom-nav').getByRole('button',{name:'Discover'}).click();
 await page.getByRole('heading',{name:'Trending now'}).waitFor();
 assert.equal(await card('Adult Show').count(),0,'adult titles disappear from Discover rails');
 await page.locator('.bottom-nav').getByRole('button',{name:'Library'}).click();
 await page.getByRole('heading',{name:'Adult titles are hidden'}).waitFor();
 assert.equal((await storage('moku.library.v1')).length,1,'hiding never deletes saved titles');

 // Turning it back off restores everything.
 await page.locator('.mobile-settings').click();
 await page.getByRole('button',{name:'Hide NSFW content'}).click();
 assert.deepEqual(await storage('moku.content.v1'),{hideNsfw:false});
 await page.locator('.bottom-nav').getByRole('button',{name:'Library'}).click();
 await card('Adult Show').first().waitFor();
 assert.equal(await card('Adult Show').first().locator('.card-rating').innerText(),'18+');
 assert.deepEqual(errors,[],`UI / CSP errors: ${errors.join('; ')}`);

 await page.setViewportSize({width:1440,height:900});
 await page.locator('.side-nav').getByRole('button',{name:'Browse'}).click();
 await page.getByRole('group',{name:'GENRE'}).waitFor();await noOverflow();
 console.log('PASS content UI: age-rating chips, genre/year/content filters, detail ratings, global hide-NSFW across Browse/Discover/Library/detail, restore, mobile and desktop.');
} finally {await browser.close()}
