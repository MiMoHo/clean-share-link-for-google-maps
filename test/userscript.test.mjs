// Tests for the generated userscript: metadata mirrors manifest.json, and the merged
// page.js + core.js + content.js work in one world (run in a Node VM with a minimal DOM stub).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { FILE, META_FILE, buildMetadata, buildUserscript } from '../scripts/build-userscript.mjs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const script = buildUserscript();
const meta = (key) => [...script.matchAll(new RegExp(`^// @${key}\\s+(.*)$`, 'gm'))].map((m) => m[1].trim());

const PLACE = 'https://www.google.com/maps/place/Eiffelturm/@48.8583701,2.291901,17z/data=!3m1!4b1!4m6!3m5!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!8m2!3d48.8583701!4d2.2944813';
const CLEAN = 'https://www.google.com/maps/search/?api=1&query=48.8583701,2.2944813&query_place_id=ChIJLU7jZClu5kcR4PcOOO6p3I0';

function environment(href, { lateRoot = false, navigationApi = false } = {}) {
  const busy = [];
  const dialogs = [];
  const navListeners = [];
  const attrs = new Map();
  const observers = [];
  const timers = [];
  let intervals = [];
  const listeners = [];
  const handlers = [];
  const shared = [];
  const written = [];
  const writtenItems = [];
  class Navigator {}
  Navigator.prototype.share = function (data) { shared.push(data); return Promise.resolve(); };
  class Clipboard {}
  Clipboard.prototype.writeText = function (text) { written.push(text); return Promise.resolve(); };
  Clipboard.prototype.write = function (items) { writtenItems.push(items); return Promise.resolve(); };
  // Minimal ClipboardItem: values may be strings, Blobs or promises of either.
  class ClipboardItem {
    constructor(parts) { this.parts = parts; this.types = Object.keys(parts); }
    getType(type) { return Promise.resolve(this.parts[type]).then((v) => (typeof v === 'string' ? new Blob([v], { type }) : v)); }
  }
  const navigator = Object.create(Navigator.prototype);
  navigator.clipboard = Object.create(Clipboard.prototype);
  const documentElement = {
    hasAttribute: (k) => attrs.has(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
  };
  // document-level listeners, e.g. the liveness answer of a running instance
  let docListeners = [];
  class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.cancelable = !!init.cancelable; this.defaultPrevented = false; }
    preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  }
  const document = {
    documentElement: lateRoot ? null : documentElement,
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '[data-ntmaps-busy]' ? busy.filter((el) => el.hasAttribute('data-ntmaps-busy')) : sel.includes('containing-dialog') ? dialogs : []),
    addEventListener: (type, fn) => docListeners.push({ type, fn }),
    dispatchEvent: (ev) => { for (const l of docListeners) if (l.type === ev.type) l.fn(ev); return !ev.defaultPrevented; },
  };
  const context = vm.createContext({
    document,
    location: { href },
    navigator, Navigator, Clipboard, ClipboardItem, Blob, CustomEvent,
    URL, // a web API, not part of the bare VM context; core.js needs it
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target) { this.target = target; }
      disconnect() { this.target = null; }
    },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    setInterval: (fn) => intervals.push(fn),
    clearInterval: (id) => { intervals[id - 1] = null; },
    window: { addEventListener: (type, fn) => { listeners.push(type); handlers.push({ type, fn }); } },
    ...(navigationApi === true ? { navigation: { addEventListener: (type, fn) => navListeners.push({ type, fn }) } } : {}),
    // A page that replaced window.navigation (possible in the userscript build).
    ...(navigationApi === 'throws' ? { navigation: { addEventListener: () => { throw new Error('replaced by the page'); } } } : {}),
    ...(navigationApi === 'not-callable' ? { navigation: { addEventListener: 'replaced by the page' } } : {}),
  });
  const run = () => vm.runInContext(script, context);
  const flush = () => { while (timers.length) timers.shift()(); };
  // Simulates the parser inserting <html> after a document-start injection.
  const insertRoot = () => {
    document.documentElement = documentElement;
    for (const o of observers) if (o.target === document) o.callback([]);
  };
  // Firefox drops a content script's listeners and timers when the extension is reloaded or
  // disabled; `upTo` limits this to intervals registered so far (the copies to kill).
  const killInstances = (upTo = intervals.length) => { docListeners = []; for (let i = 0; i < upTo; i++) intervals[i] = null; };
  const intervalCount = () => intervals.length;
  const activeIntervals = () => intervals.filter(Boolean).length;
  const fire = (ev) => { for (const h of handlers) if (h.type === ev.type) h.fn(ev); };
  const tick = () => { for (const fn of intervals.slice()) if (fn) fn(); flush(); };
  // A DOM change outside the dialog: the observer schedules sync().
  const mutate = () => { for (const o of observers) if (o.target && o.target !== document) o.callback([]); flush(); };
  // A change inside the dialog: handled synchronously, pending timers keep running.
  const mutateHot = () => { for (const o of observers) if (o.target && o.target !== document) o.callback([{ addedNodes: [], target: { nodeType: 1, closest: () => true } }]); };
  const answering = () => !document.dispatchEvent(new CustomEvent('ntmaps-alive', { cancelable: true }));
  // Same-document navigation as reported by the Navigation API (history.replaceState).
  const navigate = (next) => { context.location.href = next; for (const l of navListeners) if (l.type === 'currententrychange') l.fn({}); };
  return { dialogs, mutate, mutateHot, navigate, navListeners, busy, context, attrs, listeners, shared, written, writtenItems, ClipboardItem, run, flush, insertRoot, killInstances, answering, intervalCount, activeIntervals, fire, tick };
}

