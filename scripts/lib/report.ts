import { count, isNotNull, sql } from 'drizzle-orm';
import { db as appDbValue } from '../../server/db.js';
import { counties, listRequests, taxOfficials } from '../../shared/schema.js';
import type { ImportReport } from './import-runner.js';

type AppDb = typeof appDbValue;

const EXPECTED_STATE_ABBREVIATIONS = ['SD', 'WY', 'ID', 'NM', 'AR', 'SC', 'NC', 'VT'];

export function printImportReport(report: ImportReport): void {
  const lines: string[] = [];
  lines.push('');
  lines.push('='.repeat(60));
  lines.push(report.dryRun ? 'IMPORT REPORT (DRY RUN — no changes were persisted)' : 'IMPORT REPORT');
  lines.push('='.repeat(60));
  lines.push(`Rows in source:            ${report.totalRows}`);
  lines.push(`Rows skipped:              ${report.skippedRows.length}`);
  lines.push(`Warnings:                  ${report.warnings.length}`);
  lines.push('-'.repeat(60));
  lines.push(`States found (existing):   ${report.statesFound}`);
  lines.push(`States created:            ${report.statesCreated}`);
  lines.push(`Counties found (existing): ${report.countiesFound}`);
  lines.push(`Counties created:          ${report.countiesCreated}`);
  lines.push(`Officials created:         ${report.officialsCreated}`);
  lines.push(`Officials updated:         ${report.officialsUpdated}`);
  lines.push(`Official website URLs set: ${report.officialWebsiteUrlsSet}`);
  lines.push(`List requests created:     ${report.listRequestsCreated}`);
  lines.push(`List requests updated:     ${report.listRequestsUpdated}`);
  lines.push(`Cost amounts parsed:       ${report.costParsedCount}`);
  lines.push(`Price rows created:        ${report.pricesCreated}  (skipped as already existing: ${report.pricesSkippedExisting})`);
  lines.push(`Events created:            ${report.eventsCreated}  (skipped as already existing: ${report.eventsSkippedExisting})`);
  lines.push(`Status history created:    ${report.statusHistoryCreated}  (skipped as already existing: ${report.statusHistorySkippedExisting})`);
  lines.push(`Multi-contact counties:    ${report.multiContactCounties.length}`);
  if (report.multiContactCounties.length > 0) {
    for (const c of report.multiContactCounties) lines.push(`  - ${c}`);
  }
  if (report.costParsedExamples.length > 0) {
    lines.push('Cost parsing examples:');
    for (const c of report.costParsedExamples) {
      lines.push(`  - ${c.stateAbbreviation}/${c.countyName}: $${c.costAmount.toFixed(2)} (${c.costNotes ?? ''})`);
    }
  }
  if (report.skippedRows.length > 0) {
    lines.push('Skipped rows:');
    for (const s of report.skippedRows) lines.push(`  - row ${s.rowNumber}: ${s.reason}`);
  }
  if (report.warnings.length > 0) {
    lines.push('Warnings:');
    for (const w of report.warnings) lines.push(`  - row ${w.rowNumber}: ${w.message}`);
  }
  lines.push('='.repeat(60));
  console.log(lines.join('\n'));
}

/**
 * Verification pass, independent of any single import run — queries the
 * database's current state and compares it against the expectations
 * documented in cards/02-import-existing-data.md. Safe to run at any
 * time (read-only); does not require a source to be configured.
 */
export async function printVerificationReport(db: AppDb): Promise<void> {
  const [countyRows, officialsTotal, listRequestsTotal, multiContactCounties, costParsedRequests] =
    await Promise.all([
      db.query.counties.findMany({ columns: { id: true, stateId: true, name: true } }),
      db.select({ count: count() }).from(taxOfficials),
      db.select({ count: count() }).from(listRequests),
      db
        .select({ countyId: taxOfficials.countyId, officialCount: count() })
        .from(taxOfficials)
        .groupBy(taxOfficials.countyId)
        .having(sql`count(*) > 1`),
      db.query.listRequests.findMany({
        where: isNotNull(listRequests.costAmount),
        columns: { id: true, costAmount: true, costNotes: true },
      }),
    ]);

  const distinctStateIds = new Set(countyRows.map((c) => c.stateId));
  const states = await db.query.states.findMany({
    where: (statesTable, { inArray }) => inArray(statesTable.id, [...distinctStateIds]),
    columns: { abbreviation: true },
  });
  const touchedAbbreviations = states.map((s) => s.abbreviation).sort();
  const expectedMissing = EXPECTED_STATE_ABBREVIATIONS.filter((a) => !touchedAbbreviations.includes(a));
  const unexpectedExtra = touchedAbbreviations.filter((a) => !EXPECTED_STATE_ABBREVIATIONS.includes(a));

  const lines: string[] = [];
  lines.push('');
  lines.push('='.repeat(60));
  lines.push('VERIFICATION REPORT (current database state)');
  lines.push('='.repeat(60));
  lines.push(`Counties in DB:            ${countyRows.length}  (card expects ~20)`);
  lines.push(
    `States touched by counties: ${touchedAbbreviations.length}  [${touchedAbbreviations.join(', ') || 'none'}]  (card expects 8: ${EXPECTED_STATE_ABBREVIATIONS.join(', ')})`
  );
  if (expectedMissing.length > 0) lines.push(`  Missing expected states:  ${expectedMissing.join(', ')}`);
  if (unexpectedExtra.length > 0) lines.push(`  Unexpected extra states:  ${unexpectedExtra.join(', ')}`);
  lines.push(`Tax officials (contacts): ${officialsTotal[0]?.count ?? 0}`);
  lines.push(`List requests:             ${listRequestsTotal[0]?.count ?? 0}`);
  lines.push(`Multi-contact counties:    ${multiContactCounties.length}`);
  lines.push(`List requests with cost parsed: ${costParsedRequests.length}  (card expects $75 and $269 examples)`);
  for (const r of costParsedRequests) {
    lines.push(`  - list_request #${r.id}: $${r.costAmount} — ${r.costNotes ?? ''}`);
  }
  lines.push('='.repeat(60));
  console.log(lines.join('\n'));
}
