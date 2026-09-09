import { count, eq } from 'drizzle-orm';
import { db } from '../db.js';
import {
  counties,
  countyResearchRuns,
  listRequests,
  listRequestEvents,
  listRequestStatusHistory,
  type County,
  type ListRequest,
  type State,
} from '../../shared/schema.js';

// ============================================================
// Dashboard & Pipeline View (card 14)
//
// The kanban board groups work into eight operational stages that do not
// exist as a single db column -- they are derived from a combination of
// `list_requests.request_status`, `list_requests.data_processed`, and
// (for counties that don't have a list_request yet at all) county/contact
// state. This file is the single source of truth for that derivation so
// the pipeline and metrics endpoints -- and any future consumer -- stay in
// lockstep with the raw `request_status` enum without that enum itself
// needing to grow a redundant "pipeline stage" value.
// ============================================================

export const PIPELINE_STAGES = [
  { key: 'not_started', label: 'Not Started' },
  { key: 'researching', label: 'Researching / Needs Contact' },
  { key: 'ready_to_email', label: 'Ready to Email' },
  { key: 'email_sent', label: 'Email Sent' },
  { key: 'awaiting_response', label: 'Awaiting Response' },
  { key: 'response_received', label: 'Response Received' },
  { key: 'list_provided', label: 'List Provided' },
  { key: 'data_processed', label: 'Data Processed' },
] as const;

export type PipelineStageKey = (typeof PIPELINE_STAGES)[number]['key'];

const PIPELINE_STAGE_KEYS = new Set<string>(PIPELINE_STAGES.map((s) => s.key));

export function isPipelineStageKey(value: unknown): value is PipelineStageKey {
  return typeof value === 'string' && PIPELINE_STAGE_KEYS.has(value);
}

// Statuses that count as "a response has come back and been triaged" but
// don't have their own kanban column -- they all land in Response Received.
// list_provided gets its own column, and dataProcessed (checked first,
// independent of request_status) promotes a card straight to Data Processed
// regardless of which of these it came from.
const RESPONSE_RECEIVED_STATUSES = new Set<string>([
  'response_received',
  'requires_payment',
  'requires_form',
  'not_available',
  'declined',
  'needs_clarification',
]);

// Maps a raw request_status (plus the independent dataProcessed flag) onto
// the pipeline stage it should render under. Never mutates the enum or the
// row -- purely a read-side projection.
export function deriveStageFromRequest(request: {
  requestStatus: ListRequest['requestStatus'];
  dataProcessed: boolean | null;
}): PipelineStageKey {
  if (request.dataProcessed) return 'data_processed';

  const status = request.requestStatus ?? 'not_started';
  if (status === 'research_needed') return 'researching';
  if (status === 'list_provided') return 'list_provided';
  if (RESPONSE_RECEIVED_STATUSES.has(status)) return 'response_received';
  if (status === 'ready_to_email' || status === 'email_sent' || status === 'awaiting_response') {
    return status;
  }
  return 'not_started';
}

// Reverse mapping used when a card is moved to a new column: which
// request_status to write for a given target stage. `data_processed` has no
// corresponding status -- moving a card there sets the dataProcessed flag
// instead (see applyPipelineStatusChange).
export const STAGE_DEFAULT_STATUS: Record<Exclude<PipelineStageKey, 'data_processed'>, NonNullable<ListRequest['requestStatus']>> = {
  not_started: 'not_started',
  researching: 'research_needed',
  ready_to_email: 'ready_to_email',
  email_sent: 'email_sent',
  awaiting_response: 'awaiting_response',
  response_received: 'response_received',
  list_provided: 'list_provided',
};

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

