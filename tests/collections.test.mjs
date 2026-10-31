import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FAVOURITES_ID, titleKey, normalizeCollections, collectionNameError,
  createCollection, renameCollection, deleteCollection, setCollectionItems,
  setTitleCollections, toggleFavourite, removeTitleFromCollections
} from '../src/collections.js';

const first={source:'sogo',url:'https://animesogo.to/watch/one',title:'One'};
const second={source:'xin',url:'https://animexin.dev/two/',title:'Two'};
const key1=titleKey(first), key2=titleKey(second);

test('A legacy library remains untouched; a new Favourites collection starts empty',()=>{
  const legacy=[first,second];const before=JSON.stringify(legacy);
  const collections=normalizeCollections(null);
  assert.deepEqual(collections,[{id:FAVOURITES_ID,name:'Favourites',items:[]}]);
  assert.equal(JSON.stringify(legacy),before);
  assert.equal(key1,'sogo|https://animesogo.to/watch/one');
});
test('Normalize saved collections without inventing memberships',()=>{
  const data=[{id:'favourites',name:'anything',items:[key1,key1,null]},
    {id:'custom',name:' Watch later ',items:[key2]}, {id:'custom',name:'duplicate',items:[key1]}, {id:'all',name:'invalid',items:[key1]}];
  const normalized=normalizeCollections(data);
  assert.deepEqual(normalized,[{id:'favourites',name:'Favourites',items:[key1]},{id:'custom',name:'Watch later',items:[key2]}]);
});
test('Create, rename, select, and delete collections without deleting library titles',()=>{
  const library=[first,second];let collections=normalizeCollections([]);
  assert.match(collectionNameError('   ',collections),/Enter/);
  assert.match(collectionNameError(' all titles ',collections),/already exists/);
  assert.match(collectionNameError('FAVOURITES',collections),/already exists/);
  assert.match(collectionNameError('x'.repeat(41),collections),/40/);
  collections=createCollection(collections,'  Weekend   watches  ','c1');
  assert.equal(collections[1].name,'Weekend watches');
  assert.match(collectionNameError('WEEKEND WATCHES',collections),/already exists/);
  assert.equal(collectionNameError('Weekend watches',collections,'c1'),'');
  collections=setCollectionItems(collections,'c1',[key1,key2,key1]);
  collections=setTitleCollections(collections,key1,[FAVOURITES_ID,'c1']);
  assert.deepEqual(collections[0].items,[key1]);assert.deepEqual(collections[1].items,[key1,key2]);
  collections=renameCollection(collections,'c1','Action');
  collections=renameCollection(collections,FAVOURITES_ID,'Cannot rename');
  assert.equal(collections[0].name,'Favourites');assert.equal(collections[1].name,'Action');
  collections=deleteCollection(collections,'c1');
  assert.deepEqual(collections.map(c=>c.id),[FAVOURITES_ID]);
  assert.deepEqual(library,[first,second]);
  assert.equal(deleteCollection(collections,FAVOURITES_ID),collections);
});
test('Favourite toggles and explicit title removal only alter the relevant memberships',()=>{
  let c=createCollection(normalizeCollections([]),'Action','action');
  c=setTitleCollections(c,key1,[FAVOURITES_ID,'action']);
  c=setTitleCollections(c,key2,['action']);
  c=toggleFavourite(c,key1);assert.deepEqual(c[0].items,[]);assert.deepEqual(c[1].items,[key2,key1]);
  c=toggleFavourite(c,key2);assert.deepEqual(c[0].items,[key2]);
  c=removeTitleFromCollections(c,key1);assert.deepEqual(c[0].items,[key2]);assert.deepEqual(c[1].items,[key2]);
  const reloaded=normalizeCollections(JSON.parse(JSON.stringify(c)));
  assert.deepEqual(reloaded,c);
});
