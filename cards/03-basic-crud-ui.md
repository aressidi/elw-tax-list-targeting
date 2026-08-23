# Card 3: Basic CRUD UI - State/County Management

## Objective
Create the foundational UI components for browsing and managing states and counties.

## UI Components Required

### 1. Layout & Navigation
- App shell with sidebar navigation
- Navigation items:
  - Dashboard (placeholder)
  - States & Counties
  - Research Queue
  - Email Campaigns
  - Responses
  - Settings
- Header with app name and user info

### 2. States List View (`/states`)
- Card grid showing all 50 states
- Each state card displays:
  - State abbreviation (large)
  - State name
  - County count
  - Target priority indicator (if set)
- Click to view state detail
- Search/filter by name or abbreviation

### 3. State Detail View (`/states/:abbreviation`)
- Header: State name + abbreviation
- County table with columns:
  - County name
  - County seat
  - Target priority (badge: high/medium/low)
  - Contact count
  - Status summary (counts by request_status)
  - Actions: View, Edit
- "Add County" button
- Filter counties by target priority
- Search counties by name

### 4. County Detail View (`/counties/:id`)
- Header: County name, State
- Info cards:
  - County seat
  - Population (if available)
  - FIPS code
  - Target priority (editable dropdown)
- Contacts section:
  - List all tax officials for this county
  - Show primary contact with star icon
  - Each contact card: name, title, email, phone
  - "Add Contact" button
  - Star/unstar to set primary
- List Requests section:
  - History of FOIA requests for this county
  - Current status
  - Response summary
  - "New Request" button
- Notes field (editable)

### 5. Add County Form (`/counties/new`)
- State dropdown (required)
- County name input (required)
- County seat input (optional)
- Target priority dropdown (default: medium)
- Submit creates county and redirects to detail view

### 6. Add Contact Form (modal or page)
- County (pre-filled if from county detail)
- Full name (required)
- Title (Tax Collector, Treasurer, Assessor, etc.)
- Email address
- Phone number
- Office address
- Website URL
- "Set as primary" checkbox
- Submit creates contact

### 7. Edit County Form
- Same fields as Add County
- Pre-populated with existing data
- Save/ Cancel buttons

## Technical Requirements

### API Endpoints (Express)
- GET /api/states - List all states with county counts
- GET /api/states/:abbreviation - Get state with counties
- GET /api/counties - List counties (with filters)
- GET /api/counties/:id - Get county with contacts and requests
- POST /api/counties - Create new county
- PATCH /api/counties/:id - Update county
- DELETE /api/counties/:id - Delete county (with confirmation)
- POST /api/contacts - Create contact
- PATCH /api/contacts/:id - Update contact
- PATCH /api/contacts/:id/primary - Set as primary (unset others)
- DELETE /api/contacts/:id - Delete contact

### Frontend State Management
- Use React Query (TanStack Query) for server state
- Optimistic updates where appropriate
- Loading states and error handling

### UI/UX Details
- Use Tailwind CSS for styling (consistent with elw-mailing-list)
- Lucide icons for actions
- Toast notifications for success/error
- Confirmation dialogs for delete actions
- Responsive design (mobile-friendly)

## Verification
- Can view all 50 states
- Can click into state and see its counties
- Can add new county
- Can edit county details
- Can add contacts to county
- Can star/unstar primary contact
- Data persists after refresh

## Deliverables
1. All React components in `client/src/components/`
2. API routes in `server/routes/`
3. Database queries in `server/db/`
4. Working navigation between views
5. Form validation
6. Error handling

## Out of Scope (Future Cards)
- AI research integration (Card 4)
- Email sending (Card 7)
- Response tracking (Card 9)
- Dashboard/analytics (Card 14)
