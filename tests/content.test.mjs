import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_KEY, DEFAULT_CONTENT_PREFS, GENRES, genreSlug, canonicalGenreSlug, findGenre,
  genreList, isAdultGenre, normalizeRating, findRatingInText, isNsfw, ratingOf,
  yearFromText, yearOf, statusGroup, filterTitles, normalizeContentPrefs,
  readContentPrefs, saveContentPrefs,
} from '../src/content.js';

class Store {
  constructor(initial={}) { this.values=new Map(Object.entries(initial)); }
  getItem(k) { return this.values.has(k)?this.values.get(k):null; }
  setItem(k,v) { this.values.set(k,String(v)); }
}

test('genre names resolve to canonical Browse genres through slugs and aliases',()=>{
  assert.ok(GENRES.includes('Action') && GENRES.includes('Martial Arts') && GENRES.includes('Hentai'));
  assert.equal(genreSlug('Slice of Life'),'slice-of-life');
  assert.equal(canonicalGenreSlug('Science Fiction'),'sci-fi');
  assert.equal(findGenre('action'),'Action');
  assert.equal(findGenre('Sci-Fi'),'Sci-Fi');
  assert.equal(findGenre('Science Fiction'),'Sci-Fi');
  assert.equal(findGenre('invented genre'),'');
  assert.deepEqual(genreList({genres:'Action, Fantasy'}),['Action','Fantasy']);
  assert.deepEqual(genreList({genres:['Action',' Ecchi ']}),['Action','Ecchi']);
  assert.deepEqual(genreList({}),[]);
});

test('age ratings normalize onto one PG-style scale, scores never pose as ratings',()=>{
  assert.equal(normalizeRating('PG-13 - Teens 13 or older').label,'PG-13');
  assert.equal(normalizeRating('PG - Children').label,'PG');
  assert.equal(normalizeRating('G - All Ages').label,'G');
  assert.equal(normalizeRating('TV-14').label,'PG-13');
  assert.equal(normalizeRating('TV-PG').label,'PG');
  assert.equal(normalizeRating('R - 17+ (violence & profanity)').label,'R');
  assert.equal(normalizeRating('TV-MA').label,'R');
  assert.equal(normalizeRating('Rx - Hentai').label,'18+');
  assert.equal(normalizeRating('18+').adult,true);
  assert.equal(normalizeRating('R+').adult,true);
  assert.equal(normalizeRating('PG-13').adult,false);
  assert.equal(normalizeRating('7.85'),null,'a numeric score is not an age rating');
  assert.equal(normalizeRating('8/10'),null);
  assert.equal(normalizeRating(''),null);
  assert.equal(normalizeRating(null),null);
  assert.equal(normalizeRating('Unrated'),null);
});

test('rating tokens can be found in card meta text without matching stray letters',()=>{
  assert.equal(findRatingInText('TV · PG-13 · 2024').label,'PG-13');
  assert.equal(findRatingInText('2024 · 24 episodes'),null);
  assert.equal(findRatingInText('R rating pending'),null,'a bare R in prose is not a rating');
  assert.equal(findRatingInText(''),null);
});

test('NSFW classification uses adult flags, 18+ ratings and adult genres only',()=>{
  assert.equal(isNsfw({nsfw:true}),true);
  assert.equal(isNsfw({isAdult:true}),true);
  assert.equal(isNsfw({rating:'18+'}),true);
  assert.equal(isNsfw({genres:['Action','Ecchi']}),true);
  assert.equal(isNsfw({genres:'Harem, Hentai'}),true);
  assert.equal(isNsfw({genres:['Action','Fantasy'],rating:'PG-13'}),false);
  assert.equal(isNsfw({}),false,'unknown is not marked, and never claims to be safe-rated');
  assert.equal(isAdultGenre('hentai'),true);
  assert.equal(isAdultGenre('Adult Cast'),false);
  assert.equal(ratingOf({rating:'TV-14'}).label,'PG-13');
  assert.equal(ratingOf({genres:['Ecchi']}).label,'18+','adult-marked titles badge as 18+');
  assert.equal(ratingOf({genres:['Action']}),null,'no source rating means NR, not an invented one');
});

