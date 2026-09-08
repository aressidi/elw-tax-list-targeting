/**
 * One-time import of the "County Treasurer Target List" source data.
 * See cards/02-import-existing-data.md for the full spec and
 * scripts/README.md for usage, the source-adapter contract, and the
 * external prerequisite for a live Google Sheets import.
 *
 * Usage:
 *   tsx scripts/import-existing-data.ts --source=csv --file=<path> [--dry-run]
 *   tsx scripts/import-existing-data.ts --source=google-sheets [--dry-run]
 *   tsx scripts/import-existing-data.ts --verify
 *   tsx scripts/import-existing-data.ts --help
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, pool } from '../server/db.js';
import { CsvFileSource, GoogleSheetsSource, type ImportSource } from './lib/sources.js';
import { runImport } from './lib/import-runner.js';
import { printImportReport, printVerificationReport } from './lib/report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures',
  'county-treasurer-target-list.sample.csv'
);

type CliOptions = Record<string, string | boolean>;

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eqIdx = body.indexOf('=');
    if (eqIdx === -1) opts[body] = true;
    else opts[body.slice(0, eqIdx)] = body.slice(eqIdx + 1);
  }
  return opts;
}

function printUsage(): void {
  console.log(`
Import the County Treasurer Target List into the database.

  --source=csv|google-sheets   Where to read rows from (default: csv)
  --file=<path>                CSV file path (default: bundled sample fixture)
  --sheet-id=<id>               Override the Google Sheet ID
  --tab=<name>                  Override the Google Sheet tab name
  --dry-run                     Run the full import inside a transaction that is
                                 always rolled back — reports what WOULD happen
                                 without persisting anything.
  --verify                      Skip the import; just print a verification report
                                 of the database's current state.
  --help                        Show this message.

Examples:
  tsx scripts/import-existing-data.ts --source=csv --file=scripts/fixtures/county-treasurer-target-list.sample.csv --dry-run
  tsx scripts/import-existing-data.ts --source=csv --file=./real-export.csv
  tsx scripts/import-existing-data.ts --source=google-sheets --dry-run
  tsx scripts/import-existing-data.ts --verify
`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printUsage();
    return;
  }

  if (opts.verify) {
    await printVerificationReport(db);
    return;
  }

  const sourceType = typeof opts.source === 'string' ? opts.source : 'csv';
  const dryRun = Boolean(opts['dry-run']);

  let source: ImportSource;
  if (sourceType === 'csv') {
    const filePath = typeof opts.file === 'string' ? opts.file : DEFAULT_FIXTURE_PATH;
    if (typeof opts.file !== 'string') {
      console.warn(
        '⚠️  No --file provided — using the bundled SAMPLE fixture. This is synthetic test data,\n' +
          '   not the real "County Treasurer Target List" spreadsheet. Pass --file=<path-to-real-export>\n' +
          '   for an actual import. See scripts/README.md.'
      );
    }
    source = new CsvFileSource(filePath);
  } else if (sourceType === 'google-sheets') {
    source = new GoogleSheetsSource({
      sheetId: typeof opts['sheet-id'] === 'string' ? opts['sheet-id'] : undefined,
      tabName: typeof opts.tab === 'string' ? opts.tab : undefined,
    });
  } else {
    console.error(`Unknown --source "${sourceType}". Expected "csv" or "google-sheets".`);
    process.exitCode = 1;
    return;
  }

  console.log(`Source: ${source.describe()}`);
  console.log(dryRun ? 'Mode:   DRY RUN (no changes will be persisted)' : 'Mode:   LIVE (changes will be written)');

  let rows;
  try {
    rows = await source.fetchRows();
  } catch (err) {
    console.error('\nFailed to load source rows — this is likely the external prerequisite blocker:\n');
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }
  console.log(`Loaded ${rows.length} data row(s).`);

  const report = await runImport(db, rows, { dryRun });
  printImportReport(report);

  if (!dryRun) {
    console.log('\nRunning post-import verification...');
    await printVerificationReport(db);
  }
}

main()
  .catch((err) => {
    console.error('\nImport failed with an unexpected error:');
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
