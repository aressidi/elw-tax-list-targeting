export type TargetPriority = 'high' | 'medium' | 'low';

export type ResearchStatus = 'not_started' | 'in_progress' | 'completed' | 'needs_review' | 'skipped' | 'failed';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface State {
  id: number;
  abbreviation: string;
  name: string;
  fipsCode: string | null;
  priority: number | null;
  notes: string | null;
  createdAt: string;
}

export interface StateWithCounts extends State {
  countyCount: number;
  highPriorityCountyCount: number;
  mediumPriorityCountyCount: number;
  lowPriorityCountyCount: number;
  topCountyPriority: TargetPriority | null;
}

export interface CountySummary {
  id: number;
  stateId: number;
  name: string;
  countySeat: string | null;
  fipsCode: string | null;
  population: number | null;
  targetPriority: TargetPriority | null;
  notes: string | null;
  researchStatus: ResearchStatus;
  createdAt: string;
  contactCount: number;
  requestStatusSummary: Record<string, number>;
}

export interface StateWithCounties extends State {
  counties: CountySummary[];
}

export interface ListRequestPrice {
  id: number;
  listRequestId: number;
  basis: string | null;
  unitAmount: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  currency: string | null;
  totalAmount: string | null;
  effectiveDate: string | null;
  rawText: string | null;
  sourceLabel: string | null;
  notes: string | null;
}

export interface ListRequestEvent {
  id: number;
  listRequestId: number;
  eventType: string;
  occurredAt: string | null;
  channel: string | null;
  summary: string | null;
  body: string | null;
}

export interface ListRequestStatusHistoryEntry {
  id: number;
  listRequestId: number;
  fromStatus: string | null;
  toStatus: string;
  changedAt: string;
  reason: string | null;
}

export interface ListRequest {
  id: number;
  taxOfficialId: number;
  requestStatus: string;
  listType: string;
  costAmount: string | null;
  costCurrency: string | null;
  costNotes: string | null;
  pricingBasis: string | null;
  // Budget tracking & reporting (card 15)
  paymentStatus: string | null;
  paymentDate: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  invoiceNumber: string | null;
  responseSummary: string | null;
  assignedTo: string | null;
  foiaTemplateId: number | null;
  emailSentAt: string | null;
  listFileReceived?: boolean;
  createdAt: string;
  updatedAt: string;
  prices: ListRequestPrice[];
  events: ListRequestEvent[];
  statusHistory: ListRequestStatusHistoryEntry[];
}

export interface TaxOfficial {
  id: number;
  countyId: number;
  fullName: string;
  title: string | null;
  phoneNumber: string | null;
  emailAddress: string | null;
  officeAddress: string | null;
  websiteUrl: string | null;
  isPrimary: boolean | null;
  researchSource: string | null;
  confidenceScore: ConfidenceLevel | null;
  sourceUrl: string | null;
  verifiedAt: string | null;
  notes: string | null;
  createdAt: string;
  listRequests?: ListRequest[];
}

// ====================
// Global Contacts View (card 05)
// ====================

export interface ContactListItem extends Omit<TaxOfficial, 'listRequests'> {
  county: {
    id: number;
    name: string;
    stateId: number;
    state: {
      abbreviation: string;
      name: string;
    };
  };
}

export interface CountyDetail {
  id: number;
  stateId: number;
  name: string;
  countySeat: string | null;
  fipsCode: string | null;
  population: number | null;
  targetPriority: TargetPriority | null;
  notes: string | null;
  researchStatus: ResearchStatus;
  createdAt: string;
  state: State;
  taxOfficials: TaxOfficial[];
}

// ====================
// AI Contact Research (card 04)
// ====================

export interface ResearchCandidate {
  fullName: string;
  title: string | null;
  emailAddress: string | null;
  phoneNumber: string | null;
  websiteUrl: string | null;
  confidence: ConfidenceLevel;
  sourceUrl: string | null;
  sourceSnippet: string | null;
}

export interface ResearchRun {
  id: number;
  countyId: number;
  status: 'in_progress' | 'completed' | 'failed';
  provider: string;
  isDemo: boolean;
  requestedAt: string;
  completedAt: string | null;
  resultData: { candidates: ResearchCandidate[] } | null;
  errorMessage: string | null;
}

export interface ResearchResultsResponse {
  researchStatus: ResearchStatus;
  runs: ResearchRun[];
}

// ====================
// FOIA Templates (card 06)
// ====================

export interface FoiaTemplate {
  id: number;
  name: string;
  subjectLine: string;
  bodyText: string;
  isDefault: boolean;
  createdAt: string;
}

