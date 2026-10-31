import { titleKey } from './collections.js';

// Only titles in Favourites or a personal collection are checked. One title may
// belong to several collections, but its source + URL is sent to Android once.
export function monitoredTitles(library, collections) {
  const included=new Set((Array.isArray(collections)?collections:[]).flatMap(c=>Array.isArray(c?.items)?c.items:[]));
  const seen=new Set(), result=[];
  for(const item of Array.isArray(library)?library:[]) {
    if(!item || typeof item.source!=='string' || typeof item.url!=='string' || typeof item.title!=='string')continue;
    const id=titleKey(item);if(!included.has(id)||seen.has(id))continue;
    seen.add(id);
    result.push({source:item.source,url:item.url,title:item.title,image:item.image||'',type:item.type||'',badge:item.badge||'',status:item.status||''});
  }
  return result;
}
export function unreadByTitle(updates) {
  const counts={};
  for(const entry of Array.isArray(updates)?updates:[]) {
    if(!entry?.read && typeof entry?.titleId==='string')counts[entry.titleId]=(counts[entry.titleId]||0)+1;
  }
  return counts;
}
