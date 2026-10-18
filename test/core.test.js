// Unit tests for src/core.js. Run with: npm test (Node 18+).
// Place ID ↔ feature ID pairs were verified against Google's own server
// response to the Maps URLs link (the response contains the feature ID).
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');

const PAIRS = [
  // Eiffel Tower – feature ID from the Maps place URL, Place ID widely published
  ['0x47e66e2964e34e2d:0x8ddca9ee380ef7e0', 'ChIJLU7jZClu5kcR4PcOOO6p3I0', '10222232094831998944'],
  // Sydney Opera House – Maps URLs documentation example
  ['0x6b12ae665e892fdd:0x3133f8d75a1ac251', 'ChIJ3S-JXmauEmsRUcIaWtf4MzE', '3545450935484072529'],
  // Google Sydney – Place Details documentation example (places/web-service/legacy/details)
  ['0x6b12ae37b47f5b37:0x8eaddfcd1b32ca52', 'ChIJN1t_tDeuEmsRUsoyG83frY4', '10281119596374313554']
];

test('feature ID ↔ Place ID conversion matches published IDs', () => {
  for (const [fid, placeId, cid] of PAIRS) {
    assert.equal(core.fidToPlaceId(fid), placeId);
    assert.equal(core.placeIdToFid(placeId), fid);
    assert.equal(core.fidToCid(fid), cid);
  }
});

test('conversion is case-insensitive and rejects malformed input', () => {
  assert.equal(core.fidToPlaceId('0x47E66E2964E34E2D:0x8DDCA9EE380EF7E0'), PAIRS[0][1]);
  assert.equal(core.fidToPlaceId('0x47e66e2964e34e2d'), null);
  assert.equal(core.fidToPlaceId(''), null);
  assert.equal(core.fidToPlaceId(null), null);
  assert.equal(core.placeIdToFid('ChIJ3S-JXmauEmsRUcIaWtf4MzX'.slice(0, 10)), null);
  assert.equal(core.placeIdToFid('not base64url!'), null);
  assert.equal(core.placeIdToFid('EiNTeWRuZXkgT3BlcmEgSG91c2U'), null); // other Place ID type
});

test('place URL → search link with coordinates and Place ID', () => {
  const info = core.parseMapsUrl('https://www.google.com/maps/place/Eiffelturm/@48.8583701,2.291901,17z/data=!3m1!4b1!4m6!3m5!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!8m2!3d48.8583701!4d2.2944813');
  assert.equal(info.kind, 'place');
  assert.equal(info.name, 'Eiffelturm');
  assert.equal(info.placeId, PAIRS[0][1]);
  assert.equal(info.lat, 48.8583701);
  assert.equal(info.lng, 2.2944813);
  assert.equal(info.exact, true);
  assert.equal(core.buildCleanUrl(info),
    'https://www.google.com/maps/search/?api=1&query=48.8583701,2.2944813&query_place_id=ChIJLU7jZClu5kcR4PcOOO6p3I0');
});

test('place URL without marker falls back to the viewport centre', () => {
  const info = core.parseMapsUrl('https://www.google.de/maps/place/Eiffelturm/@48.8583701,2.291901,17z/data=!4m2!3m1!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0');
  assert.equal(info.kind, 'place');
  assert.equal(info.exact, false);
  assert.equal(core.buildCleanUrl(info),
    'https://www.google.com/maps/search/?api=1&query=48.8583701,2.291901&query_place_id=ChIJLU7jZClu5kcR4PcOOO6p3I0');
});

test('dropped pin → search link with coordinates only', () => {
  const info = core.parseMapsUrl('https://www.google.com/maps/place/48%C2%B051%2730.1%22N+2%C2%B017%2740.1%22E/@48.8583701,2.291901,17z/data=!3m1!4b1!4m4!3m3!8m2!3d48.8583701!4d2.2944813');
  assert.equal(info.kind, 'pin');
  assert.equal(info.placeId, null);
  assert.equal(core.buildCleanUrl(info), 'https://www.google.com/maps/search/?api=1&query=48.8583701,2.2944813');
});

test('search URL with Maps URLs parameters is passed through', () => {
  const info = core.parseMapsUrl('https://www.google.com/maps/search/?api=1&query=48.8583701,2.2944813&query_place_id=ChIJLU7jZClu5kcR4PcOOO6p3I0');
  assert.equal(info.kind, 'place');
  assert.equal(info.fid, PAIRS[0][0]);
  assert.equal(core.buildCleanUrl(info),
    'https://www.google.com/maps/search/?api=1&query=48.8583701,2.2944813&query_place_id=ChIJLU7jZClu5kcR4PcOOO6p3I0');
});

