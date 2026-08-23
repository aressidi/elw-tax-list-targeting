# Card 8: Email Throttle & Scheduler

## Objective
Implement "break-up feature" to throttle emails at 20-50/day.

## Requirements
- Queue system for pending emails
- Daily send limit (configurable: 20-50/day)
- Schedule emails for specific times
- Pause/resume campaign
- Queue status dashboard

## Features
- "Send Queue" view showing pending emails
- Daily counter (sent today / limit)
- Bulk add to queue
- Manual send vs scheduled send
- Queue with auto-send at optimal times

## Database
- Add to list_requests: queued_at, scheduled_send_at
- Queue processing job

## UI
- Queue management dashboard
- Settings for daily limit
- Schedule picker
- Pause/resume controls
- Queue statistics
