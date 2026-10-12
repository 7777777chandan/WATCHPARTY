/**
 * Failure-handling scenarios in real browser tabs. This script starts and kills its own server
 * on :3001 (stop yours first) and needs the Vite dev server on :5173.
 *
 *   cd e2e && npm run test:failure            (about 3.5 minutes: the real 15 s / 60 s grace periods)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP, sleep, reporter, newUser, player, createRoom, setVideo, userNames } from './lib.mjs';

const SERVER_DIR = fileURLToPath(new URL('../server/', import.meta.url));
const { check, results } = reporter();
let server = null;

async function startServer() {
  server = spawn(process.execPath, ['src/index.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: '3001', LOG_LEVEL: 'warn', TMDB_READ_TOKEN: '' }, // no token: TMDB "down"
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch('http://localhost:3001/health')).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error('server did not start (is something else on :3001?)');
}

async function stopServer() {
  if (!server) return;
  const proc = server;
  server = null;
  proc.kill('SIGKILL');
  await new Promise((r) => proc.once('exit', r));
}

const drop = (page, ms) =>
  page.evaluate((d) => {
    window.__wpSocket.disconnect();
    setTimeout(() => window.__wpSocket.connect(), d);
  }, ms);

const synced = async (a, b, tol = 0.4) => {
  const pa = await player(a.page);
  const pb = await player(b.page);
  return { ok: Math.abs(pa.t - pb.t) < tol && pa.state === pb.state, detail: `t ${pa.t.toFixed(2)} / ${pb.t.toFixed(2)}, state ${pa.state}/${pb.state}` };
};

async function main() {
  await startServer();
  const browser = await chromium.launch();
  const A = await newUser(browser, 'Alice', { errorVideos: ['BLOCKEDvid1'] });
  const B = await newUser(browser, 'Bob', { errorVideos: ['BLOCKEDvid1'] });

  const code = await createRoom(A.page);
  await B.page.goto(`${APP}/room/${code}`);
  await B.page.waitForSelector('.tabs');
  await setVideo(A.page);
  await sleep(1500);
  await A.page.evaluate(() => window.__fakeYT.players.at(-1).userPlay());
  await B.page.waitForFunction(() => window.__fakeYT.players.at(-1).getPlayerState() === 1, null, { timeout: 4000 });

  // 1. Client network drop 3 s
  await drop(B.page, 3000);
  await sleep(1000);
  const during = await userNames(A.page);
  check('3 s drop: the user is greyed out (not removed) for others', during.some((u) => u.text.startsWith('Bob') && u.offline));
  await B.page.waitForSelector('.banner-ok', { timeout: 10000 });
  await sleep(2000);
  let s = await synced(A, B);
  check('3 s drop: back in the room and resynced', s.ok, s.detail);

  // 2. Host drop 5 s (inside the 15 s grace): keeps host
  await drop(A.page, 5000);
  await A.page.waitForSelector('.banner-ok', { timeout: 12000 });
  await sleep(1000);
  let users = await userNames(B.page);
  check('host away 5 s (inside 15 s grace): still host', users.find((u) => u.text.startsWith('Alice'))?.host === true);

  // 3. Host drop 20 s (outside the grace): host moves to Bob, Alice returns as a guest
  await drop(A.page, 20000);
  await B.page.waitForFunction(() => document.body.innerText.includes('You are now the host'), null, { timeout: 18000 });
  check('host away 20 s: host transferred after the 15 s grace', true);
  await A.page.waitForSelector('.banner-ok', { timeout: 15000 });
  await sleep(2000);
  users = await userNames(A.page);
  check('host away 20 s: returns as a guest, Bob stays host', users.find((u) => u.text.startsWith('Bob'))?.host === true && !users.find((u) => u.text.startsWith('Alice'))?.host, JSON.stringify(users));
  s = await synced(A, B);
  check('host away 20 s: resynced on return', s.ok, s.detail);

  // 4. Video that cannot be embedded: message + host can skip
  await B.page.getByRole('tab', { name: /Playlist/ }).click();
  await B.page.locator('#pl-url').fill('https://youtu.be/9bZkp7q19f0');
  await B.page.getByRole('button', { name: 'Add', exact: true }).click();
  await B.page.waitForSelector('.playlist-item');
  await setVideo(B.page, 'https://youtu.be/BLOCKEDvid1');
  await B.page.waitForSelector('text=does not allow this video to be embedded', { timeout: 4000 });
  await A.page.waitForSelector('text=does not allow this video to be embedded', { timeout: 4000 });
  check('unembeddable video: everyone sees an explanation', true);
  check('unembeddable video: guest is told the host can skip', (await A.page.locator('text=The host can skip').count()) === 1);
  await B.page.getByRole('button', { name: 'Skip to next' }).click();
  await A.page.waitForFunction(() => window.__fakeYT.players.at(-1).videoId === '9bZkp7q19f0', null, { timeout: 4000 });
  check('unembeddable video: host skip plays the next item for everyone', true);

  // 5. TMDB down (server has no token): movies tab shows an error, the rest keeps working
  await A.page.getByRole('tab', { name: /Movies/ }).click();
  await A.page.waitForSelector('text=Movie discovery is unavailable', { timeout: 6000 });
  await A.page.getByRole('tab', { name: /Chat/ }).click();
  await A.page.locator('#chat-input').fill('movies are down but chat works');
  await A.page.keyboard.press('Enter');
  await B.page.getByRole('tab', { name: /Chat/ }).click();
  await B.page.waitForSelector('text=movies are down but chat works', { timeout: 3000 });
  check('TMDB down: movies tab shows an error state, chat still works', true);

  // 6. A crashing panel is contained by its error boundary
  await A.page.evaluate(() => {
    window.__wpCrashPanel = 'chat';
  });
  await A.page.getByRole('tab', { name: /Playlist/ }).click();
  await A.page.getByRole('tab', { name: /Chat/ }).click();
  await A.page.waitForSelector('text=This panel crashed', { timeout: 3000 });
  const playerStillThere = (await A.page.locator('.player-wrap').count()) === 1;
  await A.page.evaluate(() => {
    window.__wpCrashPanel = null;
  });
  await A.page.getByRole('button', { name: 'Try again' }).click();
  await A.page.waitForSelector('#chat-input', { timeout: 3000 });
  check('panel crash: error boundary contains it, player keeps working, retry recovers', playerStillThere);

  // 7. Client network drop 90 s (beyond the 60 s removal grace): removed, then rejoins
  await A.page.evaluate(() => window.__fakeYT.players.at(-1).userPlay());
  await drop(B.page, 90000);
  const t0 = Date.now();
  await A.page.getByRole('tab', { name: /👥/ }).click();
  await A.page.waitForFunction(() => ![...document.querySelectorAll('.user-name')].some((n) => n.textContent.startsWith('Bob')), null, { timeout: 75000, polling: 500 });
  check('90 s drop: removed from the room after the 60 s grace', true, `${Math.round((Date.now() - t0) / 1000)} s`);
  await B.page.waitForSelector('.banner-ok', { timeout: 40000 });
  await sleep(2500);
  users = await userNames(A.page);
  s = await synced(A, B);
  check('90 s drop: rejoins automatically and resyncs', users.some((u) => u.text.startsWith('Bob') && !u.offline) && s.ok, s.detail);

  // 8. Server restart mid-session (state is in memory)
  await stopServer();
  await A.page.waitForSelector('text=Reconnecting', { timeout: 5000 });
  check('server down: clients show "Reconnecting..."', true);
  await sleep(2000);
  await startServer();
  await A.page.waitForSelector('text=This room no longer exists', { timeout: 15000 });
  await B.page.waitForSelector('text=This room no longer exists', { timeout: 15000 });
  check('server restarted: clients see "room no longer exists"', true);
  await A.page.getByRole('button', { name: 'Start a new room' }).click();
  await A.page.waitForURL((u) => !u.pathname.endsWith(code), { timeout: 5000 });
  await A.page.waitForSelector('.tabs', { timeout: 6000 });
  check('server restarted: one click recreates a room', true, A.page.url());

  await browser.close();
  await stopServer();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await stopServer();
  process.exit(1);
});
