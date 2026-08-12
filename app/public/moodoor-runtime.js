/* =============================================================================
 * moodoor-runtime.js — the bridge between the static storefront and the server.
 *
 * Two jobs:
 *
 * 1. `window.claude.complete()`. Moodoor Studio calls this host-provided global
 *    to run its EVS analysis. It exists only inside the environment studio.html
 *    was authored in, so the Studio was dead everywhere else. Here it posts to
 *    /api/ai/complete, which holds the API key server-side — the shape the
 *    archive's own studio_integration_notes.md asks for ("will not execute the
 *    uploaded client-side key handling ... use the project's protected server
 *    procedures").
 *
 * 2. Storefront hydration. The bundles / territories / drops pages shipped as
 *    hand-written HTML with no data layer, so nothing an owner did in the admin
 *    could ever show up on the site. Any element carrying `data-hydrate="<kind>"`
 *    is re-rendered from /api/public/<kind> using the same markup the page
 *    already had. If the API is unreachable the static markup simply stays —
 *    the safe fallback state the project's own checklist calls for.
 * ============================================================================= */
(function () {
  'use strict';

  var API = '/api';

  /* ------------------------------------------------------------------ *
   * 1. window.claude
   * ------------------------------------------------------------------ */

  if (!window.claude || typeof window.claude.complete !== 'function') {
    window.claude = window.claude || {};
    window.claude.complete = function (prompt, opts) {
      opts = opts || {};
      return fetch(API + '/ai/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt, maxTokens: opts.maxTokens || 1200 }),
      }).then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) {
            var err = new Error(body.error || ('Model request failed (' + r.status + ')'));
            err.code = body.code;
            err.status = r.status;
            throw err;
          }
          return body.completion;
        });
      });
    };
    window.claude.status = function () {
      return fetch(API + '/ai/status').then(function (r) { return r.json(); });
    };
  }

  /* ------------------------------------------------------------------ *
   * 2. Hydration
   * ------------------------------------------------------------------ */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function get(kind) {
    return fetch(API + '/public/' + kind, { headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error(kind + ': ' + r.status);
        return r.json();
      })
      .then(function (b) { return b.data; });
  }

  /* Templates reproduce the markup each page already ships, so a hydrated card
   * and a static one are indistinguishable — same classes, same structure, same
   * reveal animation hooks. Only the copy comes from the database. */

  var TEMPLATES = {
    bundles: function (b) {
      var items = (b.items || []).map(function (i) { return '<li>' + i.html + '</li>'; }).join('');
      var href = b.ctaHref || 'signature-wreaths.html';
      return '<article class="bundle reveal">' +
        '<div class="b-visual ' + esc(b.visualClass || 'v1') + '">' +
          '<span class="b-price">' + esc(b.priceLabel || ('$' + b.price)) + '</span>' +
          (b.saving ? '<span class="save">' + esc(b.saving) + '</span>' : '') +
          '<div class="trio">' + (b.trioHtml || '') + '</div>' +
        '</div>' +
        '<div class="b-copy">' +
          '<span class="overline">' + esc(b.territory) + '</span>' +
          '<h2>' + esc(b.name) + '</h2>' +
          '<p class="b-lede">' + esc(b.lede) + '</p>' +
          '<p class="desc">' + esc(b.desc) + '</p>' +
          '<ul class="b-list">' + items + '</ul>' +
          '<a class="b-cta" href="' + esc(href) + '">Get the collection <span>&rarr;</span></a>' +
        '</div>' +
      '</article>';
    },

    territories: function (t) {
      var sig = (t.signature || []).map(function (s) {
        return '<div class="sig-row"><span>' + esc(s.label) + '</span>' +
          '<div class="sig-track"><div class="sig-fill" data-v="' + Number(s.value) + '"></div></div>' +
          '<span>.' + String(s.value).padStart(2, '0') + '</span></div>';
      }).join('');
      return '<article class="terr reveal">' +
        '<div class="t-visual ' + esc(t.visualClass || 'v-comfort') + '">' +
          '<span class="num">' + esc(t.numeral) + '</span>' +
          '<span class="count">' + Number(t.designCount) + ' designs</span>' +
          (t.visualSvg || '') +
        '</div>' +
        '<div class="t-body">' +
          '<span class="overline">' + esc(t.overline) + '</span>' +
          '<h2>' + esc(t.name) + '</h2>' +
          '<p class="t-lede">' + esc(t.lede) + '</p>' +
          '<p class="desc">' + esc(t.desc) + '</p>' +
          '<div class="sig"><h5>Territory signature</h5>' + sig + '</div>' +
          '<div class="t-foot"><span class="samples">' + esc(t.samples) + '</span>' +
          '<a href="' + esc(t.browseHref || 'signature-wreaths.html') + '">Browse ' + esc(t.name) + ' &rarr;</a></div>' +
        '</div>' +
      '</article>';
    },

    drops: function (d) {
      var tags = (d.tags || []).map(function (t) {
        return '<span class="d-tag' + (t.amber ? ' amber' : '') + '">' + esc(t.label) + '</span>';
      }).join('');
      return '<article class="drop reveal">' +
        '<div class="d-when"><b>' + esc(d.dropNumber) + '</b>' + esc(d.timingLabel) +
          '<span class="status ' + esc(d.status) + '">' + esc(d.statusLabel || d.status) + '</span></div>' +
        '<div class="d-body">' +
          '<h2>' + esc(d.title) + '</h2>' +
          '<p class="d-lede">' + esc(d.lede) + '</p>' +
          '<p class="desc">' + esc(d.desc) + '</p>' +
          '<div class="d-tags">' + tags + '</div>' +
        '</div>' +
      '</article>';
    },
  };

  function hydrate() {
    var targets = document.querySelectorAll('[data-hydrate]');
    if (!targets.length) return;

    Array.prototype.forEach.call(targets, function (el) {
      var kind = el.getAttribute('data-hydrate');
      var tpl = TEMPLATES[kind];
      if (!tpl) return;

      get(kind).then(function (rows) {
        if (!rows || !rows.length) return;               // keep the static markup
        el.innerHTML = rows.map(tpl).join('');
        el.setAttribute('data-hydrated', String(rows.length));
        replayReveal(el);
        fillSignatureBars(el);
      }).catch(function () {
        // Offline or API down: the page keeps the copy it was built with.
        el.setAttribute('data-hydrated', 'static');
      });
    });
  }

  /* Each page animates cards in with an IntersectionObserver over `.reveal`.
   * Replaced nodes never saw that observer, so they are revealed directly. */
  function replayReveal(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll('.reveal'), function (el, i) {
      el.style.transitionDelay = (i * 70) + 'ms';
      requestAnimationFrame(function () { el.classList.add('in', 'visible', 'show'); });
    });
  }

  /* Signature bars are widened from their data-v by each page's own script,
   * which has already run by the time hydration lands. */
  function fillSignatureBars(scope) {
    setTimeout(function () {
      Array.prototype.forEach.call(scope.querySelectorAll('.sig-fill[data-v]'), function (f) {
        f.style.width = f.getAttribute('data-v') + '%';
      });
    }, 60);
  }

  /* ------------------------------------------------------------------ *
   * 3. Sold-out awareness for the catalog grid
   *
   * The catalog page prices and links from wreaths-data.js. Run limits, though,
   * are the thing an owner actually changes day to day, so they come live.
   * ------------------------------------------------------------------ */

  function markRunState() {
    var cards = document.querySelectorAll('[data-product]');
    if (!cards.length) return;
    get('products').then(function (rows) {
      var bySlug = {};
      rows.forEach(function (r) { bySlug[r.slug] = r; });
      Array.prototype.forEach.call(cards, function (card) {
        var p = bySlug[card.getAttribute('data-product')];
        var chip = card.querySelector('.run-chip');
        if (!p || !chip) return;
        chip.textContent = p.soldOut
          ? 'Run sold through'
          : p.runRemaining + ' of ' + p.runTotal + ' remaining';
        chip.classList.toggle('low', !p.soldOut && p.runRemaining <= 2);
        chip.classList.toggle('sold-out', Boolean(p.soldOut));
        card.classList.toggle('is-sold-out', Boolean(p.soldOut));
      });
    }).catch(function () { /* the copy the page shipped with stands */ });
  }

  function start() { hydrate(); markRunState(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.MoodoorRuntime = { hydrate: hydrate, get: get, templates: TEMPLATES };
})();
