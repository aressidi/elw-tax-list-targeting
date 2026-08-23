# Card 1: Project Bootstrap & Database Schema

## Objective
Create the elw-tax-list-targeting repository with complete database schema and project structure.

## Requirements

### Project Structure
- Create `~/Projects/elw-tax-list-targeting/` directory
- Set up same stack as elw-mailing-list: React + Express + PostgreSQL + Drizzle
- Copy/adapt configuration files (tsconfig, vite.config, package.json structure)
- Create GitHub repo: `aressidi/elw-tax-list-targeting`

### Database Schema (PostgreSQL with Drizzle)

**states table:**
- id (serial, PK)
- abbreviation (varchar(2), unique, not null)
- name (varchar(100), not null)
- fips_code (varchar(2))
- priority (integer, default 0)
- notes (text)
- created_at (timestamp, default now())

**counties table:**
- id (serial, PK)
- state_id (integer, FK to states)
- name (varchar(100), not null)
- county_seat (varchar(100))
- fips_code (varchar(5))
- population (integer)
- target_priority (varchar(20), default 'medium') -- high/medium/low
- created_at (timestamp, default now())

**tax_officials table:**
- id (serial, PK)
- county_id (integer, FK to counties)
- full_name (varchar(100), not null)
- title (varchar(100)) -- Tax Collector, Treasurer, Assessor, etc.
- phone_number (varchar(50))
- email_address (varchar(200))
- office_address (text)
- website_url (varchar(500))
- is_primary (boolean, default false)
- research_source (varchar(50)) -- AI search, website, phone call, manual
- verified_at (timestamp)
- created_at (timestamp, default now())

**list_requests table:**
- id (serial, PK)
- tax_official_id (integer, FK to tax_officials)
- request_status (varchar(50), default 'not_started')
  -- enum: not_started, research_needed, ready_to_email, email_sent, awaiting_response, response_received, list_provided, requires_payment, requires_form, not_available, declined
- list_type (varchar(50), default 'unknown')
  -- enum: free, paid, not_available, unknown
- cost_amount (decimal(10,2))
- cost_currency (varchar(3), default 'USD')
- cost_notes (text)
- payment_status (varchar(50))
  -- enum: not_required, requested, paid, fulfilled
- foia_template_id (integer, FK to foia_templates)
- email_sent_at (timestamp)
- response_received_at (timestamp)
- response_summary (text)
- full_response_text (text)
- list_file_received (boolean, default false)
- file_location (varchar(500))
- data_processed (boolean, default false)
- tax_year_available (varchar(50))
- update_frequency (varchar(100))
- next_update_date (date)
- notes (text)
- assigned_to (varchar(100))
- created_at (timestamp, default now())
- updated_at (timestamp, default now())

**foia_templates table:**
- id (serial, PK)
- name (varchar(100), not null)
- subject_line (varchar(500), not null)
- body_text (text, not null)
- is_default (boolean, default false)
- created_at (timestamp, default now())

**email_tracking table:**
- id (serial, PK)
- list_request_id (integer, FK to list_requests)
- email_type (varchar(50)) -- sent, received, follow_up
- gmail_message_id (varchar(100))
- sent_at (timestamp)
- received_at (timestamp)
- subject (varchar(500))
- body_preview (text)
- attachments_count (integer, default 0)
- processed (boolean, default false)
- created_at (timestamp, default now())

**processed_lists table:**
- id (serial, PK)
- list_request_id (integer, FK to list_requests)
- original_filename (varchar(255))
- file_type (varchar(20)) -- csv, pdf, excel
- raw_data_stored (boolean, default false)
- record_count (integer)
- mailing_list_created (boolean, default false)
- mailing_list_export_path (varchar(500))
- processed_at (timestamp)
- notes (text)

### Seed Data
- Create migration to insert all 50 US states with abbreviations and FIPS codes
- Include default FOIA template:
  - Name: "Standard FOIA Request"
  - Subject: "FOIA Request - Tax Delinquent Property List - {{county_name}} County"
  - Body: Professional template with variables for county, state, official name

### Configuration Files
- drizzle.config.ts
- tsconfig.json (server and client)
- vite.config.ts
- package.json with scripts (dev, build, db:migrate, etc.)
- .env.example with all required variables

### Deliverables
1. GitHub repo initialized with README
2. Database schema files in `shared/schema.ts`
3. Migration files in `migrations/`
4. Seed data migration for 50 states
5. Default FOIA template migration
6. Working dev environment (npm install succeeds)

## Verification
- Run `npm run db:generate` successfully
- Run `npm run typecheck` with no errors
- Database connects locally