test('userscript metadata mirrors the manifest', () => {
  assert.deepEqual(meta('version'), [manifest.version]);
  assert.deepEqual(meta('name'), [manifest.name]);
  assert.deepEqual(meta('match'), manifest.content_scripts[0].matches);
  assert.deepEqual(meta('run-at'), ['document-start']);
  assert.deepEqual(meta('inject-into'), ['page']);
  assert.deepEqual(meta('grant'), ['none']);
  assert.equal(script.includes('// @noframes'), true);
  assert.match(meta('icon')[0], /^data:image\/svg\+xml;base64,/);
  const release = manifest.homepage_url + '/releases/latest/download/';
  assert.deepEqual(meta('downloadURL'), [release + FILE]);
  assert.deepEqual(meta('updateURL'), [release + META_FILE]);
  assert.match(META_FILE, /\.meta\.js$/);
  const order = manifest.content_scripts.filter((cs) => cs.world === 'MAIN').concat(manifest.content_scripts.filter((cs) => cs.world !== 'MAIN')).flatMap((cs) => cs.js);
  assert.deepEqual([...script.matchAll(/^\/\/ ---- (\S+) ----$/gm)].map((m) => m[1]), order);
  assert.doesNotThrow(() => new vm.Script(script));
});

test('userscript publishes the clean link and swaps share and clipboard URLs', async () => {
  const env = environment(PLACE);
  env.run();
  env.flush();
  assert.equal(env.attrs.get('data-ntmaps-clean'), CLEAN);
  assert.equal(env.answering(), true);

  const short = 'https://maps.app.goo.gl/abc123';
  await env.context.navigator.share({ title: 'Eiffel Tower', text: short, url: short });
  assert.deepEqual({ ...env.shared[0] }, { title: 'Eiffel Tower', text: CLEAN, url: CLEAN });
  await env.context.navigator.clipboard.writeText(short);
  await env.context.navigator.clipboard.writeText('unrelated text');
  assert.deepEqual(env.written, [CLEAN, 'unrelated text']);
});

test('userscript keeps its globals off the page and does not act twice', async () => {
  const env = environment(PLACE);
  env.run();
  env.flush();
  const listenerCount = env.listeners.length;
  assert.equal('NTMapsCore' in env.context, false);
  assert.equal('__ntmapsLoaded' in env.context, false);

  env.run(); // second copy, e.g. the extension and the userscript at once
  env.flush();
  assert.equal(env.listeners.length, listenerCount);
  await env.context.navigator.share({ url: 'https://maps.app.goo.gl/abc123' });
  assert.equal(env.shared[0].url, CLEAN);
});

test('userscript waits for <html> when injected before it exists', () => {
  const env = environment(PLACE, { lateRoot: true });
  env.run();
  env.flush();
  assert.equal(env.listeners.length, 0);
  assert.equal(env.answering(), false);
  env.insertRoot();
  env.flush();
  assert.equal(env.answering(), true);
  assert.equal(env.attrs.get('data-ntmaps-clean'), CLEAN);
  assert.ok(env.listeners.includes('click'));
});

test('a new instance takes over when the previous one no longer answers', () => {
  // Reviewer finding: after an extension reload Firefox injects a fresh content script into open
  // tabs; a static marker left by the dead instance kept the new one from starting.
  const SYDNEY = 'https://www.google.com/maps/place/Sydney+Opera+House/@-33.8567844,151.2152967,17z/data=!3m1!4b1!4m6!3m5!1s0x6b12ae665e892fdd:0x3133f8d75a1ac251!8m2!3d-33.8567844!4d151.2152967';
  const env = environment(PLACE);
  env.run();
  env.flush();
  const before = env.listeners.length;
  env.killInstances();
  env.context.location.href = SYDNEY;
  env.run();
  env.flush();
  assert.equal(env.listeners.length, before * 2);
  assert.equal(env.answering(), true);
  assert.match(env.attrs.get('data-ntmaps-clean'), /query_place_id=ChIJ3S-JXmauEmsRUcIaWtf4MzE$/);
});

test('an idle copy takes over when the running one goes away', () => {
  const SYDNEY = 'https://www.google.com/maps/place/Sydney+Opera+House/@-33.8567844,151.2152967,17z/data=!3m1!4b1!4m6!3m5!1s0x6b12ae665e892fdd:0x3133f8d75a1ac251!8m2!3d-33.8567844!4d151.2152967';
  const env = environment(PLACE);
  env.run();
  env.flush();
  const running = env.intervalCount();
  const before = env.listeners.length;
  env.run(); // second copy finds a live one and stays idle
  env.flush();
  assert.equal(env.listeners.length, before);
  env.tick(); // still answered: stays idle
  assert.equal(env.listeners.length, before);

  env.killInstances(running);
  env.context.location.href = SYDNEY;
  env.tick();
  assert.equal(env.listeners.length, before * 2);
  assert.match(env.attrs.get('data-ntmaps-clean'), /query_place_id=ChIJ3S-JXmauEmsRUcIaWtf4MzE$/);
  // the dead copy's poll is gone, the idle copy's retry is cleared, the new copy polls location
  assert.equal(env.activeIntervals(), 1);
});

