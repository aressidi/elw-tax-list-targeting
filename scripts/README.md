# Import: County Treasurer Target List

Implements Workboard card [`02-import-existing-data`](../cards/02-import-existing-data.md)
and [`02B-desktop-csv-import`](../cards/02-import-existing-data.md): imports
the "County Treasurer Target List" source data into the `states` /
`counties` / `tax_officials` / `list_requests` tables (plus
`list_request_prices`, `list_request_events`, and
`list_request_status_history` — see card 02A), handling multiple contacts
per county, status/cost/pricing parsing, activity history, and data
cleaning.

## External prerequisite: Google Sheets credentials

The card's source is a live Google Sheet (ID
`14yKwNOT81CbIlJ80j__wayKUMEySF0LL6tgKZBwV8PY`, tab `Alex Tax Assessors`).
**This environment has no Google credentials and no network access to
Google's API**, so a live import from the sheet could not be performed or
tested here. The importer supports it (`scripts/lib/sources.ts` →
`GoogleSheetsSource`, plain `fetch` against the Sheets REST API — no
`googleapis` dependency needed), but it requires one of these env vars to be
set by whoever runs it with real access:

- `GOOGLE_SHEETS_ACCESS_TOKEN` — an OAuth2 access token for an account with
  read access to the sheet (scope
  `https://www.googleapis.com/auth/spreadsheets.readonly`), e.g. from
  `gcloud auth print-access-token`.
- `GOOGLE_SHEETS_API_KEY` — a Google Cloud API key. Only works if the sheet
  is shared "Anyone with the link can view".

Without one of these, `--source=google-sheets` fails fast with an explicit
error explaining what's missing — it does **not** silently fall back to
fake data.

## Safe offline path: CSV

Until Google Sheets access is available, use `--source=csv` (the default)
with a real export of the sheet (File → Download → CSV), or the bundled
**synthetic sample fixture** at
[`fixtures/county-treasurer-target-list.sample.csv`](fixtures/county-treasurer-target-list.sample.csv).

That fixture is fabricated test data, not the real spreadsheet — it exists
to exercise every mapping rule and edge case in the card (multi-contact
county, `M`/`m`/"Needs data extraction"/empty status, asterisked state
abbreviations, "County Treasurer" suffix cleanup, `N/A` email, missing
name, both cost formats, all four List Status phrases). It covers all 8
target states but only 8 counties (one per state), not the ~20 in the real
sheet — the verification report will say so explicitly rather than imply a
larger import happened. This is the **legacy** column contract (exact
header row, column order mirrors sheet columns A–L):

```
status,state,full_name,county,phone_number,email_address,county_alt,title,contact_status,list_status,notes,response
```

### Human-readable CSV export (card 02B)

