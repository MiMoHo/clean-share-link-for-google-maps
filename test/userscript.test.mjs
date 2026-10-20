// Tests for the generated userscript: metadata mirrors manifest.json, and the merged
// page.js + core.js + content.js work in one world (run in a Node VM with a minimal DOM stub).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildUserscript } from '../scripts/build-userscript.mjs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const script = buildUserscript();
const meta = (key) => [...script.matchAll(new RegExp(`^// @${key}\\s+(.*)$`, 'gm'))].map((m) => m[1].trim());

const PLACE = 'https://www.google.com/maps/place/Eiffelturm/@48.8583701,2.291901,17z/data=!3m1!4b1!4m6!3m5!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!8m2!3d48.8583701!4d2.2944813';
const CLEAN = 'https://www.google.com/maps/search/?api=1&query=48.8583701,2.2944813&query_place_id=ChIJLU7jZClu5kcR4PcOOO6p3I0';

function environment(href, { lateRoot = false } = {}) {
  const busy = [];
  const attrs = new Map();
  const observers = [];
  const timers = [];
  let intervals = [];
  const listeners = [];
  const handlers = [];
  const shared = [];
  const written = [];
  class Navigator {}
  Navigator.prototype.share = function (data) { shared.push(data); return Promise.resolve(); };
  class Clipboard {}
  Clipboard.prototype.writeText = function (text) { written.push(text); return Promise.resolve(); };
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
    querySelectorAll: (sel) => (sel === '[data-ntmaps-busy]' ? busy.filter((el) => el.hasAttribute('data-ntmaps-busy')) : []),
    addEventListener: (type, fn) => docListeners.push({ type, fn }),
    dispatchEvent: (ev) => { for (const l of docListeners) if (l.type === ev.type) l.fn(ev); return !ev.defaultPrevented; },
  };
  const context = vm.createContext({
    document,
    location: { href },
    navigator, Navigator, Clipboard, CustomEvent,
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
  const answering = () => !document.dispatchEvent(new CustomEvent('ntmaps-alive', { cancelable: true }));
  return { busy, context, attrs, listeners, shared, written, run, flush, insertRoot, killInstances, answering, intervalCount, activeIntervals, fire, tick };
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

test('copy() publishes the copied link, so the page.js wrapper passes it through unchanged', async () => {
  // The button still carries a link from an earlier sync while <html> already shows the current place.
  const STALE = 'https://www.google.com/maps/search/?api=1&query=48.8606111,2.337644';
  const env = environment(PLACE);
  env.run();
  env.flush();
  assert.equal(env.attrs.get('data-ntmaps-clean'), CLEAN);
  const store = () => { const m = new Map(); return { hasAttribute: (k) => m.has(k), getAttribute: (k) => (m.has(k) ? m.get(k) : null), setAttribute: (k, v) => m.set(k, String(v)), removeAttribute: (k) => m.delete(k) }; };
  const label = { ...store(), childNodes: [], textContent: 'Copy Clean Link' };
  const root = { querySelector: (sel) => (sel === '[data-skw-id="preview"] span' ? { textContent: 'Louvre Museum' } : null) };
  const btn = { ...store(), nodeType: 1, querySelector: (sel) => (sel === '[aria-live]' ? label : null) };
  btn.closest = (sel) => (sel === '[data-ntmaps-url]' ? btn : root);
  btn.setAttribute('data-ntmaps-url', STALE);
  env.fire({ type: 'click', target: btn, repeat: false, stopImmediatePropagation() {}, preventDefault() {} });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(env.written, [STALE]);
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