test('build rejects multi-line metadata and unsupported content script options', () => {
  const m = JSON.parse(JSON.stringify(manifest));
  assert.throws(() => buildUserscript({ ...m, description: 'x\n// @grant GM_xmlhttpRequest' }), /single line/);
  assert.throws(() => buildUserscript({ ...m, description: 'x\u2028globalThis.PWNED = 1;' }), /single line/);
  assert.throws(() => buildUserscript({ ...m, description: 'x\u2029globalThis.PWNED = 1;' }), /single line/);
  assert.throws(() => buildUserscript({ ...m, name: 'x // ==/UserScript==' }), /block marker/);
  assert.throws(() => buildUserscript({ ...m, name: 'x // ==UserScript==' }), /block marker/);
  assert.throws(() => buildUserscript({ ...m, description: 'x ==/userscript==' }), /block marker/);
  assert.throws(() => buildUserscript({ ...m, content_scripts: m.content_scripts.map((cs) => ({ ...cs, js: ['src/x\u2028.js'] })) }), /path must be a single line/);
  assert.throws(() => buildUserscript({ ...m, content_scripts: [] }), /no content_scripts/);
  assert.throws(() => buildUserscript({ ...m, content_scripts: m.content_scripts.map((cs) => ({ ...cs, all_frames: true })) }), /all_frames/);
  assert.throws(() => buildUserscript({ ...m, content_scripts: m.content_scripts.map((cs) => ({ ...cs, run_at: 'document_idle' })) }), /document_start/);
});

