import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db.js';
import {
  listRequests,
  listRequestEvents,
  type ListRequest,
} from '../../shared/schema.js';

// ============================================================
// Budget Tracking & Reporting (card 15)
//
// Every report here is derived, read-only, aggregation over
// list_requests (+ its county/state/official context) — there is no
// separate "budget" table. Like pipelineService.ts and dashboard metrics
// before it, aggregation happens in JS over a single fetched set of rows
// rather than several bespoke groupBy SQL queries, so all the reports stay
// trivially consistent with each other and with the dashboard's own cost
// widgets.
// ============================================================

const PAID_STATUSES = new Set(['paid', 'fulfilled']);

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

function amountOf(value: string | null): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface RequestWithContext extends ListRequest {
  taxOfficial: {
    fullName: string;
    county: {
      id: number;
      name: string;
      state: { id: number; abbreviation: string; name: string };
    };
  };
}

async function fetchAllRequests(): Promise<RequestWithContext[]> {
  const rows = await db.query.listRequests.findMany({
    with: {
      taxOfficial: {
        with: { county: { with: { state: true } } },
      },
    },
  });
  return rows as RequestWithContext[];
}

// ------------------------------------------------------------
// GET /api/reports/costs
// ------------------------------------------------------------

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

export async function getCostSummary(): Promise<CostSummaryReport> {
  const rows = await fetchAllRequests();

  let totalSpending = 0;
  let totalQuotesPending = 0;
  let totalPaid = 0;
  let totalFulfilled = 0;
  let paidListCount = 0;
  let fulfilledListCount = 0;
  let pendingQuoteCount = 0;

  const listTypeBreakdown: ListTypeBreakdown = { free: 0, paid: 0, not_available: 0, unknown: 0 };
  const basisMap = new Map<string, { count: number; totalAmount: number }>();

  for (const r of rows) {
    const listTypeKey = (r.listType ?? 'unknown') as keyof ListTypeBreakdown;
    if (listTypeKey in listTypeBreakdown) listTypeBreakdown[listTypeKey]++;

    const amount = amountOf(r.costAmount);

    if (r.paymentStatus === 'paid') {
      totalPaid += amount;
      paidListCount++;
    } else if (r.paymentStatus === 'fulfilled') {
      totalFulfilled += amount;
      fulfilledListCount++;
    } else if (r.paymentStatus === 'requested') {
      totalQuotesPending += amount;
      pendingQuoteCount++;
    }
    if (PAID_STATUSES.has(r.paymentStatus ?? '')) totalSpending += amount;

    if (amount > 0) {
      const basisKey = r.pricingBasis ?? 'unknown';
      const entry = basisMap.get(basisKey) ?? { count: 0, totalAmount: 0 };
      entry.count++;
      entry.totalAmount += amount;
      basisMap.set(basisKey, entry);
    }
  }

  const paidOrFulfilledCount = paidListCount + fulfilledListCount;

  return {
    currency: 'USD',
    totalListCount: rows.length,
    totalSpending: round2(totalSpending),
    totalQuotesPending: round2(totalQuotesPending),
    totalPaid: round2(totalPaid),
    totalFulfilled: round2(totalFulfilled),
    paidListCount,
    fulfilledListCount,
    pendingQuoteCount,
    averageCostPerPaidList: paidOrFulfilledCount > 0 ? round2(totalSpending / paidOrFulfilledCount) : null,
    listTypeBreakdown,
    pricingBasisBreakdown: Array.from(basisMap.entries())
      .map(([basis, v]) => ({ basis, count: v.count, totalAmount: round2(v.totalAmount) }))
      .sort((a, b) => b.totalAmount - a.totalAmount),
  };
}

// ------------------------------------------------------------
// GET /api/reports/by-state
// ------------------------------------------------------------

export interface CostByStateEntry {
  stateId: number;
  stateAbbreviation: string;
  stateName: string;
  listCount: number;
  totalSpend: number;
  totalQuoted: number;
  paidCount: number;
}

export async function getCostByState(): Promise<CostByStateEntry[]> {
  const rows = await fetchAllRequests();
  const byState = new Map<number, CostByStateEntry>();

  for (const r of rows) {
    const state = r.taxOfficial.county.state;
    const entry = byState.get(state.id) ?? {
      stateId: state.id,
      stateAbbreviation: state.abbreviation,
      stateName: state.name,
      listCount: 0,
      totalSpend: 0,
      totalQuoted: 0,
      paidCount: 0,
    };
    entry.listCount++;
    const amount = amountOf(r.costAmount);
    if (PAID_STATUSES.has(r.paymentStatus ?? '')) {
      entry.totalSpend += amount;
      entry.paidCount++;
    } else if (r.paymentStatus === 'requested') {
      entry.totalQuoted += amount;
    }
    byState.set(state.id, entry);
  }

  return Array.from(byState.values())
    .map((e) => ({ ...e, totalSpend: round2(e.totalSpend), totalQuoted: round2(e.totalQuoted) }))
    .sort((a, b) => b.totalSpend - a.totalSpend);
}

