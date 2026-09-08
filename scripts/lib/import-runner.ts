import { and, eq, ilike } from 'drizzle-orm';
import { db as appDbValue } from '../../server/db.js';
import { counties, listRequests, seedStates, states, taxOfficials } from '../../shared/schema.js';
import { omitUndefined } from './clean.js';
import { parseRow, type ParsedRow } from './parse-row.js';
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
  listRequestsCreated: number;
  listRequestsUpdated: number;
  costParsedCount: number;
  costParsedExamples: { countyName: string; stateAbbreviation: string; costAmount: number; costNotes?: string }[];
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
    listRequestsCreated: 0,
    listRequestsUpdated: 0,
    costParsedCount: 0,
    costParsedExamples: [],
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

  const values = omitUndefined({
    title: row.title,
    phoneNumber: row.phoneNumber,
    emailAddress: row.emailAddress,
    isPrimary,
  });

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

async function upsertListRequest(tx: Tx, officialId: number, row: ParsedRow, report: ImportReport): Promise<void> {
  const existing = await tx.query.listRequests.findFirst({
    where: eq(listRequests.taxOfficialId, officialId),
  });

  const values = omitUndefined({
    requestStatus: row.requestStatus,
    listType: row.listType,
    costAmount: row.costAmount != null ? row.costAmount.toFixed(2) : undefined,
    costNotes: row.costNotes,
    dataProcessed: row.dataProcessed,
    notes: row.notes ?? undefined,
    fullResponseText: row.fullResponseText ?? undefined,
  });

  if (existing) {
    await tx
      .update(listRequests)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(listRequests.id, existing.id));
    report.listRequestsUpdated++;
  } else {
    await tx.insert(listRequests).values({ taxOfficialId: officialId, ...values });
    report.listRequestsCreated++;
  }

  if (row.costAmount != null) {
    report.costParsedCount++;
  }
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

      if (row.costAmount != null) {
        report.costParsedExamples.push({
          countyName,
          stateAbbreviation,
          costAmount: row.costAmount,
          costNotes: row.costNotes,
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
