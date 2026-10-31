// Simulated Android bridge + CSP UI regression. This is not a real Android WebView test.
// Run after npm run build: node tests/episode-updates-ui.mjs
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

const ROOT=resolve('dist');
const SHOTS=resolve(process.env.MOKU_TEST_SCREENSHOTS||`${tmpdir()}/moku-updates-ui`);await mkdir(SHOTS,{recursive:true});
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'";
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.ttf':'font/ttf','.svg':'image/svg+xml','.txt':'text/plain'};
const a={source:'sogo',url:'https://animesogo.to/watch/a',title:'A lovely anime',image:'',type:'TV'};
const b={source:'xin',url:'https://animexin.dev/anime/b/',title:'A second story',image:'',type:'Donghua'};
const c={source:'sogo',url:'https://animesogo.to/watch/c',title:'Only saved',image:'',type:'TV'};
const key=x=>`${x.source}|${x.url}`;
const seed={
 'moku.library.v1':JSON.stringify([a,b,c]),
 'moku.history.v1':JSON.stringify([{item:c,episode:{number:'1',url:c.url+'/ep-1',title:'Episode 1'},time:123456789}]),
 'moku.collections.v1':JSON.stringify([{id:'favourites',name:'Favourites',items:[key(a)]},{id:'weekend',name:'Weekend',items:[key(a),key(b)]}]),
 'moku.startup.v1':JSON.stringify({version:'0.8.0',status:'seen'}),
};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
async function setup(viewport={width:320,height:568},mobile=true){
 const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});
 await context.route('https://app.moku.local/**',async route=>{
  const u=new URL(route.request().url());if(u.pathname==='/api/image'){await route.fulfill({status:404});return;}
  const path=resolve(ROOT,'.'+(u.pathname==='/'?'/index.html':u.pathname));
  if(!path.startsWith(ROOT+'/')){await route.fulfill({status:403});return;}
  try{await route.fulfill({status:200,headers:{'Content-Type':types[extname(path)]||'application/octet-stream','Content-Security-Policy':csp},body:await readFile(path)});}catch{await route.fulfill({status:404})}
 });
 const page=await context.newPage(),errors=[];
 page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
 page.on('console',msg=>{if(msg.type()==='error'&&msg.text().includes('Content Security Policy'))errors.push(msg.text())});
 await page.addInitScript(({seed})=>{
  if(!localStorage.getItem('episode.test.seed')){for(const [k,v] of Object.entries(seed))localStorage.setItem(k,v);localStorage.setItem('episode.test.seed','1')}
  window.__syncs=[];window.__syncOpenFlags=[];window.__manualCalls=0;window.__permissionCalls=[];window.__openIntent=true;
  window.__mockUpdates={automatic:true,alerts:true,watchedCount:0,initializedCount:0,unreadCount:0,updates:[],errors:[],checking:false,queued:false,lastSuccess:0,notificationStatus:'permission',permissionAsked:false};
  const reply=(id,value)=>window.__mokuNativeChunk(id,typeof value==='string'?value:JSON.stringify(value),true,null);
  const signal=()=>setTimeout(()=>window.dispatchEvent(new Event('moku-updates-changed')),0);
  const count=()=>window.__mockUpdates.unreadCount=window.__mockUpdates.updates.filter(x=>!x.read).length;
  window.__addUpdate=(item,n)=>{const s=window.__mockUpdates;const id=String(n).repeat(64).slice(0,64);s.updates.unshift({id,titleId:`${item.source}|${item.url}`,item,episode:{number:String(n),title:`Episode ${n}`,url:item.url+`/ep-${n}`},discoveredAt:Date.now(),read:false});s.queued=false;s.lastSuccess=Date.now();count();signal()};
  window.MokuBridge={
   request(id){reply(id,'<html></html>')},downloads(id){reply(id,[])},exportSettings(id){reply(id,{configured:false,granted:false,name:''})},openExternal(){},openPlayer(){},
   syncEpisodeTitles(id,raw,onOpen){const titles=JSON.parse(raw);window.__syncs.push(titles);window.__syncOpenFlags.push(onOpen);const s=window.__mockUpdates,ids=new Set(titles.map(x=>`${x.source}|${x.url}`));s.watchedCount=titles.length;s.initializedCount=titles.length;s.updates=s.updates.filter(x=>ids.has(x.titleId));count();reply(id,s);signal()},
   episodeUpdates(id){reply(id,window.__mockUpdates)},
   checkEpisodes(id){window.__manualCalls++;window.__mockUpdates.queued=true;reply(id,window.__mockUpdates);signal()},
   setEpisodeAutomatic(id,on){window.__mockUpdates.automatic=on;reply(id,window.__mockUpdates);signal()},
   setEpisodeAlerts(id,on){window.__mockUpdates.alerts=on;reply(id,window.__mockUpdates);signal()},
   markEpisodeRead(id,updateId){for(const e of window.__mockUpdates.updates)if(updateId==='all'||updateId===e.id)e.read=true;count();reply(id,window.__mockUpdates);signal()},
   takeOpenUpdates(){const open=window.__openIntent;window.__openIntent=false;return open},
   episodeNotificationPermission(automatic){window.__permissionCalls.push(automatic);window.__mockUpdates.permissionAsked=true;if(!automatic)window.__mockUpdates.notificationStatus='allowed';signal()}
  };
 },{seed});
 return {context,page,errors};
}
const goto=page=>page.goto('https://app.moku.local/index.html',{waitUntil:'domcontentloaded'});
const noOverflow=async page=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');
try{
 const {context,page,errors}=await setup();await goto(page);
 await page.getByRole('heading',{name:/Welcome back/i}).waitFor();
 await page.getByRole('button',{name:'Continue to Mikozora'}).click();
 await page.locator('.updates-page').waitFor();
 await page.waitForFunction(()=>window.__syncs.at(-1)?.length===2);
 assert.deepEqual((await page.evaluate(()=>window.__syncs.at(-1))).map(x=>x.title),[a.title,b.title],'deduplicated collection members only');
 assert.deepEqual(await page.evaluate(()=>window.__syncOpenFlags),[true],'first snapshot requests an on-open check');
 assert.deepEqual(await page.evaluate(()=>window.__permissionCalls),[true],'notification permission asked once after the update screen');
 assert.ok(await page.getByText('2 titles being followed').isVisible());
 await noOverflow(page);
 const top=await page.locator('.topbar').boundingBox(),buttons=await page.locator('.top-actions > button').all();
 for(const button of buttons){if(await button.isVisible()){const box=await button.boundingBox();assert.ok(box.x>=top.x&&box.x+box.width<=top.x+top.width,'header action fits 320px');}}
 await page.screenshot({path:resolve(SHOTS,'updates-empty-mobile.png')});
 await page.getByRole('button',{name:'Check now'}).click();
 await page.waitForFunction(()=>window.__manualCalls===1);assert.ok(await page.getByText(/Check queued/).isVisible());
 await page.evaluate(item=>window.__addUpdate(item,3),a);
 await page.getByRole('button',{name:'Updates, 1 unread'}).waitFor();
 assert.ok(await page.getByText('Episode 3',{exact:false}).first().isVisible());
 await page.screenshot({path:resolve(SHOTS,'updates-new-mobile.png')});
 await page.locator('.bottom-nav button').filter({hasText:'Library'}).click();
 await page.getByRole('heading',{name:'Saved for later.'}).waitFor();
 assert.ok(await page.locator('.anime-card').filter({hasText:a.title}).getByLabel('1 new episode').isVisible(),'library cover badge');
 await page.getByRole('button',{name:'Updates, 1 unread'}).click();
 await page.getByRole('button',{name:'Mark all read'}).click();
 await page.waitForFunction(()=>window.__mockUpdates.unreadCount===0);
 assert.equal(await page.locator('.update-row').count(),1,'read updates remain visible');
 await page.evaluate(item=>window.__addUpdate(item,4),a);
 await page.getByRole('button',{name:'Updates, 1 unread'}).waitFor();
 await page.getByRole('button',{name:`Open ${a.title}, episode 4`}).click();
 await page.waitForFunction(()=>location.hash==='#detail'&&window.__mockUpdates.unreadCount===0);
 await page.locator('.bottom-nav button').filter({hasText:'Library'}).click();
 const card=page.locator('.anime-card').filter({hasText:a.title});
 await card.getByRole('button',{name:`Remove ${a.title} from Favourites`}).click();
 await page.waitForFunction(title=>window.__syncs.at(-1)?.some(x=>x.title===title),a.title);
 await page.getByRole('tab',{name:/Weekend/}).click();
 await page.getByRole('button',{name:'Add titles'}).click();
 await page.getByLabel(`Select ${a.title}`).uncheck();
 await page.getByRole('button',{name:'Save changes'}).click();
 await page.waitForFunction(title=>!window.__syncs.at(-1)?.some(x=>x.title===title),a.title);
 assert.deepEqual((await page.evaluate(()=>window.__syncs.at(-1))).map(x=>x.title),[b.title],'removing the last collection membership stops checking');
 assert.equal(await page.evaluate(()=>window.__syncOpenFlags.slice(1).every(x=>x===false)),true,'collection edits do not masquerade as new app opens');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('moku.library.v1')).length),3,'collection changes did not delete library titles');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('moku.history.v1')).length),1,'history preserved');
 await page.getByRole('button',{name:'Updates',exact:true}).click();
 await page.waitForFunction(()=>window.__mockUpdates.updates.length===0);
 await page.evaluate(item=>{window.__mockUpdates.errors=[{item,message:'Source returned HTTP 403',at:Date.now()}];window.dispatchEvent(new Event('moku-updates-changed'))},b);
 await page.getByText('Some sources couldn’t be checked').waitFor();
 assert.ok(await page.getByText('AnimeXin · Source returned HTTP 403').isVisible());
 await page.getByRole('button',{name:'Alert settings'}).click();
 const automatic=page.getByRole('button',{name:'Automatic episode checks'}),alerts=page.getByRole('button',{name:'Android episode alerts'});
 assert.equal(await automatic.getAttribute('aria-pressed'),'true');await automatic.click();assert.equal(await automatic.getAttribute('aria-pressed'),'false');
 await alerts.click();assert.equal(await alerts.getAttribute('aria-pressed'),'false');
 await alerts.click();assert.equal(await alerts.getAttribute('aria-pressed'),'true');
 assert.ok(await page.getByText('Android notification permission is needed').isVisible());
 await page.getByRole('button',{name:'Allow',exact:true}).click();await page.getByText('Allowed in Android').waitFor();
 assert.deepEqual(await page.evaluate(()=>window.__permissionCalls),[true,false]);
 await noOverflow(page);await page.screenshot({path:resolve(SHOTS,'settings-updates-mobile.png')});
 await page.evaluate(()=>{window.__openIntent=true;window.dispatchEvent(new Event('moku-open-updates'))});
 await page.locator('.updates-page').waitFor();assert.ok(await page.getByText(/Automatic checks are off/).isVisible());
 await page.getByRole('button',{name:'Check now'}).click();await page.waitForFunction(()=>window.__manualCalls===2);
 assert.deepEqual(errors,[]);await context.close();
 console.log('PASS simulated Android: silent baseline UX, deduplicated memberships, notification deep-link/permission, manual checks, updates/badges/read, removal, settings, failures and 320px layout.');
 const desktop=await setup({width:1440,height:900},false);await goto(desktop.page);await desktop.page.getByRole('button',{name:'Continue to Mikozora'}).click();await desktop.page.locator('.updates-page').waitFor();
 await desktop.page.evaluate(item=>window.__addUpdate(item,2),b);await desktop.page.getByText('Episode 2',{exact:false}).first().waitFor();await noOverflow(desktop.page);
 await desktop.page.screenshot({path:resolve(SHOTS,'updates-desktop.png')});assert.deepEqual(desktop.errors,[]);await desktop.context.close();
 console.log('PASS simulated desktop updates layout.');
}finally{await browser.close()}
