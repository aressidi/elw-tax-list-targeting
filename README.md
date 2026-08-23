# ELW Tax List Targeting

A React + Express + PostgreSQL + Drizzle application for managing FOIA requests to obtain tax delinquent property lists from county tax officials.

## Features

- 📍 **State & County Management** - Track all 50 US states and their counties
- 👥 **Tax Official Directory** - Store contact info for tax collectors, assessors, and treasurers
- 📧 **FOIA Request Tracking** - Monitor the status of list requests from initial contact to receipt
- 📨 **Email Integration** - Track sent/received emails with Gmail API integration (planned)
- 📊 **Dashboard Analytics** - Visual overview of request progress and statistics
- 📝 **Template Management** - Customizable FOIA request templates with variable substitution

## Tech Stack

- **Frontend**: React 19, TanStack Query, Wouter, Tailwind CSS 4, Lucide Icons
- **Backend**: Express 5, TypeScript
- **Database**: PostgreSQL, Drizzle ORM
- **Build**: Vite, TSX

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- Git

### Installation

1. Clone the repository:
```bash
git clone https://github.com/aressidi/elw-tax-list-targeting.git
cd elw-tax-list-targeting
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your database credentials
```

4. Create the database:
```bash
createdb elw_tax_list_targeting
```

5. Run migrations:
```bash
npm run db:migrate
```

6. Start the development server:
```bash
npm run dev
```

The app will be available at:
- Frontend: http://localhost:5173
- API: http://localhost:3000

## Database Schema

### Tables

- **states** - US states with FIPS codes
- **counties** - Counties linked to states
- **tax_officials** - Contact information for tax officials
- **foia_templates** - Email templates for requests
- **list_requests** - Track FOIA request status
- **email_tracking** - Monitor email communications
- **processed_lists** - Store received list data

### Running Migrations

```bash
# Generate migrations from schema changes
npm run db:generate

# Apply migrations to database
npm run db:migrate

# Open Drizzle Studio (database GUI)
npm run db:studio
```

## API Endpoints

### States
- `GET /api/states` - List all states
- `GET /api/states/:id` - Get state with counties

### Counties
- `GET /api/counties` - List counties (with filters)
- `GET /api/counties/:id` - Get county with officials

### Tax Officials
- `GET /api/tax-officials` - List officials
- `POST /api/tax-officials` - Create official

### List Requests
- `GET /api/list-requests` - List requests
- `GET /api/list-requests/:id` - Get request details
- `POST /api/list-requests` - Create request
- `PATCH /api/list-requests/:id` - Update request

### FOIA Templates
- `GET /api/foia-templates` - List templates
- `GET /api/foia-templates/default` - Get default template
- `POST /api/foia-templates` - Create template

### Dashboard
- `GET /api/dashboard/stats` - Get overview statistics

## Project Structure

```
elw-tax-list-targeting/
├── client/           # React frontend
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── index.html
├── server/           # Express backend
│   ├── index.ts
│   ├── routes.ts
│   └── db.ts
├── shared/           # Shared types and schema
│   └── schema.ts
├── migrations/       # Drizzle migrations
├── cards/           # Project cards/specs
└── package.json
```

## Development

### Scripts

- `npm run dev` - Start dev servers (both client and server)
- `npm run dev:client` - Start client only
- `npm run dev:server` - Start server only
- `npm run build` - Build for production
- `npm run typecheck` - Run TypeScript checks
- `npm run db:generate` - Generate migrations
- `npm run db:migrate` - Run migrations
- `npm run db:studio` - Open Drizzle Studio

## License

ISC
