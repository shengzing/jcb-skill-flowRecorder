# Output Format

## Top-Level Files

### `navigation-log.json`

Array of recorded navigation records. Each item typically contains:

```json
{
  "timestamp": "ISO datetime",
  "source_url": "string",
  "target_url": "string",
  "target_title": "string",
  "clicked_text": "string",
  "element_role": "string",
  "element_tag": "string",
  "element_href": "string",
  "element_id": "string",
  "element_classes": "string",
  "element_bounds": {
    "x": "number",
    "y": "number",
    "width": "number",
    "height": "number"
  },
  "new_page": "boolean",
  "capture_id": "string",
  "capture_dir": "absolute path",
  "screenshot": "absolute path",
  "html": "absolute path",
  "network_log": "absolute path",
  "api_log": "absolute path"
}
```

### `navigation-map.csv`

Flat CSV export of the navigation records for spreadsheet filtering and manual cleanup.

### `navigation-flow.md`

Auto-generated Mermaid flow graph from raw records. This may contain duplicates and should often be refined for presentation.

## Per-Capture Files

Each navigation event writes:

```text
captures/<capture_id>/
  screenshot.png
  page.html
  network.json
  api-calls.json
  resources/
```

### `page.html`

Rendered HTML captured from:

```js
document.documentElement.outerHTML
```

This reflects the loaded DOM after client-side rendering, not the raw server response.

### `network.json`

All captured network entries for the page window, including static resources.

Typical entry shape:

```json
{
  "id": "string",
  "timestamp": "ISO datetime",
  "page_url": "string",
  "url": "string",
  "method": "GET|POST|...",
  "resource_type": "document|script|stylesheet|image|font|fetch|xhr|...",
  "status": "number",
  "status_text": "string",
  "content_type": "string",
  "query": {},
  "request_headers": {},
  "response_headers": {},
  "saved_resource": "relative path or empty",
  "body_error": "string"
}
```

### `api-calls.json`

Subset focused on `fetch` and `xhr`.

Typical entry shape:

```json
{
  "id": "string",
  "timestamp": "ISO datetime",
  "page_url": "string",
  "url": "string",
  "method": "GET|POST|...",
  "status": "number",
  "status_text": "string",
  "content_type": "string",
  "query": {},
  "request_headers": {},
  "request_body": "string|object",
  "response_shape": {},
  "response_sample": "string",
  "body_error": "string"
}
```

## Interpretation Guidance

- Treat `google-analytics`, `cdn-cgi/rum`, FullStory, and similar telemetry endpoints as instrumentation unless the user explicitly wants analytics analysis.
- Treat `_rsc=` and `text/x-component` responses as frontend framework transport, not normal business APIs.
- Favor endpoints under service prefixes like `/iam-server/api/`, `/walletd-server/api/`, `/biz-server/api/`, `/api-server/`, `/panel-server/api/`, and `/account-server/api/` when building backend interface inventories.
