# Card 11: File Upload & Storage

## Objective
Handle uploaded CSV/PDF/Excel files from tax collector responses.

## Requirements
- Upload interface for received files
- Secure storage with metadata
- File preview before processing
- Map file to list_request
- Support drag-and-drop

## Features
- File upload component
- Progress indicator
- File type validation
- Preview raw content
- Download original file

## Database
- Store file path/URL in processed_lists
- Track original_filename, file_type

## UI
- Upload area with drag-drop
- File list for request
- Preview panel
- Download button
- Delete confirmation
