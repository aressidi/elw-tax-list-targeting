import { pgTable, serial, varchar, text, integer, decimal, timestamp, boolean, jsonb, pgEnum, index, uniqueIndex, foreignKey, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

// ====================
// Enums
// ====================

export const targetPriorityEnum = pgEnum('target_priority', ['high', 'medium', 'low']);

export const requestStatusEnum = pgEnum('request_status', [
  'not_started',
  'research_needed',
  'ready_to_email',
  'email_sent',
  'awaiting_response',
  'response_received',
  'list_provided',
  'requires_payment',
  'requires_form',
  'not_available',
  'declined'
]);

export const listTypeEnum = pgEnum('list_type', ['free', 'paid', 'not_available', 'unknown']);

export const paymentStatusEnum = pgEnum('payment_status', ['not_required', 'requested', 'paid', 'fulfilled']);

export const researchSourceEnum = pgEnum('research_source', ['ai_search', 'website', 'phone_call', 'manual', 'other']);

export const emailTypeEnum = pgEnum('email_type', ['sent', 'received', 'follow_up']);

export const fileTypeEnum = pgEnum('file_type', ['csv', 'pdf', 'excel', 'txt', 'other']);

export const priceBasisEnum = pgEnum('price_basis', [
  'flat_list',
  'per_listing',
  'per_page',
  'per_record',
  'hourly',
  'unknown'
]);

export const quantityUnitEnum = pgEnum('quantity_unit', [
  'pages',
  'listings',
  'records',
  'counties',
  'unknown'
]);

export const listRequestEventTypeEnum = pgEnum('list_request_event_type', [
  'note',
  'email_sent',
  'email_received',
  'phone_call',
  'form_submitted',
  'mail_sent',
  'response_received',
  'payment_requested',
  'payment_made',
  'file_received',
  'data_processed',
  'status_changed',
  'other'
]);

export const eventChannelEnum = pgEnum('event_channel', [
  'email',
  'phone',
  'mail',
  'web_form',
  'in_person',
  'other'
]);

// ====================
// States Table
// ====================
export const states = pgTable('states', {
  id: serial('id').primaryKey(),
  abbreviation: varchar('abbreviation', { length: 2 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  fipsCode: varchar('fips_code', { length: 2 }),
  priority: integer('priority').default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  abbreviationIdx: uniqueIndex('states_abbreviation_idx').on(table.abbreviation),
  nameIdx: index('states_name_idx').on(table.name),
  priorityIdx: index('states_priority_idx').on(table.priority),
}));

// ====================
// Counties Table
// ====================
export const counties = pgTable('counties', {
  id: serial('id').primaryKey(),
  stateId: integer('state_id').notNull().references(() => states.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  countySeat: varchar('county_seat', { length: 100 }),
  fipsCode: varchar('fips_code', { length: 5 }),
  population: integer('population'),
  targetPriority: targetPriorityEnum('target_priority').default('medium'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  stateIdx: index('counties_state_idx').on(table.stateId),
  nameIdx: index('counties_name_idx').on(table.name),
  priorityIdx: index('counties_priority_idx').on(table.targetPriority),
  stateNameIdx: uniqueIndex('counties_state_name_idx').on(table.stateId, table.name),
}));

// ====================
// Tax Officials Table
// ====================
export const taxOfficials = pgTable('tax_officials', {
  id: serial('id').primaryKey(),
  countyId: integer('county_id').notNull().references(() => counties.id, { onDelete: 'cascade' }),
  fullName: varchar('full_name', { length: 100 }).notNull(),
  title: varchar('title', { length: 100 }),
  phoneNumber: varchar('phone_number', { length: 50 }),
  emailAddress: varchar('email_address', { length: 200 }),
  officeAddress: text('office_address'),
  websiteUrl: varchar('website_url', { length: 500 }),
  isPrimary: boolean('is_primary').default(false),
  researchSource: researchSourceEnum('research_source').default('manual'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  countyIdx: index('tax_officials_county_idx').on(table.countyId),
  emailIdx: index('tax_officials_email_idx').on(table.emailAddress),
  primaryIdx: index('tax_officials_primary_idx').on(table.isPrimary),
}));

// ====================
// FOIA Templates Table
// ====================
export const foiaTemplates = pgTable('foia_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  subjectLine: varchar('subject_line', { length: 500 }).notNull(),
  bodyText: text('body_text').notNull(),
  isDefault: boolean('is_default').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  nameIdx: uniqueIndex('foia_templates_name_idx').on(table.name),
  defaultIdx: index('foia_templates_default_idx').on(table.isDefault),
}));

// ====================
// List Requests Table
// ====================
export const listRequests = pgTable('list_requests', {
  id: serial('id').primaryKey(),
  taxOfficialId: integer('tax_official_id').notNull().references(() => taxOfficials.id, { onDelete: 'cascade' }),
  requestStatus: requestStatusEnum('request_status').default('not_started'),
  listType: listTypeEnum('list_type').default('unknown'),
  costAmount: decimal('cost_amount', { precision: 10, scale: 2 }),
  costCurrency: varchar('cost_currency', { length: 3 }).default('USD'),
  costNotes: text('cost_notes'),
  pricingBasis: priceBasisEnum('pricing_basis'),
  costQuantity: decimal('cost_quantity', { precision: 10, scale: 2 }),
  costQuantityUnit: quantityUnitEnum('cost_quantity_unit'),
  sourceLabel: text('source_label'),
  rawListStatus: text('raw_list_status'),
  latestEventAt: timestamp('latest_event_at', { withTimezone: true }),
  paymentStatus: paymentStatusEnum('payment_status').default('not_required'),
  foiaTemplateId: integer('foia_template_id').references(() => foiaTemplates.id, { onDelete: 'set null' }),
  emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
  responseReceivedAt: timestamp('response_received_at', { withTimezone: true }),
  responseSummary: text('response_summary'),
  fullResponseText: text('full_response_text'),
  listFileReceived: boolean('list_file_received').default(false),
  fileLocation: varchar('file_location', { length: 500 }),
  dataProcessed: boolean('data_processed').default(false),
  taxYearAvailable: varchar('tax_year_available', { length: 50 }),
  updateFrequency: varchar('update_frequency', { length: 100 }),
  nextUpdateDate: timestamp('next_update_date', { withTimezone: true }),
  notes: text('notes'),
  assignedTo: varchar('assigned_to', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  officialIdx: index('list_requests_official_idx').on(table.taxOfficialId),
  statusIdx: index('list_requests_status_idx').on(table.requestStatus),
  listTypeIdx: index('list_requests_list_type_idx').on(table.listType),
  paymentStatusIdx: index('list_requests_payment_status_idx').on(table.paymentStatus),
  templateIdx: index('list_requests_template_idx').on(table.foiaTemplateId),
  assignedIdx: index('list_requests_assigned_idx').on(table.assignedTo),
  createdAtIdx: index('list_requests_created_at_idx').on(table.createdAt),
}));

// ====================
// Email Tracking Table
// ====================
export const emailTracking = pgTable('email_tracking', {
  id: serial('id').primaryKey(),
  listRequestId: integer('list_request_id').notNull().references(() => listRequests.id, { onDelete: 'cascade' }),
  emailType: emailTypeEnum('email_type').default('sent'),
  gmailMessageId: varchar('gmail_message_id', { length: 100 }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  subject: varchar('subject', { length: 500 }),
  bodyPreview: text('body_preview'),
  attachmentsCount: integer('attachments_count').default(0),
  processed: boolean('processed').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  requestIdx: index('email_tracking_request_idx').on(table.listRequestId),
  typeIdx: index('email_tracking_type_idx').on(table.emailType),
  gmailIdx: index('email_tracking_gmail_idx').on(table.gmailMessageId),
  processedIdx: index('email_tracking_processed_idx').on(table.processed),
}));

// ====================
// Processed Lists Table
// ====================
export const processedLists = pgTable('processed_lists', {
  id: serial('id').primaryKey(),
  listRequestId: integer('list_request_id').notNull().references(() => listRequests.id, { onDelete: 'cascade' }),
  originalFilename: varchar('original_filename', { length: 255 }),
  fileType: fileTypeEnum('file_type'),
  rawDataStored: boolean('raw_data_stored').default(false),
  recordCount: integer('record_count'),
  mailingListCreated: boolean('mailing_list_created').default(false),
  mailingListExportPath: varchar('mailing_list_export_path', { length: 500 }),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  notes: text('notes'),
}, (table) => ({
  requestIdx: index('processed_lists_request_idx').on(table.listRequestId),
  fileTypeIdx: index('processed_lists_file_type_idx').on(table.fileType),
  processedAtIdx: index('processed_lists_processed_at_idx').on(table.processedAt),
}));

// ====================
// List Request Prices Table
// ====================
export const listRequestPrices = pgTable('list_request_prices', {
  id: serial('id').primaryKey(),
  listRequestId: integer('list_request_id').notNull().references(() => listRequests.id, { onDelete: 'cascade' }),
  basis: priceBasisEnum('basis').default('unknown'),
  unitAmount: decimal('unit_amount', { precision: 10, scale: 2 }),
  quantity: decimal('quantity', { precision: 10, scale: 2 }),
  quantityUnit: quantityUnitEnum('quantity_unit'),
  currency: varchar('currency', { length: 3 }).default('USD'),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }),
  effectiveDate: timestamp('effective_date', { withTimezone: true }),
  rawText: text('raw_text'),
  sourceLabel: varchar('source_label', { length: 500 }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  requestIdx: index('list_request_prices_request_idx').on(table.listRequestId),
  effectiveDateIdx: index('list_request_prices_effective_date_idx').on(table.effectiveDate),
  basisIdx: index('list_request_prices_basis_idx').on(table.basis),
}));