export interface PipelineCard {
  stage: PipelineStageKey;
  requestId: number | null;
  countyId: number;
  countyName: string;
  stateAbbreviation: string;
  stateName: string;
  contact: { name: string; email: string | null } | null;
  requestStatus: ListRequest['requestStatus'] | null;
  listType: ListRequest['listType'] | null;
  costAmount: string | null;
  costCurrency: string | null;
  priority: County['targetPriority'];
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

export async function getPipelineStages(): Promise<PipelineStageGroup[]> {
  const now = new Date();

  const [allCounties, allRequests, activeRuns] = await Promise.all([
    db.query.counties.findMany({
      with: { state: true, taxOfficials: true },
    }),
    db.query.listRequests.findMany({
      with: {
        taxOfficial: {
          with: { county: { with: { state: true } } },
        },
      },
    }),
    db
      .select({ countyId: countyResearchRuns.countyId })
      .from(countyResearchRuns)
      .where(eq(countyResearchRuns.status, 'in_progress')),
  ]);

  const activeResearchCountyIds = new Set(activeRuns.map((r) => r.countyId));
  const countiesWithRequests = new Set(
    allRequests.map((r) => r.taxOfficial.county.id)
  );

  const cards: PipelineCard[] = [];

  for (const request of allRequests) {
    const county = request.taxOfficial.county;
    const state: State = county.state;
    const stage = deriveStageFromRequest(request);
    cards.push({
      stage,
      requestId: request.id,
      countyId: county.id,
      countyName: county.name,
      stateAbbreviation: state.abbreviation,
      stateName: state.name,
      contact: { name: request.taxOfficial.fullName, email: request.taxOfficial.emailAddress },
      requestStatus: request.requestStatus,
      listType: request.listType,
      costAmount: request.costAmount,
      costCurrency: request.costCurrency,
      priority: county.targetPriority,
      emailSentAt: request.emailSentAt ? request.emailSentAt.toISOString() : null,
      responseReceivedAt: request.responseReceivedAt ? request.responseReceivedAt.toISOString() : null,
      updatedAt: request.updatedAt.toISOString(),
      daysInStage: daysBetween(request.updatedAt, now),
      daysSinceSent: request.emailSentAt ? daysBetween(request.emailSentAt, now) : null,
      dataProcessed: Boolean(request.dataProcessed),
      listFileReceived: Boolean(request.listFileReceived),
      hasActiveResearchRun: activeResearchCountyIds.has(county.id),
    });
  }

  // Counties with no list_request at all haven't entered the operational
  // pipeline yet -- they show as a virtual "Researching" card keyed by
  // county rather than request, so the board reflects the full universe of
  // targeted counties, not just ones that already have a request.
  for (const county of allCounties) {
    if (countiesWithRequests.has(county.id)) continue;
    const state = county.state;
    const primary = county.taxOfficials.find((o) => o.isPrimary) ?? null;

    cards.push({
      stage: 'researching',
      requestId: null,
      countyId: county.id,
      countyName: county.name,
      stateAbbreviation: state.abbreviation,
      stateName: state.name,
      contact: primary ? { name: primary.fullName, email: primary.emailAddress } : null,
      requestStatus: null,
      listType: null,
      costAmount: null,
      costCurrency: null,
      priority: county.targetPriority,
      emailSentAt: null,
      responseReceivedAt: null,
      updatedAt: county.createdAt.toISOString(),
      daysInStage: daysBetween(county.createdAt, now),
      daysSinceSent: null,
      dataProcessed: false,
      listFileReceived: false,
      hasActiveResearchRun: activeResearchCountyIds.has(county.id),
    });
  }

  return PIPELINE_STAGES.map((s) => {
    const stageCards = cards
      .filter((c) => c.stage === s.key)
      .sort((a, b) => b.daysInStage - a.daysInStage);
    return { key: s.key, label: s.label, count: stageCards.length, cards: stageCards };
  });
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

const TERMINAL_INACTIVE_STATUSES = new Set(['not_available', 'declined']);

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const [countyCountResult, rows] = await Promise.all([
    db.select({ count: count() }).from(counties),
    db
      .select({
        requestStatus: listRequests.requestStatus,
        emailSentAt: listRequests.emailSentAt,
        responseReceivedAt: listRequests.responseReceivedAt,
        dataProcessed: listRequests.dataProcessed,
        costAmount: listRequests.costAmount,
        paymentStatus: listRequests.paymentStatus,
      })
      .from(listRequests),
  ]);

  const totalListRequests = rows.length;
  const sentRows = rows.filter((r) => r.emailSentAt !== null);
  const totalSent = sentRows.length;
  const respondedRows = rows.filter((r) => r.emailSentAt !== null && r.responseReceivedAt !== null);
  const responseRate = totalSent > 0 ? Math.round((respondedRows.length / totalSent) * 1000) / 10 : 0;

  const avgResponseTimeDays =
    respondedRows.length > 0
      ? Math.round(
          (respondedRows.reduce(
            (sum, r) => sum + (r.responseReceivedAt!.getTime() - r.emailSentAt!.getTime()) / 86_400_000,
            0
          ) /
            respondedRows.length) *
            10
        ) / 10
      : null;

  const activeRequests = rows.filter(
    (r) => !r.dataProcessed && !TERMINAL_INACTIVE_STATUSES.has(r.requestStatus ?? 'not_started')
  ).length;
  const processedLists = rows.filter((r) => r.dataProcessed).length;

  let totalQuoted = 0;
  let totalPaid = 0;
  let totalAll = 0;
  for (const r of rows) {
    const amount = r.costAmount ? Number(r.costAmount) : 0;
    if (!amount) continue;
    totalAll += amount;
    if (r.paymentStatus === 'requested') totalQuoted += amount;
    if (r.paymentStatus === 'paid' || r.paymentStatus === 'fulfilled') totalPaid += amount;
  }

  return {
    totalCounties: countyCountResult[0]?.count ?? 0,
    totalListRequests,
    totalSent,
    responseRate,
    avgResponseTimeDays,
    activeRequests,
    processedLists,
    cost: {
      currency: 'USD',
      totalQuoted: Math.round(totalQuoted * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalAll: Math.round(totalAll * 100) / 100,
    },
  };
}

export type PipelineStatusInput = NonNullable<ListRequest['requestStatus']> | 'data_processed';

export interface ApplyStatusChangeResult {
  listRequest: ListRequest;
  previousStatus: ListRequest['requestStatus'];
}

// Shared by the single-request and bulk status endpoints: writes the new
// status (or, for the data_processed pseudo-status, the dataProcessed
// flag), and leaves the same audit trail (status history + event row) the
// response-classification review flow already relies on.
export async function applyPipelineStatusChange(
  listRequestId: number,
  input: { status: PipelineStatusInput; reason?: string | null; sourceLabel?: string }
): Promise<ApplyStatusChangeResult | null> {
  const request = await db.query.listRequests.findFirst({ where: eq(listRequests.id, listRequestId) });
  if (!request) return null;

  const { status, reason, sourceLabel = 'pipeline_dashboard' } = input;
  const previousStatus = request.requestStatus;

  if (status === 'data_processed') {
    const [updated] = await db
      .update(listRequests)
      .set({ dataProcessed: true, updatedAt: new Date() })
      .where(eq(listRequests.id, listRequestId))
      .returning();

    await db.insert(listRequestEvents).values({
      listRequestId,
      eventType: 'data_processed',
      summary: reason?.trim() || 'Marked as data processed from pipeline dashboard',
      body: reason || null,
      metadata: { previousStatus, source: sourceLabel },
    });

    return { listRequest: updated, previousStatus };
  }

  const [updated] = await db
    .update(listRequests)
    .set({ requestStatus: status, updatedAt: new Date() })
    .where(eq(listRequests.id, listRequestId))
    .returning();

  if (previousStatus !== status) {
    await db.insert(listRequestStatusHistory).values({
      listRequestId,
      fromStatus: previousStatus,
      toStatus: status,
      reason: reason || `Moved to "${status}" from pipeline dashboard`,
      sourceLabel,
    });

    await db.insert(listRequestEvents).values({
      listRequestId,
      eventType: 'status_changed',
      summary: `Status changed from "${previousStatus ?? 'not_started'}" to "${status}"`,
      body: reason || null,
      metadata: { previousStatus, newStatus: status, source: sourceLabel },
    });
  }

  return { listRequest: updated, previousStatus };
}
