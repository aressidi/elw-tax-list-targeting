# Card 6: FOIA Template System

## Objective
Create a template system for FOIA request emails with variable substitution.

## Database Schema

**foia_templates table:**
- id (serial, PK)
- name (varchar(100), not null)
- subject_line (varchar(500), not null)
- body_text (text, not null)
- is_default (boolean, default false)
- created_at (timestamp, default now())

## Template Variables

### Available Variables
- `{{county_name}}` - County name
- `{{state_name}}` - Full state name
- `{{state_abbr}}` - State abbreviation
- `{{official_name}}` - Contact full name
- `{{official_title}}` - Contact title
- `{{current_date}}` - Today's date (formatted)
- `{{custom_note}}` - Optional custom text

## UI Components

### 1. Templates List (`/templates`)
- Card grid of all templates
- Each card shows:
  - Template name
  - "Default" badge (if is_default)
  - Subject line preview
  - "Edit", "Duplicate", "Delete" buttons
- "Create New Template" button

### 2. Template Editor (`/templates/:id/edit` or `/templates/new`)
- Form fields:
  - Template name (required)
  - Subject line (required) with variable helper
  - Body text (textarea) with variable helper
  - "Set as default" checkbox
- Variable helper panel:
  - Clickable variable buttons
  - Inserts at cursor position
  - Shows description of each variable
- Live preview panel:
  - Shows email with variables substituted
  - Sample data dropdown (pick a county to preview)
  - Toggle between raw and preview modes

### 3. Variable Helper UI
- Sidebar or popover with:
  - `{{county_name}}` - County name
  - `{{state_name}}` - Full state name
  - `{{state_abbr}}` - State abbreviation
  - `{{official_name}}` - Contact name
  - `{{official_title}}` - Contact title
  - `{{current_date}}` - Today's date
  - `{{custom_note}}` - Custom note
- Click variable to insert at cursor

### 4. Preview Panel
- Shows rendered email with real data
- Dropdown to select sample county/contact
- Shows both subject and body
- Highlight substituted variables in different color

## Default Template

**Name:** Standard FOIA Request
**Subject:** FOIA Request - Tax Delinquent Property List - {{county_name}} County
**Body:**
```
Dear {{official_name}},

I am writing to request a list of tax delinquent properties in {{county_name}} County, {{state_name}} under the Freedom of Information Act (FOIA).

Specifically, I am requesting:
- A current list of properties with delinquent taxes
- Property owner names and mailing addresses
- Amount of taxes owed (if available)
- Property identification information (APN, parcel number, etc.)

Please provide this information in electronic format (CSV, Excel, or PDF) if available.

If there are any fees associated with this request, please inform me before processing.

Thank you for your assistance.

Sincerely,
[User will add signature manually]
```

## API Endpoints

- GET /api/templates - List all templates
- GET /api/templates/:id - Get template
- POST /api/templates - Create template
- PATCH /api/templates/:id - Update template
- DELETE /api/templates/:id - Delete template
- POST /api/templates/:id/set-default - Set as default
- POST /api/templates/:id/preview - Preview with sample data

## Template Validation

- Required: name, subject_line, body_text
- Subject max: 500 chars
- Body max: 10,000 chars
- Check for valid variable names (warn on unknown variables)
- Require at least one variable (to personalize)

## Preview Logic

```typescript
function renderTemplate(template: Template, data: SampleData): string {
  return template.body_text
    .replace(/{{county_name}}/g, data.county.name)
    .replace(/{{state_name}}/g, data.state.name)
    .replace(/{{state_abbr}}/g, data.state.abbreviation)
    .replace(/{{official_name}}/g, data.contact?.name || '[Contact Name]')
    .replace(/{{official_title}}/g, data.contact?.title || '[Title]')
    .replace(/{{current_date}}/g, new Date().toLocaleDateString())
    .replace(/{{custom_note}}/g, data.customNote || '');
}
```

## UI/UX Details

- Textarea with monospace font for template editing
- Variable buttons styled as badges
- Preview shows realistic example
- Warn if template has no variables
- Can't delete default template (must set new default first)

## Verification
- Can create new template
- Can edit existing template
- Variables substitute correctly in preview
- Can set default template
- Can delete non-default templates
- Validation prevents empty templates

## Deliverables
1. Templates list view
2. Template editor with variable helpers
3. Live preview functionality
4. API endpoints
5. Default template seeded

## Integration Points
- Used by Email Campaign (Card 7)
- Referenced by List Requests table
