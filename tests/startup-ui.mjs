// Simulated Android WebView/CSP tests for the startup intro and per-version changelog.
// Run after npm run build: node tests/startup-ui.mjs
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { APP_VERSION, EXPERIENCE_KEY } from '../src/releases.js';

const ROOT=resolve('dist');
const SCREENSHOTS=resolve(process.env.MOKU_TEST_SCREENSHOTS || `${tmpdir()}/moku-startup-ui`);
await mkdir(SCREENSHOTS,{recursive:true});
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'";
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.ttf':'font/ttf','.svg':'image/svg+xml','.txt':'text/plain'};
const oldTitle={source:'sogo',url:'https://animesogo.to/watch/old-title',title:'Old title',image:'',type:'TV'};
const legacy={
 'moku.library.v1':JSON.stringify([oldTitle]),
 'moku.history.v1':JSON.stringify([{item:oldTitle,episode:{number:'1',url:'https://animesogo.to/watch/old-title/ep-1',title:'Episode 1'},time:123456789}]),
 'moku.collections.v1':JSON.stringify([{id:'favourites',name:'Favourites',items:['sogo|https://animesogo.to/watch/old-title']},{id:'collection-weekend',name:'Weekend',items:['sogo|https://animesogo.to/watch/old-title']}]),
};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
async function setup({seed={},viewport={width:320,height:568},mobile=true,root=ROOT}={}){
 let assetRoot=resolve(root);
 const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});
 await context.route('https://app.moku.local/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/api/image'){await route.fulfill({status:404});return;}
  const path=resolve(assetRoot,'.'+(u.pathname==='/'?'/index.html':u.pathname));
  if(!path.startsWith(assetRoot+'/')){await route.fulfill({status:403});return;}
  try{await route.fulfill({status:200,headers:{'Content-Type':types[extname(path)]||'application/octet-stream','Content-Security-Policy':csp},body:await readFile(path)});}catch{await route.fulfill({status:404})}
 });
 const page=await context.newPage(), errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error'&&msg.text().includes('Content Security Policy'))errors.push(msg.text());});
 await page.addInitScript(({seed})=>{
  if(!localStorage.getItem('startup.test.seed')){
   for(const [key,value] of Object.entries(seed))localStorage.setItem(key,value);
   localStorage.setItem('startup.test.seed','1');
  }
  window.__sourceRequests=[];window.__downloads=[{id:'old-download',item:{title:'Old title',source:'sogo'},episode:{number:'1'},status:'completed',storageMode:'folder'}];
  const reply=(id,value)=>window.__mokuNativeChunk(id,typeof value==='string'?value:JSON.stringify(value),true,null);
  window.MokuBridge={request(id,url){window.__sourceRequests.push(url);reply(id,'<html></html>');},downloads(id){reply(id,window.__downloads)},exportSettings(id){reply(id,{configured:true,granted:true,name:'My anime folder'})},openPlayer(){},openExternal(){},openDownload(){},openExport(){}};
 },{seed});
 return {context,page,errors,upgrade:()=>{assetRoot=ROOT;}};
}
const go=page=>page.goto('https://app.moku.local/index.html',{waitUntil:'domcontentloaded'});
const record=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),EXPERIENCE_KEY);
const noOverflow=async page=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');
try{
 // New installation: welcome is not marked seen until the user actually leaves it.
 {
  const {context,page,errors}=await setup();await go(page);
  await page.getByRole('heading',{name:/Welcome to your space/i}).waitFor();
  assert.ok(await page.getByRole('heading',{name:/What’s new/i}).isVisible());
  assert.ok(await page.getByText('A little welcome',{exact:true}).isVisible());
  assert.equal((await record(page)).status,'pending');
  assert.equal(await page.evaluate(()=>window.__sourceRequests.length),0,'intro is available before source requests');
  await noOverflow(page);
  const cta=await page.getByRole('button',{name:'Get started'}).boundingBox();
  assert.ok(cta.y>=0&&cta.y+cta.height<=568,'mobile continue action remains visible without scrolling');
  await page.screenshot({path:resolve(SCREENSHOTS,'welcome-mobile.png')});
  await page.getByRole('button',{name:'Jump to release notes'}).click();
  await page.waitForFunction(()=>{const r=document.querySelector('#release-title').getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight-95});
  const ctaAfterJump=await page.getByRole('button',{name:'Get started'}).boundingBox();
  assert.ok(ctaAfterJump.y>=0&&ctaAfterJump.y+ctaAfterJump.height<=568,'continue action stays visible after scrolling');
  assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('button')?.textContent.trim(),{x:ctaAfterJump.x+ctaAfterJump.width/2,y:ctaAfterJump.y+ctaAfterJump.height/2}),'Get started','continue action is not clipped after scrolling');
  await page.screenshot({path:resolve(SCREENSHOTS,'welcome-mobile-changelog.png')});
  await page.waitForFunction(()=>localStorage.getItem('moku.library.v1')!==null);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:/Welcome to your space/i}).waitFor();
  assert.equal((await record(page)).mode,'intro','interrupted welcome remains a welcome');
  await page.getByRole('button',{name:'Get started'}).click();
  await page.locator('.app-shell').waitFor();assert.equal((await record(page)).status,'seen');
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('.app-shell').waitFor();
  assert.equal(await page.locator('.intro-screen').count(),0,'no repeat on same version');
  // Settings can open the changelog manually without changing the startup marker.
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const notes=page.locator('.setting-row').filter({hasText:'What’s new'});
  await notes.getByRole('button',{name:'View'}).click();
  await page.getByRole('button',{name:'Back to settings'}).waitFor();
  assert.equal((await record(page)).status,'seen');
  await page.getByRole('button',{name:'Back to settings'}).click();
  assert.ok(await page.getByRole('heading',{name:'Your space, your way.'}).isVisible());
  assert.deepEqual(errors,[]);await context.close();
 }
 // Existing users from v0.7 have legacy storage but no startup marker.
 {
  const {context,page,errors}=await setup({seed:legacy});await go(page);
  await page.getByRole('heading',{name:/Welcome back/i}).waitFor();
  assert.equal((await record(page)).mode,'update');
  const releaseHeading=await page.locator('#release-title').boundingBox();
  assert.ok(releaseHeading.y<568-95,'update notes are visible above the fixed action at startup');
  await page.screenshot({path:resolve(SCREENSHOTS,'update-mobile.png')});await noOverflow(page);
  for(const [key,value] of Object.entries(legacy))assert.deepEqual(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key),JSON.parse(value),key+' remains intact');
  await page.waitForFunction(()=>typeof window.__handleAndroidBack==='function');
  assert.equal(await page.evaluate(()=>window.__handleAndroidBack()),true,'Android back dismisses notes');
  await page.locator('.app-shell').waitFor();assert.equal((await record(page)).status,'seen');
  assert.equal((await page.evaluate(()=>window.__downloads)).length,1,'existing native downloads are untouched');
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('.app-shell').waitFor();
  assert.equal(await page.locator('.intro-screen').count(),0);
  for(const [key,value] of Object.entries(legacy))assert.deepEqual(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key),JSON.parse(value),key+' survives reload');
  assert.deepEqual(errors,[]);await context.close();
 }
 // An older acknowledged version triggers exactly one update screen on desktop.
 {
  const oldMarker=JSON.stringify({version:'0.7.0',status:'seen'});
  const {context,page,errors}=await setup({seed:{...legacy,[EXPERIENCE_KEY]:oldMarker},viewport:{width:1440,height:900},mobile:false});
  await go(page);await page.getByRole('heading',{name:/Welcome back/i}).waitFor();
  assert.equal((await record(page)).version,APP_VERSION);assert.equal((await record(page)).status,'pending');
  await page.screenshot({path:resolve(SCREENSHOTS,'update-desktop.png')});await noOverflow(page);
  await page.getByRole('button',{name:'Continue to Moku'}).click();
  await page.locator('.app-shell').waitFor();await page.reload({waitUntil:'domcontentloaded'});await page.locator('.app-shell').waitFor();
  assert.equal(await page.locator('.intro-screen').count(),0);assert.deepEqual(errors,[]);await context.close();
 }
 if(process.env.MOKU_OLD_WEB_DIR){
  // Load the actual previous APK's bundled UI, then serve the new build on the
  // same origin, preserving the browser's real localStorage across the swap.
  const oldVersion=process.env.MOKU_OLD_STARTUP_VERSION;
  const marker=oldVersion?JSON.stringify({version:oldVersion,status:'seen'}):null;
  const {context,page,errors,upgrade}=await setup({seed:{...legacy,...(marker?{[EXPERIENCE_KEY]:marker}:{})},root:process.env.MOKU_OLD_WEB_DIR});
  await go(page);await page.locator('.app-shell').waitFor();
  await page.waitForFunction(()=>localStorage.getItem('moku.collections.v1')!==null);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),EXPERIENCE_KEY),marker);
  upgrade();await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:/Welcome back/i}).waitFor();
  assert.equal((await record(page)).mode,'update');
  for(const [key,value] of Object.entries(legacy))assert.deepEqual(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key),JSON.parse(value),key+' survives the actual old/new UI swap');
  await page.getByRole('button',{name:'Continue to Moku'}).click();await page.locator('.app-shell').waitFor();
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('.app-shell').waitFor();
  assert.equal(await page.locator('.intro-screen').count(),0);assert.deepEqual(errors,[]);await context.close();
  console.log('PASS actual previous APK UI -> current UI: same origin/localStorage, preserved data and one update screen.');
 }
 console.log('PASS startup UI: first launch, interrupted intro, legacy upgrade, once-per-version, Android back, Settings replay, data preservation, mobile CTA and desktop.');
} finally {await browser.close();}