test('directions with two places and travel mode', () => {
  const info = core.parseMapsUrl('https://www.google.com/maps/dir/Eiffelturm/Louvre/@48.86,2.31,14z/data=!3m1!4b1!4m14!4m13!1m5!1m1!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!2m2!1d2.2944813!2d48.8583701!1m5!1m1!1s0x47e671d877937b0f:0xb975fcfa192f84d4!2m2!1d2.337644!2d48.8606111!3e2');
  assert.equal(info.kind, 'dir');
  assert.equal(info.waypoints.length, 2);
  assert.equal(info.travelmode, 'walking');
  assert.equal(info.waypoints[0].name, 'Eiffelturm');
  assert.equal(info.waypoints[1].lat, 48.8606111);
  const url = core.buildCleanUrl(info);
  // Names, not coordinates: Maps on the web only honours the place IDs next to a name.
  assert.equal(url,
    'https://www.google.com/maps/dir/?api=1&origin=Eiffelturm&origin_place_id=ChIJLU7jZClu5kcR4PcOOO6p3I0'
    + '&destination=Louvre&destination_place_id=' + core.fidToPlaceId('0x47e671d877937b0f:0xb975fcfa192f84d4')
    + '&travelmode=walking');
});

test('directions with coordinates-only stops use the coordinates', () => {
  const info = core.parseMapsUrl('https://www.google.com/maps/dir/48.8583701,2.2944813/48.8606111,2.337644/@48.86,2.31,14z/data=!3m1!4b1!4m2!4m1!3e2');
  assert.equal(info.kind, 'dir');
  assert.equal(core.buildCleanUrl(info),
    'https://www.google.com/maps/dir/?api=1&origin=48.8583701%2C2.2944813&destination=48.8606111%2C2.337644&travelmode=walking');
});

test('directions with an empty origin ("your location") and a waypoint', () => {
  const info = core.parseMapsUrl('https://www.google.com/maps/dir//Louvre/Eiffelturm/@48.86,2.31,14z/data=!4m20!4m19!1m0!1m5!1m1!1s0x47e671d877937b0f:0xb975fcfa192f84d4!2m2!1d2.337644!2d48.8606111!1m5!1m1!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!2m2!1d2.2944813!2d48.8583701!3e0');
  assert.equal(info.kind, 'dir');
  assert.equal(info.waypoints.length, 3);
  assert.equal(info.waypoints[0].name, null);
  assert.equal(info.waypoints[0].lat, null);
  const url = core.buildCleanUrl(info);
  assert.ok(url.startsWith('https://www.google.com/maps/dir/?api=1&destination=Eiffelturm&destination_place_id=ChIJLU7jZClu5kcR4PcOOO6p3I0'));
  assert.ok(url.includes('&waypoints=Louvre&waypoint_place_ids=' + core.fidToPlaceId('0x47e671d877937b0f:0xb975fcfa192f84d4')));
  assert.ok(url.endsWith('&travelmode=driving'));
  assert.ok(!url.includes('origin='));
});

test('directions by name only (no data segment)', () => {
  const info = core.parseMapsUrl('https://www.google.com/maps/dir/Berlin,+Germany/Paris,+France/');
  assert.equal(info.kind, 'dir');
  assert.equal(core.buildCleanUrl(info),
    'https://www.google.com/maps/dir/?api=1&origin=Berlin%2C%20Germany&destination=Paris%2C%20France');
});

test('Street View → pano link with viewpoint, heading, pitch and fov', () => {
  const info = core.parseMapsUrl('https://www.google.com/maps/@48.8583701,2.2944813,3a,75y,264.68h,90t/data=!3m7!1e1!3m5!1sAF1QipMExampleExample!2e0!6shttps:%2F%2Fexample%2F!7i13312!8i6656');
  assert.equal(info.kind, 'pano');
  assert.equal(info.panoId, 'AF1QipMExampleExample');
  assert.equal(core.buildCleanUrl(info),
    'https://www.google.com/maps/@?api=1&map_action=pano&pano=AF1QipMExampleExample&viewpoint=48.8583701,2.2944813&heading=264.68&pitch=0&fov=75');
});