// ------------------------------------------------------------
// GET /api/reports/by-county
// ------------------------------------------------------------

export interface CostByCountyEntry {
  requestId: number;
  countyId: number;
  countyName: string;
  stateAbbreviation: string;
  stateName: string;
  officialName: string;
  requestStatus: ListRequest['requestStatus'];
  listType: ListRequest['listType'];
  pricingBasis: ListRequest['pricingBasis'];
  costAmount: number | null;
  currency: string;
  paymentStatus: ListRequest['paymentStatus'];
  paymentDate: string | null;
  paymentMethod: string | null;
  invoiceNumber: string | null;
  paymentReference: string | null;
  listFileReceived: boolean;
}

function toCostByCountyEntry(r: RequestWithContext): CostByCountyEntry {
  const county = r.taxOfficial.county;
  return {
    requestId: r.id,
    countyId: county.id,
    countyName: county.name,
    stateAbbreviation: county.state.abbreviation,
    stateName: county.state.name,
    officialName: r.taxOfficial.fullName,
    requestStatus: r.requestStatus,
    listType: r.listType,
    pricingBasis: r.pricingBasis,
    costAmount: r.costAmount !== null ? amountOf(r.costAmount) : null,
    currency: r.costCurrency ?? 'USD',
    paymentStatus: r.paymentStatus,
    paymentDate: r.paymentDate ? r.paymentDate.toISOString() : null,
    paymentMethod: r.paymentMethod,
    invoiceNumber: r.invoiceNumber,
    paymentReference: r.paymentReference,
    listFileReceived: Boolean(r.listFileReceived),
  };
}

export async function getCostByCounty(): Promise<CostByCountyEntry[]> {
  const rows = await fetchAllRequests();
  return rows
    .map(toCostByCountyEntry)
    .sort((a, b) => a.stateAbbreviation.localeCompare(b.stateAbbreviation) || a.countyName.localeCompare(b.countyName));
}

// ------------------------------------------------------------
// GET /api/reports/pending-payments
// ------------------------------------------------------------

export interface PendingPaymentEntry {
  requestId: number;
  countyId: number;
  countyName: string;
  stateAbbreviation: string;
  officialName: string;
  costAmount: number | null;
  currency: string;
  paymentStatus: ListRequest['paymentStatus'];
  invoiceNumber: string | null;
  requestedAt: string;
  daysPending: number;
}

export async function getPendingPayments(): Promise<PendingPaymentEntry[]> {
  const now = new Date();
  const rows = await fetchAllRequests();
  const pending = rows.filter((r) => r.paymentStatus === 'requested');
  if (pending.length === 0) return [];

  const pendingIds = pending.map((r) => r.id);
  const events = await db.query.listRequestEvents.findMany({
    where: and(inArray(listRequestEvents.listRequestId, pendingIds), eq(listRequestEvents.eventType, 'payment_requested')),
    orderBy: desc(listRequestEvents.occurredAt),
  });
  const latestRequestedAt = new Map<number, Date>();
  for (const ev of events) {
    if (!latestRequestedAt.has(ev.listRequestId) && ev.occurredAt) {
      latestRequestedAt.set(ev.listRequestId, ev.occurredAt);
    }
  }

  return pending
    .map((r) => {
      const county = r.taxOfficial.county;
      const requestedAt = latestRequestedAt.get(r.id) ?? r.updatedAt;
      return {
        requestId: r.id,
        countyId: county.id,
        countyName: county.name,
        stateAbbreviation: county.state.abbreviation,
        officialName: r.taxOfficial.fullName,
        costAmount: r.costAmount !== null ? amountOf(r.costAmount) : null,
        currency: r.costCurrency ?? 'USD',
        paymentStatus: r.paymentStatus,
        invoiceNumber: r.invoiceNumber,
        requestedAt: requestedAt.toISOString(),
        daysPending: daysBetween(requestedAt, now),
      };
    })
    .sort((a, b) => b.daysPending - a.daysPending);
}

// ------------------------------------------------------------
// GET /api/reports/paid-unfulfilled
// ------------------------------------------------------------

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
  requestStatus: ListRequest['requestStatus'];
}

