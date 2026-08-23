# Card 4: AI Contact Research Integration

## Objective
Create an AI-powered research queue and contact discovery system for finding tax collector information.

## UI Components

### 1. Research Queue View (`/research`)
- Table of counties needing contact research
- Columns:
  - State (abbreviation + name)
  - County name
  - Target priority (badge)
  - Current contact count
  - Research status (not_started, in_progress, completed, needs_review)
  - Actions: Research, Review, Skip
- Filters:
  - By state
  - By target priority
  - By research status
- Bulk actions: Research selected, Mark as skipped

### 2. Add County with AI Research (`/counties/new-with-research`)
- State dropdown (required)
- County name input (required)
- Target priority dropdown
- "Research Contacts" checkbox (default: true)
- Submit flow:
  1. Create county record
  2. If research enabled, trigger AI search
  3. Show AI results in review modal
  4. User approves/rejects each contact
  5. Save approved contacts

### 3. AI Research Results Modal
- Shows AI-discovered contacts (1-3 results typically)
- For each contact:
  - Name (editable)
  - Title (dropdown: Tax Collector, Treasurer, Assessor, County Clerk, etc.)
  - Email address (editable, with validation)
  - Phone number (editable)
  - Website URL (if found)
  - Confidence score (AI-provided)
  - Source snippet (AI excerpt)
  - Checkbox: Include this contact
  - Checkbox: Make primary contact
- "Research Again" button (if results unsatisfactory)
- "Add Manually" button (for entering custom contact)

## AI Research Logic

### Research Prompt
```
Find the tax collector or treasurer for [county_name] County, [state_name]. 
Provide their full name, official title, email address, phone number, and office website URL.
If there are multiple relevant officials (e.g., both Tax Collector and Treasurer), provide all of them.
Format as JSON with confidence scores.
```

### Response Parsing
- Use web_search or web_fetch tools to find official county websites
- Extract contact information from:
  - County official websites
  - State government directories
  - Official .gov domains (preferred)
- Parse and structure:
  - Full name
  - Title/role
  - Email (verify format)
  - Phone (standardize format)
  - Source URL

### Confidence Scoring
- High: From official .gov website
- Medium: From secondary sources, partial info
- Low: Unverified or incomplete
- Flag low-confidence for manual review

### Rate Limiting
- Space out AI research calls (avoid rapid-fire)
- Cache results to avoid duplicate research
- Queue system for bulk research

## API Endpoints

- GET /api/research-queue - Counties needing research
- POST /api/counties/:id/research - Trigger AI research
- GET /api/counties/:id/research-results - Get cached results
- POST /api/counties/:id/contacts/ai-import - Save AI contacts
- POST /api/research/bulk - Bulk research multiple counties

## Database Updates

**Add field to counties table:**
- research_status (varchar(50), default 'not_started')

**Add field to tax_officials table:**
- confidence_score (varchar(20)) -- high, medium, low
- source_url (varchar(500))

## Technical Requirements

### AI Integration
- Use web_search tool for finding contacts
- Parse official county websites
- Extract structured data
- Handle rate limits gracefully

### UI/UX
- Show loading state during AI research
- Display confidence indicators
- Allow editing before saving
- Confirmation before saving

### Validation
- Email format validation
- Phone number standardization
- Duplicate detection

## Verification
- Can trigger research for single county
- AI returns structured contact info
- Can review and approve contacts
- Can mark research as complete
- Research queue updates automatically

## Deliverables
1. Research queue UI
2. AI research integration
3. Contact review modal
4. API endpoints
5. Database schema updates

## Out of Scope
- Automated research (batch) - Card 5
- Advanced parsing - Card 12
