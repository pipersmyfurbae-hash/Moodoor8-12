/* ============================================================
   Moodoor cart — shared across all pages
   localStorage-backed cart, nav badge, slide-in drawer.
   Include with <script src="cart.js" defer></script>
   Add items via: Moodoor.add({id,name,variant,price,type})
   ============================================================ */
(function () {
  var KEY = 'moodoor_cart_v1';
  var money = function (n) { return '$' + n.toLocaleString('en-US'); };

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { return []; }
  }
  function write(items) {
    localStorage.setItem(KEY, JSON.stringify(items));
    render();
  }
  function count() { return read().reduce(function (s, i) { return s + i.qty; }, 0); }
  function total() { return read().reduce(function (s, i) { return s + i.price * i.qty; }, 0); }

  function add(item) {
    var items = read();
    var existing = items.find(function (i) { return i.id === item.id; });
    if (existing) { existing.qty += 1; }
    else { items.push(Object.assign({ qty: 1 }, item)); }
    write(items);
    open();
    flash(item.name);
  }
  function setQty(id, qty) {
    var items = read();
    var it = items.find(function (i) { return i.id === id; });
    if (!it) return;
    it.qty = qty;
    if (it.qty <= 0) items = items.filter(function (i) { return i.id !== id; });
    write(items);
  }
  function remove(id) { write(read().filter(function (i) { return i.id !== id; })); }
  function clear() { localStorage.removeItem(KEY); render(); }

  /* ---------- thumbnail by type ---------- */
  function thumb(type) {
    if (type === 'blueprint') {
      return '<svg width="34" height="34" viewBox="0 0 40 40" fill="none"><rect x="5" y="5" width="30" height="30" rx="4" fill="#fff" stroke="#E8E8E8"/><circle cx="20" cy="20" r="11" stroke="#4A6741" stroke-width="1" stroke-dasharray="3 3"/><circle cx="15" cy="15" r="3.5" fill="#EEF2ED" stroke="#4A6741" stroke-width=".8"/></svg>';
    }
    if (type === 'bundle') {
      return '<svg width="34" height="34" viewBox="0 0 40 40" fill="none"><circle cx="14" cy="20" r="9" fill="#F2EFE9" stroke="#C4922A" stroke-width="1"/><circle cx="26" cy="20" r="9" fill="#EEF2ED" stroke="#4A6741" stroke-width="1"/></svg>';
    }
    return '<svg width="34" height="34" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="14" stroke="#8A7458" stroke-width="1.4" opacity=".6" stroke-dasharray="8 3 5 2"/><circle cx="13" cy="13" r="4.5" fill="#EEF2ED" stroke="#4A6741"/><circle cx="27" cy="27" r="3" fill="#F9F7F4" stroke="#6B8F67"/><circle cx="28" cy="14" r="1.8" fill="#C4922A"/></svg>';
  }

  /* ---------- DOM ---------- */
  var styleTag, btnEl, badgeEl, drawerEl, backdropEl, flashEl;

  function injectStyles() {
    if (document.getElementById('moodoor-cart-style')) return;
    var css = ''
      + '.mc-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:9999px;background:transparent;border:none;cursor:pointer;color:#1A1A1A;transition:color .2s ease,background .2s ease;margin-left:4px}'
      + '.mc-btn:hover{color:#4A6741;background:#EEF2ED}'
      + '.mc-badge{position:absolute;top:2px;right:1px;min-width:17px;height:17px;padding:0 4px;border-radius:9999px;background:#4A6741;color:#F9F7F4;font:600 10px/17px Inter,system-ui,sans-serif;text-align:center;transform:scale(0);transition:transform .25s cubic-bezier(.2,1.3,.4,1)}'
      + '.mc-badge.show{transform:scale(1)}'
      + '.mc-backdrop{position:fixed;inset:0;background:rgba(26,26,26,.32);opacity:0;pointer-events:none;z-index:1000}'
      + '.mc-backdrop.open{opacity:1;pointer-events:auto}'
      + '.mc-drawer{position:fixed;top:0;right:0;bottom:0;width:min(420px,100%);background:#F9F7F4;box-shadow:-12px 0 40px rgba(0,0,0,.12);transform:translateX(100%);z-index:1001;display:flex;flex-direction:column;font-family:Inter,system-ui,sans-serif}'
      + '.mc-drawer.open{transform:translateX(0)}'
      + '.mc-head{display:flex;align-items:center;justify-content:space-between;padding:24px 26px 18px;border-bottom:1px solid #E8E8E8}'
      + '.mc-head h3{font-family:"Cormorant Garamond",Georgia,serif;font-weight:400;font-size:26px;color:#1A1A1A;margin:0}'
      + '.mc-head .mc-sub{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#787878;margin-top:2px;font-weight:600}'
      + '.mc-x{background:none;border:none;cursor:pointer;color:#787878;width:34px;height:34px;border-radius:9999px;display:flex;align-items:center;justify-content:center;transition:background .2s,color .2s}'
      + '.mc-x:hover{background:#EEF2ED;color:#4A6741}'
      + '.mc-body{flex:1;overflow-y:auto;padding:8px 26px}'
      + '.mc-item{display:grid;grid-template-columns:48px 1fr auto;gap:14px;align-items:center;padding:18px 0;border-bottom:1px solid #EFEDE8}'
      + '.mc-thumb{width:48px;height:48px;border-radius:9999px;border:1.5px solid #EEF2ED;display:flex;align-items:center;justify-content:center;background:#fff}'
      + '.mc-name{font-family:"Cormorant Garamond",Georgia,serif;font-size:19px;color:#1A1A1A;line-height:1.15}'
      + '.mc-variant{font-size:11px;color:#787878;letter-spacing:.04em;margin-top:2px}'
      + '.mc-qty{display:inline-flex;align-items:center;gap:9px;margin-top:9px}'
      + '.mc-qty button{width:22px;height:22px;border-radius:9999px;border:1px solid #D0D0D0;background:#fff;color:#4A4A4A;cursor:pointer;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;transition:border-color .2s,color .2s}'
      + '.mc-qty button:hover{border-color:#6B8F67;color:#4A6741}'
      + '.mc-qty span{font-size:13px;min-width:16px;text-align:center;font-variant-numeric:tabular-nums}'
      + '.mc-line-price{font-family:"Cormorant Garamond",Georgia,serif;font-size:19px;color:#4A6741;text-align:right;white-space:nowrap}'
      + '.mc-remove{display:block;margin-top:6px;font-size:11px;color:#A8A8A8;background:none;border:none;cursor:pointer;text-align:right;width:100%;transition:color .2s}'
      + '.mc-remove:hover{color:#B94040}'
      + '.mc-empty{text-align:center;padding:64px 20px;color:#787878}'
      + '.mc-empty svg{opacity:.6;margin-bottom:18px}'
      + '.mc-empty p{font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-size:20px;color:#4A4A4A;margin:0 0 6px}'
      + '.mc-empty small{font-size:13px}'
      + '.mc-empty a{display:inline-block;margin-top:22px;font-size:13px;font-weight:600;color:#4A6741;text-decoration:none;border-bottom:1.5px solid #6B8F67;padding-bottom:3px}'
      + '.mc-foot{border-top:1px solid #E8E8E8;padding:22px 26px 26px;background:#fff}'
      + '.mc-rowline{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;font-size:13px;color:#4A4A4A}'
      + '.mc-total{display:flex;justify-content:space-between;align-items:baseline;margin:10px 0 18px}'
      + '.mc-total .l{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#787878;font-weight:600}'
      + '.mc-total .v{font-family:"Cormorant Garamond",Georgia,serif;font-size:30px;color:#1A1A1A}'
      + '.mc-checkout{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;padding:15px;border-radius:9999px;background:#4A6741;color:#F9F7F4;font:600 14px Inter,system-ui,sans-serif;border:none;cursor:pointer;text-decoration:none;transition:transform .2s,box-shadow .2s}'
      + '.mc-checkout:hover{transform:scale(1.01);box-shadow:0 8px 22px rgba(74,103,65,.28)}'
      + '.mc-fine{text-align:center;font-size:11px;color:#A8A8A8;margin-top:12px}'
      + '.mc-flash{position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);background:#1A1A1A;color:#F9F7F4;padding:12px 22px;border-radius:9999px;font:500 13px Inter,system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.2);opacity:0;pointer-events:none;transition:opacity .3s,transform .3s;z-index:1002;display:flex;align-items:center;gap:9px}'
      + '.mc-flash.show{opacity:1;transform:translate(-50%,0)}'
      + '.mc-flash svg{color:#6B8F67}'
      + '.mc-quick{position:absolute;bottom:14px;right:14px;width:38px;height:38px;border-radius:9999px;background:#4A6741;color:#F9F7F4;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0;transform:translateY(6px);transition:opacity .2s,transform .2s,box-shadow .2s;z-index:4}'
      + '.card:hover .mc-quick,.bp-card:hover .mc-quick,.mc-quick:focus-visible{opacity:1;transform:translateY(0)}'
      + '.mc-quick:hover{box-shadow:0 6px 16px rgba(74,103,65,.34)}'
      + '@media(hover:none){.mc-quick{opacity:1;transform:none}}'
      + '@media(max-width:900px){.moodoor-cart-li{display:flex !important}}';
    styleTag = document.createElement('style');
    styleTag.id = 'moodoor-cart-style';
    styleTag.textContent = css;
    document.head.appendChild(styleTag);
  }

  function injectButton() {
    var navLinks = document.querySelector('.nav-links');
    if (!navLinks) return; // pages without a nav menu (e.g. checkout) skip the cart button
    var bagSvg = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>';
    btnEl = document.createElement('button');
    btnEl.className = 'mc-btn';
    btnEl.setAttribute('aria-label', 'Open cart');
    btnEl.innerHTML = bagSvg + '<span class="mc-badge">0</span>';
    btnEl.addEventListener('click', open);
    badgeEl = btnEl.querySelector('.mc-badge');
    var li = document.createElement('li');
    li.className = 'moodoor-cart-li';
    li.style.display = 'flex';
    li.style.alignItems = 'center';
    li.appendChild(btnEl);
    navLinks.appendChild(li);
  }

  function injectDrawer() {
    backdropEl = document.createElement('div');
    backdropEl.className = 'mc-backdrop';
    backdropEl.addEventListener('click', close);
    drawerEl = document.createElement('aside');
    drawerEl.className = 'mc-drawer';
    drawerEl.setAttribute('aria-label', 'Cart');
    document.body.appendChild(backdropEl);
    document.body.appendChild(drawerEl);
    flashEl = document.createElement('div');
    flashEl.className = 'mc-flash';
    document.body.appendChild(flashEl);
  }

  function render() {
    if (badgeEl) {
      var c = count();
      badgeEl.textContent = c;
      badgeEl.classList.toggle('show', c > 0);
    }
    if (!drawerEl) return;
    var items = read();
    var html = ''
      + '<div class="mc-head"><div><div class="mc-sub">Your cart</div><h3>' + (count() ? count() + (count() === 1 ? ' item' : ' items') : 'Empty') + '</h3></div>'
      + '<button class="mc-x" aria-label="Close cart"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>';

    if (!items.length) {
      html += '<div class="mc-body"><div class="mc-empty">'
        + '<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#6B8F67" stroke-width="1.2"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>'
        + '<p>Nothing here yet.</p><small>Every wreath starts with a memory.</small>'
        + '<a href="index.html#memory">Begin a memory &rarr;</a>'
        + '</div></div>';
    } else {
      html += '<div class="mc-body">';
      items.forEach(function (i) {
        html += '<div class="mc-item">'
          + '<div class="mc-thumb">' + thumb(i.type) + '</div>'
          + '<div><div class="mc-name">' + i.name + '</div><div class="mc-variant">' + (i.variant || '') + '</div>'
          + '<div class="mc-qty"><button data-dec="' + i.id + '" aria-label="Decrease">&minus;</button><span>' + i.qty + '</span><button data-inc="' + i.id + '" aria-label="Increase">+</button></div></div>'
          + '<div><div class="mc-line-price">' + money(i.price * i.qty) + '</div><button class="mc-remove" data-rm="' + i.id + '">Remove</button></div>'
          + '</div>';
      });
      html += '</div>';
      var hasWreath = items.some(function (i) { return i.type === 'wreath'; });
      html += '<div class="mc-foot">'
        + '<div class="mc-rowline"><span>Subtotal</span><span>' + money(total()) + '</span></div>'
        + '<div class="mc-rowline"><span>Shipping</span><span>' + (hasWreath ? 'Free' : '—') + '</span></div>'
        + '<div class="mc-total"><span class="l">Total</span><span class="v">' + money(total()) + '</span></div>'
        + '<a class="mc-checkout" href="checkout.html">Checkout <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>'
        + '<div class="mc-fine">' + (hasWreath ? 'Finished wreaths ship in small numbered runs.' : 'Blueprints deliver instantly after checkout.') + '</div>'
        + '</div>';
    }
    drawerEl.innerHTML = html;
    drawerEl.querySelector('.mc-x').addEventListener('click', close);
    drawerEl.querySelectorAll('[data-inc]').forEach(function (b) { b.addEventListener('click', function () { var id = b.getAttribute('data-inc'); setQty(id, qtyOf(id) + 1); }); });
    drawerEl.querySelectorAll('[data-dec]').forEach(function (b) { b.addEventListener('click', function () { var id = b.getAttribute('data-dec'); setQty(id, qtyOf(id) - 1); }); });
    drawerEl.querySelectorAll('[data-rm]').forEach(function (b) { b.addEventListener('click', function () { remove(b.getAttribute('data-rm')); }); });
  }
  function qtyOf(id) { var it = read().find(function (i) { return i.id === id; }); return it ? it.qty : 0; }

  // Preview host hijacks CSS transitions (holds them at frame 0). Cancel any
  // injected animations on the drawer/backdrop so they settle to target state.
  function settle() {
    var n = 0;
    function tick() {
      [drawerEl, backdropEl, flashEl].forEach(function (el) {
        if (el) el.getAnimations().forEach(function (a) { try { a.cancel(); } catch (e) {} });
      });
      if (n++ < 24) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  function open() { if (drawerEl) { drawerEl.classList.add('open'); backdropEl.classList.add('open'); settle(); } }
  function close() { if (drawerEl) { drawerEl.classList.remove('open'); backdropEl.classList.remove('open'); settle(); } }

  var flashTimer;
  function flash(name) {
    if (!flashEl) return;
    flashEl.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 13l4 4L19 7"/></svg> Added ' + name + ' to cart';
    flashEl.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flashEl.classList.remove('show'); }, 2200);
  }

  /* ---------- wire declarative buttons ---------- */
  function wireButtons() {
    document.querySelectorAll('[data-add-to-cart]').forEach(function (el) {
      if (el.__mcWired) return;
      el.__mcWired = true;
      el.addEventListener('click', function (e) {
        e.preventDefault();
        add({
          id: el.getAttribute('data-id'),
          name: el.getAttribute('data-name'),
          variant: el.getAttribute('data-variant') || '',
          price: parseFloat(el.getAttribute('data-price')) || 0,
          type: el.getAttribute('data-type') || 'wreath'
        });
      });
    });
  }

  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function wireShopCards() {
    document.querySelectorAll('.card, .bp-card').forEach(function (card) {
      if (card.__qaWired) return;
      var h3 = card.querySelector('h3');
      var priceEl = card.querySelector('.price');
      if (!h3 || !priceEl) return;
      card.__qaWired = true;
      var isBp = card.classList.contains('bp-card');
      var name = h3.textContent.trim();
      var price = parseFloat(priceEl.textContent.replace(/[^0-9.]/g, '')) || 0;
      var btn = document.createElement('button');
      btn.className = 'mc-quick';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Add ' + name + ' to cart');
      btn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>';
      btn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        add({ id: slug(name) + (isBp ? '-blueprint' : '-finished'), name: name, variant: isBp ? 'Digital blueprint' : 'Finished wreath', price: price, type: isBp ? 'blueprint' : 'wreath' });
      });
      var host = card.querySelector('.card-visual') || card.querySelector('.bp-mini') || card;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.appendChild(btn);
    });
  }

  function wireBundles() {
    document.querySelectorAll('.bundle').forEach(function (b) {
      var cta = b.querySelector('.b-cta');
      var h2 = b.querySelector('h2');
      var priceEl = b.querySelector('.b-price');
      if (!cta || !h2 || !priceEl || cta.__bWired) return;
      cta.__bWired = true;
      var name = h2.textContent.trim();
      var m = priceEl.textContent.match(/\$\s*([\d,]+)/);
      var price = m ? parseFloat(m[1].replace(/,/g, '')) : 0;
      cta.setAttribute('href', '#');
      cta.addEventListener('click', function (e) {
        e.preventDefault();
        add({ id: slug(name) + '-bundle', name: name, variant: 'Collection bundle · 3 blueprints', price: price, type: 'bundle' });
      });
    });
  }

  function init() {
    injectStyles();
    injectButton();
    injectDrawer();
    render();
    wireButtons();
    wireShopCards();
    wireBundles();
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  // public API
  window.Moodoor = {
    add: add, remove: remove, clear: clear, read: read,
    count: count, total: total, money: money, open: open, close: close,
    rewire: function () { wireButtons(); wireShopCards(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
