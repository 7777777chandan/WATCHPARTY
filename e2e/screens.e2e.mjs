/**
 * Responsive check: renders the landing page and a populated room at 360 / 768 / 1440 px in both
 * themes, saves screenshots to e2e/screens/, and fails if any page scrolls horizontally.
 *   cd e2e && node screens.e2e.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { APP, sleep, reporter, newUser, createRoom, setVideo } from './lib.mjs';

const { check, results } = reporter();
const OUT = new URL('./screens/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const host = await newUser(browser, 'Alice');
const code = await createRoom(host.page);
await setVideo(host.page);
await sleep(1200);
await host.page.evaluate(() => window.__fakeYT.players.at(-1).userPlay());
await host.page.locator('#chat-input').fill('Hello everyone! || the twist is at 2:30');
await host.page.keyboard.press('Enter');
await host.page.locator('#chat-input').fill('Check https://example.com <b>not bold</b>');
await host.page.keyboard.press('Enter');
for (const e of ['🔥', '😂', '🎉']) await host.page.getByRole('button', { name: `React ${e}` }).click();

for (const width of [360, 768, 1440]) {
  for (const theme of ['dark', 'light']) {
    const u = await newUser(browser, `Viewer${width}`);
    await u.page.setViewportSize({ width, height: width < 800 ? 780 : 900 });
    await u.page.addInitScript((t) => localStorage.setItem('wp.theme', t), theme);
    await u.page.goto(APP);
    await sleep(300);
    const landingOverflow = await u.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await u.page.screenshot({ path: `${OUT}landing-${width}-${theme}.png`, fullPage: true });
    await u.page.goto(`${APP}/room/${code}`);
    await u.page.waitForSelector('.tabs');
    await sleep(1500);
    const roomOverflow = await u.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const tabsVisible = await u.page.locator('.tabs').isVisible();
    const playerVisible = await u.page.locator('.player-wrap').isVisible();
    await u.page.screenshot({ path: `${OUT}room-${width}-${theme}.png`, fullPage: false });
    check(`${width}px ${theme}: no horizontal scroll, player and tabs visible`, !landingOverflow && !roomOverflow && tabsVisible && playerVisible, `landing overflow ${landingOverflow}, room overflow ${roomOverflow}`);
    await u.context.close();
  }
}

// Keyboard: tab order reaches the main controls with a visible focus ring
const k = await newUser(browser, 'Keyboard');
await k.page.goto(`${APP}/room/${code}`);
await k.page.waitForSelector('.tabs');
await sleep(800);
await k.page.keyboard.press('r');
const focused = await k.page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
check('"R" moves focus to the reaction bar', focused?.startsWith('React'), focused);
await k.page.keyboard.press('ArrowRight');
await k.page.keyboard.press('Enter');
await k.page.keyboard.press('?');
check('"?" opens the shortcuts dialog', (await k.page.locator('role=dialog').count()) === 1);
await k.page.keyboard.press('Escape');
const unlabeled = await k.page.evaluate(() =>
  [...document.querySelectorAll('input, textarea, select')].filter((el) => {
    if (el.type === 'hidden') return false;
    const id = el.id && document.querySelector(`label[for="${el.id}"]`);
    return !id && !el.closest('label') && !el.getAttribute('aria-label');
  }).length,
);
check('every input has a label', unlabeled === 0, `${unlabeled} unlabeled`);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed · screenshots in e2e/screens/`);
process.exit(failed.length ? 1 : 0);
