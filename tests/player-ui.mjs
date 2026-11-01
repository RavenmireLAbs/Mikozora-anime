// Browser player test: previous/next and the scrollable episode rail switch
// episodes without returning to the detail-page episode list.
// Run after npm run build: node tests/player-ui.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { APP_VERSION, EXPERIENCE_KEY } from '../src/releases.js';

const ROOT = resolve('dist');
const EPISODE_COUNT = 25;

function fixture(raw) {
  const url = new URL(raw);
  if (url.hostname !== 'animesuge.cz') return '<html></html>';

  if (url.pathname === '/anime/show') {
    return `<div class="watch-wrap" data-id="42"><section id="w-info"><div class="poster"><img src="https://cdn.anipixcdn.co/test.jpg"></div><h1 class="title">Player fixture</h1><div class="bmeta"><div class="meta"><div>Status: <span>Finished</span></div></div></div></section></div>`;
  }
  if (url.pathname === '/ajax/episode/list/42') {
    // Deliberately newest-first: player navigation must still be chronological.
    const rows = Array.from({ length: EPISODE_COUNT }, (_, index) => {
      const number = EPISODE_COUNT - index;
      return `<li><a href="#" data-num="${number}" data-slug="${number}" data-ids="token${number}" data-sub="1">${number}</a></li>`;
    }).join('');
    return JSON.stringify({ status: 200, result: `<ul>${rows}</ul>` });
  }
  if (url.pathname === '/ajax/server/list') {
    const token = url.searchParams.get('servers') || 'token1';
    const number = token.replace('token', '') || '1';
    return JSON.stringify({
      status: 200,
      result: `<div class="type" data-type="sub"><div data-link-id="server${number}"><span>Test server</span></div></div>`,
    });
  }
  if (url.pathname === '/ajax/server') {
    const number = (url.searchParams.get('get') || 'server1').replace('server', '') || '1';
    return JSON.stringify({ status: 200, result: { url: `https://player.example.org/embed/${number}` } });
  }
  return '<html></html>';
}

const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'";
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 900, height: 850 } });

await context.route('https://app.moku.local/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/raw') {
    await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: fixture(url.searchParams.get('url')) });
    return;
  }
  if (url.pathname === '/api/image') {
    await route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64') });
    return;
  }
  const path = resolve(ROOT, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!path.startsWith(ROOT + '/')) { await route.fulfill({ status: 403 }); return; }
  try {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Content-Security-Policy': csp },
      body: await readFile(path),
    });
  } catch {
    await route.fulfill({ status: 404 });
  }
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(({ version, experienceKey }) => {
  if (window !== window.top) return;
  localStorage.setItem(experienceKey, JSON.stringify({ version, status: 'seen' }));
  localStorage.setItem('moku.library.v1', JSON.stringify([{
    source: 'suge',
    url: 'https://animesuge.cz/anime/show',
    title: 'Player fixture',
    image: '',
    type: 'TV',
  }]));
}, { version: APP_VERSION, experienceKey: EXPERIENCE_KEY });

const waitForEpisode = async number => {
  await page.waitForFunction(expected => {
    const heading = document.querySelector('.player-header p')?.textContent || '';
    const frame = document.querySelector('.player-modal iframe');
    return heading.startsWith(`Episode ${expected} ·`) && frame?.getAttribute('src') === `https://player.example.org/embed/${expected}`;
  }, number, { timeout: 10000 });
};

try {
  await page.goto('https://app.moku.local/index.html', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Open Player fixture' }).first().click({ timeout: 10000 });
  await page.locator('.episode-row').first().waitFor({ timeout: 10000 });

  const firstRow = page.locator('.episode-row').filter({ has: page.locator('.episode-number', { hasText: /^01$/ }) }).first();
  await firstRow.locator('.episode-open').click();
  await page.locator('.player-modal').waitFor({ timeout: 10000 });
  await waitForEpisode(1);

  assert.deepEqual(
    await page.locator('.player-episode-chip').allTextContents(),
    Array.from({ length: EPISODE_COUNT }, (_, index) => String(index + 1)),
    'the rail is chronological even when the source lists newest episodes first',
  );
  assert.equal(await page.evaluate(() => {
    const rail = document.querySelector('.player-episode-rail');
    return rail.scrollWidth > rail.clientWidth;
  }), true, 'the episode rail scrolls horizontally');
  assert.equal(await page.getByRole('button', { name: 'Previous episode' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Next episode 2' }).isDisabled(), false);
  assert.equal(await page.locator('.player-episode-chip.current').innerText(), '1');

  await page.getByRole('button', { name: 'Next episode 2' }).click();
  await waitForEpisode(2);
  assert.equal(await page.locator('.player-episode-chip.current').innerText(), '2');

  await page.getByRole('button', { name: `Play episode ${EPISODE_COUNT}` }).click();
  await waitForEpisode(EPISODE_COUNT);
  assert.equal(await page.getByRole('button', { name: 'Next episode' }).isDisabled(), true);
  assert.equal(await page.locator('.player-episode-chip.current').innerText(), String(EPISODE_COUNT));
  await page.waitForFunction(() => {
    const rail = document.querySelector('.player-episode-rail');
    const chip = document.querySelector('.player-episode-chip.current');
    const railBox = rail.getBoundingClientRect();
    const chipBox = chip.getBoundingClientRect();
    return rail.scrollLeft > 0 && chipBox.left >= railBox.left && chipBox.right <= railBox.right;
  }, null, { timeout: 10000 });

  await page.getByRole('button', { name: `Previous episode ${EPISODE_COUNT - 1}` }).click();
  await waitForEpisode(EPISODE_COUNT - 1);
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('moku.history.v1') || '[]'));
  assert.equal(history[0].episode.number, String(EPISODE_COUNT - 1));
  assert.deepEqual(errors, []);
  console.log('PASS player UI: previous/next, direct scrollable episode selection, current-chip scrolling, boundaries and history.');
} finally {
  await browser.close();
}
