import test from 'node:test';
import assert from 'node:assert/strict';
import { monitoredTitles, unreadByTitle } from '../src/episode-updates.js';
import { titleKey } from '../src/collections.js';

const a={source:'sogo',url:'https://animesogo.to/watch/a',title:'A',image:'cover',type:'TV'};
const b={source:'xin',url:'https://animexin.dev/anime/b/',title:'B'};
const c={source:'sogo',url:'https://animesogo.to/watch/c',title:'C'};

test('monitors Favourites and all personal collections exactly once per source and URL',()=>{
  const lists=[{id:'favourites',items:[titleKey(a),titleKey(b)]},{id:'weekend',items:[titleKey(a),titleKey(a),'missing']},{id:'other',items:[titleKey(b)]}];
  const watched=monitoredTitles([a,b,a,c],lists);
  assert.deepEqual(watched.map(x=>x.title),['A','B']);
  assert.deepEqual(Object.keys(watched[0]).sort(),['badge','image','source','status','title','type','url']);
  assert.equal(watched[0].image,'cover');
});
test('All titles alone are not monitored, and removal/re-addition follows current membership',()=>{
  assert.deepEqual(monitoredTitles([a,b],[]),[]);
  assert.deepEqual(monitoredTitles([a,b],[{id:'favourites',items:[titleKey(a)]}]).map(x=>x.title),['A']);
  assert.deepEqual(monitoredTitles([a,b],[{id:'favourites',items:[]},{id:'custom',items:[titleKey(b)]}]).map(x=>x.title),['B']);
});
test('invalid entries and dangling collection keys do not manufacture titles',()=>{
  assert.deepEqual(monitoredTitles([null,{},a],[{},null,{items:['garbage']}]),[]);
  assert.deepEqual(monitoredTitles(null,null),[]);
});
test('unread badges aggregate by the saved title and ignore read or invalid events',()=>{
  assert.deepEqual(unreadByTitle([{titleId:titleKey(a),read:false},{titleId:titleKey(a),read:false},{titleId:titleKey(a),read:true},{titleId:titleKey(b),read:false},null]),{[titleKey(a)]:2,[titleKey(b)]:1});
});
