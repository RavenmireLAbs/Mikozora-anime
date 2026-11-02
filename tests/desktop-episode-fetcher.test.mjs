import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, fetchEpisodes } from '../desktop/src/lib/episode-fetcher.js';

test('canonical numbers mirror BigDecimal plain strings', () => {
  assert.equal(canonical('007.50'), '7.5');
  assert.equal(canonical('12.0'), '12');
  assert.equal(canonical('0.5'), '0.5');
  assert.equal(canonical(' 3 '), '3');
  assert.equal(canonical('000'), '0');
  assert.equal(canonical('1.2345'), '');
  assert.equal(canonical('abc'), '');
  assert.equal(canonical(''), '');
  assert.equal(canonical(null), '');
});

test('Sogo-family fetch builds episode URLs from data-num/data-slug', async () => {
  const pages = new Map([
    ['https://animesogo.to/watch/example', '<div id="watch-page" data-id="12345"></div>'],
    ['https://animesogo.to/ajax/episode/list/12345?vrf=', JSON.stringify({
      status: 200,
      result: `<ul class="episodes">
        <li><a data-num="1" data-slug="1">1</a></li>
        <li><a data-num="2.5" data-slug="2-5">2.5</a></li>
        <li><a data-num="2.5" data-slug="2-5">dup</a></li>
      </ul>`,
    })],
  ]);
  const episodes = await fetchEpisodes('sogo', 'https://animesogo.to/watch/example', async (url) => {
    if (!pages.has(url)) throw new Error(`Unexpected ${url}`);
    return pages.get(url);
  });
  assert.deepEqual(episodes.map((e) => [e.key, e.number, e.url]), [
    ['number:1', '1', 'https://animesogo.to/watch/example/ep-1'],
    ['number:2.5', '2.5', 'https://animesogo.to/watch/example/ep-2-5'],
  ]);
});

test('Waves fetch prefers the listed href', async () => {
  const episodes = await fetchEpisodes('waves', 'https://aniwaves.ru/watch/example', async (url) => {
    if (url === 'https://aniwaves.ru/watch/example') return '<div class="watch-wrap" data-id="777"></div>';
    if (url === 'https://aniwaves.ru/ajax/episode/list/777?vrf=') {
      return JSON.stringify({
        status: 200,
        result: '<a data-num="3" data-ids="x" href="/watch/example/ep-3">3</a>',
      });
    }
    throw new Error(`Unexpected ${url}`);
  });
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].url, 'https://aniwaves.ru/watch/example/ep-3');
  assert.equal(episodes[0].number, '3');
});

test('WordPress fetch reads eplister numbers/titles and URL-key specials', async () => {
  const page = `<html><body><div class="eplister"><ul>
    <li><a href="https://animexin.dev/example-episode-1/"><span class="epl-num">1</span><span class="epl-title">The Start</span></a></li>
    <li><a href="https://animexin.dev/example-episode-2/"><span class="epl-num">Episode 2</span><span class="epl-title"></span></a></li>
    <li><a href="https://animexin.dev/example-special/"><span class="epl-num">Special</span><span class="epl-title">Side Story</span></a></li>
  </ul></div></body></html>`;
  const episodes = await fetchEpisodes('xin', 'https://animexin.dev/example/', async () => page);
  assert.deepEqual(episodes.map((e) => [e.key, e.number, e.title]), [
    ['number:1', '1', 'The Start'],
    ['number:2', '2', 'Episode 2'],
    ['url:https://animexin.dev/example-special/', '', 'Side Story'],
  ]);
});

test('empty lists are an error unless the series is upcoming', async () => {
  const upcoming = '<html><body><div class="spe"><span>Status: Upcoming</span></div></body></html>';
  assert.deepEqual(await fetchEpisodes('xin', 'https://animexin.dev/example/', async () => upcoming), []);
  await assert.rejects(
    fetchEpisodes('xin', 'https://animexin.dev/example/', async () => '<html><body><p>nothing</p></body></html>'),
    /Source episode list is empty or unavailable/,
  );
});

test('AnimeBash fetch sorts, keeps sequential watch numbers and skips future rows', async () => {
  const now = () => Date.UTC(2026, 5, 1);
  const getText = async (url) => {
    if (url === 'https://animebash.in/api/anime/42') return JSON.stringify({ title: { english: 'Example' }, status: 'RELEASING' });
    if (url === 'https://animebash.in/api/watch/42') {
      return JSON.stringify({
        episodes: [
          { number: 2, title: 'Second', airDate: '2026-01-02' },
          { number: 1, title: 'First', airDate: '2026-01-01' },
          { number: 3, title: 'Future', airDate: '2999-01-01' },
        ],
      });
    }
    throw new Error(`Unexpected ${url}`);
  };
  const episodes = await fetchEpisodes('bash', 'https://animebash.in/anime/42', getText, now);
  assert.deepEqual(episodes.map((e) => [e.number, e.title, e.url]), [
    ['1', 'First', 'https://animebash.in/anime/42/1'],
    ['2', 'Second', 'https://animebash.in/anime/42/2'],
  ]);

  const upcoming = await fetchEpisodes('bash', 'https://animebash.in/anime/42', async (url) => (
    url.includes('/api/anime/')
      ? JSON.stringify({ title: { english: 'Example' }, status: 'NOT_YET_RELEASED' })
      : JSON.stringify({ episodes: [] })
  ), now);
  assert.deepEqual(upcoming, []);

  await assert.rejects(
    fetchEpisodes('bash', 'https://animebash.in/anime/42', async (url) => (
      url.includes('/api/anime/')
        ? JSON.stringify({ title: { english: 'Example' }, status: 'RELEASING' })
        : JSON.stringify({ episodes: [] })
    ), now),
    /AnimeBash did not provide episode links/,
  );
});

test('fetcher rejects series URLs that do not match the source', async () => {
  await assert.rejects(
    fetchEpisodes('sogo', 'https://animexin.dev/example/', async () => ''),
    /Invalid series source/,
  );
});
