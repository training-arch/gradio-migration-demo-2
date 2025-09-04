# Contracts

This document describes the stable payloads and configuration shapes used by the engine, API, and UI.

## targets_config

Per-target configuration keyed by the target column name in the uploaded Excel.

Example

```
{
  "Enquiry": {
    "ai": false,
    "prompt": "",
    "wc": true,
    "wc_min": 3,
    "kw_flag": { "enabled": true, "mode": "ANY", "phrases": ["urgent", "help"] },
    "vf_on": false,
    "filters": {},
    "filter_mode": "AND",
    "tf_on": false,
    "text_filters": {}
  }
}
```

Schema (per target)

- ai: boolean. Enables the AI prompt rule when true.
- prompt: string. Template for AI rule. Supports `{Field_Name}`, `{Field_Value}`, and `{<Normalized_Column_Name>}` tokens.
- wc: boolean. Enables word count rule on the target column.
- wc_min: integer [1..20]. Minimum words required when `wc` is true.
- kw_flag: object. Keyword flag rule on the target column only.
  - enabled: boolean.
  - mode: "ANY" | "ALL". Matching mode across phrases.
  - phrases: string[]. Exact substring matches (case-insensitive).
- vf_on: boolean. Enables value filters on arbitrary columns.
- filters: object `{ columnName: string[] }`. Allowed values per column. Within a column, values are OR'ed; across columns, combined by `filter_mode`.
- filter_mode: "AND" | "OR". Combination across columns for value/text filters.
- tf_on: boolean. Enables text filters on arbitrary columns.
- text_filters: object `{ columnName: { mode: "ANY"|"ALL", phrases: string[], include: boolean } }`.

Notes

- Unknown fields are ignored by the engine.
- Missing fields default as in `backend_app/engine.ensure_target_defaults`.

## Engine outputs

- For each configured target column `T`, the engine adds a column `"T Mistakes"` with either `"[]"` (no issues) or a semicolon-joined string of messages.
- Message strings (non-AI):
  - `"NULL VALUE"` when word-count is enabled and the target cell is empty/whitespace.
  - `"Too short (<N words)"` when word-count is enabled and the target cell has fewer than `wc_min` words.
  - `"Keyword flag: <phrases>"` when keyword rule matches based on configuration (phrases joined by ", ").

The returned DataFrame contains only rows where at least one `"<Target> Mistakes"` column is not `"[]"`.

## API payloads

Uploads

- `POST /uploads` (multipart): field `file` (xlsx). Response:
  - `{ "upload_id": string, "filename": string }`

Jobs

- `POST /jobs` (json): `{ "upload_id": string, "targets_config": { ... } }`. Response:
  - `{ "job_id": string }`
- `GET /jobs/{id}`: Response:
  - `{ "status": "PENDING"|"RUNNING"|"SUCCEEDED"|"FAILED", "progress": number, "error": string|null }`
- `GET /jobs/{id}/download`: Success returns the result file (`.xlsx`).

## Status/progress rules

- `PENDING` on creation, `RUNNING` while processing, `SUCCEEDED` on success, `FAILED` on exceptions.
- `progress` is an integer 0..100. Implementations may update it per N rows.

## Error semantics (engine)

- Selecting a target column not present in the Excel raises: `"Selected target column not found in Excel: <col>"`.
- Invalid `wc_min` when `wc` is true raises: `"'<col>' word-count minimum must be between 1 and 20."`