test('years and status groups are read from source wording',()=>{
  assert.equal(yearFromText('Oct 3, 2002 to Feb 8, 2007'),2002);
  assert.equal(yearFromText('2024'),2024);
  assert.equal(yearFromText('no dates here'),0);
  assert.equal(yearOf({year:2023}),2023);
  assert.equal(yearOf({aired:'Jun 24, 2023'}),2023);
  assert.equal(yearOf({}),0);
  assert.equal(statusGroup('Finished Airing'),'completed');
  assert.equal(statusGroup('RELEASING'),'ongoing');
  assert.equal(statusGroup('NOT_YET_RELEASED'),'upcoming');
  assert.equal(statusGroup(''),'');
});

test('filterTitles applies genre, year, status and NSFW rules honestly',()=>{
  const items=[
    {title:'action-2024',genres:['Action'],year:2024,status:'Ongoing',rating:'PG-13'},
    {title:'romance-2002',genres:['Romance'],aired:'Apr 2002',status:'Finished Airing',rating:'PG'},
    {title:'adult',genres:['Ecchi','Comedy'],year:2024,status:'Ongoing'},
    {title:'unknown'},
  ];
  const names=list=>list.map(x=>x.title);
  assert.deepEqual(names(filterTitles(items,{})),['action-2024','romance-2002','adult','unknown']);
  // Known mismatches are dropped; unknown metadata is kept for the source listing.
  assert.deepEqual(names(filterTitles(items,{genre:'Action'})),['action-2024','unknown']);
  assert.deepEqual(names(filterTitles(items,{genre:'Science Fiction'})),['unknown']);
  assert.deepEqual(names(filterTitles(items,{year:'2024'})),['action-2024','adult','unknown']);
  assert.deepEqual(names(filterTitles(items,{status:'completed'})),['romance-2002','unknown']);
  assert.deepEqual(names(filterTitles(items,{nsfw:'safe'})),['action-2024','romance-2002','unknown']);
  assert.deepEqual(names(filterTitles(items,{nsfw:'only'})),['adult']);
  // The global preference forces safe even if a stale Browse value asked for NSFW only.
  assert.deepEqual(names(filterTitles(items,{nsfw:'only',hideNsfw:true})),['action-2024','romance-2002','unknown']);
  assert.deepEqual(names(filterTitles(items,{genre:'Comedy',nsfw:'safe'})),['unknown']);
});

test('the hide-NSFW preference persists in its own key and validates bad data',()=>{
  assert.deepEqual(DEFAULT_CONTENT_PREFS,{hideNsfw:false});
  assert.deepEqual(normalizeContentPrefs({hideNsfw:true,extra:'x'}),{hideNsfw:true});
  assert.deepEqual(normalizeContentPrefs('yes'),{hideNsfw:false});
  assert.deepEqual(normalizeContentPrefs(null),{hideNsfw:false});
  const store=new Store();
  assert.deepEqual(readContentPrefs(store),{hideNsfw:false});
  assert.equal(saveContentPrefs(store,{hideNsfw:true}),true);
  assert.equal(store.getItem(CONTENT_KEY),'{"hideNsfw":true}');
  assert.deepEqual(readContentPrefs(store),{hideNsfw:true});
  store.setItem(CONTENT_KEY,'not-json');
  assert.deepEqual(readContentPrefs(store),{hideNsfw:false},'corrupt state falls back to the default');
  const blocked={getItem(){throw new Error('blocked')},setItem(){throw new Error('blocked')}};
  assert.deepEqual(readContentPrefs(blocked),{hideNsfw:false});
  assert.equal(saveContentPrefs(blocked,{hideNsfw:true}),false);
});
