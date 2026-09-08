import { and, eq, ilike } from 'drizzle-orm';
import { db as appDbValue } from '../../server/db.js';
import {
  counties,
  listRequestEvents,
  listRequestPrices,
  listRequestStatusHistory,
  listRequests,
  seedStates,
  states,
  taxOfficials,
} from '../../shared/schema.js';
import { omitUndefined } from './clean.js';
import { parseRow, type ParsedRow, type RequestStatus } from './parse-row.js';
import type { RawImportRow } from './sources.js';

type AppDb = typeof appDbValue;
type Tx = Parameters<Parameters<AppDb['transaction']>[0]>[0];

export interface ImportReport {
  dryRun: boolean;
  totalRows: number;
  skippedRows: { rowNumber: number; reason: string }[];
  warnings: { rowNumber: number; message: string }[];
  statesFound: number;
  statesCreated: number;
  countiesFound: number;
  countiesCreated: number;
  officialsCreated: number;
  officialsUpdated: number;
  officialWebsiteUrlsSet: number;
  listRequestsCreated: number;
  listRequestsUpdated: number;
  costParsedCount: number;
  costParsedExamples: { countyName: string; stateAbbreviation: string; costAmount: number; costNotes?: string }[];
  pricesCreated: number;
  pricesSkippedExisting: number;
  eventsCreated: number;
  eventsSkippedExisting: number;
  statusHistoryCreated: number;
  statusHistorySkippedExisting: number;
  multiContactCounties: string[];
}

function emptyReport(dryRun: boolean, totalRows: number): ImportReport {
  return {
    dryRun,
    totalRows,
    skippedRows: [],
    warnings: [],
    statesFound: 0,
    statesCreated: 0,
    countiesFound: 0,
    countiesCreated: 0,
    officialsCreated: 0,
    officialsUpdated: 0,
    officialWebsiteUrlsSet: 0,
    listRequestsCreated: 0,
    listRequestsUpdated: 0,
    costParsedCount: 0,
    costParsedExamples: [],
    pricesCreated: 0,
    pricesSkippedExisting: 0,
    eventsCreated: 0,
    eventsSkippedExisting: 0,
    statusHistoryCreated: 0,
    statusHistorySkippedExisting: 0,
    multiContactCounties: [],
  };
}

/** Thrown at the end of a dry-run transaction to force a rollback while still returning results. */
class DryRunRollback extends Error {}

async function upsertState(tx: Tx, abbreviation: string, report: ImportReport): Promise<number | null> {
  const existing = await tx.query.states.findFirst({ where: eq(states.abbreviation, abbreviation) });
  if (existing) {
    report.statesFound++;
    return existing.id;
  }

  const seedMatch = seedStates.find((s) => s.abbreviation === abbreviation);
  if (!seedMatch) {
    return null;
  }

  const [created] = await tx.insert(states).values(seedMatch).returning();
  report.statesCreated++;
  return created.id;
}

async function upsertCounty(
  tx: Tx,
  stateId: number,
  countyName: string,
  report: ImportReport
): Promise<number> {
  const existing = await tx.query.counties.findFirst({
    where: and(eq(counties.stateId, stateId), eq(counties.name, countyName)),
  });
  if (existing) {
    report.countiesFound++;
    return existing.id;
  }

  const [created] = await tx.insert(counties).values({ stateId, name: countyName }).returning();
  report.countiesCreated++;
  return created.id;
}

async function upsertOfficial(
  tx: Tx,
  countyId: number,
  row: ParsedRow,
  isPrimary: boolean,
  report: ImportReport
): Promise<number> {
  const existing = await tx.query.taxOfficials.findFirst({
    where: and(eq(taxOfficials.countyId, countyId), ilike(taxOfficials.fullName, row.fullName)),
  });

  // Never overwrite an existing non-null website URL with null — only ever
  // include the key when we actually have a value to set.
  const websiteUrlPatch = row.websiteUrl ? { websiteUrl: row.websiteUrl } : {};

  const values = omitUndefined({
    title: row.title,
    phoneNumber: row.phoneNumber,
    emailAddress: row.emailAddress,
    isPrimary,
    ...websiteUrlPatch,
  });

  if (row.websiteUrl) report.officialWebsiteUrlsSet++;

  if (existing) {
    await tx.update(taxOfficials).set(values).where(eq(taxOfficials.id, existing.id));
    report.officialsUpdated++;
    return existing.id;
  }

  const [created] = await tx
    .insert(taxOfficials)
    .values({ countyId, fullName: row.fullName, ...values })
    .returning();
  report.officialsCreated++;
  return created.id;
}

