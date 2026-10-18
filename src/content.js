// Clean Share Link for Google Maps – content script.
// Turns the "Copy Link" button of the Google Maps share dialog and the
// "Copy link" button of the directions panel into "Copy Clean Link" and shows
// the clean URL in the dialog preview.
// No network requests, no storage, no UI of its own: everything is derived from location.href.
(() => {
  'use strict';

  const core = globalThis.NTMapsCore;
  if (!core || globalThis.__ntmapsLoaded) return;
  globalThis.__ntmapsLoaded = true;

  const LABEL = 'Copy Clean Link';
  const LABEL_DONE = 'Copied';
  const LABEL_FAILED = 'Copy Failed';

  // Hinweis: Google's CSS class names are obfuscated and change often. The
  // data-skw-id attributes and button ids of the share dialog are far more stable.
  const DIALOG = '[data-skw-id="containing-dialog"], [role="dialog"][jslog*="sharekitweb"]';
  // Hinweis: the directions panel has no share dialog, only a "Copy link" button
  // that copies a maps.app.goo.gl short link. Its jslog element id is language-independent.
  const DIRECTIONS_COPY = 'button[jslog^="198301;"]';
  const DIRECTIONS_COPY_TEXT = /(cop(y|i)\w*|kopi\w*)\W+(link|lien|enlace)|(link|lien|enlace)\W+(kopi\w*|cop(y|i)\w*)/i;
  const ACTIVE = 'data-ntmaps-url';
  const ORIGINAL = 'data-ntmaps-original';
  const ORIGINAL_TITLE = 'data-ntmaps-original-title';
  const BUSY = 'data-ntmaps-busy';
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

  // The preview card shows the short-link host ("maps.app.goo.gl").
  function findPreviewUrl(root) {
    const preview = root.querySelector('[data-skw-id="preview"]');
    if (!preview) return null;
    const marked = preview.querySelector('[' + ORIGINAL + ']');
    if (marked) return marked;
    for (const s of preview.querySelectorAll('span')) {
      if (/^(https?:\/\/)?(maps\.app\.)?goo\.gl\b/i.test(s.textContent.trim())) return s;
    }
    return null;
  }

  function dialogTitle(root) {
    const span = root.querySelector('[data-skw-id="preview"] span');
    return span ? span.textContent.trim() : null;
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

  function cleanLink(root) {
    const { info, url } = parseCurrent();
    if (!url) return null;
    // Never present a link for another place than the one shown in the dialog.
    if (info.kind === 'place' && core.namesMatch(info.name, dialogTitle(root)) === false) return null;
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

  function setTitle(el, text) {
    if (!el.hasAttribute(ORIGINAL_TITLE)) el.setAttribute(ORIGINAL_TITLE, el.getAttribute('title') ?? '');
    el.setAttribute('title', text);
  }

  function restoreText(el) {
    if (!el || !el.hasAttribute(ORIGINAL)) return;
    const node = textNodeOf(el);
    if (node) node.data = el.getAttribute(ORIGINAL); else el.textContent = el.getAttribute(ORIGINAL);
    el.removeAttribute(ORIGINAL);
    if (el.hasAttribute(ORIGINAL_TITLE)) {
      const t = el.getAttribute(ORIGINAL_TITLE);
      if (t) el.setAttribute('title', t); else el.removeAttribute('title');
      el.removeAttribute(ORIGINAL_TITLE);
    }
  }

  function activate(btn, label, url, opts) {
    btn.setAttribute(ACTIVE, url);
    btn.setAttribute('title', url);
    if (!btn.hasAttribute(BUSY)) setText(label, LABEL);
    // Hinweis: the directions button is a flex item that shrinks until "Copy Clean
    // Link" wraps onto three lines; 9.5em keeps "Copy Clean" on the first line.
    if (opts && opts.minWidth) btn.style.minWidth = opts.minWidth;
  }

  function deactivate(btn, label) {
    if (!btn) return;
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
      const label = btn && labelOf(btn);
      const preview = findPreviewUrl(root);
      const url = cleanLink(root);

      if (url && btn && label) {
        activate(btn, label, url);
        if (preview) {
          setText(preview, url.replace(/^https:\/\//, ''));
          setTitle(preview, url);
        }
      } else {
        deactivate(btn, label);
        restoreText(preview);
      }
    }

    const dirBtn = findDirectionsCopyButton();
    if (dirBtn) {
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
    // Hinweis: the attribute is at most one sync cycle (≤ 1 s) old and is what the
    // user just saw; preferable to letting Google's handler copy the tracking link.
    const url = (root ? cleanLink(root) : parseCurrent().url) || btn.getAttribute(ACTIVE);
    if (!url) return;
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
    if (!btn) return;
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
  // Only click and keydown call preventDefault; the other listeners are passive so
  // they never delay scrolling on the map.
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'keyup']) {
    window.addEventListener(type, intercept, { capture: true, passive: true });
  }
  for (const type of ['click', 'keydown']) {
    window.addEventListener(type, intercept, { capture: true });
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
  new MutationObserver((records) => {
    if (isHot(records)) { lastHref = location.href; sync(); } else schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('popstate', schedule);
  setInterval(() => { if (location.href !== lastHref) schedule(); }, 1000);
  schedule();
})();