test('photo sphere (type ≠ 0) keeps the viewpoint but drops the pano ID', () => {
  const info = core.parseMapsUrl('https://www.google.com/maps/@48.8583701,2.2944813,3a,75y,264.68h,90t/data=!3m7!1e1!3m5!1sAF1QipMExampleExample!2e10!6shttps:%2F%2Fexample%2F!7i13312!8i6656');
  assert.equal(info.kind, 'pano');
  assert.equal(info.panoId, null);
  assert.ok(core.buildCleanUrl(info).includes('map_action=pano&viewpoint=48.8583701,2.2944813'));
});

test('plain map view and satellite view', () => {
  const map = core.parseMapsUrl('https://www.google.co.uk/maps/@51.5073509,-0.1277583,12z');
  assert.equal(map.kind, 'map');
  assert.equal(core.buildCleanUrl(map), 'https://www.google.com/maps/@?api=1&map_action=map&center=51.5073509,-0.1277583&zoom=12');
  const sat = core.parseMapsUrl('https://www.google.com/maps/@51.5073509,-0.1277583,12.37z/data=!3m1!1e3');
  assert.equal(sat.satellite, true);
  assert.equal(core.buildCleanUrl(sat), 'https://www.google.com/maps/@?api=1&map_action=map&center=51.5073509,-0.1277583&zoom=12&basemap=satellite');
});

test('zoom is clamped to 0–21 and coordinates are validated', () => {
  const info = core.parseMapsUrl('https://www.google.com/maps/@51.5,-0.1,99z');
  assert.equal(info.viewport.zoom, 21);
  assert.equal(core.parseMapsUrl('https://www.google.com/maps/@91,-0.1,12z').kind, 'unsupported');
  assert.equal(core.parseMapsUrl('https://www.google.com/maps/@51.5,181,12z').kind, 'unsupported');
});

test('saved lists and unrelated pages are unsupported', () => {
  assert.equal(core.parseMapsUrl('https://www.google.com/maps/@51.5,-0.1,12z/data=!4m3!11m2!2sExampleListId!3e3').kind, 'unsupported');
  assert.equal(core.parseMapsUrl('https://www.google.com/maps').kind, 'unsupported');
  assert.equal(core.parseMapsUrl('https://www.google.com/maps/contrib/123').kind, 'unsupported');
  assert.equal(core.buildCleanUrl({ kind: 'unsupported' }), null);
  assert.equal(core.buildCleanUrl(null), null);
});

test('only https Google hosts with a /maps path are accepted', () => {
  assert.equal(core.parseMapsUrl('http://www.google.com/maps/@51.5,-0.1,12z').kind, 'unsupported');
  assert.equal(core.parseMapsUrl('https://evilgoogle.com/maps/@51.5,-0.1,12z').kind, 'unsupported');
  assert.equal(core.parseMapsUrl('https://google.com.evil.example/maps/@51.5,-0.1,12z').kind, 'unsupported');
  assert.equal(core.parseMapsUrl('https://www.google.com/mapsfoo/@51.5,-0.1,12z').kind, 'unsupported');
  assert.equal(core.parseMapsUrl('not a url').kind, 'unsupported');
  assert.equal(core.parseMapsUrl('https://maps.google.com/maps/@51.5,-0.1,12z').kind, 'map');
  assert.equal(core.parseMapsUrl('https://www.google.com.au/maps/@-33.8,151.2,12z').kind, 'map');
});