/**
 * Idempotent on rerun: matches an existing price row by its exact raw
 * source text (the original "$X <basis-label>" or legacy free-text cost
 * phrase) for this list request, and skips inserting a duplicate.
 */
async function upsertPrice(tx: Tx, listRequestId: number, price: ParsedRow['price'], report: ImportReport): Promise<void> {
  if (!price) return;

  const existingRows = await tx.query.listRequestPrices.findMany({
    where: eq(listRequestPrices.listRequestId, listRequestId),
  });
  const alreadyExists = existingRows.some((r) => r.rawText === price.rawText);
  if (alreadyExists) {
    report.pricesSkippedExisting++;
    return;
  }

  await tx.insert(listRequestPrices).values({
    listRequestId,
    basis: price.basis,
    unitAmount: price.unitAmount != null ? price.unitAmount.toFixed(2) : undefined,
    quantity: price.quantity != null ? price.quantity.toFixed(2) : undefined,
    quantityUnit: price.quantityUnit,
    totalAmount: price.totalAmount != null ? price.totalAmount.toFixed(2) : undefined,
    rawText: price.rawText,
    sourceLabel: price.sourceLabel,
  });
  report.pricesCreated++;
}

/**
 * Idempotent on rerun: only records a transition when there's an actual raw
 * source label describing it, and skips if a history row with the same
 * (toStatus, sourceLabel) already exists for this list request.
 */
async function recordStatusHistory(
  tx: Tx,
  listRequestId: number,
  fromStatus: RequestStatus | null,
  toStatus: RequestStatus,
  sourceLabel: string | null,
  report: ImportReport
): Promise<void> {
  if (!sourceLabel) return;

  const existingRows = await tx.query.listRequestStatusHistory.findMany({
    where: eq(listRequestStatusHistory.listRequestId, listRequestId),
  });
  const alreadyExists = existingRows.some((r) => r.toStatus === toStatus && r.sourceLabel === sourceLabel);
  if (alreadyExists) {
    report.statusHistorySkippedExisting++;
    return;
  }

  await tx.insert(listRequestStatusHistory).values({
    listRequestId,
    fromStatus: fromStatus ?? undefined,
    toStatus,
    sourceLabel,
  });
  report.statusHistoryCreated++;
}

/**
 * Idempotent on rerun: dedupes by (sourceRow, field) stashed in `metadata`,
 * since no DB-level unique constraint exists for this app-level import.
 */
async function upsertEvents(tx: Tx, listRequestId: number, row: ParsedRow, report: ImportReport): Promise<void> {
  if (row.events.length === 0) return;

  const existingRows = await tx.query.listRequestEvents.findMany({
    where: eq(listRequestEvents.listRequestId, listRequestId),
  });
  const existingKeys = new Set(
    existingRows
      .map((r) => r.metadata as { sourceRow?: number; field?: string } | null)
      .filter((m): m is { sourceRow: number; field: string } => Boolean(m?.sourceRow != null && m?.field))
      .map((m) => `${m.sourceRow}::${m.field}`)
  );

  for (const event of row.events) {
    const key = `${row.rowNumber}::${event.field}`;
    if (existingKeys.has(key)) {
      report.eventsSkippedExisting++;
      continue;
    }

    await tx.insert(listRequestEvents).values({
      listRequestId,
      eventType: event.eventType,
      channel: event.channel,
      summary: event.summary,
      body: event.body,
      metadata: { sourceRow: row.rowNumber, field: event.field },
    });
    report.eventsCreated++;
  }
}

