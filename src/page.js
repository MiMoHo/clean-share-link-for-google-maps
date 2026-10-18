// Clean Share Link for Google Maps – page script (runs in the page's own world).
// The mobile layout of Google Maps shares through navigator.share() with a long
// tracking URL (g_ep=…) and some copy actions write a maps.app.goo.gl short link
// with navigator.clipboard.writeText(). Both are wrapped here so that the clean
// Maps URLs link is handed over instead. The link itself is computed by the
// content script (content.js) and published on <html data-ntmaps-clean="…">;
// this script holds no logic of its own, makes no network requests and stores nothing.
(() => {
  'use strict';

  const ATTR = 'data-ntmaps-clean';
  const MAPS_LINK = /^(https?:\/\/)?((maps\.app\.)?goo\.gl\/|([a-z0-9-]+\.)*google\.[a-z.]+\/maps(\/|\?|$))/i;

  // The clean link for the current page when the value is a Google Maps link, otherwise null.
  function replacement(value) {
    if (typeof value !== 'string' || !MAPS_LINK.test(value.trim())) return null;
    return document.documentElement.getAttribute(ATTR) || null;
  }

  const navProto = typeof Navigator !== 'undefined' ? Navigator.prototype : null;
  if (navProto && typeof navProto.share === 'function') {
    const share = navProto.share;
    navProto.share = function (data) {
      if (data && typeof data === 'object') {
        const original = data.url;
        const url = replacement(original);
        if (url) {
          data = { ...data, url };
          if (typeof data.text === 'string' && data.text.trim() === String(original).trim()) data.text = url;
        } else if (original === undefined) {
          const text = replacement(data.text);
          if (text) data = { ...data, text };
        }
      }
      return share.call(this, data);
    };
  }

  const clipProto = typeof Clipboard !== 'undefined' ? Clipboard.prototype : null;
  if (clipProto && typeof clipProto.writeText === 'function') {
    const writeText = clipProto.writeText;
    clipProto.writeText = function (text) {
      return writeText.call(this, replacement(text) || text);
    };
  }
})();