test('built links never contain characters outside the URL-safe set', () => {
  const info = core.parseMapsUrl('https://www.google.com/maps/dir/Stra%C3%9Fe+%26+Platz%2C+K%C3%B6ln/Caf%C3%A9+%22Zum+Test%22%3Fx%3Dy/');
  const url = core.buildCleanUrl(info);
  assert.match(url, /^[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+$/);
  assert.ok(url.includes('origin=Stra%C3%9Fe%20%26%20Platz%2C%20K%C3%B6ln'));
  assert.ok(url.includes('destination=Caf%C3%A9%20%22Zum%20Test%22%3Fx%3Dy'));
});

test('coordinates are printed in fixed notation', () => {
  const url = core.buildCleanUrl({ kind: 'pin', lat: 0.00000012, lng: 1e-7, placeId: null, name: null });
  assert.equal(url, 'https://www.google.com/maps/search/?api=1&query=0.0000001,0.0000001');
  const zero = core.buildCleanUrl({ kind: 'pin', lat: -0.00000001, lng: 0, placeId: null, name: null });
  assert.equal(zero, 'https://www.google.com/maps/search/?api=1&query=0,0');
});

test('namesMatch tolerates punctuation, case and accents', () => {
  assert.equal(core.namesMatch('Eiffelturm', 'Eiffelturm'), true);
  assert.equal(core.namesMatch('Café de Flore', 'CAFÉ DE FLORE – Paris'), true);
  assert.equal(core.namesMatch('Eiffelturm', 'Louvre'), false);
  assert.equal(core.namesMatch('Eiffelturm', null), null);
  assert.equal(core.namesMatch('', 'Louvre'), null);
});

test('parseDataTree nests messages by their token count', () => {
  const { tree } = core.parseDataTree('!4m5!3m4!1s0x1:0x2!8m2!3d1!4d2');
  assert.equal(tree.length, 1);
  assert.equal(tree[0].f, 4);
  assert.equal(tree[0].c[0].f, 3);
  assert.equal(tree[0].c[0].c.length, 2);
  assert.equal(tree[0].c[0].c[1].c.length, 2);
});

test('travel mode only accepts known numeric codes (no prototype lookup)', () => {
  const base = 'https://www.google.com/maps/dir/A/B/@48.86,2.31,14z/data=!4m14!4m13!1m5!1m1!1s0x1:0x2!2m2!1d2.29!2d48.85!1m5!1m1!1s0x3:0x4!2m2!1d2.33!2d48.86';
  assert.equal(core.parseMapsUrl(base + '!3e1').travelmode, 'bicycling');
  assert.equal(core.parseMapsUrl(base + '!3e9').travelmode, null);
  assert.equal(core.parseMapsUrl(base + '!3econstructor').travelmode, null);
  assert.equal(core.parseMapsUrl(base + '!3e__proto__').travelmode, null);
  assert.ok(!core.buildCleanUrl(core.parseMapsUrl(base + '!3econstructor')).includes('travelmode'));
});

test('deeply nested data segments do not overflow the stack', () => {
  const blob = '!1m9999'.repeat(20000);
  const href = 'https://www.google.com/maps/place/X/@48.85,2.29,17z/data=' + blob + '!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0';
  assert.doesNotThrow(() => core.parseMapsUrl(href));
  assert.equal(core.parseMapsUrl(href).kind, 'place');
});

test('marker coordinates must be plain decimals (no empty, hex or binary values)', () => {
  const empty = core.parseMapsUrl('https://www.google.com/maps/place/X/@48.85,2.29,17z/data=!4m4!3m3!8m2!3d!4d');
  assert.equal(empty.kind, 'map');
  const hex = core.parseMapsUrl('https://www.google.com/maps/place/X/@48.85,2.29,17z/data=!4m4!3m3!8m2!3d0x10!4d0b11');
  assert.equal(hex.kind, 'map');
  const wp = core.parseMapsUrl('https://www.google.com/maps/dir/A/B/@48.86,2.31,14z/data=!4m12!4m11!1m4!2m2!1d!2d!1m4!2m2!1d0x1!2d1e2');
  assert.equal(wp.kind, 'dir');
  assert.equal(wp.waypoints[0].lat, null);
  assert.equal(wp.waypoints[1].lat, null);
});

test('over-long query_place_id values are not passed through', () => {
  const info = core.parseMapsUrl('https://www.google.com/maps/search/?api=1&query=48.85,2.29&query_place_id=' + 'A'.repeat(600));
  assert.equal(info.kind, 'pin');
  assert.equal(info.placeId, null);
});

test('text searches keep their query instead of degrading to a map view', () => {
  const path = core.parseMapsUrl('https://www.google.com/maps/search/coffee+shops/@48.85,2.29,14z/data=!3m1!4b1');
  assert.equal(path.kind, 'search');
  assert.equal(core.buildCleanUrl(path), 'https://www.google.com/maps/search/?api=1&query=coffee%20shops');
  const param = core.parseMapsUrl('https://www.google.com/maps/search/?api=1&query=Eiffel+Tower');
  assert.equal(param.kind, 'search');
  assert.equal(core.buildCleanUrl(param), 'https://www.google.com/maps/search/?api=1&query=Eiffel%20Tower');
  // Coordinates and place IDs in a search still win over the text branch.
  assert.equal(core.parseMapsUrl('https://www.google.com/maps/search/48.8583701,+2.2944813/@48.85,2.29,17z').kind, 'pin');
  assert.equal(core.parseMapsUrl('https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJLU7jZClu5kcR4PcOOO6p3I0').kind, 'place');
});