The real desktop CSV export ("County Treasurer Target List - Alex Tax
Assessors.csv") has a different, human-readable header. `CsvFileSource`
detects and maps it by **header name**, not fixed column position, so any
column order/extra blank trailing columns from the spreadsheet export are
fine — no manual normalized copy is needed:

```
State,Full Name,County Treasurer Website,Phone Number,Email Address,County,Title,Contact Status,List Status,Cost,Cost Type,Notes,Response
```

Notes on this format:
- `County Treasurer Website` is usually an office label (e.g. "Pennington
  County Treasurer") or a bare county/town name, not a URL — it's only used
  as a fallback for county-name cleaning when `County` is blank.
- `Email Address` sometimes contains a web-form URL instead of an email
  (e.g. `https://forms.mohave.gov/...`); those are routed to
  `tax_officials.website_url` instead of `email_address`.
- `List Status` is a clean label (`List Provided!`, `Requires Payment`,
  `Requires Written Request`, `Do not Provide`, `Do not have data`,
  `Providing`), mapped to `request_status`; the raw label is preserved in
  `list_requests.raw_list_status`/`source_label`.
- `Cost`/`Cost Type` (`List`→flat, `Page`→per-page, `Listing`→per-listing)
  produce one `list_request_prices` row per priced request; when no
  quantity is given (the common case here), the basis is preserved but
  `quantity`/`total_amount` are left null rather than guessed.
- Any non-empty data in an unnamed trailing column (stray spreadsheet
  export columns) is reported as a warning with the row number and
  ignored — it is never guessed into a typed field.
- `Contact Status`, `Notes`, and `Response` each produce one
  `list_request_events` row (in addition to the existing
  `list_requests.notes`/`full_response_text` snapshot fields, kept for
  compatibility). A small fixture exercising this format's edge cases
  (per-unit costs, URL-in-email, blank name/county with office-label
  fallback, unnamed trailing data) lives at
  [`fixtures/county-treasurer-target-list.human-sample.csv`](fixtures/county-treasurer-target-list.human-sample.csv).

## Usage

```bash
# Dry run against the bundled legacy-format sample fixture (no DB writes; always rolled back)
npm run import:data -- --source=csv --file=scripts/fixtures/county-treasurer-target-list.sample.csv --dry-run

# Dry run against the bundled human-CSV-format sample fixture
npm run import:data -- --source=csv --file=scripts/fixtures/county-treasurer-target-list.human-sample.csv --dry-run

# Dry run against a real desktop CSV export (human header, detected automatically)
npm run import:data -- --source=csv --file="./County Treasurer Target List - Alex Tax Assessors.csv" --dry-run

# Live import from a real export
npm run import:data -- --source=csv --file=./real-export.csv

# Live import from the Google Sheet (once GOOGLE_SHEETS_ACCESS_TOKEN or
# GOOGLE_SHEETS_API_KEY is set)
npm run import:data -- --source=google-sheets

# Verification only — reports current DB counts against the card's
# expectations (8 states, ~20 counties, cost-parsed rows, etc.), no writes
npm run import:data -- --verify

# Full option list
npm run import:data -- --help
```

## Design

- **Source adapter contract** (`scripts/lib/sources.ts`): `ImportSource` is
  `{ describe(), fetchRows(): Promise<RawImportRow[]> }`. `RawImportRow` has
  a `format: 'legacy' | 'human'` discriminant so downstream parsing can
  branch cleanly. `CsvFileSource` detects legacy vs. human header shape and
  maps human-format columns **by header name** (order-independent, extra
  columns tolerated); `GoogleSheetsSource` still reads the legacy positional
  layout (the live sheet's current shape). Neither adapter hard-codes a
  credential — both read from CLI flags/env vars.
- **Cleaning** (`scripts/lib/clean.ts`): trimming, state-abbreviation
  normalization (strips asterisks), county-suffix stripping ("County
  Treasurer"/"Treasurer"/"County"), phone normalization, email
  lowercasing + `N/A` → `null`, `parseEmailOrUrl` splitting a web-form URL
  out of the email cell into a separate website URL, title default.
- **Row parsing** (`scripts/lib/parse-row.ts`): branches on `format`.
  Legacy: status column (A) + free-text list-status column (J), including
  the two cost formats ("$X flat" and "$X per page, N pages" → `X * N`).
  Human: `List Status` label lookup (`List Provided!`, `Requires Payment`,
  `Requires Written Request`, `Do not Provide`, `Do not have data`,
  `Providing`) and `Cost`/`Cost Type` parsing into a basis-preserving
  `ParsedPrice` (flat/per-page/per-listing; quantity/total left null when
  not given). Both formats share missing-name placeholder handling,
  per-row warnings, and per-field event extraction (Contact Status/Notes/
  Response).
- **Import runner** (`scripts/lib/import-runner.ts`): groups rows by
  (state, county), upserts `states` (falling back to the schema's seed
  data if a state is missing rather than fabricating one), upserts
  `counties`, then per-row upserts `tax_officials` and `list_requests`, and
  additionally: one `list_request_prices` row when a price was parsed, one
  `list_request_status_history` row when the raw status label changes,
  and up to three `list_request_events` rows (Contact Status/Notes/
  Response). Multi-contact counties get one official per row; the first
  row with a non-null email is marked `is_primary` (falls back to the
  first row if none have email, per the card's stated options). A
  non-null `website_url` parsed from the email cell is added to the
  official's upsert values but never overwrites an existing one with null.
- **Idempotency**: no new unique constraint/migration was added — all
  upserts are app-level find-then-insert-or-update queries run inside the
  same transaction as the rest of the row:
  - officials by `(countyId, fullName)` (case-insensitive), list requests
    by `taxOfficialId` (unchanged from card 02);
  - prices by exact `rawText` match on existing rows for that list request;
  - status history by exact `(toStatus, sourceLabel)` match;
  - events by `(sourceRow, field)` stashed in the `metadata` jsonb column
    (there's no natural unique business key for free-text notes).
  Verified directly in this session: running the same parsed rows twice
  through `runImportBody` inside one transaction produced 0 additional
  prices/events/status-history rows and 0 additional officials/list
  requests (all correctly resolved as "already exists") on the second
  pass. This intentionally avoids a migration because the existing schema
  already provides everything needed — a migration would only be
  justified if concurrent/high-volume imports needed a DB-level
  uniqueness guarantee.
- **Dry run**: runs the entire import inside a DB transaction that is
  always rolled back, so counts reflect exactly what a live run would do
  (including "found vs. created" resolution) without persisting anything.
- **Verification**: `--verify` is a separate, read-only pass independent
  of any specific run — queries current DB state and diffs it against the
  card's stated expectations (8 states, ~20 counties, cost-parsed rows
  found).
- No email is sent, no migrations are applied, and no data is deleted by
  this script.

## Verification performed for card 02B

`npm run typecheck`, `npm run typecheck:scripts`, and `npm run build` all
pass. `npm run import:data -- --source=csv --file=<real desktop export>
--dry-run` was run against the actual 43-row desktop CSV export (not
committed to this repo) inside this session's local dev database and
correctly: mapped all 13 named columns by header, parsed all pricing
examples (`$75`/List, `$1`/Page, `$0.50`/Listing, `$106.60`/List, etc.),
split 3 web-form URLs out of the email column into `website_url`, flagged
the one row with non-empty data in unnamed trailing columns as a warning
(and did not import it), and flagged county-name/office-label mismatches
and missing-name placeholders as warnings. The transaction was rolled back
as designed — no data was persisted. Live execution of the real import is
intentionally left for a follow-up run outside this session.