export interface TemplatePreviewResult {
  subject: string;
  body: string;
  sampleData: {
    countyName: string;
    stateName: string;
    stateAbbr: string;
    officialName: string;
    officialTitle: string;
    customNote?: string;
  };
  usedVariables: string[];
  unknownVariables: string[];
}

// ====================
// Email Sending (card 07)
// ====================

export type EmailTransportName = 'dry_run' | 'gog';

export interface EmailSendPreview {
  listRequestId: number;
  recipientEmail: string;
  subject: string;
  body: string;
  transport: EmailTransportName;
  preview: true;
}

export interface EmailSendResult {
  listRequestId: number;
  outcome: 'sent';
  transport: EmailTransportName;
  messageId: string | null;
  recipientEmail: string;
  subject: string;
  body: string;
}

export interface EmailBulkSendResultItem {
  listRequestId: number;
  outcome: 'sent' | 'skipped' | 'failed';
  transport?: EmailTransportName;
  messageId?: string | null;
  recipientEmail?: string;
  error?: string;
}

export interface EmailBulkSendSummary {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  transport: EmailTransportName;
}

export interface EmailBulkSendResponse {
  results: EmailBulkSendResultItem[];
  summary: EmailBulkSendSummary;
}

// ====================
// Email Queue & Throttle (card 08)
// ====================

export type EmailQueueItemStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface EmailQueueEntry {
  id: number;
  listRequestId: number;
  status: EmailQueueItemStatus;
  queuedAt: string;
  sendAt: string | null;
  sentAt: string | null;
  error: string | null;
  listRequest: {
    id: number;
    requestStatus: string;
    taxOfficial: {
      fullName: string;
      emailAddress: string | null;
      county: {
        name: string;
        state: { abbreviation: string; name: string };
      };
    };
  };
}

export interface EmailQueueStatus {
  paused: boolean;
  dailyLimit: number;
  sentToday: number;
  realSentToday: number;
  pending: number;
  dueNow: number;
  scheduled: number;
  failedToday: number;
}

export interface EmailQueueSettingsRow {
  id: number;
  dailyLimit: number;
  paused: boolean;
  updatedAt: string;
}

export interface EnqueueResultItem {
  listRequestId: number;
  outcome: 'queued' | 'skipped' | 'failed';
  queueId?: number;
  error?: string;
}

export interface EnqueueBulkSummary {
  total: number;
  queued: number;
  skipped: number;
  failed: number;
}

export interface EnqueueBulkResponse {
  results: EnqueueResultItem[];
  summary: EnqueueBulkSummary;
}

// ====================
// Gmail Inbox Monitoring (card 09)
// ====================

export type InboxProviderName = 'mock' | 'gog';

export type InboxItemStatus = 'unprocessed' | 'matched' | 'unmatched' | 'reviewed' | 'attached';

export type InboxMatchMethod = 'thread_id' | 'subject' | 'from_address' | 'manual';

export type InboxClassification =
  | 'list_received'
  | 'fee_quote'
  | 'fee_paid'
  | 'clarification'
  | 'rejection'
  | 'other';

// Human review classification (card 10) — distinct from InboxClassification
// above, which is the rule engine's guess at ingest time.
export type ReviewClassification =
  | 'list_provided'
  | 'requires_payment'
  | 'requires_form'
  | 'not_available'
  | 'needs_clarification'
  | 'declined';

export interface InboxAttachmentMeta {
  filename: string;
  sizeBytes: number;
  kind: string;
}

export interface InboxItem {
  id: number;
  gmailMessageId: string;
  threadId: string | null;
  fromAddress: string | null;
  subject: string | null;
  bodyText: string | null;
  receivedAt: string | null;
  listRequestId: number | null;
  matchConfidence: number | null;
  matchMethod: InboxMatchMethod | null;
  classification: InboxClassification | null;
  status: InboxItemStatus;
  attachmentMetadata: InboxAttachmentMeta[] | null;
  reviewClassification: ReviewClassification | null;
  reviewNotes: string | null;
  reviewCostAmount: string | null;
  reviewCostCurrency: string | null;
  reviewFormUrl: string | null;
  reviewedAt: string | null;
  createdAt: string;
  listRequest: {
    id: number;
    requestStatus: string;
    taxOfficial: {
      fullName: string;
      emailAddress: string | null;
      county: {
        name: string;
        state: { abbreviation: string; name: string };
      };
    };
  } | null;
}

export interface PollInboxResult {
  provider: InboxProviderName;
  fetched: number;
  newItemsCount: number;
  items: InboxItem[];
}

