# Card 16: Mailing List Module Integration

## Objective
Integrate with elw-mailing-list app for seamless data transfer.

## Requirements
- Export processed data to mailing list format
- API endpoint for data sharing
- Sync mailing list contacts
- Avoid duplicates

## Features
- One-click export to mailing list
- Field mapping between apps
- Import directly into mailing-list database
- Track which lists have been imported

## API
- POST /api/export/to-mailing-list - Export to ELW mailing list
- GET /api/export/status/:id - Check export status

## Data Mapping
- Map tax delinquent owners to mailing list contacts
- Include source (which county)
- Preserve property information
- Standardize address format

## UI
- "Export to Mailing List" button
- Select which records to export
- Preview before export
- Success confirmation
- View in mailing list app link

## Integration
- REST API between apps
- Shared database or API bridge
- Authentication between services

## Deliverables
- Export endpoint
- UI integration
- Data validation
- Duplicate prevention
