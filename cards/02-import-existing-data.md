# Card 2: Import Existing Spreadsheet Data

## Objective
Import the "County Treasurer Target List" Google Sheet data into the database, validating the schema and handling multi-contact scenarios.

## Source Data
- Google Sheet: "County Treasurer Target List"
- Sheet ID: 14yKwNOT81CbIlJ80j__wayKUMEySF0LL6tgKZBwV8PY
- Tab: "Alex Tax Assessors"
- ~20 counties across 8 states (SD, WY, ID, NM, AR, SC, NC, VT)

## Data Mapping

### Spreadsheet Columns → Database Fields

**Status** (Column A)
- "M" or "m" → request_status = 'email_sent'
- "Needs data extraction" → request_status = 'list_provided' AND data_processed = false
- Empty → request_status = 'not_started'

**State** (Column B)
- Map to states table by abbreviation
- Clean up asterisks (e.g., "SD *" → "SD")

**Full Name** (Column C)
- tax_officials.full_name
- May contain empty values

**County** (Column D/G - appears twice)
- counties.name
- Clean up suffixes ("Pennington County Treasurer" → "Pennington")

**Phone Number** (Column E)
- tax_officials.phone_number

**Email Address** (Column F)
- tax_officials.email_address
- "N/A" → null

**Title** (Column H)
- tax_officials.title
- Default to "Tax Collector" if empty

**Contact Status** (Column I)
- Map to list_requests.notes or response tracking
- Values: "Filled out form", "Emailed, called", "Called", "Emailed"

**List Status** (Column J)
- Parse for request_status and cost tracking:
  - "Not providing" → request_status = 'not_available'
  - "Going to provide" → request_status = 'awaiting_response'
  - "$75 flat for list" → list_type = 'paid', cost_amount = 75, cost_notes
  - "$1 per page, 269 pages" → list_type = 'paid', cost_amount = 269, cost_notes
  - "Provided!" → request_status = 'list_provided'
  - "Pending written request" → request_status = 'requires_form'

**Notes** (Column K)
- list_requests.notes

**Response** (Column L)
- list_requests.full_response_text
- Parse for additional status info

## Import Logic

### Multi-Contact Handling
- If a county appears multiple times (check by county name + state):
  - Create separate tax_officials records
  - Mark first one as is_primary = true
  - Or use first one with email as primary

### State/County Creation
1. For each unique state abbreviation:
   - Find or create state record
   - Use existing state ID from seed data

2. For each unique county:
   - Find or create county record
   - Link to state_id

3. For each row:
   - Create tax_officials record
   - Create list_requests record
   - Link them together

### Data Cleaning
- Trim whitespace from all text fields
- Normalize phone numbers (strip non-numeric, keep format)
- Lowercase email addresses
- Parse cost amounts from text fields
- Handle empty/null values gracefully

## Script Requirements
Create a one-time import script:
- `scripts/import-existing-data.ts`
- Read from Google Sheets API (gog)
- Insert into database with Drizzle
- Log progress and any errors
- Generate report: imported counties, contacts, skipped rows

## Verification
- Count imported: should match ~20 counties
- Count states: should be 8 (SD, WY, ID, NM, AR, SC, NC, VT)
- Count contacts: should match row count
- Verify multi-contact counties have multiple officials
- Check cost parsing: should find $75 and $269 amounts

## Edge Cases to Handle
- Duplicate county names (verify state match)
- Empty email addresses (still create contact)
- "N/A" in email field (treat as null)
- Inconsistent county naming ("County Treasurer" suffix)
- Asterisks in state abbreviations
- Missing official names (use placeholder or skip)

## Deliverables
1. Import script at `scripts/import-existing-data.ts`
2. Data cleaning utilities
3. Import execution log
4. Verification report showing counts
