// Live source smoke: uses the same bounded HTTPS document bridge contract as Android.
// Usage: node tests/live-v9-smoke.mjs  (requires curl and internet; no download is performed)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run=promisify(execFile);
globalThis.window={MokuBridge:{request(id,url){
  const origin=new URL(url).origin+'/';
  run('curl',['--compressed','-fsSL','--max-time','22','-A','Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36','-H',`Referer: ${origin}`,'-H','X-Requested-With: XMLHttpRequest',url],{maxBuffer:8*1024*1024}).then(({stdout})=>window.__mokuNativeChunk(id,stdout,true,null)).catch(error=>window.__mokuNativeChunk(id,'',true,error.message));
}}};
const {getCatalog,getDetail,getServers}=await import('../src/data.js');
const cases=[
 ['suge','naruto','https://animesuge.cz/anime/road-of-naruto-ggjw8'],
 ['anikoto','naruto','https://anikototv.to/watch/naruto-eybxz'],
 ['rulz','naruto','https://animerulz.com.in/anime/naruto/'],
 ['waves','naruto','https://aniwaves.ru/watch/naruto-76396'],
 ['bash','naruto','https://animebash.in/anime/20'],
 ['narul','soul land','https://naruldonghua.com/soul-land-2-the-unrivaled-tang-sect/'],
 ['stream','soul land','https://donghuastream.org/anime/soul-land-2nd/'],
 ['world','soul land','https://donghuaworld.com/anime/soul-land-2-the-unrivaled-tang-sect-3d/'],
];
let failures=0;
for(const [id,query,url] of cases){
 try{
  const [catalog,search]=await Promise.all([getCatalog(id),getCatalog(id,{query})]);
  if(!catalog.items.length||!search.items.length)throw new Error('catalog or search was empty');
  const detail=await getDetail({source:id,url,title:'Sample',type:'Anime'});
  if(!detail.episodes.length)throw new Error('no episodes');
  const target=detail.episodes.find(e=>e.number==='1')||detail.episodes[0];
  const servers=await getServers(id,target);
  if(!servers.length)throw new Error(`episode ${target.number} has no server links`);
  console.log(`${id}: catalog=${catalog.items.length}, search=${search.items.length}, title=${detail.title}, status=${detail.status}, episodes=${detail.episodes.length}, episode=${target.number}, servers=${servers.length} (${servers.slice(0,3).map(x=>x.name).join(', ')})`);
 }catch(e){failures++;console.error(`${id}: FAILED ${e.message}`)}
}
if(failures)process.exitCode=1;