// ====================
// List Request Events Table
// ====================
export const listRequestEvents = pgTable('list_request_events', {
  id: serial('id').primaryKey(),
  listRequestId: integer('list_request_id').notNull().references(() => listRequests.id, { onDelete: 'cascade' }),
  eventType: listRequestEventTypeEnum('event_type').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow(),
  channel: eventChannelEnum('channel'),
  summary: varchar('summary', { length: 500 }),
  body: text('body'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  requestIdx: index('list_request_events_request_idx').on(table.listRequestId),
  occurredAtIdx: index('list_request_events_occurred_at_idx').on(table.occurredAt),
  eventTypeIdx: index('list_request_events_event_type_idx').on(table.eventType),
}));

// ====================
// List Request Status History Table
// ====================
export const listRequestStatusHistory = pgTable('list_request_status_history', {
  id: serial('id').primaryKey(),
  listRequestId: integer('list_request_id').notNull().references(() => listRequests.id, { onDelete: 'cascade' }),
  fromStatus: requestStatusEnum('from_status'),
  toStatus: requestStatusEnum('to_status').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
  reason: text('reason'),
  sourceLabel: text('source_label'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  requestIdx: index('list_request_status_history_request_idx').on(table.listRequestId),
  changedAtIdx: index('list_request_status_history_changed_at_idx').on(table.changedAt),
  toStatusIdx: index('list_request_status_history_to_status_idx').on(table.toStatus),
}));

