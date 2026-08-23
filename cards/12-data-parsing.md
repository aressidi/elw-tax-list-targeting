# Card 12: Data Parsing & Validation

## Objective
Parse uploaded files (CSV/PDF/Excel) and validate data.

## Requirements
- CSV parser with auto-delimiter detection
- PDF text extraction
- Excel parser (.xlsx, .xls)
- Field mapping UI (for non-standard formats)
- Validate required fields

## Features
- Auto-detect file type
- Parse and preview data
- Field mapping tool
- Deduplicate records
- Validation errors report

## Standard Fields
- Owner name
- Property address
- Mailing address
- APN/Parcel number
- Tax amount owed
- Property description

## UI
- Field mapping interface
- Data preview table
- Validation report
- Fix errors inline
- Approve for export

## API
- POST /api/files/:id/parse - Parse file
- POST /api/files/:id/map-fields - Save field mapping
- GET /api/files/:id/preview - Get parsed preview