export async function getPaidUnfulfilled(): Promise<PaidUnfulfilledEntry[]> {
  const now = new Date();
  const rows = await fetchAllRequests();

  return rows
    .filter((r) => r.paymentStatus === 'paid' && !r.listFileReceived)
    .map((r) => {
      const county = r.taxOfficial.county;
      return {
        requestId: r.id,
        countyId: county.id,
        countyName: county.name,
        stateAbbreviation: county.state.abbreviation,
        officialName: r.taxOfficial.fullName,
        costAmount: r.costAmount !== null ? amountOf(r.costAmount) : null,
        currency: r.costCurrency ?? 'USD',
        paymentDate: r.paymentDate ? r.paymentDate.toISOString() : null,
        daysSincePaid: r.paymentDate ? daysBetween(r.paymentDate, now) : null,
        requestStatus: r.requestStatus,
      };
    })
    .sort((a, b) => (b.daysSincePaid ?? 0) - (a.daysSincePaid ?? 0));
}

// ------------------------------------------------------------
// GET /api/reports/export-csv
// ------------------------------------------------------------

const CSV_COLUMNS = [
  'state',
  'county',
  'official',
  'request_status',
  'list_type',
  'pricing_basis',
  'cost_amount',
  'currency',
  'payment_status',
  'payment_date',
  'payment_method',
  'invoice_number',
  'payment_reference',
  'list_file_received',
] as const;

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildCostSummaryCsv(rows: CostByCountyEntry[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    const values = [
      r.stateAbbreviation,
      r.countyName,
      r.officialName,
      r.requestStatus ?? '',
      r.listType ?? '',
      r.pricingBasis ?? '',
      r.costAmount !== null ? r.costAmount.toFixed(2) : '',
      r.currency,
      r.paymentStatus ?? '',
      r.paymentDate ?? '',
      r.paymentMethod ?? '',
      r.invoiceNumber ?? '',
      r.paymentReference ?? '',
      r.listFileReceived ? 'yes' : 'no',
    ];
    lines.push(values.map((v) => csvEscape(String(v))).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

// ------------------------------------------------------------
// PATCH /api/list-requests/:id/payment
// ------------------------------------------------------------

export interface UpdatePaymentInput {
  paymentStatus?: NonNullable<ListRequest['paymentStatus']>;
  costAmount?: number | null;
  pricingBasis?: ListRequest['pricingBasis'];
  paymentDate?: Date | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  invoiceNumber?: string | null;
  costNotes?: string | null;
}

function paymentEventType(status: NonNullable<ListRequest['paymentStatus']>): (typeof listRequestEvents.$inferInsert)['eventType'] {
  if (status === 'paid' || status === 'fulfilled') return 'payment_made';
  if (status === 'requested') return 'payment_requested';
  return 'other';
}

export async function updateListRequestPayment(
  id: number,
  input: UpdatePaymentInput
): Promise<ListRequest | null> {
  const existing = await db.query.listRequests.findFirst({ where: eq(listRequests.id, id) });
  if (!existing) return null;

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (input.paymentStatus !== undefined) updateData.paymentStatus = input.paymentStatus;
  if (input.costAmount !== undefined) updateData.costAmount = input.costAmount === null ? null : String(input.costAmount);
  if (input.pricingBasis !== undefined) updateData.pricingBasis = input.pricingBasis;
  if (input.paymentDate !== undefined) updateData.paymentDate = input.paymentDate;
  if (input.paymentMethod !== undefined) updateData.paymentMethod = input.paymentMethod;
  if (input.paymentReference !== undefined) updateData.paymentReference = input.paymentReference;
  if (input.invoiceNumber !== undefined) updateData.invoiceNumber = input.invoiceNumber;
  if (input.costNotes !== undefined) updateData.costNotes = input.costNotes;

  const [updated] = await db.update(listRequests).set(updateData).where(eq(listRequests.id, id)).returning();

  if (input.paymentStatus !== undefined && input.paymentStatus !== existing.paymentStatus) {
    await db.insert(listRequestEvents).values({
      listRequestId: id,
      eventType: paymentEventType(input.paymentStatus),
      summary: `Payment status changed from "${existing.paymentStatus ?? 'not_required'}" to "${input.paymentStatus}"`,
      metadata: {
        previousStatus: existing.paymentStatus,
        newStatus: input.paymentStatus,
        costAmount: updateData.costAmount ?? existing.costAmount,
        paymentMethod: input.paymentMethod ?? existing.paymentMethod,
        invoiceNumber: input.invoiceNumber ?? existing.invoiceNumber,
        source: 'budget_reports',
      },
    });
  }

  return updated;
}
