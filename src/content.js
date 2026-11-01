// Clean Share Link for Google Maps – content script.
// Turns the "Copy Link" button of the Google Maps share dialog and the
// "Copy link" button of the directions panel into "Copy Clean Link". The upper
// part of the share dialog (image, name, address, short link) is left to Google.
// No network requests, no storage, no UI of its own: everything is derived from location.href.
(() => {
  'use strict';

  // Hinweis: the extension and the userscript run in different worlds and cannot see
  // each other's globals. A running instance answers this synchronous event. Firefox
  // drops the content script of a reloaded or disabled extension, so it stops answering
  // and an idle copy takes over; an engine that keeps such a copy running keeps it working.
  const ALIVE = 'ntmaps-alive';
  const core = globalThis.NTMapsCore;
  if (!core) return;

  const LABEL = 'Copy Clean Link';
  const LABEL_DONE = 'Copied';
  const LABEL_FAILED = 'Copy Failed';
  const LABEL_NONE = 'No Clean Link';
  const TITLE_NONE = 'No clean link: the share dialog shows another place than the address bar';

  // Hinweis: Google's CSS class names are obfuscated and change often. The
  // data-skw-id attributes and button ids of the share dialog are far more stable.
  const DIALOG = '[data-skw-id="containing-dialog"], [role="dialog"][jslog*="sharekitweb"]';
  // Hinweis: the preview (image, place name, address and link line) is Google's own way
  // to copy its short link (a click copies it with navigator.clipboard.write) and is
  // left alone; only the copy button below it copies the clean link.
  const PREVIEW = '[data-skw-id="preview"]';
  // Hinweis: the directions panel has no share dialog, only a "Copy link" button
  // that copies a maps.app.goo.gl short link. Its jslog element id is language-independent.
  const DIRECTIONS_COPY = 'button[jslog^="198301;"]';
  const DIRECTIONS_COPY_TEXT = /(cop(y|i)\w*|kopi\w*)\W+(link|lien|enlace)|(link|lien|enlace)\W+(kopi\w*|cop(y|i)\w*)/i;
  const ACTIVE = 'data-ntmaps-url';
  const ORIGINAL = 'data-ntmaps-original';
  const BUSY = 'data-ntmaps-busy';
  const NONE = 'data-ntmaps-none';
  // Read by src/page.js in the page's world; the only data shared between the two.
  const CLEAN = 'data-ntmaps-clean';

  function findCopyButton(root) {
    const byId = root.querySelector('[id="app-container-Copy Link"]');
    if (byId) return byId;
    // Localised ids such as "app-container-Link kopieren"; "link" alone would also match LinkedIn.
    const buttons = root.querySelectorAll('[data-skw-id="app-sharing"] [role="button"][id^="app-container-"]');
    for (const b of buttons) if (/copy|copi|kopi/i.test(b.id.slice('app-container-'.length))) return b;
    return null;
  }

  function findDirectionsCopyButton() {
    const byLog = document.querySelector(DIRECTIONS_COPY);
    if (byLog && !byLog.closest(DIALOG)) return byLog;
    for (const main of document.querySelectorAll('[role="main"]')) {
      for (const b of main.querySelectorAll('button')) {
        if (b.querySelector('.google-symbols') && DIRECTIONS_COPY_TEXT.test(b.textContent)) return b;
      }
    }
    return null;
  }

  function labelOf(btn) {
    const live = btn.querySelector('[aria-live]');
    if (live) return live;
    const divs = [...btn.querySelectorAll('div')].filter((d) => !d.querySelector('svg, img') && d.textContent.trim());
    return divs.pop() || null;
  }

  // True for elements in the preview's image container, where Google overlays
  // "Copy Link" on hover and "Copied" after a click on the card (observed 30.10.2026).
  function inImage(el, preview) {
    for (let p = el.parentElement; p && p !== preview; p = p.parentElement) {
      if (p.querySelector(':scope > img')) return true;
    }
    return false;
  }

  // The preview's link line shows the short-link host ("maps.app.goo.gl"). A build from
  // before 21.10.2026 that still runs may have rewritten it and marked the original.
  function findPreviewUrl(root) {
    const preview = root.querySelector(PREVIEW);
    if (!preview) return null;
    const marked = preview.querySelector('[' + ORIGINAL + ']');
    if (marked) return marked;
    for (const s of preview.querySelectorAll('span')) {
      if (/^(https?:\/\/)?(maps\.app\.)?goo\.gl\b/i.test(s.textContent.trim())) return s;
    }
    return null;
  }

  // The place name is the first span of the text column that holds the link line.
  // Google's overlay on the card image is never the name; read as one, it made the
  // dialog look like one for another place and the button fell back to Google's.
  function dialogTitle(root) {
    const preview = root.querySelector(PREVIEW);
    if (!preview) return null;
    const spans = [...preview.querySelectorAll('span')];
    const link = findPreviewUrl(root);
    const column = link && link.parentElement;
    const title = (column && spans.find((s) => s.parentElement === column)) ||
      spans.find((s) => !inImage(s, preview));
    return title ? title.textContent.trim() : null;
  }

  // Parsed once per URL; sync() runs on many DOM mutations.
  let parsedHref = null;
  let parsed = null;
  function parseCurrent() {
    if (parsedHref === location.href && parsed) return parsed;
    try {
      const info = core.parseMapsUrl(location.href);
      parsed = { info, url: core.buildCleanUrl(info) };
    } catch (e) {
      parsed = { info: { kind: 'unsupported' }, url: null };
    }
    parsedHref = location.href;
    return parsed;
  }

  // The dialog shows another place than the address bar, so no clean link exists for it.
  function otherPlace(root) {
    const { info, url } = parseCurrent();
    return !!url && info.kind === 'place' && core.namesMatch(info.name, dialogTitle(root)) === false;
  }

  function cleanLink(root) {
    const { url } = parseCurrent();
    // Never present a link for another place than the one shown in the dialog.
    if (!url || otherPlace(root)) return null;
    return url;
  }

  // Labels are either a text node next to an icon (directions panel) or the
  // whole element text (share dialog). Only the text node is touched if present.
  function textNodeOf(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.data.trim()) return n;
    return null;
  }

  function setText(el, text) {
    if (!el) return;
    const node = textNodeOf(el);
    if (!el.hasAttribute(ORIGINAL)) el.setAttribute(ORIGINAL, node ? node.data : el.textContent);
    if (node) {
      const lead = /^\s*/.exec(node.data)[0];
      if (node.data !== lead + text) node.data = lead + text;
    } else if (el.textContent !== text) {
      el.textContent = text;
    }
  }

  function restoreText(el) {
    if (!el || !el.hasAttribute(ORIGINAL)) return;
    const node = textNodeOf(el);
    if (node) node.data = el.getAttribute(ORIGINAL); else el.textContent = el.getAttribute(ORIGINAL);
    el.removeAttribute(ORIGINAL);
  }

  // Hinweis: builds from before the ntmaps-alive check (up to 18.10.2026) may still run
  // next to this copy and set a button the other way. Both copies react to each other's
  // text changes at once, so re-applying our state would loop and freeze the tab. A
  // button whose state another copy changed is therefore left to that copy.
  // Our greying out is lifted, because the other copy may make the button copy again;
  // older builds ignore attribute changes, so this does not start a loop.
  const applied = new WeakMap();
  const contested = new WeakSet();
  function ours(btn) {
    if (contested.has(btn)) return false;
    if (applied.has(btn) && applied.get(btn) !== btn.getAttribute(ACTIVE)) {
      contested.add(btn);
      setBlocked(btn, false);
      return false;
    }
    return true;
  }

  // Greyed out and announced as disabled, so the button is not clicked unread.
  function setBlocked(btn, on) {
    if (on) {
      btn.setAttribute(NONE, '');
      btn.setAttribute('aria-disabled', 'true');
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    } else if (btn.hasAttribute(NONE)) {
      btn.removeAttribute(NONE);
      btn.removeAttribute('aria-disabled');
      btn.style.opacity = '';
      btn.style.cursor = '';
      if (!btn.getAttribute('style')) btn.removeAttribute('style');
    }
  }

  function textOf(el) {
    const node = textNodeOf(el);
    return (node ? node.data : el.textContent).trim();
  }

  function activate(btn, label, url, opts) {
    applied.set(btn, url);
    setBlocked(btn, false);
    btn.setAttribute(ACTIVE, url);
    btn.setAttribute('title', url);
    // During the copy feedback "Copied" stays, but never "No Clean Link" on an enabled button.
    if (!btn.hasAttribute(BUSY) || textOf(label) === LABEL_NONE) setText(label, LABEL);
    // Hinweis: the directions button is a flex item that shrinks until "Copy Clean
    // Link" wraps onto three lines; 9.5em keeps "Copy Clean" on the first line.
    if (opts && opts.minWidth) btn.style.minWidth = opts.minWidth;
  }

  // Hinweis: for another place there is no clean link. The button then says so, is
  // greyed out and copies nothing, instead of falling back to Google's tracking link.
  // It keeps the ACTIVE attribute (empty), so its clicks are still intercepted. The label
  // replaces a running "Copied" at once, so it never suggests that this place was copied.
  function block(btn, label) {
    applied.set(btn, '');
    btn.setAttribute(ACTIVE, '');
    btn.setAttribute('title', TITLE_NONE);
    setBlocked(btn, true);
    setText(label, LABEL_NONE);
  }

  function deactivate(btn, label) {
    if (!btn) return;
    applied.set(btn, null);
    setBlocked(btn, false);
    btn.removeAttribute(ACTIVE);
    btn.removeAttribute('title');
    btn.style.minWidth = '';
    if (!btn.getAttribute('style')) btn.removeAttribute('style');
    restoreText(label);
  }

  function sync() {
    // Publish the current clean link for page.js (navigator.share / clipboard wrappers).
    const current = parseCurrent();
    if (current.url) document.documentElement.setAttribute(CLEAN, current.url);
    else document.documentElement.removeAttribute(CLEAN);

    for (const root of document.querySelectorAll(DIALOG)) {
      if (root.parentElement && root.parentElement.closest(DIALOG)) continue;
      const btn = findCopyButton(root);
      if (btn && !ours(btn)) continue;
      const label = btn && labelOf(btn);
      const url = cleanLink(root);
      // The upper part of the dialog (image, name, address, link line) stays Google's:
      // it copies Google's short link, so nothing there is changed.
      if (url && btn && label) activate(btn, label, url);
      else if (btn && label && otherPlace(root)) block(btn, label);
      else deactivate(btn, label);
    }

    const dirBtn = findDirectionsCopyButton();
    if (dirBtn && ours(dirBtn)) {
      const label = labelOf(dirBtn);
      if (current.url && label && current.info.kind === 'dir') activate(dirBtn, label, current.url, { minWidth: '9.5em' });
      else deactivate(dirBtn, label);
    }
  }

  async function writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Hinweis: fallback where the async Clipboard API is unavailable.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.documentElement.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  async function copy(btn) {
    const root = btn.closest(DIALOG);
    // Never fall back to a link from an earlier sync when the dialog shows another place.
    if (root && otherPlace(root)) {
      const label = labelOf(btn);
      if (label && ours(btn)) block(btn, label);
      return;
    }
    // Hinweis: the attribute is at most one sync cycle (≤ 1 s) old and is what the
    // user just saw; preferable to letting Google's handler copy the tracking link.
    const url = (root ? cleanLink(root) : parseCurrent().url) || btn.getAttribute(ACTIVE);
    if (!url) return;
    // The page.js wrapper swaps Maps links for this attribute; keep it identical to what is copied.
    document.documentElement.setAttribute(CLEAN, url);
    const label = labelOf(btn);
    btn.setAttribute(BUSY, '');
    const ok = await writeClipboard(url);
    setText(label, ok ? LABEL_DONE : LABEL_FAILED);
    setTimeout(() => { btn.removeAttribute(BUSY); sync(); }, 2000);
  }

  function activeButton(ev) {
    const t = ev.target;
    const el = t && t.nodeType === 1 ? t : t && t.parentElement;
    return el && el.closest ? el.closest('[' + ACTIVE + ']') : null;
  }

  // Capture phase on window runs before Google's own handlers, so the tracking
  // link is never copied while the button shows "Copy Clean Link".
  function intercept(ev) {
    const btn = activeButton(ev);
    if (!btn || contested.has(btn)) return;
    const isKey = ev.type === 'keydown' || ev.type === 'keyup';
    if (isKey && ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.stopImmediatePropagation();
    if (ev.type === 'click' || (ev.type === 'keydown' && !ev.repeat)) {
      ev.preventDefault();
      copy(btn);
    } else if (ev.type === 'keydown') {
      ev.preventDefault();
    }
  }

  // Hinweis: Google Maps is a single-page app that reuses the dialog for
  // several places. Re-syncing on DOM and URL changes keeps the link current.
  let scheduled = 0;
  let lastHref = location.href;
  const schedule = () => {
    if (scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = 0;
      lastHref = location.href;
      sync();
    }, 100);
  };
  // Mutations that insert the dialog or the directions button, or happen inside
  // them, are handled in the same microtask, before the first paint; the user
  // never sees Google's label. Everything else is debounced.
  const HOT = DIALOG + ', ' + DIRECTIONS_COPY;
  function isHot(records) {
    for (const rec of records) {
      for (const n of rec.addedNodes) {
        if (n.nodeType === 1 && (n.matches(HOT) || n.querySelector(HOT))) return true;
      }
      const el = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement;
      if (el && el.closest(HOT)) return true;
    }
    return false;
  }

  // Returns true once this copy runs; false while another live copy answers.
  function start() {
    if (globalThis.__ntmapsLoaded) return true;
    if (!document.dispatchEvent(new CustomEvent(ALIVE, { cancelable: true }))) return false;
    globalThis.__ntmapsLoaded = true;
    document.addEventListener(ALIVE, (ev) => ev.preventDefault());
    // A copy that went away during copy() may have left its 2 s busy marker behind.
    for (const el of document.querySelectorAll('[' + BUSY + ']')) el.removeAttribute(BUSY);
    const html = document.documentElement;
    // Only click and keydown call preventDefault; the other listeners are passive so
    // they never delay scrolling on the map.
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'keyup']) {
      window.addEventListener(type, intercept, { capture: true, passive: true });
    }
    for (const type of ['click', 'keydown']) {
      window.addEventListener(type, intercept, { capture: true });
    }
    new MutationObserver((records) => {
      if (isHot(records)) { lastHref = location.href; sync(); } else schedule();
    }).observe(html, { childList: true, subtree: true, characterData: true });
    window.addEventListener('popstate', schedule);
    setInterval(() => { if (location.href !== lastHref) schedule(); }, 1000);
    schedule();
    // Google Maps rewrites the address with history.replaceState, which fires no DOM event.
    // The Navigation API reports it where available. It is registered last and guarded,
    // because in the userscript build the page can replace window.navigation; the poll
    // above keeps working either way.
    try {
      if (typeof navigation === 'object' && navigation && typeof navigation.addEventListener === 'function') {
        navigation.addEventListener('currententrychange', schedule);
      }
    } catch {
      // keep the poll
    }
    return true;
  }

  // An idle copy checks again, so it takes over when the running one goes away.
  function begin() {
    if (start()) return;
    const retry = setInterval(() => { if (start()) clearInterval(retry); }, 2000);
  }

  // Hinweis: content scripts at document_start already see <html>; userscript
  // managers may run before it exists, so wait for it instead of failing.
  if (document.documentElement) {
    begin();
  } else {
    const waiting = new MutationObserver(() => {
      if (!document.documentElement) return;
      waiting.disconnect();
      begin();
    });
    waiting.observe(document, { childList: true });
  }
})();
