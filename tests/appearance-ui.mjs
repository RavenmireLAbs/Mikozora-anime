// Built UI, simulated Android bridge and production CSP; this is not a real WebView.
// Run after npm run build: node tests/appearance-ui.mjs
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {ACCENTS,APPEARANCE_KEY} from '../src/appearance.js';
import {APP_VERSION,EXPERIENCE_KEY} from '../src/releases.js';
const ROOT=resolve('dist'),SHOTS=resolve(process.env.MOKU_TEST_SCREENSHOTS||`${tmpdir()}/moku-appearance-ui`);await mkdir(SHOTS,{recursive:true});
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'";
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.ttf':'font/ttf','.svg':'image/svg+xml','.txt':'text/plain'};
const image='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><defs><linearGradient id="a"><stop stop-color="#c99aad"/><stop offset="1" stop-color="#4a718c"/></linearGradient></defs><path fill="url(#a)" d="M0 0h600v900H0z"/><circle fill="#ffa" cx="460" cy="130" r="95"/><path d="M0 700L150 300l120 220 150-340 180 380v340H0z" fill="#485b66"/></svg>';
const item={source:'sogo',url:'https://animesogo.to/watch/legacy-show',title:'Legacy Show',image:'https://cdn.anipixcdn.co/thumbnail/test.jpg',type:'TV',badge:'EP 2'};
const seed={
 'moku.library.v1':JSON.stringify([item]),
 'moku.history.v1':JSON.stringify([{item,episode:{number:'1',url:item.url+'/ep-1',title:'Episode 1'},time:123456789}]),
 'moku.collections.v1':JSON.stringify([{id:'favourites',name:'Favourites',items:[`sogo|${item.url}`]},{id:'weekend',name:'Weekend',items:[`sogo|${item.url}`]}]),
 [EXPERIENCE_KEY]:JSON.stringify({version:APP_VERSION,status:'seen'}),
};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
async function setup({viewport,mobile,extra={},oldRoot=null}={}){
 let assetRoot=oldRoot?resolve(oldRoot):ROOT;
 const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});
 await context.route('https://app.moku.local/**',async route=>{
  const u=new URL(route.request().url());if(u.pathname==='/api/image'){await route.fulfill({status:200,contentType:'image/svg+xml',body:image});return;}
  const path=resolve(assetRoot,'.'+(u.pathname==='/'?'/index.html':u.pathname));
  if(!path.startsWith(assetRoot+'/')){await route.fulfill({status:403});return;}
  try{await route.fulfill({status:200,headers:{'Content-Type':types[extname(path)]||'application/octet-stream','Content-Security-Policy':csp},body:await readFile(path)});}catch{await route.fulfill({status:404})}
 });
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&m.text().includes('Content Security Policy'))errors.push(m.text())});
 await page.addInitScript(({seed})=>{
  if(!localStorage.getItem('appearance.test.seed')){for(const [k,v] of Object.entries(seed))localStorage.setItem(k,v);localStorage.setItem('appearance.test.seed','1')}
  window.__appearances=[];
  window.__oldDownloads=[{id:'legacy',item:{source:'sogo',title:'Legacy Show'},episode:{number:'1',title:'Episode 1'},status:'completed',storageMode:'folder',exportUri:'content://folder/legacy.mp4'}];
  window.__mockUpdates={automatic:false,alerts:false,watchedCount:1,initializedCount:1,unreadCount:0,updates:[],errors:[],checking:false,queued:false,notificationStatus:'allowed'};
  const reply=(id,value)=>setTimeout(()=>window.__mokuNativeChunk(id,typeof value==='string'?value:JSON.stringify(value),true,null),0);
  const sogoCard='<div class="ani items"><div class="item"><div class="type">TV</div><a class="poster" href="/watch/legacy-show/ep-2"><img src="https://cdn.anipixcdn.co/thumbnail/test.jpg"></a><div class="ep-status sub">2</div><a class="name" href="/watch/legacy-show/ep-2">Legacy Show</a></div></div>';
  function fixture(raw){const u=new URL(raw);
   if(u.hostname==='animesogo.to'&&u.pathname==='/home')return `<div class="swiper-slide item" style="background-image:url('https://cdn.anipixcdn.co/thumbnail/hero.jpg')"><a href="/watch/legacy-show"><div class="title">Legacy Show</div><div class="genre">Action</div></a></div><div id="top-anime"><div class="tab-content" data-name="week"><a class="item" href="/watch/legacy-show"><div class="poster"><span style="background-image:url('https://cdn.anipixcdn.co/thumbnail/test.jpg')"></span></div><div class="name">Legacy Show</div></a></div></div>`;
   if(u.hostname==='animesogo.to'&&(['/latest-updated','/filter'].includes(u.pathname)||u.pathname.startsWith('/status/')))return sogoCard;
   if(u.hostname==='animesogo.to'&&u.pathname==='/watch/legacy-show')return `<div id="watch-page" data-id="123"><div id="player"><div class="backdrop" style="background-image:url('https://cdn.anipixcdn.co/thumbnail/test.jpg')"></div></div><section id="w-info"><div class="poster"><img src="https://cdn.anipixcdn.co/thumbnail/test.jpg"></div><h1 class="title">Legacy Show</h1><div class="bl-meta"><div class="meta"><div>Status: <span>Finished Airing</span></div><div>Date aired: <span>Oct 3, 2002</span></div><div>Episodes: <span>220</span></div><div>Type: <span>TV</span></div></div></div></section></div>`;
   if(u.hostname==='animesogo.to'&&u.pathname==='/ajax/episode/list/123')return JSON.stringify({status:200,result:'<ul class="episodes"><li><a data-num="1" data-ids="s1" data-sub="1">1</a></li><li><a data-num="2" data-ids="s2" data-sub="1">2</a></li></ul>'});
   return '<html></html>';
  }
  window.MokuBridge={
   request(id,url){reply(id,fixture(url))},downloads(id){reply(id,window.__oldDownloads)},exportSettings(id){reply(id,{configured:true,granted:true,name:'Anime folder'})},
   openPlayer(){},openExternal(){},openDownload(){},openExport(){},setAppearance(mode,accent){window.__appearances.push({mode,accent})},
   downloadOptions(id){reply(id,{servers:[{id:'s',label:'Server',qualities:[{id:'best',label:'Best'}]}],unavailable:0})},
   syncEpisodeTitles(id){reply(id,window.__mockUpdates)},episodeUpdates(id){reply(id,window.__mockUpdates)},checkEpisodes(id){reply(id,window.__mockUpdates)},
   setEpisodeAutomatic(id,value){window.__mockUpdates.automatic=value;reply(id,window.__mockUpdates)},setEpisodeAlerts(id,value){window.__mockUpdates.alerts=value;reply(id,window.__mockUpdates)},
   markEpisodeRead(id){reply(id,window.__mockUpdates)},takeOpenUpdates(){return false},episodeNotificationPermission(){}
  };
 },{seed:{...seed,...extra}});
 return {context,page,errors,upgrade:()=>{assetRoot=ROOT}};
}
const open=page=>page.goto('https://app.moku.local/index.html',{waitUntil:'domcontentloaded'});
const noOverflow=async page=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page must fit the viewport');
const getTheme=async page=>page.evaluate(key=>{let stored=null;try{stored=JSON.parse(localStorage.getItem(key)||'null')}catch{}return {mode:document.documentElement.dataset.mode,accent:document.documentElement.dataset.accent,themed:document.documentElement.dataset.themed||'',stored,native:window.__appearances.at(-1),meta:document.querySelector('meta[name="theme-color"]').content}},APPEARANCE_KEY);
// Composite CSS background colors from the element to the root and compute WCAG contrast.
const contrast=async(page,selector)=>page.locator(selector).first().evaluate(element=>{
 function rgba(v){const m=v.match(/[\d.]+/g);return m?[+m[0],+m[1],+m[2],m[3]===undefined?1:+m[3]]:[0,0,0,0]}
 function blend(f,b){return [f[0]*f[3]+b[0]*(1-f[3]),f[1]*f[3]+b[1]*(1-f[3]),f[2]*f[3]+b[2]*(1-f[3]),1]}
 function lum(c){let rgb=c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]}
 let colors=[];for(let x=element;x;x=x.parentElement)colors.push(rgba(getComputedStyle(x).backgroundColor));
 let bg=[255,255,255,1];for(let i=colors.length-1;i>=0;i--)bg=blend(colors[i],bg);
 let fg=blend(rgba(getComputedStyle(element).color),bg),a=lum(fg),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
});
async function checkContrast(page,selectors){for(const selector of selectors){const value=await contrast(page,selector);assert.ok(value>=4.5,`${selector} contrast ${value.toFixed(2)} should be at least 4.5:1`)}}
const settings=async(page,mobile)=>mobile?page.locator('.mobile-settings').click():page.locator('.sidebar').getByRole('button',{name:'Settings',exact:true}).click();
const nav=async(page,mobile,name)=>page.locator(mobile?'.bottom-nav':'.sidebar').getByRole('button',{name:name==='Sources'&&!mobile?/^Sources/:name,exact:!(name==='Sources'&&!mobile)}).click();
try{
 for(const config of [{viewport:{width:320,height:568},mobile:true},{viewport:{width:1280,height:900},mobile:false}]){
  const {context,page,errors}=await setup(config);await open(page);await settings(page,config.mobile);
  let value=await getTheme(page);assert.deepEqual(value.native,{mode:'dark',accent:'green'});assert.equal(value.mode,'dark');assert.equal(value.accent,'green');assert.equal(value.themed,'');
  assert.equal(await page.getByRole('button',{name:'Dark mode'}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByRole('button',{name:'Green accent'}).getAttribute('aria-pressed'),'true');
  for(const mode of ['dark','light']){
   await page.getByRole('button',{name:`${mode==='dark'?'Dark':'Light'} mode`}).click();
   for(const accent of ACCENTS){
    const button=page.getByRole('button',{name:`${accent.label} accent`});await button.click();
    value=await getTheme(page);assert.deepEqual(value.stored,{mode,accent:accent.id});assert.deepEqual(value.native,value.stored);
    assert.equal(value.mode,mode);assert.equal(value.accent,accent.id);assert.equal(value.themed,mode==='dark'&&accent.id==='green'?'':'true');
    assert.equal(value.meta,mode==='dark'?accent.bgDark:accent.bgLight);assert.equal(await button.getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.appearance-color[aria-pressed=true]').count(),1);assert.equal(await page.locator('.appearance-mode[aria-pressed=true]').count(),1);
    await noOverflow(page);
    await checkContrast(page,['.appearance-intro strong','.appearance-intro p','.appearance-mode.selected .mode-copy strong','.appearance-mode.selected .mode-copy small','.appearance-field legend','.appearance-color.selected','.settings-title','.setting-row strong','.setting-row p']);
    const boxes=await page.locator('.appearance-colors button').evaluateAll(buttons=>buttons.map(b=>{let r=b.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}}));
    assert.ok(boxes.every(b=>b.left>=0&&b.right<=config.viewport.width&&b.width>=35),'all five accent controls fit');
    if(config.mobile){
     await nav(page,true,'Library');await page.getByRole('heading',{name:'Saved for later.'}).waitFor();
     await checkContrast(page,['.card-title','.card-meta']);await noOverflow(page);
     await page.getByRole('button',{name:'Open Legacy Show'}).first().click();await page.locator('.episode-row').first().waitFor();
     await checkContrast(page,['.detail-copy h1','.detail-copy .genre-line','.detail-actions .btn.primary','.detail-facts strong']);await noOverflow(page);
     if(mode==='light'){
      const pos=await page.evaluate(()=>({bottom:document.querySelector('.detail-banner').getBoundingClientRect().bottom,top:document.querySelector('.detail-copy').getBoundingClientRect().top}));
      assert.ok(pos.top>=pos.bottom-1,'light-mode detail text stays below dark banner');
     }
     await page.getByRole('button',{name:'Download episode 1'}).click();await page.locator('.download-modal').waitFor();
     await checkContrast(page,['.download-modal h2','.download-dialog-actions .btn.primary','.download-explainer p']);await noOverflow(page);
     await page.getByRole('button',{name:'Cancel',exact:true}).click();
     await nav(page,true,'Downloads');await page.locator('.download-card').waitFor();
     await checkContrast(page,['.download-card h3','.download-card-main>p','.download-card-actions .btn.primary']);await noOverflow(page);
     await nav(page,true,'Sources');await page.locator('.source-card').first().waitFor();
     await checkContrast(page,['.source-symbol','.source-card h2','.source-card p']);await noOverflow(page);
     await page.locator('.updates-button').click();await page.locator('.updates-page').waitFor();
     await checkContrast(page,['.updates-page h1','.updates-page .page-heading p']);await noOverflow(page);
     await settings(page,true);
    }
   }
  }
  // Keyboard activation does not depend on color recognition or pointer access.
  await page.getByRole('button',{name:'Purple accent'}).focus();await page.keyboard.press('Space');
  assert.deepEqual((await getTheme(page)).stored,{mode:'light',accent:'purple'});
  await page.screenshot({path:resolve(SHOTS,`${config.mobile?'mobile':'desktop'}-light-purple.png`)});
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('.app-shell').waitFor();value=await getTheme(page);
  assert.equal(value.mode,'light');assert.equal(value.accent,'purple');assert.deepEqual(value.native,{mode:'light',accent:'purple'});
  // Theme persists while navigating all major screens, including dialogs and release notes.
  await nav(page,config.mobile,'Discover');await page.locator('.hero').waitFor();await noOverflow(page);
  assert.equal(await page.locator('.cover-img img').first().evaluate(el=>getComputedStyle(el).filter),'none','artwork is not color-filtered');
  await page.screenshot({path:resolve(SHOTS,`${config.mobile?'mobile':'desktop'}-light-home.png`)});
  await nav(page,config.mobile,'Browse');await page.getByRole('heading',{name:/Find your next favorite/}).waitFor();await noOverflow(page);
  await nav(page,config.mobile,'Library');await page.getByRole('heading',{name:'Saved for later.'}).waitFor();await noOverflow(page);
  await page.getByRole('button',{name:'Open Legacy Show'}).first().click();await page.locator('.episode-row').first().waitFor();await noOverflow(page);
  const positions=await page.evaluate(()=>({bottom:document.querySelector('.detail-banner').getBoundingClientRect().bottom,top:document.querySelector('.detail-copy').getBoundingClientRect().top}));
  assert.ok(positions.top>=positions.bottom-1,'dark detail artwork never sits behind light-mode text');
  await checkContrast(page,['.detail-copy h1','.detail-copy .genre-line','.detail-actions .btn.primary','.detail-facts strong']);
  await page.getByRole('button',{name:'Download episode 1'}).click();await page.locator('.download-modal').waitFor();await noOverflow(page);
  await checkContrast(page,['.download-modal h2','.download-dialog-actions .btn.primary','.download-explainer p']);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await nav(page,config.mobile,'History');await noOverflow(page);
  await nav(page,config.mobile,'Downloads');await page.locator('.download-card').waitFor();await noOverflow(page);
  await nav(page,config.mobile,'Sources');await page.locator('.source-card').first().waitFor();await noOverflow(page);
  await checkContrast(page,['.source-symbol','.source-card h2','.source-card p']);
  await page.locator('.updates-button').click();await page.locator('.updates-page').waitFor();await noOverflow(page);
  await settings(page,config.mobile);await page.locator('.setting-row').filter({hasText:'What’s new'}).getByRole('button',{name:'View'}).click();
  await page.getByRole('button',{name:'Back to settings'}).waitFor();await noOverflow(page);
  assert.equal((await getTheme(page)).mode,'light');assert.equal((await getTheme(page)).accent,'purple');
  await page.getByRole('button',{name:'Back to settings'}).click();
  for(const key of ['moku.library.v1','moku.history.v1','moku.collections.v1'])assert.deepEqual(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key),JSON.parse(seed[key]),`${key} remains intact`);
  assert.equal(await page.evaluate(()=>window.__oldDownloads.length),1);assert.equal(await page.evaluate(()=>window.__mockUpdates.automatic),false);assert.equal(await page.evaluate(()=>window.__mockUpdates.alerts),false);
  assert.deepEqual(errors,[]);await context.close();
 }
 // Corrupt and partly invalid saved values cannot prevent startup.
 for(const raw of ['{bad',JSON.stringify({mode:'light',accent:'not-a-color'})]){
  const {context,page,errors}=await setup({viewport:{width:320,height:568},mobile:true,extra:{[APPEARANCE_KEY]:raw}});await open(page);await settings(page,true);
  const state=await getTheme(page);assert.equal(state.accent,'green');assert.equal(state.mode,raw==='{bad'?'dark':'light');assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS appearance UI: all 10 combinations, immediate native bridge + storage, keyboard, restart, desktop/320px, contrast, artwork, navigation, dialogs, release notes and preserved user data under production CSP.');
}finally{await browser.close()}
