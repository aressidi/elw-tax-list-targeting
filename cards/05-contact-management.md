# Card 5: Contact Management & Primary Contact System

## Objective
Build a complete contact management system with starring/favoriting for primary contacts.

## UI Components

### 1. County Contacts Section (in County Detail)
- List all contacts for county
- Each contact card shows:
  - Star icon (filled = primary, outline = not primary)
  - Name (bold for primary)
  - Title
  - Email (click to copy)
  - Phone (click to call)
  - Website link
  - Research confidence badge
  - "Edit" and "Delete" buttons
- Sort: Primary first, then by name
- "Add Contact" button opens modal

### 2. Contact Card Actions
- **Star/Unstar**: Click star to toggle primary status
  - If starring: unstar all other contacts for this county
  - Show toast: "Set as primary contact"
- **Edit**: Opens edit modal
- **Delete**: Confirmation dialog, then remove

### 3. Add Contact Modal
- County (pre-filled)
- Full name (required)
- Title (dropdown + custom input)
- Email address
- Phone number
- Office address (optional)
- Website URL (optional)
- "Set as primary" checkbox
- "Research this contact" button (optional AI verify)

### 4. Edit Contact Modal
- Same fields as Add
- Show created_at and research_source
- "Verify with AI" button (re-research this specific contact)

### 5. Primary Contact Badge
- In county lists, show star icon next to county name
- In county detail, primary contact highlighted
- In research queue, show if primary exists

### 6. Contacts List View (`/contacts`)
- Global view of all contacts
- Search by name, email, county
- Filter by state
- Sort by county, name
- Quick actions: Email, View County

## API Endpoints

- GET /api/contacts - List all contacts (with filters)
- GET /api/counties/:id/contacts - Get county contacts
- POST /api/contacts - Create contact
- PATCH /api/contacts/:id - Update contact
- DELETE /api/contacts/:id - Delete contact
- POST /api/contacts/:id/primary - Set as primary
- POST /api/contacts/:id/verify - Verify with AI

## Database Schema

**tax_officials table (already created, ensure these fields):**
- id, county_id, full_name, title, phone_number, email_address, office_address, website_url, is_primary, research_source, verified_at, confidence_score, source_url, created_at

**Add constraint:**
- Only one is_primary = true per county
- On setting primary, automatically unset others

## Business Logic

### Setting Primary Contact
```typescript
async function setPrimaryContact(contactId: number) {
  const contact = await getContact(contactId);
  const countyId = contact.county_id;
  
  // Unset all other contacts in this county
  await db.update(tax_officials)
    .set({ is_primary: false })
    .where(eq(tax_officials.county_id, countyId));
  
  // Set this one as primary
  await db.update(tax_officials)
    .set({ is_primary: true })
    .where(eq(tax_officials.id, contactId));
}
```

### Contact Validation
- Email must be unique within county (warn if duplicate)
- At least one contact method required (email or phone)
- Name required

### AI Verification
- Optional re-research for existing contact
- Update confidence_score and source_url
- Track verification history

## UI/UX Details

- Star icon: Lucide `Star` (outline) vs `StarOff` (filled)
- Primary contact: highlighted with subtle background
- Email click: copy to clipboard with toast
- Phone click: format as tel: link
- Delete: require confirmation, warn if only contact

## Verification
- Can add multiple contacts to county
- Can star/unstar contacts
- Only one primary per county
- Primary persists after refresh
- Can edit contact details
- Can delete contacts
- Deleting last contact shows warning

## Deliverables
1. Contact list UI in county detail
2. Add/Edit contact modals
3. Primary contact logic
4. API endpoints
5. Contacts global view

## Integration Points
- Uses AI research from Card 4
- Feeds into List Requests (Card 6)