async function upsertListRequest(tx: Tx, officialId: number, row: ParsedRow, report: ImportReport): Promise<void> {
  const existing = await tx.query.listRequests.findFirst({
    where: eq(listRequests.taxOfficialId, officialId),
  });

  const price = row.price;
  const values = omitUndefined({
    requestStatus: row.requestStatus,
    listType: price ? ('paid' as const) : undefined,
    costAmount: price ? (price.totalAmount ?? price.unitAmount)?.toFixed(2) : undefined,
    costNotes: price?.rawText,
    pricingBasis: price?.basis,
    costQuantity: price?.quantity != null ? price.quantity.toFixed(2) : undefined,
    costQuantityUnit: price?.quantityUnit,
    sourceLabel: row.rawListStatus ?? undefined,
    rawListStatus: row.rawListStatus ?? undefined,
    dataProcessed: row.dataProcessed,
    notes: row.notes ?? undefined,
    fullResponseText: row.fullResponseText ?? undefined,
  });

  let listRequestId: number;
  let previousStatus: RequestStatus | null = null;

  if (existing) {
    previousStatus = existing.requestStatus;
    await tx
      .update(listRequests)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(listRequests.id, existing.id));
    report.listRequestsUpdated++;
    listRequestId = existing.id;
  } else {
    const [created] = await tx.insert(listRequests).values({ taxOfficialId: officialId, ...values }).returning();
    report.listRequestsCreated++;
    listRequestId = created.id;
  }

  if (price != null) {
    report.costParsedCount++;
    await upsertPrice(tx, listRequestId, price, report);
  }

  await recordStatusHistory(tx, listRequestId, previousStatus, row.requestStatus, row.rawListStatus, report);
  await upsertEvents(tx, listRequestId, row, report);
}

async function runImportBody(tx: Tx, usableRows: ParsedRow[], report: ImportReport): Promise<void> {
  const groups = new Map<string, ParsedRow[]>();
  for (const row of usableRows) {
    const key = `${row.stateAbbreviation}::${row.countyName!.toLowerCase()}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const stateIdCache = new Map<string, number | null>();

  for (const groupRows of groups.values()) {
    const first = groupRows[0];
    const stateAbbreviation = first.stateAbbreviation!;
    const countyName = first.countyName!;

    let stateId = stateIdCache.get(stateAbbreviation);
    if (stateId === undefined) {
      stateId = await upsertState(tx, stateAbbreviation, report);
      stateIdCache.set(stateAbbreviation, stateId);
    }

    if (stateId === null) {
      for (const row of groupRows) {
        report.skippedRows.push({
          rowNumber: row.rowNumber,
          reason: `Unknown state abbreviation "${stateAbbreviation}" (not in seed data)`,
        });
      }
      continue;
    }

    const countyId = await upsertCounty(tx, stateId, countyName, report);

    if (groupRows.length > 1) {
      report.multiContactCounties.push(`${stateAbbreviation}/${countyName}`);
    }

    const primaryIndex = groupRows.findIndex((r) => r.emailAddress);
    const primaryIdx = primaryIndex === -1 ? 0 : primaryIndex;

    for (let i = 0; i < groupRows.length; i++) {
      const row = groupRows[i];
      const officialId = await upsertOfficial(tx, countyId, row, i === primaryIdx, report);
      await upsertListRequest(tx, officialId, row, report);

      if (row.price?.unitAmount != null) {
        report.costParsedExamples.push({
          countyName,
          stateAbbreviation,
          costAmount: row.price.totalAmount ?? row.price.unitAmount,
          costNotes: row.price.rawText,
        });
      }
    }
  }
}

export async function runImport(
  db: AppDb,
  rawRows: RawImportRow[],
  options: { dryRun: boolean }
): Promise<ImportReport> {
  const parsedRows = rawRows.map(parseRow);
  const report = emptyReport(options.dryRun, rawRows.length);

  for (const row of parsedRows) {
    for (const warning of row.warnings) {
      report.warnings.push({ rowNumber: row.rowNumber, message: warning });
    }
    if (row.skip) {
      report.skippedRows.push({ rowNumber: row.rowNumber, reason: row.skipReason! });
    }
  }

  const usableRows = parsedRows.filter((r) => !r.skip);

  if (options.dryRun) {
    try {
      await db.transaction(async (tx) => {
        await runImportBody(tx, usableRows, report);
        throw new DryRunRollback('dry-run: rolling back');
      });
    } catch (err) {
      if (!(err instanceof DryRunRollback)) throw err;
    }
  } else {
    await db.transaction((tx) => runImportBody(tx, usableRows, report));
  }

  return report;
}