// ====================
// Relations
// ====================

export const statesRelations = relations(states, ({ many }) => ({
  counties: many(counties),
}));

export const countiesRelations = relations(counties, ({ one, many }) => ({
  state: one(states, {
    fields: [counties.stateId],
    references: [states.id],
  }),
  taxOfficials: many(taxOfficials),
}));

export const taxOfficialsRelations = relations(taxOfficials, ({ one, many }) => ({
  county: one(counties, {
    fields: [taxOfficials.countyId],
    references: [counties.id],
  }),
  listRequests: many(listRequests),
}));

export const foiaTemplatesRelations = relations(foiaTemplates, ({ many }) => ({
  listRequests: many(listRequests),
}));

export const listRequestsRelations = relations(listRequests, ({ one, many }) => ({
  taxOfficial: one(taxOfficials, {
    fields: [listRequests.taxOfficialId],
    references: [taxOfficials.id],
  }),
  foiaTemplate: one(foiaTemplates, {
    fields: [listRequests.foiaTemplateId],
    references: [foiaTemplates.id],
  }),
  emailTracking: many(emailTracking),
  processedLists: many(processedLists),
  prices: many(listRequestPrices),
  events: many(listRequestEvents),
  statusHistory: many(listRequestStatusHistory),
}));

export const emailTrackingRelations = relations(emailTracking, ({ one }) => ({
  listRequest: one(listRequests, {
    fields: [emailTracking.listRequestId],
    references: [listRequests.id],
  }),
}));

export const processedListsRelations = relations(processedLists, ({ one }) => ({
  listRequest: one(listRequests, {
    fields: [processedLists.listRequestId],
    references: [listRequests.id],
  }),
}));

export const listRequestPricesRelations = relations(listRequestPrices, ({ one }) => ({
  listRequest: one(listRequests, {
    fields: [listRequestPrices.listRequestId],
    references: [listRequests.id],
  }),
}));

export const listRequestEventsRelations = relations(listRequestEvents, ({ one }) => ({
  listRequest: one(listRequests, {
    fields: [listRequestEvents.listRequestId],
    references: [listRequests.id],
  }),
}));

