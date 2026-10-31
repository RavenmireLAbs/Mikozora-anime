// Deterministic mobile + desktop UI/upgrade checks with the Android bridge and CSP simulated.
// Run after npm run build: node tests/collections-ui.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { APP_VERSION, EXPERIENCE_KEY } from '../src/releases.js';
const ROOT=resolve('dist');
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'";
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.ttf':'font/ttf','.svg':'image/svg+xml','.txt':'text/plain'};
const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64');
const sogoCard='<div class="ani items"><div class="item"><div class="type">TV</div><a class="poster" href="/watch/legacy-show/ep-2"><img src="https://cdn.anipixcdn.co/thumbnail/test.jpg"></a><div class="ep-status sub">2</div><a class="name" href="/watch/legacy-show/ep-2">Legacy Show</a></div></div>';
const xinCard='<div class="postbody"><div class="listupd"><article class="bs"><a href="https://animexin.dev/old-donghua/" title="Old Donghua"><div class="typez">ONA</div><span class="sb">Sub</span><span class="epx">Ongoing</span><img src="https://animexin.dev/old.jpg"></a></article></div></div>';
function fixture(raw){
 const u=new URL(raw);
 if(u.hostname==='animesogo.to'&&u.pathname==='/home')return `<div class="swiper-slide item" style="background-image:url('https://cdn.anipixcdn.co/thumbnail/hero.jpg')"><a href="/watch/legacy-show"><div class="title">Legacy Show</div><div class="genre">Action</div></a></div><div id="top-anime"><div class="tab-content" data-name="week"><a class="item" href="/watch/legacy-show"><div class="poster"><span style="background-image:url('https://cdn.anipixcdn.co/thumbnail/test.jpg')"></span></div><div class="name">Legacy Show</div></a></div></div>`;
 if(u.hostname==='animesogo.to'&&(['/latest-updated','/filter'].includes(u.pathname)||u.pathname.startsWith('/status/')))return sogoCard;
 if(u.hostname==='animesogo.to'&&u.pathname==='/watch/legacy-show')return `<div id="watch-page" data-id="123"><div id="player"><div class="backdrop" style="background-image:url('https://cdn.anipixcdn.co/thumbnail/test.jpg')"></div></div><section id="w-info"><div class="poster"><img src="https://cdn.anipixcdn.co/thumbnail/test.jpg"></div><h1 class="title">Legacy Show</h1><div class="bl-meta"><div class="meta"><div>Status: <span>Finished Airing</span></div><div>Date aired: <span>Oct 3, 2002 to Feb 8, 2007</span></div><div>Episodes: <span>220</span></div><div>Type: <span>TV</span></div></div></div></section></div>`;
 if(u.hostname==='animesogo.to'&&u.pathname==='/ajax/episode/list/123')return JSON.stringify({status:200,result:'<ul class="episodes"><li><a data-num="1" data-ids="s1" data-sub="1">1</a></li></ul>'});
 if(u.hostname==='animexin.dev'&&u.pathname==='/')return `<ul class="wpop-weekly"><li><div class="ctr">1</div><div class="imgseries"><a class="series" href="https://animexin.dev/popular-title/"><img src="https://animexin.dev/popular.jpg" alt="Popular Title"></a></div><h4><a class="series" href="https://animexin.dev/popular-title/">Popular Title</a></h4></li></ul>${xinCard}`;
 if(u.hostname==='animexin.dev'&&u.pathname==='/anime/')return xinCard;
 if(u.hostname==='animexin.dev'&&u.pathname==='/popular-title/')return `<h1 class="entry-title">Popular Title</h1><div class="thumbook"><div class="thumb"><img src="https://animexin.dev/popular.jpg"></div></div><div class="spe"><span><b>Status:</b> Ongoing</span><span><b>Released:</b> Jun 24, 2023</span><span><b>Episodes:</b> 182</span><span><b>Type:</b> ONA</span></div><div class="eplister"><ul><li><a href="https://animexin.dev/popular-title-episode-1/"><div class="epl-num">1</div><div class="epl-title">Episode 1</div></a></li></ul></div>`;
 if(u.hostname==='animexin.dev'&&u.pathname==='/old-donghua/')return `<h1 class="entry-title">Old Donghua</h1><div class="spe"><span><b>Status:</b> Completed</span></div><div class="eplister"><ul></ul></div>`;
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
let acceptDelete=true;page.on('dialog',dialog=>acceptDelete?dialog.accept():dialog.dismiss());
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error'&&msg.text().includes('Content Security Policy'))errors.push(msg.text())});
await page.exposeBinding('__nativeFetch',async (_source,url)=>fixture(url));
await page.addInitScript(({ version, experienceKey })=>{
 if(!localStorage.getItem('moku.test.seeded')){
  localStorage.setItem(experienceKey,JSON.stringify({version,status:'seen'}));
  const legacy=[{source:'sogo',url:'https://animesogo.to/watch/legacy-show',title:'Legacy Show',image:'https://cdn.anipixcdn.co/thumbnail/test.jpg',type:'TV',badge:'EP 2',status:''},{source:'xin',url:'https://animexin.dev/old-donghua/',title:'Old Donghua',image:'https://animexin.dev/old.jpg',type:'ONA',badge:'Sub',status:'Completed'}];
  const history=[{item:legacy[0],episode:{number:'1',url:'https://animesogo.to/watch/legacy-show/ep-1',title:'Episode 1'},time:123456789}];
  localStorage.setItem('moku.library.v1',JSON.stringify(legacy));localStorage.setItem('moku.history.v1',JSON.stringify(history));localStorage.setItem('moku.test.seeded','yes');
 }
 window.__requests=[];window.__downloads=[{id:'old-download',item:{source:'sogo',title:'Legacy Show'},episode:{number:'1',title:'Episode 1'},status:'completed',storageMode:'folder',exportUri:'content://folder/legacy.mp4'}];
 const reply=(id,value)=>window.__mokuNativeChunk(id,typeof value==='string'?value:JSON.stringify(value),true,null);
 window.MokuBridge={
  request(id,url){window.__requests.push(url);window.__nativeFetch(url).then(body=>reply(id,body)).catch(e=>window.__mokuNativeChunk(id,'',true,e.message));},
  downloads(id){reply(id,window.__downloads)},exportSettings(id){reply(id,{configured:true,granted:true,name:'Anime folder'})},openPlayer(){},openExternal(){},openDownload(){},openExport(){}
 };
},{version:APP_VERSION,experienceKey:EXPERIENCE_KEY});
const storage=async key=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page must fit the mobile viewport');
try{
 await page.goto('https://app.moku.local/index.html',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Trending now'}).waitFor();
 await page.locator('.trending-card').first().waitFor();
 assert.equal(await page.locator('.trending-card').count(),1);
 assert.ok(await page.getByRole('heading',{name:'Discover anime'}).isVisible());
 assert.ok(await page.getByRole('heading',{name:'Discover donghua'}).isVisible());
 assert.equal((await storage('moku.library.v1')).length,2);
 assert.deepEqual((await storage('moku.collections.v1'))[0].items,[],'old saved titles are not silently marked as favourites');
 await page.getByRole('button',{name:/Open Legacy Show, number 1/}).click();
 await page.getByLabel('Source details').waitFor();const sogoFacts=await page.getByLabel('Source details').innerText();
 assert.match(sogoFacts,/Completed/);assert.match(sogoFacts,/Source: Finished Airing/);assert.match(sogoFacts,/Oct 3, 2002 to Feb 8, 2007/);assert.match(sogoFacts,/220/);
 await page.goBack();await page.getByRole('heading',{name:'Trending now'}).waitFor();
 await page.getByRole('tab',{name:'Donghua · AnimeXin'}).click();
 await page.getByRole('button',{name:/Open Popular Title, number 1/}).click();
 await page.getByRole('heading',{name:'Popular Title'}).waitFor();
 const facts=page.getByLabel('Source details');await facts.waitFor();
 assert.match(await facts.innerText(),/Ongoing/);assert.match(await facts.innerText(),/Jun 24, 2023/);assert.match(await facts.innerText(),/182/);
 await page.getByRole('button',{name:'Organize Popular Title in collections'}).click();
 await page.getByLabel('Favourites',{exact:true}).check();await page.getByRole('button',{name:'Save changes'}).click();
 assert.equal((await storage('moku.library.v1')).length,3,'choosing a collection saves a new title');
 assert.deepEqual((await storage('moku.collections.v1'))[0].items,['xin|https://animexin.dev/popular-title/']);
 await page.locator('.bottom-nav').getByRole('button',{name:'Library'}).click();
 assert.equal(await page.locator('.anime-card').count(),3);
 await page.getByRole('button',{name:'Add Legacy Show to Favourites'}).click();
 assert.equal((await storage('moku.collections.v1'))[0].items.length,2);
 await page.getByRole('button',{name:'New collection'}).click();
 await page.getByLabel('COLLECTION NAME').fill('Favourites');await page.getByRole('button',{name:'Create collection'}).click();
 assert.match(await page.getByRole('alert').innerText(),/already exists/i);
 await page.getByLabel('COLLECTION NAME').fill('Weekend watches');await page.getByRole('button',{name:'Create collection'}).click();
 assert.ok(await page.getByRole('tab',{name:/Weekend watches/}).getAttribute('aria-selected')==='true');
 await page.getByRole('button',{name:'Add titles',exact:true}).click();
 await page.getByLabel('Select Legacy Show').check();await page.getByLabel('Select Old Donghua').check();
 await page.getByRole('button',{name:'Save changes'}).click();
 assert.equal(await page.locator('.anime-card').count(),2);await noOverflow();
 let collections=await storage('moku.collections.v1');let custom=collections.find(x=>x.name==='Weekend watches');assert.equal(custom.items.length,2);
 assert.equal((await storage('moku.library.v1')).length,3);assert.equal((await storage('moku.history.v1')).length,1);assert.equal((await page.evaluate(()=>window.__downloads)).length,1);
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('.bottom-nav').getByRole('button',{name:'Library'}).click();
 await page.getByRole('tab',{name:/Weekend watches/}).click();assert.equal(await page.locator('.anime-card').count(),2);
 assert.equal((await storage('moku.collections.v1')).find(x=>x.id===custom.id).items.length,2,'collection survives a restart');
 await page.getByRole('button',{name:'Rename Weekend watches'}).click();await page.getByLabel('COLLECTION NAME').fill('Action nights');await page.getByRole('button',{name:'Save name'}).click();
 assert.ok(await page.getByRole('tab',{name:/Action nights/}).isVisible());
 acceptDelete=false;await page.getByRole('button',{name:'Delete Action nights'}).click();assert.ok(await page.getByRole('tab',{name:/Action nights/}).isVisible(),'cancel keeps the collection');
 acceptDelete=true;await page.getByRole('button',{name:'Delete Action nights'}).click();assert.equal(await page.getByRole('tab',{name:/Action nights/}).count(),0);
 assert.equal((await storage('moku.library.v1')).length,3,'deleting a collection does not remove saved titles');
 assert.equal((await storage('moku.history.v1')).length,1);assert.equal((await page.evaluate(()=>window.__downloads)).length,1);
 await page.getByRole('tab',{name:/Favourites/}).click();assert.equal(await page.locator('.anime-card').count(),2);
 await page.getByRole('button',{name:'Remove Legacy Show from Favourites'}).click();assert.equal(await page.locator('.anime-card').count(),1);
 assert.equal((await storage('moku.library.v1')).length,3,'removing a favourite does not remove the saved title');
 await page.getByRole('button',{name:'New collection'}).click();assert.ok(await page.getByRole('dialog').isVisible());
 assert.equal(await page.evaluate(()=>window.__handleAndroidBack()),true);await page.getByRole('dialog').waitFor({state:'detached'});assert.equal(await page.getByRole('dialog').count(),0,'Android back closes a collection dialog');
 await page.setViewportSize({width:320,height:780});await noOverflow();
 await page.getByRole('button',{name:'New collection'}).click();await noOverflow();await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.locator('.bottom-nav').getByRole('button',{name:'Browse'}).click();
 await page.getByRole('button',{name:'AnimeSogo',exact:true}).click();await page.getByRole('button',{name:'Completed',exact:true}).click();
 await page.waitForFunction(()=>window.__requests.some(x=>x.includes('/status/finished-airing')));
 await page.getByRole('button',{name:'AnimeXin',exact:true}).click();await page.getByRole('button',{name:'Ongoing',exact:true}).click();
 await page.waitForFunction(()=>window.__requests.some(x=>x.includes('status=ongoing')));
 await page.getByLabel('Search titles').fill('Soul');await page.locator('.browse-search button').click();
 assert.ok(await page.getByRole('button',{name:/Clear search to filter by status/}).isVisible());await noOverflow();
 assert.deepEqual(errors,[],`UI / CSP errors: ${errors.join('; ')}`);
 // Desktop layout also remains usable with an existing saved library.
 await page.setViewportSize({width:1440,height:900});await page.locator('.side-nav').getByRole('button',{name:'Library'}).click();
 await page.getByRole('tab',{name:/All titles/}).click();assert.equal(await page.locator('.anime-card').count(),3);await noOverflow();
 await page.getByRole('button',{name:'Remove Popular Title from library'}).click();
 assert.equal((await storage('moku.library.v1')).length,2);assert.deepEqual((await storage('moku.collections.v1'))[0].items,[]);
 assert.equal((await storage('moku.history.v1')).length,1);assert.equal((await page.evaluate(()=>window.__downloads)).length,1,'removing a saved title does not remove its downloads');
 console.log('PASS collections/discovery UI: migration, source rankings, metadata, filters, Favourites, create/edit/delete, cancel, reload, Android back, downloads/history preservation, mobile 320px and desktop.');
} finally {await browser.close()}
