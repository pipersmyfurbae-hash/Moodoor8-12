/**
 * a11y-check.mjs — accessibility audit across every page.
 *
 * Checks what can be verified mechanically and matters in practice: landmarks
 * and page titles, one visible <h1>, a gapless heading outline, `alt` on
 * images, an accessible name on every control, a label on every form field,
 * and decorative graphics hidden from assistive technology.
 *
 * The archive's markup was sound on the fundamentals — the first run found no
 * missing `alt`, no unnamed control, and one unlabelled field in total. What it
 * did find: 149 decorative <svg> announced as unlabelled graphics, five pages
 * with no main landmark, and nine whose heading outline skipped a level.
 *
 * Three of its own early findings were faults in this script rather than in the
 * pages — it looked for a literal <main> and missed `role="main"`, counted a
 * hidden success-state <h1> as a duplicate, and read heading tags while
 * ignoring `aria-level`. All three are fixed. A checker is worth only the trust
 * its last false positive earned.
 *
 * Usage: node tools/a11y-check.mjs [baseUrl]   — exits non-zero on any finding.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
let chromium;
for (const spec of ['playwright', '/tmp/pw/node_modules/playwright']) {
  try { ({ chromium } = createRequire(import.meta.url)(spec)); break; } catch { /* next */ }
}
if (!chromium) { console.error('playwright is not installed.'); process.exit(2); }
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const root of [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean)) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root).sort().reverse()) {
      for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
        const p = path.join(root, dir, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return undefined;
}
const b = await chromium.launch({ executablePath: findChromium() });
const ctx = await b.newContext({ viewport:{width:1440,height:1000} });
await ctx.route('**/*', r => r.request().url().startsWith('http://localhost:3000') ? r.continue() : r.fulfill({status:200,contentType:'text/css',body:''}));

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');
const PAGES = ['/', '/signature-wreaths.html', '/moodoor-product-page.html?w=september-porch',
  '/collection-bundles.html', '/territories.html', '/upcoming-drops.html',
  '/digital-blueprints.html', '/how-matching-works.html', '/checkout.html',
  '/stories.html', '/studio.html', '/admin', '/404.html'];

const all = {};
for (const url of PAGES) {
  const p = await ctx.newPage();
  await p.goto(BASE + url, { waitUntil: 'load' });
  await p.waitForTimeout(700);
  all[url] = await p.evaluate(() => {
    const issues = [];
    const name = el => (el.getAttribute('aria-label') || el.getAttribute('title') ||
      (el.getAttribute('aria-labelledby') ? (document.getElementById(el.getAttribute('aria-labelledby'))||{}).textContent : '') ||
      el.textContent || '').trim();
    const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none'; };

    if (!document.documentElement.lang) issues.push('<html> has no lang attribute');
    if (!document.title || document.title.length < 3) issues.push('no page title');
    if (!document.querySelector('main, [role="main"]')) issues.push('no main landmark');
    if (!document.querySelector('h1')) issues.push('no <h1>');
    const shownH1 = [...document.querySelectorAll('h1')].filter(vis);
    if (shownH1.length > 1) issues.push(shownH1.length+' visible <h1> elements');

    document.querySelectorAll('img').forEach(i => {
      if (!i.hasAttribute('alt')) issues.push(`img with no alt: ${(i.getAttribute('src')||'').slice(-32)}`); });

    document.querySelectorAll('button, a[href], [role="button"]').forEach(el => {
      if (vis(el) && !name(el) && !el.querySelector('img[alt]:not([alt=""])'))
        issues.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} has no accessible name`); });

    document.querySelectorAll('input, select, textarea').forEach(el => {
      if (el.type === 'hidden' || !vis(el)) return;
      const lbl = el.labels && el.labels.length, aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      if (!lbl && !aria) issues.push(`${el.tagName.toLowerCase()}#${el.id||'(no id)'} has no label`); });

    // heading order
    let prev = 0;
    document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]').forEach(h => {
      // aria-level overrides the tag's implicit level, and is what a screen
      // reader actually announces.
      const lvl = Number(h.getAttribute('aria-level')) || Number(h.tagName[1]);
      if (prev && lvl > prev + 1) issues.push(`heading jumps h${prev} -> h${lvl}: "${h.textContent.trim().slice(0,26)}"`);
      prev = lvl; });

    // svg that conveys meaning but is not hidden from AT
    let decorativeSvg = 0;
    document.querySelectorAll('svg').forEach(s => {
      if (!s.getAttribute('aria-hidden') && !s.getAttribute('role') && !s.querySelector('title')) decorativeSvg++; });
    if (decorativeSvg) issues.push(`${decorativeSvg} <svg> not marked aria-hidden or given a role/title`);

    return [...new Set(issues)];
  });
  await p.close();
}
for (const [u, list] of Object.entries(all)) {
  console.log('\n' + u + '  (' + list.length + ')');
  list.slice(0,8).forEach(i => console.log('   - ' + i));
}
const total = Object.values(all).reduce((n,l)=>n+l.length,0);
await b.close();
if (total) {
  console.error(`\n  ${total} accessibility issue(s).\n`);
  process.exit(1);
}
console.log('\n  No accessibility issues across ' + PAGES.length + ' pages.\n');
