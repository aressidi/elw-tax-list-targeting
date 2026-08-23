# Card 14: Dashboard & Pipeline View

## Objective
Create kanban board dashboard showing county pipeline status.

## Requirements
- Kanban board with columns for each status
- Drag-and-drop between columns
- Count cards per stage
- Filter by state, priority, date
- Quick action buttons

## Pipeline Stages
1. Not Started
2. Researching (needs contact)
3. Ready to Email
4. Email Sent
5. Awaiting Response
6. Response Received
7. List Provided
8. Data Processed

## Features
- Kanban view (default)
- List view toggle
- Bulk actions (move status, assign)
- Color-coded by priority
- Aging indicators

## UI
- Kanban columns
- Draggable cards
- Card shows: county, state, primary contact, status
- Click card for detail view
- Filters sidebar

## API
- GET /api/dashboard/pipeline - Get counts by status
- PATCH /api/list-requests/:id/status - Update status
- POST /api/list-requests/bulk-update - Bulk status update

## Widgets
- Total counties
- Response rate
- Average response time
- Cost summary
