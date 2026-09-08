# Import: County Treasurer Target List

Implements Workboard card [`02-import-existing-data`](../cards/02-import-existing-data.md):
imports the "County Treasurer Target List" source data into the `states` /
`counties` / `tax_officials` / `list_requests` tables, handling multiple
contacts per county, status/cost parsing, and data cleaning.

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
larger import happened.

A real CSV export must use this exact header row (column order mirrors
sheet columns A–L):

```
status,state,full_name,county,phone_number,email_address,county_alt,title,contact_status,list_status,notes,response
```

## Usage

```bash
# Dry run against the bundled sample fixture (no DB writes; always rolled back)
npm run import:data -- --source=csv --file=scripts/fixtures/county-treasurer-target-list.sample.csv --dry-run

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
  `{ describe(), fetchRows(): Promise<RawImportRow[]> }`. `CsvFileSource`
  and `GoogleSheetsSource` are the only two implementations; neither
  hard-codes a credential — both read from CLI flags/env vars.
- **Cleaning** (`scripts/lib/clean.ts`): trimming, state-abbreviation
  normalization (strips asterisks), county-suffix stripping ("County
  Treasurer"/"Treasurer"/"County"), phone normalization, email
  lowercasing + `N/A` → `null`, title default.
- **Row parsing** (`scripts/lib/parse-row.ts`): status column (A) and list
  status column (J) parsing, including the two cost formats ("$X flat" and
  "$X per page, N pages" → `X * N`), missing-name placeholder handling,
  and per-row warnings.
- **Import runner** (`scripts/lib/import-runner.ts`): groups rows by
  (state, county), upserts `states` (falling back to the schema's seed
  data if a state is missing rather than fabricating one), upserts
  `counties`, then per-row upserts `tax_officials` and `list_requests`.
  Multi-contact counties get one official per row; the first row with a
  non-null email is marked `is_primary` (falls back to the first row if
  none have email, per the card's stated options).
- **Idempotency**: no new unique constraint/migration was added — the
  runner does an app-level find-then-insert-or-update, matching officials
  by `(countyId, fullName)` (case-insensitive) and list requests by
  `taxOfficialId`. Re-running the same import updates rather than
  duplicates. This intentionally avoids a migration because the existing
  schema (`migrations/0000_white_next_avengers.sql`,
  `0001_seed_states_and_template.sql`) already provides everything needed
  — a migration would only be justified if concurrent/high-volume imports
  needed a DB-level uniqueness guarantee.
- **Dry run**: runs the entire import inside a DB transaction that is
  always rolled back, so counts reflect exactly what a live run would do
  (including "found vs. created" resolution) without persisting anything.
- **Verification**: `--verify` is a separate, read-only pass independent
  of any specific run — queries current DB state and diffs it against the
  card's stated expectations (8 states, ~20 counties, cost-parsed rows
  found).
- No email is sent, no migrations are applied, and no data is deleted by
  this script.

## Known limitation in this environment

This script could not be executed end-to-end here: there is no reachable
PostgreSQL instance and no network access in this sandbox (`pg_isready`,
`node`, and `npm run` invocations all require approval that wasn't
available in this session). The logic was verified by careful manual
trace-through of the bundled fixture against every rule in the card (see
commit message / PR description for the expected counts), and by review of
the Drizzle schema and query APIs already used elsewhere in this repo
(`server/routes.ts`). Before relying on this in production, run it for
real against a local Postgres instance:

```bash
createdb elw_tax_list_targeting
npm run db:migrate
npm run import:data -- --dry-run
npm run import:data -- --verify
```