export interface ResearchQueueEntry {
  id: number;
  name: string;
  targetPriority: TargetPriority | null;
  researchStatus: ResearchStatus;
  contactCount: number;
  state: {
    id: number;
    abbreviation: string;
    name: string;
  };
  latestResearchRun: {
    id: number;
    status: 'in_progress' | 'completed' | 'failed';
    provider: string;
    isDemo: boolean;
    requestedAt: string;
    completedAt: string | null;
    errorMessage: string | null;
  } | null;
}

// ====================
// File Upload & Storage (card 11)
// ====================

export type UploadFileType = 'csv' | 'pdf' | 'excel' | 'txt' | 'other';

export interface ProcessedListFile {
  id: number;
  listRequestId: number;
  originalFilename: string | null;
  fileType: UploadFileType | null;
  filePath: string | null;
  fileSizeBytes: number | null;
  mimeType: string | null;
  rawDataStored: boolean | null;
  recordCount: number | null;
  mailingListCreated: boolean | null;
  mailingListExportPath: string | null;
  fieldMapping: Partial<Record<StandardFieldId, string | null>> | null;
  validationSummary: ValidationSummary | null;
  processedAt: string | null;
  notes: string | null;
}

export interface FileTextPreview {
  kind: 'text';
  totalLines: number;
  rows: string[][];
  truncated: boolean;
}

export interface FilePdfPreview {
  kind: 'pdf';
  approxPageCount: number | null;
  title: string | null;
  author: string | null;
  producer: string | null;
  note: string;
}

export interface FileMetadataOnlyPreview {
  kind: 'metadata';
  note: string;
}

export type FilePreview = FileTextPreview | FilePdfPreview | FileMetadataOnlyPreview;

export interface FilePreviewResponse {
  file: {
    id: number;
    originalFilename: string | null;
    fileType: UploadFileType | null;
    fileSizeBytes: number | null;
  };
  preview: FilePreview;
}

// ====================
// Data Parsing & Validation (card 12)
// ====================

export type StandardFieldId =
  | 'apn'
  | 'owner_name'
  | 'property_address'
  | 'mailing_address'
  | 'amount_due'
  | 'property_description';

export type FieldMapping = Partial<Record<StandardFieldId, string | null>>;

export interface ValidationSummary {
  totalRecords: number;
  validRecords: number;
  warningRecords: number;
  errorRecords: number;
  duplicateRecords: number;
}

export interface ParsedRecordPreview {
  rawData: Record<string, string>;
  mappedData: Partial<Record<StandardFieldId, string | number | null>>;
  isValid: boolean;
  isDuplicate: boolean;
  validationErrors: string[];
}

export interface ParseFileResponse {
  headers: string[];
  rowCount: number;
  mapping: FieldMapping | null;
  sampleRecords: ParsedRecordPreview[];
  validationSummary: ValidationSummary | null;
  sourceFormat: 'csv' | 'txt' | 'excel' | 'pdf' | 'unsupported';
  warnings: string[];
}

export interface FieldMappingResponse {
  headers: string[];
  mapping: FieldMapping | null;
  validationSummary: ValidationSummary | null;
  recordCount: number | null;
  sourceFormat: 'csv' | 'txt' | 'excel' | 'pdf' | 'unsupported';
  warnings: string[];
}

export interface MapFieldsResponse {
  processedList: ProcessedListFile;
  validationSummary: ValidationSummary;
}

export interface ProcessedListRecord {
  id: number;
  processedListId: number;
  rawData: Record<string, string>;
  mappedData: Partial<Record<StandardFieldId, string | number | null>>;
  isValid: boolean;
  validationErrors: string[] | null;
  isDuplicate: boolean;
  createdAt: string;
}

// ====================
// Mailing List Export & ELW Integration (card 13)
// ====================

export type ElwExportColumn =
  | 'first_name'
  | 'last_name'
  | 'company_name'
  | 'owner_raw'
  | 'mailing_street'
  | 'mailing_city'
  | 'mailing_state'
  | 'mailing_zip'
  | 'property_apn'
  | 'property_street'
  | 'property_city'
  | 'property_state'
  | 'property_zip'
  | 'tax_amount_due'
  | 'county_name'
  | 'state_name'
  | 'source_label';

export type ElwExportRow = Record<ElwExportColumn, string>;

export interface ExportOptions {
  includeDuplicates: boolean;
  validOnly: boolean;
}

export interface ExportPreviewResponse {
  columns: readonly ElwExportColumn[];
  rows: ElwExportRow[];
  previewCount: number;
  totalMatching: number;
}

