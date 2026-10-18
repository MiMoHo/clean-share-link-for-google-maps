# Privacy

Clean Share Link for Google Maps does not collect, store or transmit any data.

- It makes no network requests of its own.
- It reads only the URL of the current Google Maps page in your browser and derives the clean link from it locally.
- It stores nothing, sets no cookies and uses no analytics.
- The clean link it produces contains no `utm_` or other tracking parameters, even though Google's Maps URLs documentation asks developers to add them.

In the Firefox manifest this is declared as `data_collection_permissions: { "required": ["none"] }`.

If you believe the extension behaves differently, please open an issue in the repository.