export const listRequestStatusHistoryRelations = relations(listRequestStatusHistory, ({ one }) => ({
  listRequest: one(listRequests, {
    fields: [listRequestStatusHistory.listRequestId],
    references: [listRequests.id],
  }),
}));

// ====================
// Zod Insert Schemas
// ====================

export const insertStateSchema = createInsertSchema(states);
export const insertCountySchema = createInsertSchema(counties);
export const insertTaxOfficialSchema = createInsertSchema(taxOfficials);
export const insertFoiaTemplateSchema = createInsertSchema(foiaTemplates);
export const insertListRequestSchema = createInsertSchema(listRequests);
export const insertEmailTrackingSchema = createInsertSchema(emailTracking);
export const insertProcessedListSchema = createInsertSchema(processedLists);
export const insertListRequestPriceSchema = createInsertSchema(listRequestPrices);
export const insertListRequestEventSchema = createInsertSchema(listRequestEvents);
export const insertListRequestStatusHistorySchema = createInsertSchema(listRequestStatusHistory);

// ====================
// Type Exports
// ====================

export type State = typeof states.$inferSelect;
export type NewState = typeof states.$inferInsert;

export type County = typeof counties.$inferSelect;
export type NewCounty = typeof counties.$inferInsert;

export type TaxOfficial = typeof taxOfficials.$inferSelect;
export type NewTaxOfficial = typeof taxOfficials.$inferInsert;

export type FoiaTemplate = typeof foiaTemplates.$inferSelect;
export type NewFoiaTemplate = typeof foiaTemplates.$inferInsert;

export type ListRequest = typeof listRequests.$inferSelect;
export type NewListRequest = typeof listRequests.$inferInsert;

export type EmailTracking = typeof emailTracking.$inferSelect;
export type NewEmailTracking = typeof emailTracking.$inferInsert;

export type ProcessedList = typeof processedLists.$inferSelect;
export type NewProcessedList = typeof processedLists.$inferInsert;

export type ListRequestPrice = typeof listRequestPrices.$inferSelect;
export type NewListRequestPrice = typeof listRequestPrices.$inferInsert;

export type ListRequestEvent = typeof listRequestEvents.$inferSelect;
export type NewListRequestEvent = typeof listRequestEvents.$inferInsert;

export type ListRequestStatusHistory = typeof listRequestStatusHistory.$inferSelect;
export type NewListRequestStatusHistory = typeof listRequestStatusHistory.$inferInsert;

// ====================
// Seed Data - 50 US States with FIPS codes
// ====================

