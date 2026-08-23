# Card 9: Gmail Inbox Monitoring

## Objective
Monitor alex@eastonlandworks.com for replies and match to requests.

## Requirements
- Poll Gmail inbox periodically
- Search for replies to sent FOIA requests
- Match by thread ID / subject line
- Download attachments
- Classify responses automatically

## Features
- Automated inbox checking (cron job)
- Thread matching to list_requests
- Attachment detection and download
- Initial auto-classification using AI
- Flag unmatched responses for manual review

## API Endpoints
- POST /api/inbox/check - Trigger inbox check
- GET /api/inbox/unprocessed - List unprocessed replies

## UI
- Inbox monitor dashboard
- List of new responses
- One-click classification
- Unmatched responses view
