import { readFileSync } from 'node:fs';

export const APP = process.env.APP_URL || 'http://localhost:5173';
const FAKE_YT = readFileSync(new URL('./fakeYouTube.js', import.meta.url), 'utf8');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function reporter() {
  const results = [];
  return {
    results,
    check(name, ok, detail = '') {
      results.push({ name, ok, detail });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
    },
  };
}

/** A user = its own browser context (own localStorage, so its own userId). */
export async function newUser(browser, name, ytConfig = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((cfg) => {
    window.__fakeYTConfig = cfg;
  }, ytConfig);
  await context.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_YT }));
  await context.route(/i\.ytimg\.com|image\.tmdb\.org/, (route) => route.fulfill({ status: 404, body: '' }));
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message));
  await page.addInitScript((n) => localStorage.setItem('wp.name', n), name);
  return { context, page, name };
}

export const player = (page) =>
  page.evaluate(() => {
    const p = window.__fakeYT?.players.at(-1);
    const c = window.__wpController;
    return p ? { t: p.getCurrentTime(), exp: c?.expected(), state: p.getPlayerState(), videoId: p.videoId } : null;
  });

export async function createRoom(page) {
  await page.goto(APP);
  await page.getByRole('button', { name: 'Create a room' }).click();
  await page.waitForURL(/\/room\/[A-Z0-9]{6}$/);
  return page.url().split('/').pop();
}

export async function setVideo(page, url = 'https://youtu.be/dQw4w9WgXcQ') {
  await page.getByPlaceholder('Paste a YouTube link…').fill(url);
  await page.getByRole('button', { name: 'Play now' }).click();
}

export async function userNames(page) {
  await page.getByRole('tab', { name: /👥/ }).click();
  return page.locator('.user-list .user').evaluateAll((els) =>
    els.map((e) => ({ text: e.querySelector('.user-name').textContent, offline: e.classList.contains('offline'), host: Boolean(e.querySelector('.crown')) })),
  );
}