test('a click while the dialog shows another place copies nothing, not even the link from an earlier sync', async () => {
  // The button still carries a link from an earlier sync while <html> already shows the current place.
  const STALE = 'https://www.google.com/maps/search/?api=1&query=48.8606111,2.337644';
  const env = environment(PLACE);
  env.run();
  env.flush();
  assert.equal(env.attrs.get('data-ntmaps-clean'), CLEAN);
  const store = () => { const m = new Map(); return { hasAttribute: (k) => m.has(k), getAttribute: (k) => (m.has(k) ? m.get(k) : null), setAttribute: (k, v) => m.set(k, String(v)), removeAttribute: (k) => m.delete(k) }; };
  const label = { ...store(), childNodes: [], textContent: 'Copy Clean Link' };
  const preview = { querySelectorAll: (sel) => (sel === 'span' ? [title] : []), querySelector: () => null };
  const title = { ...store(), childNodes: [], textContent: 'Louvre Museum', parentElement: preview };
  const root = { querySelector: (sel) => (sel === '[data-skw-id="preview"]' ? preview : null) };
  const btn = { ...store(), nodeType: 1, style: {}, querySelector: (sel) => (sel === '[aria-live]' ? label : null) };
  btn.closest = (sel) => (sel === '[data-ntmaps-url]' ? btn : root);
  btn.setAttribute('data-ntmaps-url', STALE);
  const ev = { type: 'click', target: btn, repeat: false, stopped: false, prevented: false, stopImmediatePropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
  env.fire(ev);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(env.written, []);
  assert.equal(ev.stopped, true); // Google's handler does not copy its tracking link either
  assert.equal(ev.prevented, true);
  assert.equal(label.textContent, 'No Clean Link');
  assert.equal(btn.getAttribute('data-ntmaps-url'), '');
  assert.equal(btn.getAttribute('aria-disabled'), 'true');
});

test('a click on a button without a recognisable label copies nothing while the dialog shows another place', async () => {
  // Without a label the button cannot be relabelled, so it still carries the link from an earlier sync.
  const STALE = 'https://www.google.com/maps/search/?api=1&query=48.8606111,2.337644';
  const env = environment(PLACE);
  env.run();
  env.flush();
  const store = () => { const m = new Map(); return { hasAttribute: (k) => m.has(k), getAttribute: (k) => (m.has(k) ? m.get(k) : null), setAttribute: (k, v) => m.set(k, String(v)), removeAttribute: (k) => m.delete(k) }; };
  const preview = { querySelectorAll: (sel) => (sel === 'span' ? [title] : []), querySelector: () => null };
  const title = { ...store(), childNodes: [], textContent: 'Louvre Museum', parentElement: preview };
  const root = { querySelector: (sel) => (sel === '[data-skw-id="preview"]' ? preview : null) };
  const btn = { ...store(), nodeType: 1, style: {}, querySelector: () => null, querySelectorAll: () => [] };
  btn.closest = (sel) => (sel === '[data-ntmaps-url]' ? btn : root);
  btn.setAttribute('data-ntmaps-url', STALE);
  const ev = { type: 'click', target: btn, repeat: false, stopped: false, prevented: false, stopImmediatePropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
  env.fire(ev);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(env.written, []);
  assert.equal(ev.stopped, true);
  assert.equal(env.attrs.get('data-ntmaps-clean'), CLEAN); // not switched to the stale link either
});

test('copy() publishes the copied link, so the page.js wrapper passes it through unchanged', async () => {
  // The button still carries a link from an earlier sync while the address bar no longer has a
  // supported link (e.g. Google is rewriting it); what the user just saw is copied.
  const STALE = 'https://www.google.com/maps/search/?api=1&query=48.8606111,2.337644';
  const env = environment('https://www.google.com/maps/@48.86,2.33,15z/data=!4m3!11m2!2sExampleListId!3e3');
  env.run();
  env.flush();
  assert.equal(env.attrs.has('data-ntmaps-clean'), false);
  const store = () => { const m = new Map(); return { hasAttribute: (k) => m.has(k), getAttribute: (k) => (m.has(k) ? m.get(k) : null), setAttribute: (k, v) => m.set(k, String(v)), removeAttribute: (k) => m.delete(k) }; };
  const label = { ...store(), childNodes: [], textContent: 'Copy Clean Link' };
  const preview = { querySelectorAll: (sel) => (sel === 'span' ? [title] : []), querySelector: () => null };
  const title = { ...store(), childNodes: [], textContent: 'Louvre Museum', parentElement: preview };
  const root = { querySelector: (sel) => (sel === '[data-skw-id="preview"]' ? preview : null) };
  const btn = { ...store(), nodeType: 1, style: {}, querySelector: (sel) => (sel === '[aria-live]' ? label : null) };
  btn.closest = (sel) => (sel === '[data-ntmaps-url]' ? btn : root);
  btn.setAttribute('data-ntmaps-url', STALE);
  env.fire({ type: 'click', target: btn, repeat: false, stopImmediatePropagation() {}, preventDefault() {} });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(env.written, [STALE]);
  assert.equal(env.attrs.get('data-ntmaps-clean'), STALE);
  assert.equal(label.textContent, 'Copied');
});

test('a taking-over copy clears a busy marker left behind; an idle copy leaves it alone', () => {
  const store = () => { const m = new Map(); return { hasAttribute: (k) => m.has(k), getAttribute: (k) => (m.has(k) ? m.get(k) : null), setAttribute: (k, v) => m.set(k, String(v)), removeAttribute: (k) => m.delete(k) }; };
  const env = environment(PLACE);
  env.run();
  env.flush();
  const running = env.intervalCount();
  const button = store();
  env.busy.push(button);
  button.setAttribute('data-ntmaps-busy', ''); // the running copy is inside copy()'s 2 s window
  env.run(); // idle copy
  env.tick();
  assert.equal(button.hasAttribute('data-ntmaps-busy'), true);
  env.killInstances(running); // the running copy goes away before its timer clears the marker
  env.tick();
  assert.equal(button.hasAttribute('data-ntmaps-busy'), false);
});

test('the .meta.js file is exactly the metadata block of the userscript, without code', () => {
  const block = buildMetadata();
  assert.equal(script.startsWith(block), true);
  assert.match(block, /^\/\/ ==UserScript==\n(\/\/ @.*\n)+\/\/ ==\/UserScript==\n$/);
  assert.equal(block.includes('(function'), false);
});

test('an address rewrite reported by the Navigation API updates the link without waiting for the poll', () => {
  const SYDNEY = 'https://www.google.com/maps/place/Sydney+Opera+House/@-33.8567844,151.2152967,17z/data=!3m1!4b1!4m6!3m5!1s0x6b12ae665e892fdd:0x3133f8d75a1ac251!8m2!3d-33.8567844!4d151.2152967';
  const env = environment(PLACE, { navigationApi: true });
  env.run();
  env.flush();
  assert.equal(env.attrs.get('data-ntmaps-clean'), CLEAN);
  assert.equal(env.navListeners.filter((l) => l.type === 'currententrychange').length, 1);
  env.navigate(SYDNEY);
  env.flush(); // only the 100 ms debounce, no interval tick
  assert.match(env.attrs.get('data-ntmaps-clean'), /query_place_id=ChIJ3S-JXmauEmsRUcIaWtf4MzE$/);
});

test('without the Navigation API the copy still starts and relies on the poll', () => {
  const env = environment(PLACE);
  env.run();
  env.flush();
  assert.equal(env.attrs.get('data-ntmaps-clean'), CLEAN);
  assert.equal(env.navListeners.length, 0);
});

for (const kind of ['throws', 'not-callable']) {
  test(`a replaced window.navigation (${kind}) does not stop the copy; the poll still follows the address`, () => {
    const SYDNEY = 'https://www.google.com/maps/place/Sydney+Opera+House/@-33.8567844,151.2152967,17z/data=!3m1!4b1!4m6!3m5!1s0x6b12ae665e892fdd:0x3133f8d75a1ac251!8m2!3d-33.8567844!4d151.2152967';
    const env = environment(PLACE, { navigationApi: kind });
    assert.doesNotThrow(() => env.run());
    env.flush();
    assert.equal(env.attrs.get('data-ntmaps-clean'), CLEAN);
    env.context.location.href = SYDNEY;
    env.tick(); // the 1 s poll
    assert.match(env.attrs.get('data-ntmaps-clean'), /query_place_id=ChIJ3S-JXmauEmsRUcIaWtf4MzE$/);
  });
}

// A share dialog stub shaped like the observed DOM (30.10.2026): the preview (upper part of
// the dialog) holds an image container and a text column with name, address and link line;
// Google's overlay ("Copy Link" on hover, "Copied" after a click on the preview) sits in the
// image container or, as a variant, directly under the preview. Only what content.js
// queries is modelled.
function dialogStub({ name, overlay = null, overlayUnderCard = false, linkText = 'maps.app.goo.gl', labelText = 'Copy Link' } = {}) {
  const store = () => { const m = new Map(); return { hasAttribute: (k) => m.has(k), getAttribute: (k) => (m.has(k) ? m.get(k) : null), setAttribute: (k, v) => m.set(k, String(v)), removeAttribute: (k) => m.delete(k) }; };
  const preview = { ...store(), nodeType: 1, querySelectorAll: (sel) => (sel === 'span' ? spans : []), querySelector: (sel) => (sel === '[data-ntmaps-original]' ? spans.find((s) => s.hasAttribute('data-ntmaps-original')) || null : null) };
  preview.closest = (sel) => (sel === '[data-ntmaps-url]' ? (preview.hasAttribute('data-ntmaps-url') ? preview : null) : root);
  const imageBox = { parentElement: preview, querySelector: (sel) => (sel === ':scope > img' ? {} : null) };
  const textColumn = { parentElement: preview, querySelector: () => null };
  const span = (text, parent) => {
    const s = { ...store(), nodeType: 1, childNodes: [], textContent: text, parentElement: parent };
    s.closest = (sel) => (sel === '[data-ntmaps-url]' ? (s.hasAttribute('data-ntmaps-url') ? s : preview.hasAttribute('data-ntmaps-url') ? preview : null) : root);
    return s;
  };
  const overlaySpan = overlay === null ? null : span(overlay, overlayUnderCard ? preview : imageBox);
  const title = span(name, textColumn);
  const address = span('Av. Gustave Eiffel, 75007 Paris', textColumn);
  const link = span(linkText, textColumn);
  const spans = [...(overlaySpan ? [overlaySpan] : []), title, address, link];
  const label = { ...store(), childNodes: [], textContent: labelText };
  const btn = { ...store(), nodeType: 1, style: {}, querySelector: (sel) => (sel === '[aria-live]' ? label : null) };
  const root = { parentElement: null, querySelector: (sel) => (sel === '[data-skw-id="preview"]' ? preview : sel === '[id="app-container-Copy Link"]' ? btn : null) };
  btn.closest = (sel) => (sel === '[data-ntmaps-url]' ? (btn.hasAttribute('data-ntmaps-url') ? btn : null) : root);
  return { root, btn, label, preview, overlaySpan, title, link };
}
const click = (env, target) => {
  const ev = { type: 'click', target, repeat: false, stopped: false, prevented: false, stopImmediatePropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
  env.fire(ev);
  return ev;
};
const settle = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };

for (const [overlay, underCard] of [['Copy Link', false], ['Copied', false], ['Copy Link', true], ['Copied', true]]) {
  test(`Google's "${overlay}" overlay ${underCard ? 'directly under the card' : 'on the card image'} is never taken for the place name`, () => {
    const env = environment(PLACE);
    env.run();
    env.flush();
    const d = dialogStub({ name: 'Eiffelturm', overlay, overlayUnderCard: underCard });
    env.dialogs.push(d.root);
    env.mutate();
    env.mutate(); // a second sync must come to the same result
    assert.equal(d.btn.getAttribute('data-ntmaps-url'), CLEAN);
    assert.equal(d.label.textContent, 'Copy Clean Link');
    assert.equal(d.link.textContent, 'maps.app.goo.gl'); // the preview keeps Google's link line
    assert.equal(d.link.hasAttribute('title'), false);
    assert.equal(d.overlaySpan.textContent, overlay); // Google's overlay is not touched
  });
}

test('without a recognisable link line the name is the first span outside the image container', () => {
  const env = environment(PLACE);
  env.run();
  env.flush();
  const d = dialogStub({ name: 'Eiffelturm', overlay: 'Copy Link', linkText: 'www.example.test/x' });
  env.dialogs.push(d.root);
  env.mutate();
  assert.equal(d.btn.getAttribute('data-ntmaps-url'), CLEAN);
  // the same fallback still recognises a dialog for another place
  const other = dialogStub({ name: 'Louvre Museum', overlay: 'Copy Link', linkText: 'www.example.test/x' });
  env.dialogs.splice(0, 1, other.root);
  env.mutate();
  assert.equal(other.btn.getAttribute('data-ntmaps-url'), '');
  assert.equal(other.label.textContent, 'No Clean Link');
});

test('a dialog without a preview still gets the clean button', () => {
  const env = environment(PLACE);
  env.run();
  env.flush();
  const d = dialogStub({ name: 'Eiffelturm' });
  const query = d.root.querySelector;
  d.root.querySelector = (sel) => (sel === '[data-skw-id="preview"]' ? null : query(sel));
  env.dialogs.push(d.root);
  env.mutate();
  assert.equal(d.btn.getAttribute('data-ntmaps-url'), CLEAN);
  assert.equal(d.label.textContent, 'Copy Clean Link');
});

test('a link line rewritten by a still running pre-21.10 build is left alone and still found', () => {
  const env = environment(PLACE);
  env.run();
  env.flush();
  // The old build marks the original text; the overlay sits directly under the preview, so
  // only the marked link line leads to the right text column.
  const d = dialogStub({ name: 'Eiffelturm', overlay: 'Copy Link', overlayUnderCard: true, linkText: CLEAN.replace(/^https:\/\//, '') });
  d.link.setAttribute('data-ntmaps-original', 'maps.app.goo.gl');
  env.dialogs.push(d.root);
  env.mutate();
  env.mutate();
  assert.equal(d.link.textContent, CLEAN.replace(/^https:\/\//, '')); // not restored: the old copy would rewrite it again
  assert.equal(d.link.getAttribute('data-ntmaps-original'), 'maps.app.goo.gl');
  assert.equal(d.btn.getAttribute('data-ntmaps-url'), CLEAN);
});

test('a button that a pre-21.10 build keeps changing is left to it, so the copies cannot loop', async () => {
  const env = environment(PLACE);
  env.run();
  env.flush();
  const d = dialogStub({ name: 'Eiffelturm', overlay: 'Copy Link' });
  env.dialogs.push(d.root);
  env.mutate();
  assert.equal(d.btn.getAttribute('data-ntmaps-url'), CLEAN);
  // The old copy falls back to Google's button after every change (e.g. while the image is hovered).
  let reactivated = 0;
  for (let i = 0; i < 5; i++) {
    d.btn.removeAttribute('data-ntmaps-url');
    d.label.textContent = 'Copy Link';
    env.mutate();
    if (d.btn.hasAttribute('data-ntmaps-url') || d.label.textContent !== 'Copy Link') reactivated++;
  }
  assert.equal(reactivated, 0);
  // Even when the old copy returns to this copy's state, the button stays the old copy's:
  // a later change (here: the dialog shows another place) does not make this copy touch it.
  d.btn.setAttribute('data-ntmaps-url', CLEAN);
  d.label.textContent = 'Copy Clean Link';
  env.mutate();
  d.title.textContent = 'Louvre Museum';
  env.mutate();
  assert.equal(d.btn.getAttribute('data-ntmaps-url'), CLEAN);
  assert.equal(d.label.textContent, 'Copy Clean Link');
  // Clicks on that button are left to the old copy as well.
  d.btn.setAttribute('data-ntmaps-url', 'https://www.google.com/maps/search/?api=1&query=48.8583701,2.2944813');
  const ev = click(env, d.btn);
  await settle();
  assert.equal(ev.stopped, false);
  assert.deepEqual(env.written, []);

  // The reverse: this copy falls back for another place, the old copy keeps the button active.
  const other = dialogStub({ name: 'Louvre Museum' });
  env.dialogs.splice(0, 1, other.root);
  env.mutate();
  assert.equal(other.btn.getAttribute('data-ntmaps-url'), ''); // this copy shows "No Clean Link"
  other.btn.setAttribute('data-ntmaps-url', CLEAN);
  other.label.textContent = 'Copy Clean Link';
  env.mutate();
  assert.equal(other.btn.getAttribute('data-ntmaps-url'), CLEAN);
  assert.equal(other.label.textContent, 'Copy Clean Link');
});

test('the preview card stays Google\'s: its click is not intercepted and clipboard.write is not wrapped', async () => {
  const env = environment(PLACE);
  env.run();
  env.flush();
  const d = dialogStub({ name: 'Eiffelturm', overlay: 'Copy Link' });
  env.dialogs.push(d.root);
  env.mutate();
  for (const target of [d.preview, d.overlaySpan, d.title]) {
    const ev = click(env, target);
    assert.equal(ev.stopped, false);
    assert.equal(ev.prevented, false);
  }
  await settle();
  assert.deepEqual(env.written, []);
  // Google's own copy of the card (short link in a ClipboardItem) reaches the clipboard unchanged
  const items = [new env.ClipboardItem({ 'text/plain': 'https://maps.app.goo.gl/abc123' })];
  await env.context.navigator.clipboard.write(items);
  assert.equal(env.writtenItems[0], items);
  // the button keeps working after Google's "Copied" overlay appeared
  d.overlaySpan.textContent = 'Copied';
  env.mutate();
  assert.equal(d.label.textContent, 'Copy Clean Link');
  click(env, d.btn);
  await settle();
  assert.deepEqual(env.written, [CLEAN]);
  assert.equal(d.label.textContent, 'Copied');
});

test('a dialog for another place shows a greyed-out "No Clean Link" that copies nothing', async () => {
  const env = environment(PLACE);
  env.run();
  env.flush();
  const d = dialogStub({ name: 'Eiffelturm', overlay: 'Copy Link' });
  env.dialogs.push(d.root);
  env.mutate();
  assert.equal(d.btn.getAttribute('data-ntmaps-url'), CLEAN);
  d.title.textContent = 'Louvre Museum'; // Google reuses the dialog for another place
  env.mutate();
  assert.equal(d.btn.getAttribute('data-ntmaps-url'), '');
  assert.equal(d.label.textContent, 'No Clean Link');
  assert.equal(d.btn.getAttribute('aria-disabled'), 'true');
  assert.equal(d.btn.style.opacity, '0.5');
  assert.equal(d.btn.style.cursor, 'not-allowed');
  assert.match(d.btn.getAttribute('title'), /another place/);
  assert.equal(d.link.textContent, 'maps.app.goo.gl');
  // the address bar's clean link stays published for page.js (share / writeText)
  assert.equal(env.attrs.get('data-ntmaps-clean'), CLEAN);
  // neither a click nor Enter copies anything, and Google's handler does not run either
  for (const ev of [click(env, d.btn), (() => { const k = { type: 'keydown', key: 'Enter', target: d.btn, repeat: false, stopped: false, prevented: false, stopImmediatePropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } }; env.fire(k); return k; })()]) {
    assert.equal(ev.stopped, true);
    assert.equal(ev.prevented, true);
  }
  await settle();
  assert.deepEqual(env.written, []);
  assert.equal(d.label.textContent, 'No Clean Link');
  // back to the address bar's place: the button is active again and no longer greyed out
  d.title.textContent = 'Eiffelturm';
  env.mutate();
  assert.equal(d.btn.getAttribute('data-ntmaps-url'), CLEAN);
  assert.equal(d.label.textContent, 'Copy Clean Link');
  assert.equal(d.btn.hasAttribute('aria-disabled'), false);
  assert.equal(d.btn.style.opacity, '');
  assert.equal(d.btn.style.cursor, '');
  click(env, d.btn);
  await settle();
  assert.deepEqual(env.written, [CLEAN]);
});

test('a directions button that a pre-21.10 build keeps changing is left to it', () => {
  const env = environment('https://www.google.com/maps/dir/?api=1&origin=Eiffel+Tower&destination=Louvre');
  env.run();
  env.flush();
  const store = () => { const m = new Map(); return { hasAttribute: (k) => m.has(k), getAttribute: (k) => (m.has(k) ? m.get(k) : null), setAttribute: (k, v) => m.set(k, String(v)), removeAttribute: (k) => m.delete(k) }; };
  const label = { ...store(), childNodes: [], textContent: 'Copy link' };
  const dirBtn = { ...store(), nodeType: 1, style: {}, closest: () => null, querySelector: (sel) => (sel === '[aria-live]' ? label : null) };
  env.context.document.querySelector = (sel) => (sel === 'button[jslog^="198301;"]' ? dirBtn : null);
  env.mutate();
  assert.equal(dirBtn.getAttribute('data-ntmaps-url'), 'https://www.google.com/maps/dir/?api=1&origin=Eiffel%20Tower&destination=Louvre');
  assert.equal(label.textContent, 'Copy Clean Link');
  let reactivated = 0;
  for (let i = 0; i < 3; i++) {
    dirBtn.removeAttribute('data-ntmaps-url');
    label.textContent = 'Copy link';
    env.mutate();
    if (dirBtn.hasAttribute('data-ntmaps-url') || label.textContent !== 'Copy link') reactivated++;
  }
  assert.equal(reactivated, 0);
});

test('a sync during the 2 s copy feedback keeps "Copied"', async () => {
  // Writing "Copied" is itself a text change inside the dialog, so the observer syncs at once
  // (mutateHot); without the busy guard that sync would put "Copy Clean Link" back.
  const env = environment(PLACE);
  env.run();
  env.flush();
  const d = dialogStub({ name: 'Eiffelturm' });
  env.dialogs.push(d.root);
  env.mutate();
  click(env, d.btn);
  await settle();
  assert.deepEqual(env.written, [CLEAN]);
  assert.equal(d.label.textContent, 'Copied');
  env.mutateHot(); // Google changes something inside the dialog while the feedback runs
  assert.equal(d.label.textContent, 'Copied');
  env.flush(); // the 2 s timer ends the feedback
  assert.equal(d.label.textContent, 'Copy Clean Link');
});

const LIST = 'https://www.google.com/maps/@48.86,2.33,15z/data=!4m3!11m2!2sExampleListId!3e3';

test('a button this copy left to Google is left to a pre-21.10 build that activates it', () => {
  const env = environment(LIST); // a saved list: no clean link, Google's button stays
  env.run();
  env.flush();
  const d = dialogStub({ name: 'Eiffelturm' });
  env.dialogs.push(d.root);
  env.mutate();
  assert.equal(d.btn.hasAttribute('data-ntmaps-url'), false);
  d.btn.setAttribute('data-ntmaps-url', CLEAN); // the old copy relabels it
  d.label.textContent = 'Copy Clean Link';
  env.mutate();
  env.mutate();
  assert.equal(d.btn.getAttribute('data-ntmaps-url'), CLEAN);
  assert.equal(d.label.textContent, 'Copy Clean Link');
});

test('"No Clean Link" is lifted completely when the page no longer has a clean link', () => {
  const env = environment(PLACE);
  env.run();
  env.flush();
  const d = dialogStub({ name: 'Louvre Museum' }); // another place than the address bar
  env.dialogs.push(d.root);
  env.mutate();
  assert.equal(d.label.textContent, 'No Clean Link');
  env.context.location.href = LIST;
  env.mutate();
  assert.equal(d.btn.hasAttribute('data-ntmaps-url'), false);
  assert.equal(d.btn.hasAttribute('aria-disabled'), false);
  assert.equal(d.btn.style.opacity, '');
  assert.equal(d.btn.style.cursor, '');
  assert.equal(d.btn.hasAttribute('title'), false);
  assert.equal(d.label.textContent, 'Copy Link');
});

test('a switch to another place replaces "Copied" with "No Clean Link" at once', async () => {
  const env = environment(PLACE);
  env.run();
  env.flush();
  const d = dialogStub({ name: 'Eiffelturm' });
  env.dialogs.push(d.root);
  env.mutate();
  click(env, d.btn);
  await settle();
  assert.deepEqual(env.written, [CLEAN]);
  d.title.textContent = 'Louvre Museum';
  env.mutateHot();
  assert.equal(d.btn.getAttribute('data-ntmaps-url'), ''); // blocked for further clicks
  assert.equal(d.btn.getAttribute('aria-disabled'), 'true');
  assert.equal(d.label.textContent, 'No Clean Link'); // the copied link was the earlier place's
  env.flush(); // the 2 s timer ends the feedback
  assert.equal(d.label.textContent, 'No Clean Link');
  assert.deepEqual(env.written, [CLEAN]);
});

test('a dropped pin is never blocked: its dialog may name an address instead of the coordinates', () => {
  const env = environment('https://www.google.com/maps/place/48%C2%B051%2730.1%22N+2%C2%B017%2740.1%22E/@48.85,2.29,17z/data=!3m1!4b1!4m4!3m3!8m2!3d48.8583701!4d2.2944813');
  env.run();
  env.flush();
  const d = dialogStub({ name: 'Av. Gustave Eiffel, 75007 Paris' });
  env.dialogs.push(d.root);
  env.mutate();
  assert.equal(d.btn.getAttribute('data-ntmaps-url'), 'https://www.google.com/maps/search/?api=1&query=48.8583701,2.2944813');
  assert.equal(d.label.textContent, 'Copy Clean Link');
});

test('a greyed-out button that a pre-21.10 build takes over is no longer greyed out', () => {
  const env = environment(PLACE);
  env.run();
  env.flush();
  const d = dialogStub({ name: 'Louvre Museum' }); // another place than the address bar
  env.dialogs.push(d.root);
  env.mutate();
  assert.equal(d.btn.getAttribute('aria-disabled'), 'true');
  d.btn.removeAttribute('data-ntmaps-url'); // the old copy falls back to Google's button
  d.label.textContent = 'Copy Link';
  env.mutate();
  env.mutate();
  assert.equal(d.btn.hasAttribute('data-ntmaps-url'), false);
  assert.equal(d.label.textContent, 'Copy Link');
  assert.equal(d.btn.hasAttribute('aria-disabled'), false);
  assert.equal(d.btn.style.opacity, '');
  assert.equal(d.btn.style.cursor, '');
});

test('back to the address bar\'s place during the copy feedback, the enabled button no longer reads "No Clean Link"', async () => {
  const env = environment(PLACE);
  env.run();
  env.flush();
  const d = dialogStub({ name: 'Eiffelturm' });
  env.dialogs.push(d.root);
  env.mutate();
  click(env, d.btn);
  await settle();
  assert.equal(d.label.textContent, 'Copied');
  d.title.textContent = 'Louvre Museum';
  env.mutateHot();
  assert.equal(d.label.textContent, 'No Clean Link');
  d.title.textContent = 'Eiffelturm'; // back within the 2 s feedback
  env.mutateHot();
  assert.equal(d.btn.getAttribute('data-ntmaps-url'), CLEAN);
  assert.equal(d.btn.hasAttribute('aria-disabled'), false);
  assert.equal(d.label.textContent, 'Copy Clean Link');
  env.flush(); // the 2 s timer ends the feedback
  assert.equal(d.label.textContent, 'Copy Clean Link');
  assert.deepEqual(env.written, [CLEAN]);
});

test('a sync during the 2 s feedback keeps "Copy Failed" as well', async () => {
  const env = environment(PLACE);
  env.run();
  env.flush();
  // Both the async Clipboard API and the execCommand fallback fail.
  env.context.navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
  const doc = env.context.document;
  doc.createElement = () => ({ value: '', style: {}, setAttribute() {}, select() {}, remove() {} });
  doc.documentElement.appendChild = () => {};
  doc.execCommand = () => false;
  const d = dialogStub({ name: 'Eiffelturm' });
  env.dialogs.push(d.root);
  env.mutate();
  click(env, d.btn);
  await settle();
  assert.deepEqual(env.written, []);
  assert.equal(d.label.textContent, 'Copy Failed');
  env.mutateHot(); // the label change itself is a text change inside the dialog
  assert.equal(d.label.textContent, 'Copy Failed');
  env.flush(); // the 2 s timer ends the feedback
  assert.equal(d.label.textContent, 'Copy Clean Link');
});
