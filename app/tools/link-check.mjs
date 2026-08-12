/**
 * link-check.mjs — crawls the running site and fails on any dead reference.
 *
 * Checks, for every reachable page:
 *   - <a href>            internal pages and in-page #anchors
 *   - <script src>        including the ../-relative ones the Studio uses
 *   - <link href>         stylesheets, icons, preloads
 *   - <img src>, srcset
 *   - CSS url(...) inside <style> blocks
 *
 * An in-page anchor is only counted as good if an element with that id (or a
 * matching <a name>) actually exists on the target page — a link to #waitlist
 * that scrolls nowhere is a broken link, even though the server returns 200.
 *
 * Usage: node tools/link-check.mjs [baseUrl]
 */
const BASE = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

/**
 * Entry points. checkout.html is only ever reached from the cart drawer's
 * JavaScript, and each product page is a query-string variant, so neither is
 * discoverable by following markup alone — they are seeded explicitly.
 */
const START = ['/', '/studio.html', '/admin', '/checkout.html'];

try {
  const r = await fetch(BASE + '/api/public/products');
  if (r.ok) {
    const { data } = await r.json();
    for (const p of data) START.push(`/moodoor-product-page.html?w=${p.slug}`);
  }
} catch {
  console.warn('  (product list unavailable — checking static pages only)');
}

const pages = new Map();      // path -> html
const checked = new Map();    // url  -> status
const problems = [];
const queue = [...START];
const seen = new Set(START);

const isExternal = (u) => /^(https?:)?\/\//i.test(u) || /^(mailto|tel|data|javascript|blob):/i.test(u);

function resolve(from, ref) {
  try { return new URL(ref, BASE + from); } catch { return null; }
}

async function head(url) {
  const key = url.pathname + url.search;
  if (checked.has(key)) return checked.get(key);
  let status;
  try {
    const r = await fetch(url, { headers: { Accept: 'text/html,*/*' } });
    status = r.status;
    if (r.ok && (r.headers.get('content-type') || '').includes('text/html')) {
      // Keyed with the query string: /moodoor-product-page.html?w=a and ?w=b
      // are different documents with different links.
      pages.set(key, await r.text());
    }
  } catch (e) {
    status = 'ERR ' + e.message;
  }
  checked.set(key, status);
  return status;
}

function refsIn(html) {
  const out = [];
  const push = (ref, kind) => {
    const v = (ref || '').trim();
    if (!v) return;
    // Skip hrefs that are really JavaScript string concatenation caught inside a
    // template, e.g. href="moodoor-product-page.html?w=' + rs + '". Those links
    // only exist once the page runs, and are verified by the rendered-DOM pass
    // in tools/verify.mjs instead.
    if (/['"]\s*\+|\$\{|\+\s*['"]/.test(v)) return;
    out.push({ ref: v, kind });
  };

  for (const m of html.matchAll(/<a\b[^>]*?\shref\s*=\s*"([^"]*)"/gi)) push(m[1], 'link');
  for (const m of html.matchAll(/<script\b[^>]*?\ssrc\s*=\s*"([^"]*)"/gi)) push(m[1], 'script');
  for (const m of html.matchAll(/<link\b[^>]*?\shref\s*=\s*"([^"]*)"/gi)) push(m[1], 'stylesheet');
  for (const m of html.matchAll(/<img\b[^>]*?\ssrc\s*=\s*"([^"]*)"/gi)) push(m[1], 'image');
  for (const m of html.matchAll(/<(?:img|source)\b[^>]*?\ssrcset\s*=\s*"([^"]*)"/gi)) {
    for (const part of m[1].split(',')) push(part.trim().split(/\s+/)[0], 'image');
  }
  for (const style of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    // Blank out data: URIs first. An inline SVG data URI legitimately contains
    // its own `url(%23n)` filter reference, and matching that as a site asset
    // reports a 404 for something that was never a request.
    const css = style[1].replace(/url\(\s*(['"]?)data:[\s\S]*?\1\s*\)/gi, 'url(data-uri)');
    for (const u of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
      const ref = u[1];
      // `url(#id)` / `url(%23id)` point at an element in the document, not a file.
      if (ref === 'data-uri' || ref.startsWith('#') || ref.startsWith('%23')) continue;
      push(ref, 'css-asset');
    }
  }
  return out;
}

function hasAnchor(html, id) {
  if (!id) return true;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\sid\\s*=\\s*["']${escaped}["']`, 'i').test(html) ||
         new RegExp(`<a[^>]*\\sname\\s*=\\s*["']${escaped}["']`, 'i').test(html);
}

/* ---- crawl ---- */

while (queue.length) {
  const path = queue.shift();
  const url = resolve('/', path);
  const status = await head(url);
  if (status !== 200) {
    problems.push({ from: '(entry)', ref: path, kind: 'page', status });
    continue;
  }
  const html = pages.get(url.pathname + url.search);
  if (!html) continue;

  for (const { ref, kind } of refsIn(html)) {
    if (isExternal(ref)) continue;

    if (ref.startsWith('#')) {
      if (!hasAnchor(html, ref.slice(1))) {
        problems.push({ from: path, ref, kind: 'anchor', status: 'no element with that id' });
      }
      continue;
    }

    const target = resolve(path, ref);
    if (!target) { problems.push({ from: path, ref, kind, status: 'unparseable' }); continue; }

    const st = await head(target);
    if (st !== 200) {
      problems.push({ from: path, ref, kind, status: st });
      continue;
    }

    if (target.hash) {
      const targetHtml = pages.get(target.pathname + target.search);
      if (targetHtml && !hasAnchor(targetHtml, target.hash.slice(1))) {
        problems.push({ from: path, ref, kind: 'anchor', status: 'no element with that id on target' });
      }
    }

    // Follow same-origin HTML pages.
    const isHtml = /\.html?$/.test(target.pathname) || !/\.[a-z0-9]+$/i.test(target.pathname);
    const next = target.pathname + target.search;
    if (isHtml && !seen.has(next)) {
      seen.add(next);
      queue.push(next);
    }
  }
}

/* ---- report ---- */

console.log(`crawled ${seen.size} page(s), checked ${checked.size} distinct reference(s)`);

if (!problems.length) {
  console.log('\n  No broken links.\n');
  for (const p of [...seen].sort()) console.log('    200  ' + p);
  process.exit(0);
}

console.error(`\n  ${problems.length} broken reference(s):\n`);
for (const p of problems) {
  console.error(`    ${String(p.status).padEnd(28)} ${p.kind.padEnd(11)} ${p.ref}\n${' '.repeat(6)}on ${p.from}`);
}
process.exit(1);