export interface MailingListExport {
  id: number;
  processedListId: number;
  filename: string;
  exportPath: string;
  recordCount: number;
  exportFormat: string;
  includeDuplicates: boolean;
  validOnly: boolean;
  exportedAt: string;
}

export interface GenerateExportResponse {
  export: MailingListExport;
  recordCount: number;
  downloadUrl: string;
  processedList?: ProcessedListFile;
}

// ====================
// Dashboard & Pipeline View (card 14)
// ====================

export type PipelineStageKey =
  | 'not_started'
  | 'researching'
  | 'ready_to_email'
  | 'email_sent'
  | 'awaiting_response'
  | 'response_received'
  | 'list_provided'
  | 'data_processed';

export interface PipelineCard {
  stage: PipelineStageKey;
  requestId: number | null;
  countyId: number;
  countyName: string;
  stateAbbreviation: string;
  stateName: string;
  contact: { name: string; email: string | null } | null;
  requestStatus: string | null;
  listType: string | null;
  costAmount: string | null;
  costCurrency: string | null;
  priority: TargetPriority | null;
  emailSentAt: string | null;
  responseReceivedAt: string | null;
  updatedAt: string;
  daysInStage: number;
  daysSinceSent: number | null;
  dataProcessed: boolean;
  listFileReceived: boolean;
  hasActiveResearchRun: boolean;
}

export interface PipelineStageGroup {
  key: PipelineStageKey;
  label: string;
  count: number;
  cards: PipelineCard[];
}

export interface PipelineResponse {
  stages: PipelineStageGroup[];
}

export interface DashboardMetrics {
  totalCounties: number;
  totalListRequests: number;
  totalSent: number;
  responseRate: number;
  avgResponseTimeDays: number | null;
  activeRequests: number;
  processedLists: number;
  cost: {
    currency: string;
    totalQuoted: number;
    totalPaid: number;
    totalAll: number;
  };
}

export interface BulkStatusResultItem {
  id: number;
  success: boolean;
  error?: string;
}

export interface BulkStatusSummary {
  total: number;
  updated: number;
  failed: number;
}

export interface BulkStatusResponse {
  results: BulkStatusResultItem[];
  summary: BulkStatusSummary;
}

// ====================
// Budget Tracking & Reporting (card 15)
// ====================

export type PaymentStatus = 'not_required' | 'requested' | 'paid' | 'fulfilled';

export interface PricingBasisBreakdownEntry {
  basis: string;
  count: number;
  totalAmount: number;
}

export interface ListTypeBreakdown {
  free: number;
  paid: number;
  not_available: number;
  unknown: number;
}

export interface CostSummaryReport {
  currency: string;
  totalListCount: number;
  totalSpending: number;
  totalQuotesPending: number;
  totalPaid: number;
  totalFulfilled: number;
  paidListCount: number;
  fulfilledListCount: number;
  pendingQuoteCount: number;
  averageCostPerPaidList: number | null;
  listTypeBreakdown: ListTypeBreakdown;
  pricingBasisBreakdown: PricingBasisBreakdownEntry[];
}

export interface CostByStateEntry {
  stateId: number;
  stateAbbreviation: string;
  stateName: string;
  listCount: number;
  totalSpend: number;
  totalQuoted: number;
  paidCount: number;
}

export interface CostByCountyEntry {
  requestId: number;
  countyId: number;
  countyName: string;
  stateAbbreviation: string;
  stateName: string;
  officialName: string;
  requestStatus: string | null;
  listType: string | null;
  pricingBasis: string | null;
  costAmount: number | null;
  currency: string;
  paymentStatus: PaymentStatus | null;
  paymentDate: string | null;
  paymentMethod: string | null;
  invoiceNumber: string | null;
  paymentReference: string | null;
  listFileReceived: boolean;
}

export interface PendingPaymentEntry {
  requestId: number;
  countyId: number;
  countyName: string;
  stateAbbreviation: string;
  officialName: string;
  costAmount: number | null;
  currency: string;
  paymentStatus: PaymentStatus | null;
  invoiceNumber: string | null;
  requestedAt: string;
  daysPending: number;
}

export interface PaidUnfulfilledEntry {
  requestId: number;
  countyId: number;
  countyName: string;
  stateAbbreviation: string;
  officialName: string;
  costAmount: number | null;
  currency: string;
  paymentDate: string | null;
  daysSincePaid: number | null;
  requestStatus: string | null;
}

export interface UpdatePaymentInput {
  paymentStatus?: PaymentStatus;
  costAmount?: number | null;
  pricingBasis?: string | null;
  paymentDate?: string | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  invoiceNumber?: string | null;
  costNotes?: string | null;
}
