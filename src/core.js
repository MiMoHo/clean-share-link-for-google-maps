// Clean Share Link for Google Maps – core logic.
// Pure functions without DOM or network access. Loaded by the content script;
// also importable in Node for the unit tests in /test.
(function (root) {
  'use strict';

  const BASE = 'https://www.google.com/maps';
  const FID_RE = /^0x([0-9a-f]{1,16}):0x([0-9a-f]{1,16})$/i;
  const PLACE_ID_RE = /^[A-Za-z0-9_-]{20,512}$/;
  const NUM_RE = /^-?\d{1,3}(?:\.\d+)?$/;
  const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const TRAVEL_MODES = { 0: 'driving', 1: 'bicycling', 2: 'walking', 3: 'transit' };
  const travelMode = (v) => (/^\d+$/.test(v) && Object.prototype.hasOwnProperty.call(TRAVEL_MODES, v) ? TRAVEL_MODES[v] : null);
  // Nesting deeper than this is not a Maps URL; stop recursing and keep the rest flat.
  const MAX_DEPTH = 64;

  // Hinweis: Google documents Place IDs as opaque strings. The ChIJ… form used
  // for establishments is, in practice, a base64url-encoded protobuf holding the
  // two 64-bit halves of the feature ID ("0xAAAA:0xBBBB") that appears in Maps
  // URLs as "!1s0x…:0x…". The second half is the decimal "cid".
  // Verified against independently published IDs, see test/core.test.js.
  // If Google changes this, Maps falls back to the coordinates in the link.

  function hexToLittleEndian(hex) {
    const h = hex.padStart(16, '0');
    const out = [];
    for (let i = 14; i >= 0; i -= 2) out.push(parseInt(h.slice(i, i + 2), 16));
    return out;
  }

  function littleEndianToHex(bytes) {
    let h = '';
    for (let i = bytes.length - 1; i >= 0; i--) h += bytes[i].toString(16).padStart(2, '0');
    return '0x' + h.replace(/^0+(?=.)/, '');
  }

  function base64urlEncode(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
      const chars = i + 2 < bytes.length ? 4 : i + 1 < bytes.length ? 3 : 2;
      for (let k = 0; k < chars; k++) out += B64URL[(n >> (18 - 6 * k)) & 63];
    }
    return out;
  }

  function base64urlDecode(str) {
    const bytes = [];
    let buf = 0;
    let bits = 0;
    for (const c of str) {
      const v = B64URL.indexOf(c);
      if (v < 0) return null;
      buf = ((buf << 6) | v) & 0xffffff;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buf >> bits) & 0xff);
      }
    }
    return bytes;
  }

  function normalizeFid(fid) {
    const m = FID_RE.exec(String(fid || '').trim());
    return m ? '0x' + m[1].toLowerCase() + ':0x' + m[2].toLowerCase() : null;
  }

  function fidToPlaceId(fid) {
    const m = FID_RE.exec(String(fid || ''));
    if (!m) return null;
    // Protobuf: field 1 (length 18) { field 1 fixed64, field 2 fixed64 }
    return base64urlEncode([0x0a, 0x12, 0x09, ...hexToLittleEndian(m[1]), 0x11, ...hexToLittleEndian(m[2])]);
  }

  function placeIdToFid(placeId) {
    const b = base64urlDecode(String(placeId || ''));
    if (!b || b.length !== 20 || b[0] !== 0x0a || b[1] !== 0x12 || b[2] !== 0x09 || b[11] !== 0x11) return null;
    return littleEndianToHex(b.slice(3, 11)) + ':' + littleEndianToHex(b.slice(12, 20));
  }

  function fidToCid(fid) {
    const m = FID_RE.exec(String(fid || ''));
    return m && typeof BigInt === 'function' ? BigInt('0x' + m[2]).toString() : null;
  }

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  function decodeName(segment) {
    return safeDecode(String(segment).replace(/\+/g, ' ')).trim();
  }

  function validLat(n) { return Number.isFinite(n) && n >= -90 && n <= 90; }
  function validLng(n) { return Number.isFinite(n) && n >= -180 && n <= 180; }
  // Strict decimal parse: Number('') is 0 and Number('0x10') is 16, both must be rejected.
  function num(s) { return NUM_RE.test(String(s ?? '')) ? Number(s) : NaN; }

  // Fixed-point output; avoids exponent notation such as 1e-7 near 0° and a bare "-0".
  function fmt(n, digits) {
    const s = n.toFixed(digits).replace(/\.?0+$/, '');
    return s === '' || s === '-0' ? '0' : s;
  }
  function fmtCoord(n) { return fmt(n, 7); }
  function latLng(lat, lng) { return fmtCoord(lat) + ',' + fmtCoord(lng); }

  function parseCoordPair(str) {
    const m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(String(str || ''));
    if (!m) return null;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    return validLat(lat) && validLng(lng) ? { lat, lng } : null;
  }

  // "@48.85,2.29,17z" | "@48.85,2.29,3a,75y,264.68h,90t" (Street View/3D) | "@48.85,2.29,812m"
  function parseViewport(segment) {
    if (!segment || segment[0] !== '@') return null;
    const parts = segment.slice(1).split(',');
    if (parts.length < 2 || !NUM_RE.test(parts[0]) || !NUM_RE.test(parts[1])) return null;
    const lat = Number(parts[0]);
    const lng = Number(parts[1]);
    if (!validLat(lat) || !validLng(lng)) return null;
    const vp = { lat, lng, zoom: null, fov: null, heading: null, tilt: null };
    for (const p of parts.slice(2)) {
      const m = /^(-?\d+(?:\.\d+)?)([a-z])$/.exec(p);
      if (!m) continue;
      const v = Number(m[1]);
      if (m[2] === 'z') vp.zoom = Math.min(21, Math.max(0, Math.round(v)));
      else if (m[2] === 'y') vp.fov = v;
      else if (m[2] === 'h') vp.heading = v;
      else if (m[2] === 't') vp.tilt = v;
    }
    return vp;
  }

  // The "data=" blob is a serialized protobuf: "!<field><type><value>".
  // For type "m" the value is the number of following tokens in that message.
  function parseDataTree(blob) {
    const tokens = String(blob || '').split('!').filter(Boolean).map((s) => {
      const m = /^(\d+)([a-zA-Z])([\s\S]*)$/.exec(s);
      return m ? { f: Number(m[1]), t: m[2], v: safeDecode(m[3]) } : null;
    }).filter(Boolean);
    function build(start, count, depth) {
      const nodes = [];
      let i = start;
      const end = Math.min(tokens.length, start + count);
      while (i < end) {
        const tk = tokens[i++];
        if (tk.t === 'm' && depth < MAX_DEPTH) {
          const [kids, next] = build(i, parseInt(tk.v, 10) || 0, depth + 1);
          nodes.push({ f: tk.f, t: 'm', v: tk.v, c: kids });
          i = next;
        } else {
          nodes.push(tk.t === 'm' ? { f: tk.f, t: 'm', v: tk.v, c: [] } : tk);
        }
      }
      return [nodes, i];
    }
    return { tokens, tree: build(0, tokens.length, 0)[0] };
  }

  const child = (node, f, t) => (node && node.c ? node.c.find((k) => k.f === f && k.t === t) : undefined);

  function walk(nodes, fn) {
    for (const n of nodes) {
      if (fn(n)) return n;
      if (n.c) {
        const hit = walk(n.c, fn);
        if (hit) return hit;
      }
    }
    return null;
  }

  // Flat scan for feature IDs and the marker coordinates (!3d lat !4d lng) that follow them.
  // Hinweis: "@lat,lng" in the path is the viewport centre, not the place.
  function findPlace(tokens) {
    const places = [];
    let current = null;
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      if (tk.f === 1 && tk.t === 's') {
        const fid = normalizeFid(tk.v);
        if (fid) {
          current = { fid, lat: null, lng: null };
          places.push(current);
          continue;
        }
      }
      const next = tokens[i + 1];
      if (tk.f === 3 && tk.t === 'd' && next && next.f === 4 && next.t === 'd') {
        const lat = num(tk.v);
        const lng = num(next.v);
        if (validLat(lat) && validLng(lng)) {
          if (current && current.lat === null) Object.assign(current, { lat, lng });
          else if (!current) places.push({ fid: null, lat, lng });
        }
        i++;
      }
    }
    return places.filter((p) => p.fid && p.lat !== null).pop()
      || places.filter((p) => p.fid).pop()
      || places.filter((p) => p.lat !== null).pop()
      || null;
  }

  function readWaypoint(node) {
    const idNode = child(child(node, 1, 'm'), 1, 's');
    const pos = child(node, 2, 'm');
    const lng = num(child(pos, 1, 'd')?.v);
    const lat = num(child(pos, 2, 'd')?.v);
    const ok = validLat(lat) && validLng(lng);
    return { fid: idNode ? normalizeFid(idNode.v) : null, lat: ok ? lat : null, lng: ok ? lng : null };
  }

  // Directions: a message with ≥2 repeated field-1 messages (waypoints) and an optional travel mode (field 3).
  function findRoute(tree) {
    const node = walk(tree, (n) => n.t === 'm' && n.c.filter((k) => k.f === 1 && k.t === 'm').length >= 2
      && n.c.filter((k) => k.f === 1 && k.t === 'm').every((k) => k.c.length === 0 || child(k, 2, 'm') || child(k, 1, 'm')));
    if (!node) return null;
    const mode = child(node, 3, 'e');
    return {
      waypoints: node.c.filter((k) => k.f === 1 && k.t === 'm').map(readWaypoint),
      travelmode: mode ? travelMode(mode.v) : null
    };
  }

  // Top-level "!3m…!1e1" marks Street View, "!1e3" satellite. "!1e2" is the photo viewer.
  function findView(tree) {
    const view = tree.find((n) => n.f === 3 && n.t === 'm');
    const kind = child(view, 1, 'e');
    if (!kind) return { mode: null };
    if (kind.v === '1') {
      const pano = child(view, 3, 'm');
      const id = child(pano, 1, 's');
      const type = child(pano, 2, 'e');
      // Hinweis: only classic Street View IDs (type 0) are accepted by "pano"; photo spheres fall back to viewpoint.
      return { mode: 'pano', panoId: id && type && type.v === '0' ? id.v : null };
    }
    if (kind.v === '3') return { mode: 'satellite' };
    return { mode: null };
  }

  function waypointFromParts(name, data) {
    const fid = data && data.fid;
    return {
      name: name || null,
      fid: fid || null,
      placeId: fid ? fidToPlaceId(fid) : null,
      lat: data && data.lat !== null ? data.lat : null,
      lng: data && data.lat !== null ? data.lng : null
    };
  }

  /**
   * Parses a Google Maps web URL.
   * kind: 'place' | 'pin' | 'search' | 'dir' | 'pano' | 'map' | 'unsupported'
   */
  function parseMapsUrl(href) {
    const empty = { kind: 'unsupported' };
    let url;
    try { url = new URL(href); } catch (e) { return empty; }
    const isGoogle = /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/i.test(url.hostname);
    if (url.protocol !== 'https:' || !isGoogle || !/^\/maps(\/|$)/.test(url.pathname)) return empty;

    const raw = url.pathname.split('/');
    const segs = raw.filter(Boolean);
    const isMeta = (s) => s[0] === '@' || s.startsWith('data=');
    const mode = segs[1] && !isMeta(segs[1]) ? segs[1] : 'map';
    const viewport = parseViewport(segs.find((s) => s[0] === '@'));
    const dataSeg = segs.find((s) => s.startsWith('data='));
    const { tokens, tree } = parseDataTree(dataSeg ? dataSeg.slice(5) : '');
    const q = url.searchParams;

    // Hinweis: saved lists ("!11m") and other collections cannot be expressed as Maps URLs.
    if (walk(tree, (n) => n.f === 11 && n.t === 'm')) return empty;

    if (mode === 'dir') {
      const start = raw.indexOf('dir') + 1;
      const names = [];
      for (let i = start; i < raw.length && !isMeta(raw[i]); i++) names.push(decodeName(raw[i]));
      if (names.length && names[names.length - 1] === '' && raw.length === start + names.length) names.pop();
      const route = findRoute(tree);
      const data = route ? route.waypoints : [];
      let travelmode = route ? route.travelmode : null;
      if (!travelmode) {
        // Coordinate-only routes carry no waypoint messages, only "!4m2!4m1!3e<mode>".
        const modeNode = walk(tree, (n) => n.f === 4 && n.t === 'm' && !!child(n, 3, 'e'));
        const m = modeNode && child(modeNode, 3, 'e');
        if (m) travelmode = travelMode(m.v);
      }
      let wps;
      if (data.length && names.length && data.length !== names.length) return empty;
      if (data.length) wps = data.map((d, i) => waypointFromParts(names[i], d));
      else wps = names.map((n) => waypointFromParts(n, null));
      if (wps.length < 2) return empty;
      return { kind: 'dir', waypoints: wps, travelmode, viewport };
    }

    const view = findView(tree);
    if (view.mode === 'pano' && viewport) {
      return { kind: 'pano', panoId: view.panoId, viewport };
    }

    const name = (mode === 'place' || mode === 'search') && segs[2] && !isMeta(segs[2]) ? decodeName(segs[2]) : null;
    const block = findPlace(tokens);
    let fid = block && block.fid;
    let placeId = null;
    let lat = block && block.lat !== null ? block.lat : null;
    let lng = block && block.lat !== null ? block.lng : null;

    if (!fid && q.get('ftid')) fid = normalizeFid(q.get('ftid'));
    const explicitPid = q.get('query_place_id') || (/^place_id:(.+)$/.exec(q.get('q') || '') || [])[1];
    if (explicitPid && PLACE_ID_RE.test(explicitPid)) placeId = explicitPid;
    if (!placeId && fid) placeId = fidToPlaceId(fid);
    if (!fid && placeId) fid = placeIdToFid(placeId);

    if (lat === null) {
      const pair = parseCoordPair(q.get('query'))
        || (!/^place_id:/.test(q.get('q') || '') && parseCoordPair(q.get('q')))
        || (mode === 'search' && name && parseCoordPair(name));
      if (pair) ({ lat, lng } = pair);
    }

    const exact = lat !== null;
    if (!exact && placeId && viewport) ({ lat, lng } = viewport);

    const base = { name, placeId, fid: fid || null, cid: fid ? fidToCid(fid) : null, lat, lng, exact, viewport };
    if (placeId) return { kind: 'place', ...base };
    if (exact) return { kind: 'pin', ...base };
    // Text search ("/maps/search/coffee+shops/@…" or "search/?api=1&query=…"): keep the query
    // instead of degrading to a bare map view. Maps URLs has no viewport for searches.
    const text = mode === 'search' ? (name || q.get('query') || q.get('q') || '').trim() : '';
    if (text && !/^place_id:/.test(text)) return { kind: 'search', query: text, viewport };
    if (viewport) return { kind: 'map', ...base, satellite: view.mode === 'satellite' };
    return empty;
  }

  // Hinweis: Google Maps on the web ignores origin/destination/waypoint place IDs
  // when the paired value is a coordinate pair and reverse-geocodes the coordinates
  // instead (wrong place label). With a name as the value the place ID is honoured.
  function waypointValue(wp) {
    if (wp.name) return encodeURIComponent(wp.name);
    if (wp.lat !== null) return latLng(wp.lat, wp.lng);
    return null;
  }

  /** Builds the documented, cookie-free Maps URLs link ("api=1") for a parse result. */
  function buildCleanUrl(info) {
    if (!info) return null;
    if (info.kind === 'place' || info.kind === 'pin') {
      // Hinweis: "query" is mandatory; with a valid query_place_id it is only a fallback.
      let query;
      if (info.lat !== null && info.lng !== null) query = latLng(info.lat, info.lng);
      else if (info.name) query = encodeURIComponent(info.name);
      else return null;
      return BASE + '/search/?api=1&query=' + query + (info.placeId ? '&query_place_id=' + info.placeId : '');
    }
    if (info.kind === 'search') {
      return BASE + '/search/?api=1&query=' + encodeURIComponent(info.query);
    }
    if (info.kind === 'dir') {
      const wps = info.waypoints;
      const origin = wps[0];
      const dest = wps[wps.length - 1];
      const via = wps.slice(1, -1);
      const destValue = waypointValue(dest);
      if (!destValue || via.some((w) => !waypointValue(w))) return null;
      let out = BASE + '/dir/?api=1';
      const originValue = waypointValue(origin);
      // Hinweis: an empty origin ("your location") is omitted; Maps then uses the device location.
      if (originValue) out += '&origin=' + originValue + (origin.placeId ? '&origin_place_id=' + origin.placeId : '');
      out += '&destination=' + destValue + (dest.placeId ? '&destination_place_id=' + dest.placeId : '');
      if (via.length) {
        out += '&waypoints=' + via.map(waypointValue).join('%7C');
        if (via.every((w) => w.placeId)) out += '&waypoint_place_ids=' + via.map((w) => w.placeId).join('%7C');
      }
      if (info.travelmode) out += '&travelmode=' + info.travelmode;
      return out;
    }
    if (info.kind === 'pano') {
      const vp = info.viewport;
      let out = BASE + '/@?api=1&map_action=pano';
      if (info.panoId) out += '&pano=' + encodeURIComponent(info.panoId);
      out += '&viewpoint=' + latLng(vp.lat, vp.lng);
      if (vp.heading !== null) out += '&heading=' + fmt(Math.max(-180, Math.min(360, vp.heading)), 2);
      if (vp.tilt !== null) out += '&pitch=' + fmt(Math.max(-90, Math.min(90, vp.tilt - 90)), 2);
      if (vp.fov !== null) out += '&fov=' + fmt(Math.max(10, Math.min(100, vp.fov)), 2);
      return out;
    }
    if (info.kind === 'map' && info.viewport) {
      let out = BASE + '/@?api=1&map_action=map&center=' + latLng(info.viewport.lat, info.viewport.lng);
      if (info.viewport.zoom !== null) out += '&zoom=' + info.viewport.zoom;
      if (info.satellite) out += '&basemap=satellite';
      return out;
    }
    return null;
  }

  function normalizeName(s) {
    return String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  }

  /** true / false, or null when either side is unknown. */
  function namesMatch(a, b) {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb) return null;
    return na.includes(nb) || nb.includes(na);
  }

  const api = { parseMapsUrl, buildCleanUrl, fidToPlaceId, placeIdToFid, fidToCid, namesMatch, parseDataTree };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTMapsCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
