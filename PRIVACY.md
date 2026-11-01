# Privacy

Clean Share Link for Google Maps does not collect, store or transmit any data.

- It makes no network requests of its own.
- It reads the URL of the current Google Maps page and, in the share dialog, the name of the place shown there. It builds the clean link locally from the URL and uses the place name only to check that the dialog shows the same place.
- When Google Maps itself shares a link through the browser’s share function (`navigator.share()`) or copies text with `navigator.clipboard.writeText()`, the extension checks that text in memory, only to replace a Google Maps link with the clean link. It never reads the clipboard.
- It stores nothing, sets no cookies and uses no analytics.
- The clean link it produces contains no `utm_` or other tracking parameters, even though Google’s Maps URLs documentation encourages developers to add `utm_` parameters.

In the Firefox manifest this is declared as `data_collection_permissions: { "required": ["none"] }`.

If you believe the extension behaves differently, please open an issue in the repository.
