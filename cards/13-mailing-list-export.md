# Card 13: Mailing List Export

## Objective
Export parsed data to mailing list format.

## Requirements
- Export validated data to CSV
- Standardized field format
- Mark list_request as data_processed
- Integration with mailing-list module
- Track export history

## Features
- Generate standardized CSV
- Field standardization
- Deduplicate against existing contacts
- Export preview before download
- Mark as processed in database

## Export Fields
- First name, Last name
- Mailing address (street, city, state, zip)
- Property APN
- County, State
- Source (which county list)

## UI
- Export button in processed list view
- Preview export data
- Download CSV
- Mark as complete
- View export history

## API
- POST /api/processed-lists/:id/export - Generate export
- GET /api/processed-lists/:id/download - Download CSV

## Integration
- Export to elw-mailing-list format
- Compatible with existing mailing list imports