export const seedStates: NewState[] = [
  { abbreviation: 'AL', name: 'Alabama', fipsCode: '01', priority: 0 },
  { abbreviation: 'AK', name: 'Alaska', fipsCode: '02', priority: 0 },
  { abbreviation: 'AZ', name: 'Arizona', fipsCode: '04', priority: 0 },
  { abbreviation: 'AR', name: 'Arkansas', fipsCode: '05', priority: 0 },
  { abbreviation: 'CA', name: 'California', fipsCode: '06', priority: 0 },
  { abbreviation: 'CO', name: 'Colorado', fipsCode: '08', priority: 0 },
  { abbreviation: 'CT', name: 'Connecticut', fipsCode: '09', priority: 0 },
  { abbreviation: 'DE', name: 'Delaware', fipsCode: '10', priority: 0 },
  { abbreviation: 'FL', name: 'Florida', fipsCode: '12', priority: 0 },
  { abbreviation: 'GA', name: 'Georgia', fipsCode: '13', priority: 0 },
  { abbreviation: 'HI', name: 'Hawaii', fipsCode: '15', priority: 0 },
  { abbreviation: 'ID', name: 'Idaho', fipsCode: '16', priority: 0 },
  { abbreviation: 'IL', name: 'Illinois', fipsCode: '17', priority: 0 },
  { abbreviation: 'IN', name: 'Indiana', fipsCode: '18', priority: 0 },
  { abbreviation: 'IA', name: 'Iowa', fipsCode: '19', priority: 0 },
  { abbreviation: 'KS', name: 'Kansas', fipsCode: '20', priority: 0 },
  { abbreviation: 'KY', name: 'Kentucky', fipsCode: '21', priority: 0 },
  { abbreviation: 'LA', name: 'Louisiana', fipsCode: '22', priority: 0 },
  { abbreviation: 'ME', name: 'Maine', fipsCode: '23', priority: 0 },
  { abbreviation: 'MD', name: 'Maryland', fipsCode: '24', priority: 0 },
  { abbreviation: 'MA', name: 'Massachusetts', fipsCode: '25', priority: 0 },
  { abbreviation: 'MI', name: 'Michigan', fipsCode: '26', priority: 0 },
  { abbreviation: 'MN', name: 'Minnesota', fipsCode: '27', priority: 0 },
  { abbreviation: 'MS', name: 'Mississippi', fipsCode: '28', priority: 0 },
  { abbreviation: 'MO', name: 'Missouri', fipsCode: '29', priority: 0 },
  { abbreviation: 'MT', name: 'Montana', fipsCode: '30', priority: 0 },
  { abbreviation: 'NE', name: 'Nebraska', fipsCode: '31', priority: 0 },
  { abbreviation: 'NV', name: 'Nevada', fipsCode: '32', priority: 0 },
  { abbreviation: 'NH', name: 'New Hampshire', fipsCode: '33', priority: 0 },
  { abbreviation: 'NJ', name: 'New Jersey', fipsCode: '34', priority: 0 },
  { abbreviation: 'NM', name: 'New Mexico', fipsCode: '35', priority: 0 },
  { abbreviation: 'NY', name: 'New York', fipsCode: '36', priority: 0 },
  { abbreviation: 'NC', name: 'North Carolina', fipsCode: '37', priority: 0 },
  { abbreviation: 'ND', name: 'North Dakota', fipsCode: '38', priority: 0 },
  { abbreviation: 'OH', name: 'Ohio', fipsCode: '39', priority: 0 },
  { abbreviation: 'OK', name: 'Oklahoma', fipsCode: '40', priority: 0 },
  { abbreviation: 'OR', name: 'Oregon', fipsCode: '41', priority: 0 },
  { abbreviation: 'PA', name: 'Pennsylvania', fipsCode: '42', priority: 0 },
  { abbreviation: 'RI', name: 'Rhode Island', fipsCode: '44', priority: 0 },
  { abbreviation: 'SC', name: 'South Carolina', fipsCode: '45', priority: 0 },
  { abbreviation: 'SD', name: 'South Dakota', fipsCode: '46', priority: 0 },
  { abbreviation: 'TN', name: 'Tennessee', fipsCode: '47', priority: 0 },
  { abbreviation: 'TX', name: 'Texas', fipsCode: '48', priority: 0 },
  { abbreviation: 'UT', name: 'Utah', fipsCode: '49', priority: 0 },
  { abbreviation: 'VT', name: 'Vermont', fipsCode: '50', priority: 0 },
  { abbreviation: 'VA', name: 'Virginia', fipsCode: '51', priority: 0 },
  { abbreviation: 'WA', name: 'Washington', fipsCode: '53', priority: 0 },
  { abbreviation: 'WV', name: 'West Virginia', fipsCode: '54', priority: 0 },
  { abbreviation: 'WI', name: 'Wisconsin', fipsCode: '55', priority: 0 },
  { abbreviation: 'WY', name: 'Wyoming', fipsCode: '56', priority: 0 },
];

// ====================
// Default FOIA Template
// ====================

export const defaultFoiaTemplate: NewFoiaTemplate = {
  name: 'Standard FOIA Request',
  subjectLine: 'FOIA Request - Tax Delinquent Property List - {{county_name}} County, {{state_name}}',
  bodyText: `Dear {{official_title}} {{official_name}},

I am writing to request access to public records under the {{state_name}} Freedom of Information Act (or applicable public records law).

Specifically, I am requesting a list of tax delinquent properties in {{county_name}} County, {{state_name}}. I am interested in obtaining the following information for each property:

• Parcel/Property ID number (APN)
• Property address or legal description
• Owner name(s)
• Mailing address of record
• Amount of taxes owed
• Tax year(s) delinquent

Format: If available, I would prefer the data in electronic format (CSV, Excel, or PDF).

Purpose: This information will be used for research purposes related to real estate investment and community development.

Please let me know:
1. If this information is available
2. The format(s) in which it can be provided
3. Any associated costs for reproduction
4. The estimated timeframe for fulfillment

If there are any fees associated with this request, please inform me before processing. I am willing to pay reasonable reproduction costs.

Thank you for your assistance with this public records request. I look forward to your response within the timeframe required by law.

Sincerely,
[Your Name]
[Your Company Name]
[Your Contact Information]`,
  isDefault: true,
};
