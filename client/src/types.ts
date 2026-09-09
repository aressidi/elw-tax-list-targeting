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
  responseSummary: string | null;
  assignedTo: string | null;
  foiaTemplateId: number | null;
  emailSentAt: string | null;
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
