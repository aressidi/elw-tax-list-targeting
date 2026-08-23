# Card 10: Response Classification UI

## Objective
UI for reviewing and classifying email responses from tax collectors.

## Requirements
- View incoming replies
- One-click classification buttons
- Capture cost information if they charge
- Update list_requests with response data
- Track response_received_at

## Classification Options
- list_provided (with file attachment)
- requires_payment (capture amount)
- requires_form (link to form)
- not_available (with reason)
- needs_clarification
- declined

## UI
- Response inbox view
- Classification modal
- Cost capture form
- Notes field
- Quick actions toolbar

## API
- PATCH /api/list-requests/:id/classify - Update status
- POST /api/responses/:id/process - Mark as processed
