// Live integration smoke test for the Android HTML/CSP + bridge contract.
// Start `npm run dev` first, then run `node tests/android-bridge-smoke.mjs`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
const ROOT=resolve('dist');
const proxy='http://127.0.0.1:5173';
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'";
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.ttf':'font/ttf','.svg':'image/svg+xml','.txt':'text/plain'};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
await context.route('https://app.moku.local/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/api/image') {
    try { const r=await fetch(`${proxy}/api/image?url=${encodeURIComponent(u.searchParams.get('url'))}`);await route.fulfill({status:r.status,headers:{'Content-Type':r.headers.get('content-type')||'application/octet-stream'},body:Buffer.from(await r.arrayBuffer())}); }
    catch { await route.fulfill({status:502,body:'image unavailable'}); } return;
  }
  const path=resolve(ROOT,'.'+(u.pathname==='/'?'/index.html':u.pathname));
  if(!path.startsWith(ROOT+'/')){await route.fulfill({status:403});return;}
  try { await route.fulfill({status:200,headers:{'Content-Type':types[extname(path)]||'application/octet-stream','Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff'},body:await readFile(path)}); }
  catch {await route.fulfill({status:404,body:'not found'});}
});
const page=await context.newPage();
page.on('dialog',dialog=>dialog.accept());
const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console',msg=>{if(msg.type()==='error'&&msg.text().includes('Content Security Policy'))errors.push(msg.text());});
await page.exposeBinding('__nativeFetch',async (_source,url)=>{const r=await fetch(`${proxy}/api/raw?url=${encodeURIComponent(url)}`);const body=await r.text();if(!r.ok)throw new Error(body);return body;});
await page.addInitScript(()=>{
  window.__bridgeStats={requests:0,chunks:0};window.__openedPlayer=null;window.__mockDownloads=[];window.__optionCalls=[];window.__enqueuePayloads=[];window.__folder={configured:false,granted:false,name:''};window.__exportCalls=[];
  const reply=(id,body)=>window.__mokuNativeChunk(id,body,true,null);
  window.MokuBridge={
    request(id,url){window.__bridgeStats.requests++;window.__nativeFetch(url).then(body=>{for(let i=0;i<body.length;i+=20000){window.__bridgeStats.chunks++;window.__mokuNativeChunk(id,body.slice(i,i+20000),i+20000>=body.length,null);}if(!body.length)window.__mokuNativeChunk(id,'',true,null);}).catch(e=>window.__mokuNativeChunk(id,'',true,e.message));},
    openPlayer(payload){window.__openedPlayer=JSON.parse(payload);},
    openExternal(url){window.__openedExternal=url;},
    downloads(id){reply(id,JSON.stringify(window.__mockDownloads));},
    downloadOptions(id,raw){
      const x=JSON.parse(raw);window.__optionCalls.push(x);
      const q=(ids)=>[{id:'best',label:'Best available'},...ids.map(([id,label])=>({id,label}))];
      const servers=x.item.source==='sogo'?[{id:'sogo-hd-1-0',label:'HD-1 · MegaPlay SUB',qualities:q([['v:1920x1080','1080p'],['v:1280x720','720p']])}]:[
        {id:'xin-mediafire',label:`MediaFire · ${x.language}`,qualities:q([['f:1080','1080p · source file']])},
        {id:'xin-dailymotion-test-0',label:'Dailymotion',qualities:q([['v:512x288','288p']])},
        {id:'xin-okru-test-0',label:'OK.ru',qualities:q([['f:720','720p']])}
      ];
      reply(id,JSON.stringify({servers,unavailable:0}));
    },
    enqueueDownloads(id,raw){const x=JSON.parse(raw);window.__enqueuePayloads.push(x);for(const p of x.episodes){window.__mockDownloads.push({id:String(window.__mockDownloads.length+1).padStart(32,'0'),...p,language:x.language,serverChoice:x.server,qualityChoice:x.quality,status:'queued',subtitleDescription:'Preparing subtitles'});}reply(id,JSON.stringify({added:x.episodes.length,skipped:0}));},
    removeDownload(id,key){window.__mockDownloads=window.__mockDownloads.filter(x=>x.id!==key);reply(id,'ok');},
    openDownload(id){window.__openedOffline=id;},
    exportSettings(id){reply(id,JSON.stringify(window.__folder));},
    chooseDownloadFolder(id){window.__folder={configured:true,granted:true,name:'Anime folder'};reply(id,JSON.stringify(window.__folder));},
    clearDownloadFolder(id){window.__folder={configured:false,granted:false,name:''};reply(id,JSON.stringify(window.__folder));},
    exportDownload(id,key){window.__exportCalls.push(key);const x=window.__mockDownloads.find(d=>d.id===key);x.exportStatus='queued';x.exportFolder=window.__folder.name;reply(id,JSON.stringify({queued:true}));},
    openExport(key){window.__openedExport=key;}
  
  };
});
try {
  await page.goto('https://app.moku.local/index.html',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Get started'}).click();
  await page.waitForSelector('.anime-card',{state:'visible',timeout:30000});
  assert.equal(await page.locator('.bottom-nav').isVisible(),true);
  await page.locator('.bottom-nav button').filter({hasText:'Browse'}).click();
  await page.getByRole('button',{name:'AnimeSogo',exact:true}).click();
  await page.getByLabel('Search titles').fill('naruto');await page.locator('.browse-search button').click();
  await page.waitForFunction(()=>document.querySelector('.browse-title h2')?.textContent.includes('naruto')&&document.querySelector('.anime-card'),null,{timeout:30000});
  await page.locator('.anime-card').filter({has:page.locator('.card-title',{hasText:/^Naruto$/})}).first().locator('.card-title').click();
  await page.waitForSelector('.episode-row',{timeout:30000});
  assert.match(await page.locator('.episode-head h2').innerText(),/220/);
  await page.getByRole('button',{name:'Add to library'}).click();
  await page.getByRole('button',{name:'Watch first episode'}).click();
  await page.waitForFunction(()=>!!window.__openedPlayer,null,{timeout:30000});
  const first=await page.evaluate(()=>window.__openedPlayer);
  assert.equal(first.item.source,'sogo');assert.equal(first.episode.number,'1');assert.ok(first.servers.length>0);assert.match(first.servers[0].url,/^https:\/\//);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('moku.library.v1')).length),1);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('moku.history.v1')).length),1);
  // Single-episode flow, subtitle language, and offline-play/remove bridge controls.
  await page.locator('.episode-download').first().click();
  assert.ok(await page.getByRole('dialog',{name:'Download episodes'}).isVisible());
  assert.equal(await page.getByLabel('PREFERRED SUBTITLE LANGUAGE').inputValue(),'english');
  assert.equal(await page.getByLabel('PREFERRED SUBTITLE LANGUAGE').isDisabled(),true);
  assert.equal(await page.getByLabel('PREFERRED SUBTITLE LANGUAGE').locator('option').count(),1);
  assert.match(await page.locator('.download-explainer').innerText(),/English subtitle tracks only/);
  await page.locator('select').filter({has:page.locator('option[value="sogo-hd-1-0"]')}).waitFor({timeout:10000});
  await page.getByLabel('DOWNLOAD SERVER').selectOption('sogo-hd-1-0');
  await page.getByLabel('VIDEO QUALITY').selectOption('v:1280x720');
  assert.ok((await page.getByLabel('VIDEO QUALITY').inputValue())==='v:1280x720');
  await page.getByRole('button',{name:'Add to queue'}).click();
  await page.waitForSelector('.download-card',{timeout:10000});
  assert.equal(await page.locator('.download-card').count(),1);
  const single=(await page.evaluate(()=>window.__mockDownloads))[0];
  assert.equal(single.language,'english');assert.equal(single.serverChoice,'sogo-hd-1-0');assert.equal(single.qualityChoice,'v:1280x720');
  await page.evaluate(()=>window.__mockDownloads[0].status='completed');
  await page.getByRole('button',{name:'Play offline'}).waitFor({timeout:6000});
  await page.getByRole('button',{name:'Play offline'}).click();
  assert.equal(await page.evaluate(()=>window.__openedOffline),'00000000000000000000000000000001');
  // Choose a folder, save an existing episode, and open its independent playable copy.
  await page.getByRole('button',{name:'Choose folder'}).click();
  await page.getByRole('button',{name:'Choose folder'}).click();
  await page.getByText('Anime folder',{exact:true}).waitFor({timeout:5000});
  assert.match(await page.locator('.folder-explainer').innerText(),/extra storage temporarily/i);
  assert.match(await page.locator('.folder-explainer').innerText(),/folder for each anime or donghua/i);
  assert.match(await page.locator('.folder-explainer').innerText(),/removes its private copy/i);
  assert.match(await page.locator('.folder-explainer').innerText(),/verification fails.*private copy stays/i);
  await page.locator('.bottom-nav button').filter({hasText:'Downloads'}).click();
  await page.getByRole('button',{name:'Save to folder'}).click();
  assert.deepEqual(await page.evaluate(()=>window.__exportCalls),['00000000000000000000000000000001']);
  await page.getByText(/Playable copy queued/).waitFor({timeout:5000});
  await page.evaluate(()=>{window.__mockDownloads[0].exportStatus='verifying';});
  await page.getByText(/Verifying video and subtitles/).waitFor({timeout:6000});
  await page.evaluate(()=>{Object.assign(window.__mockDownloads[0],{exportStatus:'completed',exportUri:'content://folder/episode',exportSubtitleCount:1,exportSeriesFolder:'Naruto',storageMode:'folder',cleanupStatus:'complete'});});
  await page.getByRole('button',{name:'Open file'}).waitFor({timeout:6000});
  await page.getByRole('button',{name:'Open file'}).click();
  assert.equal(await page.evaluate(()=>window.__openedExport),'00000000000000000000000000000001');
  assert.match(await page.locator('.export-status').innerText(),/Anime folder \/ Naruto/);
  assert.match(await page.locator('.export-status').innerText(),/1 subtitle file/);
  assert.match(await page.locator('.export-status').innerText(),/Private copy removed/);
  await page.getByRole('button',{name:'Remove',exact:true}).click();
  await page.waitForFunction(()=>window.__mockDownloads.length===0);
  // AnimeSogo batches also send English only while retaining server/quality choices.
  await page.locator('.bottom-nav button').filter({hasText:'Browse'}).click();
  await page.getByRole('button',{name:'AnimeSogo',exact:true}).click();
  await page.getByLabel('Search titles').fill('naruto');await page.locator('.browse-search button').click();
  await page.waitForFunction(()=>document.querySelector('.browse-title h2')?.textContent.includes('naruto')&&document.querySelector('.anime-card'),null,{timeout:30000});
  await page.locator('.anime-card').filter({has:page.locator('.card-title',{hasText:/^Naruto$/})}).first().locator('.card-title').click();
  await page.waitForSelector('.episode-row',{timeout:30000});
  await page.getByRole('button',{name:'Select episodes'}).click();
  await page.locator('.episode-check').nth(0).check();await page.locator('.episode-check').nth(1).check();
  await page.getByRole('button',{name:/Download 2/}).click();
  assert.equal(await page.getByLabel('PREFERRED SUBTITLE LANGUAGE').inputValue(),'english');
  assert.equal(await page.getByLabel('PREFERRED SUBTITLE LANGUAGE').isDisabled(),true);
  await page.locator('option[value="sogo-hd-1-0"]').waitFor({state:'attached',timeout:10000});
  await page.getByLabel('DOWNLOAD SERVER').selectOption('sogo-hd-1-0');
  await page.getByLabel('VIDEO QUALITY').selectOption('v:1280x720');
  await page.getByRole('button',{name:'Add to queue'}).click();
  await page.waitForSelector('.download-card',{timeout:10000});
  const sogoBatch=await page.evaluate(()=>window.__enqueuePayloads.at(-1));
  assert.equal(sogoBatch.language,'english');assert.equal(sogoBatch.episodes.length,2);
  assert.equal(sogoBatch.server,'sogo-hd-1-0');assert.equal(sogoBatch.quality,'v:1280x720');
  await page.evaluate(()=>{window.__mockDownloads=[];});
  await page.locator('.bottom-nav button').filter({hasText:'Browse'}).click();
  await page.getByRole('button',{name:'AnimeXin',exact:true}).click();
  await page.getByLabel('Search titles').fill('soul land');await page.locator('.browse-search button').click();
  await page.waitForFunction(()=>document.querySelector('.browse-title h2')?.textContent.includes('soul land')&&document.querySelector('.anime-card'),null,{timeout:30000});
  await page.locator('.anime-card').filter({has:page.locator('.card-title',{hasText:/^Soul Land 2: The Peerless Tang Sect$/})}).first().locator('.card-title').click();
  await page.waitForSelector('.episode-row',{timeout:30000});
  await page.evaluate(()=>window.__openedPlayer=null);await page.locator('.episode-open').first().click();
  await page.waitForFunction(()=>!!window.__openedPlayer,null,{timeout:30000});
  const second=await page.evaluate(()=>window.__openedPlayer);
  assert.equal(second.item.source,'xin');assert.ok(second.servers.length>0);
  assert.ok(second.servers.some(x=>x.url.startsWith('https://ok.ru/')), 'protocol-relative OK.ru mirrors are preserved');
  await page.getByRole('button',{name:'Select episodes'}).click();
  await page.locator('.episode-check').nth(0).check();await page.locator('.episode-check').nth(1).check();
  await page.getByRole('button',{name:/Download 2/}).click();
  await page.getByLabel('PREFERRED SUBTITLE LANGUAGE').selectOption('indonesian');
  await page.waitForFunction(()=>window.__optionCalls.some(x=>x.item.source==='xin'&&x.language==='indonesian'),null,{timeout:10000});
  await page.locator('option[value="xin-mediafire"]').waitFor({state:'attached',timeout:10000});
  await page.getByLabel('DOWNLOAD SERVER').selectOption('xin-mediafire');
  await page.getByLabel('VIDEO QUALITY').selectOption('f:1080');
  assert.match(await page.locator('.quality-batch-hint').innerText(),/episode/i);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'/home/user/research/v3/download-quality-modal.png'});
  await page.getByRole('button',{name:'Add to queue'}).click();
  await page.waitForSelector('.download-card',{timeout:10000});
  const queued=await page.evaluate(()=>window.__mockDownloads);assert.equal(queued.length,2);assert.equal(queued[0].language,'indonesian');
  assert.ok(queued.every(x=>x.serverChoice==='xin-mediafire'&&x.qualityChoice==='f:1080'));
  await page.evaluate(()=>window.__mockDownloads[0].status='failed');
  await page.getByRole('button',{name:'Retry'}).waitFor({timeout:6000});await page.getByRole('button',{name:'Retry'}).click();
  const retry=await page.evaluate(()=>window.__enqueuePayloads.at(-1));
  assert.equal(retry.language,'indonesian');assert.equal(retry.server,'xin-mediafire');assert.equal(retry.quality,'f:1080');
  await page.getByRole('button',{name:'Change server'}).first().click();
  assert.equal(await page.getByLabel('PREFERRED SUBTITLE LANGUAGE').inputValue(),'indonesian');
  await page.locator('option[value="xin-okru-test-0"]').waitFor({state:'attached',timeout:10000});
  await page.getByLabel('DOWNLOAD SERVER').selectOption('xin-okru-test-0');
  await page.getByLabel('VIDEO QUALITY').selectOption('f:720');
  await page.getByRole('button',{name:'Add to queue'}).click();
  const changed=await page.evaluate(()=>window.__enqueuePayloads.at(-1));
  assert.equal(changed.server,'xin-okru-test-0');assert.equal(changed.quality,'f:720');assert.equal(changed.episodes.length,1);
  assert.ok(await page.locator('.download-card').count()>=2);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,'mobile view should not overflow horizontally');
  const stats=await page.evaluate(()=>window.__bridgeStats);assert.ok(stats.requests>=8);assert.ok(stats.chunks>stats.requests);
  assert.deepEqual(errors,[]);
  console.log(`Android bridge/CSP smoke passed: ${stats.requests} source requests, ${stats.chunks} chunks; both sites, per-server quality choices, bulk and retry payloads passed.`);
} finally {await browser.close();}
