# Card 7: Email Sending with Gmail Integration

## Objective
Send FOIA request emails via alex@eastonlandworks.com and track message IDs.

## Requirements
- Send via `gog gmail send` CLI
- Use FOIA templates with variable substitution
- Track Gmail message IDs in database
- Update list_requests status on send
- Error handling for bounces/failures

## Key Features
- Send to primary contact for county
- Subject and body from selected template
- Log sent emails in email_tracking table
- Update list_requests.email_sent_at
- Change status to 'email_sent'

## API Endpoints
- POST /api/list-requests/:id/send-email - Send email for request
- POST /api/list-requests/bulk-send - Send multiple emails

## UI
- Send button in List Request detail
- Preview before sending
- Confirmation dialog
- Error toast if sending fails
