# Clean Share Link for Google Maps

Share Google Maps places, routes, Street View and map views without tracking. This free, open-source browser extension turns the **Copy Link** button of the Google Maps share dialog and the **Copy link** button of the directions panel into **Copy Clean Link**, and hands the same clean link to the system share sheet on Firefox for Android. Instead of a personalised `maps.app.goo.gl` short link it copies a link in Google’s documented [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) format with Place ID and coordinates, which also renders as a place smart chip in [Google Docs](https://support.google.com/docs/answer/10710316) and [Google Sheets](https://support.google.com/docs/answer/12319513).

Example (Brandenburg Gate, Berlin):

```
https://www.google.com/maps/search/?api=1&query=52.5162746,13.3777041&query_place_id=ChIJiQnyVcZRqEcRY0xnhE77uyY
```

No API key, no account, no settings, no toolbar button, no network requests, no data collection.

## Why

A `maps.app.goo.gl` short link is an HTTP redirect served by Google: every open is a request to Google’s servers before the map appears, and the redirect target carries tracking parameters (`entry=tts`, `g_ep=…`) plus a unique `skid=…` identifier for that particular share, so Google can tie everyone who opens the link to the share that created it (observed 18.10.2026 with `curl -I`; [Google’s privacy policy](https://policies.google.com/privacy#infocollect) describes the activity data collected with such requests). The `?cid=` alternative carries no coordinates, breaks when a place is removed and shows no map preview in Google Sheets (observed, undocumented). With Maps URLs, `query_place_id` opens the exact place and, as documented by [Google](https://developers.google.com/maps/documentation/urls/get-started#search-action), `query` is only used if the Place ID cannot be found. Here `query` holds the coordinates, so the link still lands in the right spot. [Google’s documentation](https://developers.google.com/maps/documentation/urls/get-started#utmtracking) asks developers to add `utm_` parameters to Maps URLs; this extension deliberately does not.

## What it does

| Google Maps page | Clean link | Reference |
| --- | --- | --- |
| Place | `search/?api=1&query=LAT,LNG&query_place_id=ChIJ…` | [Search](https://developers.google.com/maps/documentation/urls/get-started#search-action) |
| Dropped pin | `search/?api=1&query=LAT,LNG` | [Search](https://developers.google.com/maps/documentation/urls/get-started#search-action) |
| Text search | `search/?api=1&query=…` (a Maps URLs search has no map-area parameter) | [Search](https://developers.google.com/maps/documentation/urls/get-started#search-action) |
| Route (2+ stops) | `dir/?api=1&origin=…&destination=…&waypoints=…` with Place IDs and travel mode, from the **Copy link** button of the directions panel | [Directions](https://developers.google.com/maps/documentation/urls/get-started#directions-action) |
| Street View | `@?api=1&map_action=pano&pano=…&viewpoint=…&heading=…&pitch=…&fov=…` | [Street View](https://developers.google.com/maps/documentation/urls/get-started#street-view-action) |
| Map view | `@?api=1&map_action=map&center=…&zoom=…`, satellite as `basemap=satellite` | [Map](https://developers.google.com/maps/documentation/urls/get-started#map-action) |
| Saved lists and anything else | Google’s original **Copy Link** is left untouched | – |

- The share dialog preview shows the clean link instead of `maps.app.goo.gl`.
- Works on all Google domains from [Google’s official list](https://www.google.com/supported_domains) (`google.com`, `google.de`, `google.co.uk`, …).
- Follows Google Maps navigation without a page reload; the link is recomputed on every copy. The label is applied in the same task that inserts the dialog, so Google’s label never shows first.
- If the address bar and the dialog show different places, the button stays Google’s original.
- Nothing to configure: the extension has no toolbar button and no popup.
- On Firefox for Android, Google Maps shares through the system share sheet via [`navigator.share()`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share) (observed on 18.10.2026 with the mobile layout and on Firefox Nightly 160 for Android); the extension swaps the tracking URL for the clean link before the sheet opens. If a copy action still writes a `maps.app.goo.gl` link to the clipboard, it is replaced the same way.

## How it works

Every Google Maps place URL contains the place’s feature ID and marker coordinates in the `data=` segment (undocumented, observed):

```
/maps/place/Eiffelturm/@48.8583701,2.291901,17z/data=!3m1!4b1!4m6!3m5!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!8m2!3d48.8583701!4d2.2944813
                       └ viewport centre (not the place)        └ feature ID (FID)                       └ marker lat/lng
```

A Place ID of the form `ChIJ…` is that feature ID packed into a two-field protobuf message and base64url-encoded; the second half of the feature ID is the decimal `cid`. Google documents Place IDs only as [textual identifiers of varying length](https://developers.google.com/maps/documentation/places/web-service/place-id); the encoding was derived from what the URL itself exposes. The extension performs the conversion locally (`src/core.js`). Street View is read from the same `data=` segment. The unit tests (`test/core.test.js`) check the conversion against three independently published Place IDs, among them Google’s documentation examples for [Google Sydney](https://developers.google.com/maps/documentation/places/web-service/legacy/details) (Place Details) and the [Sydney Opera House](https://developers.google.com/maps/documentation/urls/get-started#utmtracking) (Maps URLs), and Google’s server resolves the resulting links to the same feature IDs (verified 18.10.2026).

For routes the clean link carries the stop names next to the Place IDs rather than coordinates: Google Maps on the web honours `origin_place_id`, `destination_place_id` and `waypoint_place_ids` only next to a name and otherwise reverse-geocodes the coordinates to the nearest business (observed 18.10.2026; the [documentation](https://developers.google.com/maps/documentation/urls/get-started#directions-action) allows names, addresses or coordinates as values).

Two small scripts run on Google Maps pages: `src/content.js` in the extension’s isolated world relabels the buttons and publishes the clean link as `data-ntmaps-clean` on the `<html>` element; `src/page.js` in the page’s own world ([`world: "MAIN"`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts#world), Firefox 128+, Chrome 111+) wraps `navigator.share()` and `navigator.clipboard.writeText()` and substitutes that link whenever Google hands over a Maps URL. The page script contains no logic of its own. The userscript build (`scripts/build-userscript.mjs`) concatenates the same three files into one script that runs in the page’s world.

## Install

The extension is not listed in any store yet. Build the add-on file once, then install it from that file (sideloading):

```
npm install
npm run build     # writes dist/clean_share_link_for_google_maps-<version>.zip
```

### Firefox for desktop

Firefox keeps an unsigned add-on installed only in the [ESR](https://www.mozilla.org/firefox/organizations/), [Developer Edition](https://www.mozilla.org/firefox/developer/) and [Nightly](https://nightly.mozilla.org/) builds; the regular release and beta builds enforce signing and ignore the preference below ([Add-on signing in Firefox](https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox), [Signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)).

1. Open `about:config`, search for `xpinstall.signatures.required` and set it to `false`. This switches off the signature check for every add-on in that profile, not just this one.
2. Open `about:addons`, click the gear icon, choose **Install Add-on From File…** and pick the zip from `dist/` (the file picker accepts `.xpi`, `.jar` and `.zip`). Confirm with **Add** ([Installing self-distributed extensions](https://extensionworkshop.com/documentation/publish/install-self-distributed/#install-addon-from-file)).
3. The add-on stays installed across restarts; `about:addons` marks it as *could not be verified*. It receives no updates, so repeat step 2 with a new build when needed.

Verified on 18.10.2026 with Firefox ESR 153 by installing the unsigned zip permanently: with the preference set to `false` the add-on installs, is active and survives a restart; with the default `true` Firefox refuses with `ERROR_SIGNEDSTATE_REQUIRED`.

If Firefox answers *could not be installed because it is not compatible with Firefox N*, it is older than the declared minimum (desktop 140, Android 142). Delete the two `strict_min_version` lines from `manifest.json` and rebuild. Firefox 139 or earlier ignores `data_collection_permissions` ([built-in data consent, older versions](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/#data-collection-experience-on-older-Firefox-versions)); below Firefox 128 the [`world: "MAIN"`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts#world) script does not run inside the page, so the share-sheet and clipboard replacement stops while the relabelled buttons keep working.

Without touching any preference, every Firefox build can load the extension temporarily: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → select `manifest.json`. It is removed when Firefox quits ([Temporary installation in Firefox](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)).

### Firefox for Android

The release build of Firefox for Android enforces signing as well. Two routes exist without a store listing:

- **Firefox Nightly for Android.** Set `xpinstall.signatures.required` to `false` in `about:config`, copy the zip to the device, then open *Settings → About Firefox Nightly* and tap the logo five times; this unlocks *Settings → Install extension from file*, which takes the zip ([Installing self-distributed extensions, Android](https://extensionworkshop.com/documentation/publish/install-self-distributed/#install-addon-from-file-android)). Mozilla documents this menu for signed files; verified on 18.10.2026 with Firefox Nightly 160 for Android that it also installs this unsigned zip permanently and that the share sheet then receives the clean link. The extension has no toolbar button, so it is listed under *Manage extensions* only, not in the extensions drop-down.
- **Temporarily over USB.** With the Android platform tools and USB debugging enabled, `npx web-ext run -t firefox-android --adb-device <device id> --firefox-apk org.mozilla.fenix` loads the extension into Nightly (`org.mozilla.firefox_beta` for Beta, `org.mozilla.firefox` for the release build) until the browser quits ([Developing extensions for Firefox for Android](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/)).

### Firefox: signed, but not listed

Mozilla also signs add-ons for *self-distribution*: `npx web-ext sign --channel unlisted` with addons.mozilla.org API credentials returns a signed `.xpi` that installs in every Firefox build, including the Android release build through the *Install extension from file* route above, without a public listing ([Self-distribution](https://extensionworkshop.com/documentation/publish/self-distribution/), [Signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)). The source is still reviewed by Mozilla, which is why this project has not used it so far.

### Userscript (Violentmonkey, Tampermonkey)

The same code is also available as a userscript. The userscript managers are signed and listed on addons.mozilla.org for Firefox and Firefox for Android, so this route works in every Firefox build without changing the signature preference.

1. Install a userscript manager: [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/) (open source, MIT) or [Tampermonkey](https://addons.mozilla.org/firefox/addon/tampermonkey/) (proprietary). Both are offered for Firefox for Android as well.
2. Run `npm run build:userscript`, which writes `dist/clean-share-link-for-google-maps.user.js`.
3. Open the file over HTTP, for example with `python3 -m http.server 8000 --bind 127.0.0.1 --directory dist` and `http://127.0.0.1:8000/clean-share-link-for-google-maps.user.js`. The manager shows its install page; confirm with **Install**.
4. Chrome and Brave additionally need the *Allow User Scripts* toggle on the manager’s details page (Chrome 138 and newer) or *Developer mode* (older versions) ([chrome.userScripts](https://developer.chrome.com/docs/extensions/reference/api/userScripts#enable-user-scripts-api)).

Verified on 21.10.2026 with Firefox ESR 153 and the signature check switched on, separately with Violentmonkey 2.49.0 and Tampermonkey 5.5.0 from addons.mozilla.org: the manager installed permanently, the userscript installed through the manager’s own install page, and the share dialog, the directions panel and the clipboard wrapper behaved as with the extension. Firefox for Android and Chromium-based browsers with a userscript manager have not been verified yet.

Differences to the extension:

- The manager can read every website, not only Google Maps; the extension itself needs no permission beyond its content scripts.
- Everything runs in the page’s own JavaScript world (`@inject-into page`), because `navigator.share()` and `navigator.clipboard.writeText()` have to be wrapped there. Google Maps’ code can therefore see the script; it keeps its own variables in a private scope.
- `@run-at document-start` does not guarantee running before the page’s scripts ([Violentmonkey: @run-at](https://violentmonkey.github.io/api/metadata-block/#run-at)). In the tests on 21.10.2026 this did not matter, because Google Maps looked up `navigator.share()` and `navigator.clipboard.writeText()` only when sharing or copying; if Google ever keeps early references to them, the share sheet and clipboard replacement would stop working. The script waits for the `<html>` element if it starts before it exists.
- Google Maps sent its Content Security Policy as `report-only` on 21.10.2026. If Google enforces it, managers may no longer be able to inject into the page, and the userscript would stop without an error message.
- If both the extension and the userscript are installed, only the first one to start relabels the buttons. A running copy answers a synchronous `ntmaps-alive` event, and an idle copy asks again every two seconds. In Firefox, a reloaded or disabled extension stops answering and the idle copy takes over (tested on 21.10.2026). Chromium-based browsers were not tested for this case; reloading the page always starts a fresh copy. The page can answer the event too and thereby keep a copy from starting, which gives it no more control than it already has over its own buttons and links.

### Chrome, Edge, Brave (desktop)

`chrome://extensions` → enable *Developer mode* → **Load unpacked** → select the repository folder, not the zip ([Load unpacked](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)). Chrome shows a generic icon because it does not support [SVG icons](https://developer.chrome.com/docs/extensions/reference/manifest/icons).

Chrome for Android cannot install extensions; the Chrome Web Store only offers *Add to Desktop* on phones ([Chrome Web Store help](https://support.google.com/chrome_webstore/answer/2664769)). The Google Maps apps for Android and iOS cannot be extended by browser add-ons.

### Safari (macOS, iOS)

Convert with `xcrun safari-web-extension-converter .` (Xcode required) and run the generated app once; untested ([Converting a web extension for Safari](https://developer.apple.com/documentation/safariservices/converting-a-web-extension-for-safari)).

## Permissions and privacy

| Permission | Reason |
| --- | --- |
| Content scripts on `*.google.<country domain>/maps*` | Relabel the copy buttons and the dialog preview; hand the clean link to the share sheet and clipboard |

The extension makes no network requests, stores nothing and collects no data, declared as `data_collection_permissions: none` for [Firefox’s built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/). See `PRIVACY.md`.

## Known limitations

- **Undocumented formats.** Google documents Place IDs only as [textual identifiers without a maximum length](https://developers.google.com/maps/documentation/places/web-service/place-id); the `data=` URL segment is not documented at all. If either changes, the link falls back to the coordinates or the button stays Google’s original. Place IDs passed through from a URL are limited to 512 characters as a safety cap.
- **Place ID types.** Only `ChIJ…` IDs can be derived from a feature ID (observed; other prefixes such as `GhIJ…` or `Eic…` appear in [Google’s examples](https://developers.google.com/maps/documentation/places/web-service/place-id)). Street addresses and intersections get coordinates only.
- **Place IDs can change.** Google [recommends refreshing Place IDs older than 12 months](https://developers.google.com/maps/documentation/places/web-service/place-id); the coordinate fallback limits the impact.
- **Routes.** Maps URLs [support up to three waypoints on mobile browsers and nine elsewhere](https://developers.google.com/maps/documentation/urls/get-started#directions-action). Route options are not read from the Google Maps URL, so the Maps URLs `avoid` parameter is never set. The directions panel’s *Copy link* button is found by its `jslog` element id `198301` with a text fallback (observed 18.10.2026, undocumented).
- **Dialog structure.** The share dialog button is found by its id `app-container-Copy Link` (the same in the English and German interfaces) and the preview by `data-skw-id` (observed 18.10.2026, undocumented). If Google changes them, the button stays Google’s original; the clipboard and share-sheet replacement in `src/page.js` keeps working.
- **Share sheet on Android.** Google Maps in Firefox for Android opens the share sheet only once per page load; reload the page to share again (observed 18.10.2026 on Firefox Nightly 160, also without the extension).
- **Firefox updates.** Firefox does not show newly added host permissions when an update is installed ([Firefox bug 1893232](https://bugzil.la/1893232), noted in the [MDN `host_permissions` reference](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions)).

## Development

```
npm install               # installs web-ext (Node 18+)
npm test                  # unit tests
npm run lint              # Mozilla addons-linter via web-ext
npm run build             # zip for sideloading, addons.mozilla.org and the Chrome Web Store
npm run build:userscript  # dist/clean-share-link-for-google-maps.user.js for Violentmonkey and Tampermonkey
npm run check-domains     # compare the manifest's domains with Google's list
```

The userscript’s `@downloadURL` and `@updateURL` point to the file of the same name in the latest GitHub release; managers update from there once a release carries it.

[Match patterns](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Match_patterns#host) allow a wildcard only at the start of the host (`*.google.com`), not in the top-level domain, so the 187 domains from [google.com/supported_domains](https://www.google.com/supported_domains) are listed explicitly; `check-domains` reports drift.

The [version](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/version) is the release date as `YYYY.M.D`: one to four dot-separated integers are required by both stores, and the [Chrome Web Store](https://developer.chrome.com/docs/extensions/reference/manifest/version) caps each integer at 65535.

The GitHub Actions workflow in `.github/workflows/ci.yml` runs the tests and `addons-linter` on every push.

## License

MIT, see `LICENSE`. The link glyph in `icon.svg` is the `link` symbol from Google’s [Material Symbols](https://github.com/google/material-design-icons) (rounded, weight 700), licensed under the [Apache License 2.0](https://github.com/google/material-design-icons/blob/master/LICENSE).

Assisted-by: Claude Opus 5.5 (xhigh) for development and the userscript build, Claude Fable 5.1 (xhigh) for review and extension

Google Maps is a trademark of Google LLC. This project is not affiliated with or endorsed by Google.
