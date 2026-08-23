# Card 15: Budget Tracking & Reporting

## Objective
Track costs per list and generate spending reports.

## Requirements
- Track cost per list request
- Payment status tracking
- Total spent by state/county
- Spending reports
- Aging report for pending payments

## Cost Tracking
- Cost amount per list
- Payment status: not_required, requested, paid, fulfilled
- Budget alerts (optional)
- Cost by state breakdown

## Reports
- Total spending summary
- Cost by state
- Cost by county
- Pending payments
- Paid but not received
- Cost per response type

## UI
- Budget dashboard
- Cost entry form
- Payment status update
- Report generator
- Export to CSV/PDF

## API
- GET /api/reports/costs - Cost summary
- GET /api/reports/pending-payments - Aging report
- GET /api/reports/by-state - State breakdown

## Database
- Use existing: list_requests.cost_amount, payment_status
- Add payment_date, payment_method if needed
