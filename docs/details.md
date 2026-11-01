# Clean Share Link for Google Maps: details

Background, step-by-step installation, testing and sources for the [README](../README.md).

## Why

Each time you share a place, Google creates a new `maps.app.goo.gl` short link. Opening it first sends a request to Google’s server, which forwards to the place and adds the parameters `entry=tts`, `g_ep=…` and `skid=…`. The `skid` parameter was first seen on 18.10.2026; on 01.11.2026 two shares of the same place gave two different `skid` values (checked with `curl`). So Google’s server can see which share a visit came from. We found no Google documentation for these parameters; Google’s [privacy policy](https://policies.google.com/privacy#infocollect) describes in general which activity data Google collects.

The clean link uses Google’s documented [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started). `query_place_id` opens the exact place. `query` holds the coordinates and is used only if Google cannot find the place ID ([search action](https://developers.google.com/maps/documentation/urls/get-started#search-action)). Google’s documentation [encourages developers to add `utm_` parameters](https://developers.google.com/maps/documentation/urls/get-started#utmtracking) to Maps URLs; this extension does not.

## What it does

| Google Maps page | Clean link | Reference |
| --- | --- | --- |
| Place | `search/?api=1&query=LAT,LNG&query_place_id=ChIJ…` | [Search](https://developers.google.com/maps/documentation/urls/get-started#search-action) |
| Dropped pin | `search/?api=1&query=LAT,LNG` | [Search](https://developers.google.com/maps/documentation/urls/get-started#search-action) |
| Text search | `search/?api=1&query=…` (a Maps URLs search has no map-area parameter) | [Search](https://developers.google.com/maps/documentation/urls/get-started#search-action) |
| Route (2+ stops) | `dir/?api=1&origin=…&destination=…&waypoints=…` with place IDs and travel mode, from the **Copy link** button of the directions panel | [Directions](https://developers.google.com/maps/documentation/urls/get-started#directions-action) |
| Street View | `@?api=1&map_action=pano&pano=…&viewpoint=…&heading=…&pitch=…&fov=…` | [Street View](https://developers.google.com/maps/documentation/urls/get-started#street-view-action) |
| Map view | `@?api=1&map_action=map&center=…&zoom=…`, satellite as `basemap=satellite` | [Map](https://developers.google.com/maps/documentation/urls/get-started#map-action) |
| Saved lists and anything else | Google’s own **Copy Link** stays as it is | – |

- The upper part of the share dialog (picture, name, address and short link) stays Google’s: pointing at the picture shows Google’s *Copy Link*, and a click on it copies Google’s short link. Only the *Copy Clean Link* button in the row below copies the clean link, also after you have pointed at or clicked the upper part.
- If the dialog shows a different place from the one in the address bar, the button shows *No Clean Link*, is greyed out, is marked as disabled for screen readers and copies nothing, not even Google’s short link. This is a safety check; in tests of normal use it never appeared (see [Testing](#testing)).
- Works on all Google domains from [Google’s list](https://www.google.com/supported_domains) (`google.com`, `google.de`, `google.co.uk` and others).
- Follows Google Maps when you move to another place without reloading the page; the link is built again on every copy.
- In Firefox for Android, Google Maps shares through the system share menu with [`navigator.share()`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share). The extension replaces the link before the menu opens. If Google copies a Maps link with `navigator.clipboard.writeText()`, it is replaced the same way. The desktop share dialog copies with `navigator.clipboard.write()`, which the extension leaves alone.
- Nothing to configure: no toolbar button and no popup.

## How it works

The link of a Google Maps place page (`/maps/place/…`) contains the place’s feature ID and the marker coordinates in its `data=` part; for a dropped pin it contains only the coordinates. We found no Google documentation for this; it was observed:

```
/maps/place/Brandenburger+Tor/@52.5162746,13.3777041,17z/data=!3m1!4b1!4m6!3m5!1s0x47a851c655f20989:0x26bbfb4e84674c63!8m2!3d52.5162746!4d13.3777041
                              └ map centre                                       └ feature ID                              └ marker lat/lng
```

The map centre after `@` may differ from the marker.

A place ID of the form `ChIJ…` is this feature ID in a small binary format (protobuf), encoded as base64url. Google documents place IDs only as [text of varying length](https://developers.google.com/maps/documentation/places/web-service/place-id); the conversion was worked out from the links themselves and runs locally in `src/core.js`. The unit tests check it against place IDs published in Google’s documentation, and Google’s server opened the resulting links at the right places (checked on 18.10.2026). Street View is read from the same `data=` part.

For routes, the clean link carries the stop names next to the place IDs, not coordinates. Google Maps on the web uses `origin_place_id`, `destination_place_id` and `waypoint_place_ids` only next to a name; with coordinates it looks for the nearest business instead (observed on 18.10.2026; the [documentation](https://developers.google.com/maps/documentation/urls/get-started#directions-action) allows names, addresses or coordinates).

Three small files run on Google Maps pages. `src/core.js` builds the clean link. `src/content.js` changes the buttons and stores the clean link as `data-ntmaps-clean` on the page’s `<html>` element. `src/page.js` runs inside the page itself ([`world: "MAIN"`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts#world), Firefox 128+, Chrome 111+, Safari 18+) and replaces Maps links that Google passes to `navigator.share()` or `navigator.clipboard.writeText()` with that clean link. The userscript (`scripts/build-userscript.mjs`) puts the same three files into one script.

## Install step by step

### Build the zip

The extension is not in any store yet. Chrome, Edge and Brave need no build, and neither does loading the extension in Firefox on a computer until Firefox closes. For everything else you need [Node.js](https://nodejs.org/) 18 or newer. Open a terminal in the project folder, the folder with `manifest.json` and `package.json` (Terminal on macOS and Linux, Command Prompt on Windows; the [README](../README.md#install) shows how), and run:

```
npm install
npm run build     # writes dist/clean_share_link_for_google_maps-<version>.zip
```

`npm install` downloads Mozilla’s build tool [web-ext](https://github.com/mozilla/web-ext) into `node_modules`. Its settings, including the list of files that stay out of the zip, are in `package.json` under `"webExt"`, which web-ext reads by itself ([web-ext configuration](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/#setting-option-defaults-in-a-configuration-file)). So npm runs the same commands on every system; it uses `cmd.exe` on Windows and `/bin/sh` elsewhere ([npm run](https://docs.npmjs.com/cli/v11/commands/npm-run)). In PowerShell on Windows, npm may not start at all, because npm also comes as a PowerShell script and PowerShell can be set to block all scripts ([execution policies](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_execution_policies)); use Command Prompt instead. Besides that list, web-ext leaves out hidden files, `node_modules` and other zip and xpi files; any other file you put into the project folder ends up in the zip.

### Firefox ESR, Developer Edition and Nightly

Firefox release and Firefox Beta keep only add-ons that Mozilla has signed. [ESR](https://www.mozilla.org/firefox/organizations/), [Developer Edition](https://www.mozilla.org/firefox/developer/) and [Nightly](https://nightly.mozilla.org/) can switch this check off ([Add-on signing in Firefox](https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox)):

1. Open `about:config`, search for `xpinstall.signatures.required` and set it to `false`. This switches off the check for every add-on in this Firefox profile, not just this one.
2. Open `about:addons`, click the gear icon, choose **Install Add-on From File…** and pick the zip from `dist/`. Confirm with **Add** ([Installing self-distributed extensions](https://extensionworkshop.com/documentation/publish/install-self-distributed/#install-addon-from-file)).
3. The add-on stays installed after a restart; `about:addons` marks it as *could not be verified*. It gets no updates, so repeat step 2 with a new build when needed.

In Firefox release and Beta, use the [userscript](#userscript-with-violentmonkey), or, on a computer, load the extension until Firefox closes: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → `manifest.json` ([Temporary installation in Firefox](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)).

If Firefox says that the add-on is not compatible, your Firefox is older than the minimum (140 on desktop, 142 on Android). Delete the two Firefox `strict_min_version` lines (under `gecko` and `gecko_android`) from `manifest.json` and build again. Below Firefox 128 the share menu and clipboard replacement do not work; the buttons should still work (not tested).

Mozilla can also sign an add-on without listing it on addons.mozilla.org ([self-distribution](https://extensionworkshop.com/documentation/publish/self-distribution/)); this project does not do that yet.

### Firefox for Android

- **Firefox Nightly.** Set `xpinstall.signatures.required` to `false` in `about:config` and copy the zip to the phone. Then open *Settings → About Firefox Nightly* and tap the logo five times; this adds *Settings → Install extension from file* ([Installing self-distributed extensions, Android](https://extensionworkshop.com/documentation/publish/install-self-distributed/#install-addon-from-file-android)). Mozilla describes this menu for signed files; only the maintainer checked that it also accepts the unsigned zip (see [Testing](#testing)). The extension has no toolbar button, so you find it only under *Manage extensions*.
- **Temporarily over USB.** You need the Android platform tools, USB debugging switched on in Android and *Remote debugging via USB* switched on in Firefox’s settings. Open a terminal in the project folder and, after `npm install`, run `npx web-ext run -t firefox-android --adb-device <device id> --firefox-apk org.mozilla.fenix`. This loads the extension into Nightly until the browser closes (for Beta use `org.mozilla.firefox_beta` instead of `org.mozilla.fenix`, for Firefox release `org.mozilla.firefox`; [Developing extensions for Firefox for Android](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/)).

### Chrome, Edge and Brave

`chrome://extensions` → switch on *Developer mode* → **Load unpacked** → choose the project folder (the folder with `manifest.json`), not the zip ([Load unpacked](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)). Chrome shows a generic icon because it does not support [SVG icons](https://developer.chrome.com/docs/extensions/reference/manifest/icons).

Chrome for Android cannot install extensions ([Chrome Web Store help](https://support.google.com/chrome_webstore/answer/2664769)). The Google Maps apps for Android and iOS cannot be extended by browser add-ons.

### Safari on macOS

Safari 18 or newer loads the zip from `dist/` as a temporary extension, without Xcode: *Settings → Advanced → Show features for web developers*, then *Settings → Developer → Add Temporary Extension…*, and confirm the question about unsigned extensions. Safari removes it after 24 hours or when you quit Safari ([Running your Safari web extension](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)). Then allow the extension on the Google domain you use (for example `google.de`) and reload the page; Safari asks for each Google domain separately. In Safari 27.2 this works only in a macOS user account with a login password (reported to Apple as FB25372799).

### Safari on iPhone and iPad

On iPhone and iPad, Safari runs an extension like this one only inside an app ([Distributing your Safari web extension](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)), and Apple names the App Store, TestFlight and builds for registered devices as ways to install such an app. This project does not provide an app. Use the userscript instead, for example with the Userscripts app:

1. Install the free, open-source app [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) from the App Store and switch it on under *Settings → Apps → Safari → Extensions* ([Apple: Safari extensions on iPhone](https://support.apple.com/guide/iphone/get-extensions-iphab0432bf6/ios)). Allow it on the Google domain you use.
2. Run `npm run build:userscript` on a computer and copy `dist/clean-share-link-for-google-maps.user.js` to the device, for example with iCloud Drive.
3. Save the file into the Userscripts folder in the Files app, then open the Userscripts menu in Safari at least once so that it finds the file ([Userscripts: usage](https://github.com/quoid/userscripts#usage), [scripts directory](https://github.com/quoid/userscripts#scripts-directory)).

Links to a GitHub release do not show Userscripts’ install prompt, because GitHub sends them as a download (GitHub’s answer checked with `curl` on 30.10.2026). Userscripts says that it “does not correctly implement the entire update process” ([Userscripts documentation](https://github.com/quoid/userscripts#metadata)). Other userscript apps for Safari were not tried. Nothing was tested on an iPhone or iPad.

### Userscript with Violentmonkey

The same code also works as a userscript. [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/) (free, open source) is signed by Mozilla, so you can install it in every Firefox, including Firefox release and Firefox for Android, without changing any setting.

1. Install Violentmonkey.
2. Run `npm run build:userscript`. It writes `dist/clean-share-link-for-google-maps.user.js` and `dist/clean-share-link-for-google-maps.meta.js`; managers use the `.meta.js` file to check for updates.
3. Give the file to Violentmonkey. The tested way is a small web server on your own computer, which needs [Python](https://www.python.org/downloads/). It works only in a browser on the same computer: the address `127.0.0.1` always means the device you are using, so a phone cannot reach the web server on your computer. In a terminal in the project folder, run `python3 -m http.server 8000 --bind 127.0.0.1 --directory dist` on macOS and Linux, or `py -m http.server 8000 --bind 127.0.0.1 --directory dist` on Windows ([Python on Windows](https://docs.python.org/3/using/windows.html)). Keep this window open, then go to `http://127.0.0.1:8000/clean-share-link-for-google-maps.user.js` in the browser. Violentmonkey shows its install page; click **Install**. Afterwards, stop the web server with Ctrl+C (on a Mac too: Control-C, not Command-C). Firefox for Android with a userscript manager was not tested. Violentmonkey also describes dragging the file into the browser’s tab bar; in Chrome this needs *Allow access to file URLs*, which Violentmonkey itself calls dangerous ([Violentmonkey guide](https://violentmonkey.github.io/posts/how-to-edit-scripts-with-your-favorite-editor/)).
4. In Chrome and Brave, also switch on *Allow User Scripts* on the manager’s details page (Chrome 138 and newer) or *Developer mode* (older versions) ([chrome.userScripts](https://developer.chrome.com/docs/extensions/reference/api/userScripts#enable-user-scripts-api)).

Differences from the extension:

- The userscript manager can read every website, not only Google Maps. The extension itself needs no permission beyond its scripts on Google Maps.
- The whole script runs inside the page (`@inject-into page`), so Google Maps’ code can see it; it keeps its internal variables private.
- `@run-at document-start` does not promise to run before the page’s own scripts ([Violentmonkey: @run-at](https://violentmonkey.github.io/api/metadata-block/#run-at)). This does not matter as long as Google Maps looks up `navigator.share()` and `navigator.clipboard.writeText()` only when sharing or copying, as it did in the tests.
- On the mobile layout, Google Maps uses a strict security policy for scripts (Content Security Policy). Its current form [still lets scripts from userscript managers run](https://www.w3.org/TR/CSP3/#strict-dynamic-usage) (tested for the way the Userscripts app adds them, see [Testing](#testing)). If Google makes the policy stricter, the userscript may stop working there without an error message. The extension does not depend on this.

### Extension and userscript together

If both are installed, only the copy that starts first changes the buttons. The running copy answers a short `ntmaps-alive` check; a waiting copy asks again every two seconds and takes over when the other one stops, for example after the extension was switched off (tested in Firefox, not in Chromium browsers).

Builds from before 21.10.2026 do not have this check. Remove such a build before you add the userscript, and reload open Google Maps tabs afterwards. These builds carry version 2026.10.18. Builds made later, up to the version change on 01.11.2026, also carry 2026.10.18, so this version number does not tell you whether a build has the check; version 2026.11.1 and later always have it. If an old build still runs next to a new one, the tab keeps working (tested in Brave), but the old build decides the button: you may see Google’s *Copy Link* and get Google’s short link.

## Privacy and permissions

| Permission | Reason |
| --- | --- |
| Scripts on `*.google.<country domain>/maps*` | Change the copy buttons; give the clean link to the share menu and the clipboard |

The extension makes no network requests, stores nothing and collects no data. For Firefox this is declared as `data_collection_permissions: none` ([Firefox’s built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)). See [PRIVACY.md](../PRIVACY.md).

## Known limitations

- **Formats without Google documentation.** Google documents place IDs only as [text without a maximum length](https://developers.google.com/maps/documentation/places/web-service/place-id), and we found no Google documentation for the `data=` part of the link. If either changes, the link falls back to the coordinates or the button stays Google’s. Place IDs taken from a link are limited to 512 characters.
- **Place ID types.** Only `ChIJ…` place IDs can be built from a feature ID. Street addresses and intersections get coordinates only.
- **Place IDs can change.** Google [recommends refreshing place IDs older than 12 months](https://developers.google.com/maps/documentation/places/web-service/place-id); the coordinates still lead to the right spot.
- **Routes.** Maps URLs [support up to three stops in between on mobile browsers and nine elsewhere](https://developers.google.com/maps/documentation/urls/get-started#directions-action). Route options such as “avoid tolls” are not copied.
- **Page structure.** The extension finds Google’s buttons and the upper part of the share dialog by names for which we found no Google documentation. If Google changes them, the button stays Google’s and copies Google’s short link. If Google changes the order of the name and address in the upper part, the extension may show *No Clean Link* by mistake. The replacement in the share menu and the clipboard does not depend on this.
- **Share menu on Android.** Google Maps in Firefox for Android opens the share menu only once per page load, also without the extension; reload the page to share again.
- **Firefox updates.** Firefox does not ask again when an update adds new website permissions ([Firefox bug 1893232](https://bugzil.la/1893232)).

## Testing

- **Unit tests:** `npm test`.
- **Installing the unsigned zip permanently** (automated, Firefox ESR 153, 18.10.2026): with `xpinstall.signatures.required` set to `false` the add-on installed, was active and stayed after a restart; with the default `true` Firefox refused it.
- **Automated browser tests** (18.10.–01.11.2026): Brave (Chromium), Firefox ESR 153 and Nightly 160, and WebKit of macOS 27.2 with Mac and iPhone user agents; Firefox and Brave also with an Android user agent. Covered: the share dialog, the directions panel, copying, the share menu on mobile layouts, and the userscript with Violentmonkey 2.49.0 in Firefox ESR 153 with the signature check switched on (21.10.2026). WebKit is the engine of Safari, but these tests are not Safari itself. In frame-by-frame checks in Firefox and Brave, Google’s own label never showed before *Copy Clean Link*.
- **Scripts added by userscript managers under Google’s Content Security Policy** (30.10.2026): `curl` showed that Google Maps enforces the policy for iPhone and Android user agents and only reports it for desktop ones; a script added the way the [Userscripts app adds page scripts](https://github.com/quoid/userscripts/blob/main/src/ext/content-scripts/entry-userscripts.js) ran under that policy in WebKit, and was blocked under a stricter test policy without `'strict-dynamic'`.
- **Checked by hand by the maintainer:**
  - Firefox Nightly 160 on an Android phone with the unsigned zip of 18.10.2026: it installed through *Install extension from file*, and the share menu passed on the clean link (18.10.2026).
  - Safari 27.2 on macOS with the temporary extension: the share dialog and the directions panel (30.10.2026). The first time he opened the share dialog of a place, Google’s own label showed for one to two seconds before *Copy Clean Link* (cause unknown). After fixes for two problems (the directions panel showed Google’s label for two to three seconds, and pointing at or clicking the picture made the button fall back to Google’s), checked again with the code of 30.10.2026, also after pointing at and clicking the picture in the share dialog (result reported on 31.10.2026); this time Google’s label did not show first.
  - *No Clean Link* in Safari 27.2 with the code of 31.10.2026 (result reported on 01.11.2026), and the userscript with Violentmonkey in Firefox with the same code, including *No Clean Link* and the directions panel (01.11.2026). *No Clean Link* was simulated by renaming the place in the dialog from the browser console. Checked: the label, the grey colour, the not-allowed pointer, the tooltip, that a click copies nothing, and *Copy Clean Link* again after reloading. Version 2026.11.1 contains the code of 31.10.2026 unchanged.
- **No Clean Link in normal use:** in ten automated cases on 01.11.2026 the button always showed *Copy Clean Link*: two places, each with the page in two of the languages English, German and French; an English link opened in German and the other way round; a dropped pin; a search for coordinates; a place from a list of results; and switching to the next result and sharing about one second later. Google rewrites the place name in the address bar to the language of the page, so name and dialog match. That is why the state in the README picture is simulated.
- **Old and new copy together** (automated in Brave, 30.10.–01.11.2026): with the build of 18.10.2026 next to a newer copy, the tab kept working; before a fix on 30.10.2026, it froze.
- **Not tested:** iPhone and iPad, the Userscripts app, userscript managers in Chromium browsers and on Firefox for Android, Edge and Google Chrome itself.

## Screenshots

`docs/share-dialog.png` was taken on 01.11.2026 in Brave (Chromium) with the English interface. The first dialog shows Google’s own button (taken with an empty test extension), the other two show this extension. Everything except the copy button, including the background, was turned black and white on purpose, so this is an edited picture, not Google Maps as it looks online. The button itself was not edited; in the third dialog the extension greys it out. The third dialog is simulated: the Reichstag’s photo, name and address were put into the Brandenburg Gate’s dialog, while the address bar (not in the picture) still showed the Brandenburg Gate. Name and address were copied from Google’s real share dialog for the Reichstag (read on 01.11.2026).

`docs/directions.png` shows only the button row of the directions panel, which looks the same for every route.

The photos are [Brandenburger Tor 2019.jpg](https://commons.wikimedia.org/wiki/File:Brandenburger_Tor_2019.jpg) by QueenElisabeththeThird and [Reichstagsgebäude (20220612114356).jpg](https://commons.wikimedia.org/wiki/File:Reichstagsgeb%C3%A4ude_(20220612114356).jpg) by Ebeling-Marius. Both are CC0 on Wikimedia Commons, so no credit is required (licence data read on 01.11.2026). They replace Google’s own photo, which Google serves from its servers and which we have no right to republish. The pictures show no map and no Street View.

## Development notes

- The [version](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/version) is the release date as `YYYY.M.D`. Firefox and the Chrome Web Store require one to four numbers separated by dots, and the [Chrome Web Store](https://developer.chrome.com/docs/extensions/reference/manifest/version) allows at most 65535 per number.
- [Match patterns](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Match_patterns#host) allow a wildcard only at the start of a host name, not for the country domain, so the 187 domains from [google.com/supported_domains](https://www.google.com/supported_domains) are listed one by one; `npm run check-domains` reports changes.
- The userscript’s `@downloadURL` and `@updateURL` point to `clean-share-link-for-google-maps.user.js` and `clean-share-link-for-google-maps.meta.js` in the latest GitHub release, as [Userscripts expects](https://github.com/quoid/userscripts#metadata). Managers can check for updates there once a release carries both files (not tested yet; the Userscripts app’s update support is incomplete, see above).
- The GitHub Actions workflow in `.github/workflows/ci.yml` runs on every push on Ubuntu, macOS and Windows: it installs web-ext, runs the tests and the add-on linter, builds the zip and checks that the zip holds only the six extension files.
