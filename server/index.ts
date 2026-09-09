import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import routes from './routes.js';
import { db } from './db.js';
import { foiaTemplates } from '../shared/schema.js';
import { startQueueProcessor } from './services/queueService.js';
import { startInboxPoller } from './services/inboxService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_TEMPLATE_NAME = 'Standard FOIA Request';
const DEFAULT_TEMPLATE_SUBJECT = 'FOIA Request - Tax Delinquent Property List - {{county_name}} County';
const DEFAULT_TEMPLATE_BODY = `{{current_date}}

Dear {{official_title}} {{official_name}},

I am writing to request access to public records under the {{state_name}} ({{state_abbr}}) Freedom of Information Act (or applicable public records law).

Specifically, I am requesting a list of tax delinquent properties in {{county_name}} County, {{state_name}}. I am interested in obtaining the following information for each property:

• Parcel/Property ID number (APN)
• Property address or legal description
• Owner name(s)
• Mailing address of record
• Amount of taxes owed
• Tax year(s) delinquent

Format: If available, I would prefer the data in electronic format (CSV, Excel, or PDF).

Purpose: This information will be used for research purposes related to real estate investment and community development.

{{custom_note}}

Please let me know:
1. If this information is available
2. The format(s) in which it can be provided
3. Any associated costs for reproduction
4. The estimated timeframe for fulfillment

If there are any fees associated with this request, please inform me before processing. I am willing to pay reasonable reproduction costs.

Thank you for your assistance with this public records request. I look forward to your response within the timeframe required by law.

Sincerely,
[User will add signature manually]`;

// Ensures exactly one default FOIA template exists. A no-op once any
// template is already marked default (via the migration seed or user
// action), so restarting the server never clobbers edited content.
async function ensureDefaultTemplate() {
  const existingDefault = await db.query.foiaTemplates.findFirst({ where: eq(foiaTemplates.isDefault, true) });
  if (existingDefault) return;

  const existingByName = await db.query.foiaTemplates.findFirst({
    where: eq(foiaTemplates.name, DEFAULT_TEMPLATE_NAME),
  });
  if (existingByName) {
    await db.update(foiaTemplates).set({ isDefault: true }).where(eq(foiaTemplates.id, existingByName.id));
    return;
  }

  await db
    .insert(foiaTemplates)
    .values({
      name: DEFAULT_TEMPLATE_NAME,
      subjectLine: DEFAULT_TEMPLATE_SUBJECT,
      bodyText: DEFAULT_TEMPLATE_BODY,
      isDefault: true,
    })
    .onConflictDoNothing();
}

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount API routes
app.use('/api', routes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    message: 'The requested API endpoint does not exist',
  });
});

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
});

ensureDefaultTemplate().catch((error) => {
  console.error('Failed to ensure default FOIA template:', error);
});

startQueueProcessor().catch((error) => {
  console.error('Failed to start email queue processor:', error);
});

startInboxPoller();

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api`);
  console.log(`💚 Health check: http://localhost:${PORT}/api/health`);
});

export default app;
