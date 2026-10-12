/**
 * End-to-end sync test in real Chromium tabs (separate browser contexts = separate users).
 * YouTube is replaced by fakeYouTube.js (route interception) so the run is deterministic and
 * works offline. Requires the server (:3001) and Vite dev server (:5173) to be running.
 *
 *   cd e2e && npm install && npm test
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const APP = process.env.APP_URL || 'http://localhost:5173';
const FAKE_YT = readFileSync(new URL('./fakeYouTube.js', import.meta.url), 'utf8');
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function newUser(browser, name, ytConfig = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((cfg) => {
    window.__fakeYTConfig = cfg;
  }, ytConfig);
  await context.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_YT }),
  );
  await context.route(/i\.ytimg\.com|image\.tmdb\.org/, (route) => route.fulfill({ status: 404, body: '' }));
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message));
  await page.addInitScript((n) => localStorage.setItem('wp.name', n), name);
  const user = { context, page, name };
  (globalThis.__pages ||= []).push(user);
  return user;
}

// Reads the fake player and controller state inside a page.
const probe = (page) =>
  page.evaluate(() => {
    const p = window.__fakeYT?.players.at(-1);
    const c = window.__wpController;
    return p
      ? { t: p.getCurrentTime(), exp: c?.expected(), state: p.getPlayerState(), videoId: p.videoId, rate: p.rate, seq: c?.lastSeq, serverPlaying: c?.serverState?.playing }
      : null;
  });

async function waitUntil(page, fn, arg, timeout = 3000) {
  const start = Date.now();
  await page.waitForFunction(fn, arg, { timeout, polling: 10 });
  return Date.now() - start;
}

const isPlaying = () => window.__fakeYT?.players.at(-1)?.getPlayerState() === 1;
const isPaused = () => {
  const s = window.__fakeYT?.players.at(-1)?.getPlayerState();
  return s === 2 || s === 5;
};

async function main() {
  const browser = await chromium.launch();
  const A = await newUser(browser, 'Alice');
  const B = await newUser(browser, 'Bob');

  // --- rooms ---
  await A.page.goto(APP);
  await A.page.getByRole('button', { name: 'Create a room' }).click();
  await A.page.waitForURL(/\/room\/[A-Z0-9]{6}$/);
  const code = A.page.url().split('/').pop();
  await B.page.goto(`${APP}/room/${code}`);
  await B.page.waitForSelector('.user-list, .tabs');
  await A.page.getByRole('tab', { name: /👥/ }).click();
  await A.page.waitForFunction(() => document.querySelectorAll('.user-list .user').length === 2, null, { timeout: 4000 });
  check('both users see each other in the user list', true, `room ${code}`);
  const crown = await A.page.locator('.user', { hasText: 'Alice' }).locator('.crown').count();
  check('host shown with a crown', crown === 1);

  // --- video ---
  await A.page.getByPlaceholder('Paste a YouTube link…').fill('https://youtu.be/dQw4w9WgXcQ');
  await A.page.getByRole('button', { name: 'Play now' }).click();
  await waitUntil(B.page, () => window.__fakeYT?.players.at(-1)?.videoId === 'dQw4w9WgXcQ');
  check('video:set reaches the guest', true);
  const badUrl = A.page.getByPlaceholder('Paste a YouTube link…');
  await badUrl.fill('https://vimeo.com/1234');
  await A.page.getByRole('button', { name: 'Play now' }).click();
  check('invalid URL shows an error', (await A.page.locator('#video-url-error').count()) === 1);
  await badUrl.fill('');

  // --- play from A, measure arrival in B ---
  await sleep(1200);
  const seq0 = (await probe(A.page)).seq;
  const t0 = Date.now();
  await A.page.evaluate(() => window.__fakeYT.players.at(-1).userPlay());
  await B.page.waitForFunction(isPlaying, null, { timeout: 3000, polling: 5 });
  const playMs = Date.now() - t0;
  check('play in A mirrors in B', playMs < 1000, `${playMs} ms incl. fake buffering + polling`);
  await sleep(1200);
  const a1 = await probe(A.page);
  const b1 = await probe(B.page);
  check('positions match after play', Math.abs(a1.t - b1.t) < 0.3, `A ${a1.t.toFixed(2)} B ${b1.t.toFixed(2)}`);
  check('no echo loop: one play = one seq increment', a1.seq === seq0 + 1 && b1.seq === seq0 + 1, `seq ${seq0} -> A ${a1.seq} B ${b1.seq}`);

  // --- pause from B ---
  await B.page.evaluate(() => window.__fakeYT.players.at(-1).userPause());
  const pauseMs = await waitUntil(A.page, isPaused, null, 3000);
  await sleep(300);
  const a2 = await probe(A.page);
  const b2 = await probe(B.page);
  check('pause in B mirrors in A', true, `${pauseMs} ms (includes 200 ms pause deferral)`);
  check('paused positions match', Math.abs(a2.t - b2.t) < 0.3, `A ${a2.t.toFixed(2)} B ${b2.t.toFixed(2)}`);

  // --- seek from B while paused, then while playing ---
  await B.page.evaluate(() => window.__fakeYT.players.at(-1).userSeek(120));
  await waitUntil(A.page, () => Math.abs(window.__fakeYT.players.at(-1).getCurrentTime() - 120) < 0.5, null, 3000);
  check('seek in B mirrors in A (paused)', true);
  await A.page.evaluate(() => window.__fakeYT.players.at(-1).userPlay());
  await B.page.waitForFunction(isPlaying, null, { timeout: 3000 });
  await sleep(1500);
  await A.page.evaluate(() => window.__fakeYT.players.at(-1).userSeek(200));
  await waitUntil(B.page, () => Math.abs(window.__fakeYT.players.at(-1).getCurrentTime() - 200) < 1.5, null, 3000);
  await sleep(1200);
  const a3 = await probe(A.page);
  const b3 = await probe(B.page);
  check('seek in A mirrors in B (playing)', Math.abs(a3.t - b3.t) < 0.35 && a3.state === 1 && b3.state === 1, `A ${a3.t.toFixed(2)} B ${b3.t.toFixed(2)}`);

  // --- rapid conflicting clicks ---
  for (let i = 0; i < 12; i++) {
    const page = i % 2 ? A.page : B.page;
    await page.evaluate((k) => {
      const p = window.__fakeYT.players.at(-1);
      if (k % 3 === 0) p.userSeek(250 + k);
      else if (p.getPlayerState() === 1) p.userPause();
      else p.userPlay();
    }, i);
    await sleep(60);
  }
  await sleep(3500);
  const a4 = await probe(A.page);
  const b4 = await probe(B.page);
  const converged = a4.seq === b4.seq && a4.serverPlaying === b4.serverPlaying && Math.abs(a4.t - b4.t) < 0.5 && (a4.state === 1) === a4.serverPlaying && (b4.state === 1) === b4.serverPlaying;
  check('rapid clicking converges to one state', converged, `seq A ${a4.seq} B ${b4.seq}, playing ${a4.serverPlaying}/${b4.serverPlaying}, t ${a4.t.toFixed(2)}/${b4.t.toFixed(2)}`);

  // make sure the room is playing at ~150 s for the late joiner
  await A.page.evaluate(() => window.__fakeYT.players.at(-1).userSeek(150));
  await sleep(800);
  if (!(await probe(A.page)).serverPlaying) await A.page.evaluate(() => window.__fakeYT.players.at(-1).userPlay());
  await sleep(1500);

  // --- late joiner ---
  const C = await newUser(browser, 'Cara');
  await C.page.goto(`${APP}/room/${code}`);
  await C.page.waitForFunction(isPlaying, null, { timeout: 6000 });
  await sleep(1500);
  const a5 = await probe(A.page);
  const c5 = await probe(C.page);
  check('late joiner lands at the room position, playing', Math.abs(a5.t - c5.t) < 0.4 && c5.state === 1, `A ${a5.t.toFixed(2)} C ${c5.t.toFixed(2)}`);

  // --- refresh keeps identity and host ---
  await A.page.reload();
  await A.page.waitForSelector('.tabs');
  await A.page.getByRole('tab', { name: /👥/ }).click();
  await A.page.waitForFunction(() => document.querySelectorAll('.user-list .user').length === 3, null, { timeout: 4000 });
  const aliceIsHost = await A.page.locator('.user', { hasText: 'Alice' }).locator('.crown').count();
  check('refresh: same user, still host, no duplicate', aliceIsHost === 1);
  await A.page.waitForFunction(isPlaying, null, { timeout: 6000 });
  await sleep(1500);
  const a6 = await probe(A.page);
  const b6 = await probe(B.page);
  check('refresh: resynced to the room', Math.abs(a6.t - b6.t) < 0.4, `A ${a6.t.toFixed(2)} B ${b6.t.toFixed(2)}`);

  // --- simulated disconnect during playback ---
  await B.page.keyboard.press('d');
  await B.page.getByRole('button', { name: /Simulate disconnect/ }).click();
  await B.page.waitForSelector('.banner-warn', { timeout: 2000 });
  check('disconnect shows "Reconnecting..." banner', true);
  await A.page.evaluate(() => window.__fakeYT.players.at(-1).userSeek(300));
  await B.page.waitForSelector('.banner-ok', { timeout: 9000 });
  await sleep(2000);
  const a7 = await probe(A.page);
  const b7 = await probe(B.page);
  check('reconnect resyncs (missed a seek while offline)', Math.abs(a7.t - b7.t) < 0.4, `A ${a7.t.toFixed(2)} B ${b7.t.toFixed(2)}`);

  // --- drift injection (hard seek path: classic YT rates, no fine rates) ---
  for (const amount of [0.5, 1, 3]) {
    await B.page.evaluate((s) => window.__wpController.injectDrift(s), amount);
    const start = Date.now();
    let fixed = false;
    let b;
    while (Date.now() - start < 10000) {
      await sleep(250);
      b = await probe(B.page);
      // Measured against the room's expected position (what the drift loop targets). With the
      // classic YouTube rate list there is no soft correction: drift <= 0.4 s is tolerated by
      // design (under the 500 ms target) and anything above is hard-seeked.
      if (Math.abs(b.t - b.exp) <= 0.4 && Date.now() - start > 1500) {
        fixed = true;
        break;
      }
    }
    check(`injected +${amount}s drift corrected automatically`, fixed, `${Date.now() - start} ms, residual ${((b.t - b.exp) * 1000).toFixed(0)} ms`);
    await sleep(1500);
  }

  // --- soft correction path with fine-grained playback rates ---
  const D = await newUser(browser, 'Dev', { rates: [0.9, 0.95, 1, 1.05, 1.1, 1.25, 1.5, 2] });
  await D.page.goto(`${APP}/room/${code}`);
  await D.page.waitForFunction(isPlaying, null, { timeout: 6000 });
  await sleep(2500);
  await D.page.evaluate(() => window.__wpController.injectDrift(-0.35));
  let sawSoft = false;
  let fixedSoft = false;
  const s0 = Date.now();
  while (Date.now() - s0 < 25000) {
    await sleep(300);
    const d = await probe(D.page);
    if (d.rate !== 1) sawSoft = true;
    if (sawSoft && d.rate === 1 && Math.abs(d.t - d.exp) < 0.15) {
      fixedSoft = true;
      break;
    }
  }
  check('0.35 s behind with fine rates: soft correction (1.05x) then back to 1x', sawSoft && fixedSoft, `${Date.now() - s0} ms`);

  // --- chat XSS + reactions + duplicate tab ---
  await A.page.getByRole('tab', { name: /Chat/ }).click();
  await A.page.locator('#chat-input').fill('<script>alert(1)</script>');
  await A.page.keyboard.press('Enter');
  await B.page.getByRole('tab', { name: /Chat/ }).click();
  await B.page.waitForFunction(() => [...document.querySelectorAll('.chat-bubble')].some((n) => n.textContent === '<script>alert(1)</script>'), null, { timeout: 3000 });
  check('chat renders <script> as plain text', (await B.page.locator('.chat-bubble script').count()) === 0);
  await A.page.getByRole('button', { name: 'React 🔥' }).click();
  await B.page.waitForSelector('.floating', { timeout: 3000 });
  check('reaction floats on the other tab', true);

  const A2 = await A.context.newPage();
  await A2.goto(`${APP}/room/${code}`);
  await A2.waitForSelector('.tabs');
  await A.page.waitForSelector('text=You opened this room in another tab', { timeout: 4000 });
  check('duplicate tab: the old tab shows "session replaced"', true);

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  for (const pg of globalThis.__pages || []) {
    const log = await pg.page.evaluate(() => (window.__wpLog || []).slice(-25)).catch(() => []);
    console.log(`--- ${pg.name} controller log ---`);
    for (const l of log) console.log(JSON.stringify(l));
  }
  process.exit(1);
});
