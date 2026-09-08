import { readFile } from 'node:fs/promises';
import { parseCsv } from './csv-parser.js';

/**
 * A single raw row from the source spreadsheet, mapped positionally to
 * columns A-L as documented in cards/02-import-existing-data.md.
 * All values are raw strings (trimmed of surrounding whitespace only) —
 * cleaning/parsing happens later in parse-row.ts.
 */
export interface RawImportRow {
  /** 1-based row number in the source, for error/warning reporting. */
  rowNumber: number;
  status: string; // A
  state: string; // B
  fullName: string; // C
  county: string; // D
  phoneNumber: string; // E
  emailAddress: string; // F
  countyAlt: string; // G (county appears twice in the source sheet)
  title: string; // H
  contactStatus: string; // I
  listStatus: string; // J
  notes: string; // K
  response: string; // L
}

/**
 * Source adapter contract. Any origin for the "County Treasurer Target
 * List" data (a CSV export, the live Google Sheet, a future different
 * spreadsheet tool, etc.) implements this so the import/cleaning/upsert
 * logic never needs to know where the rows came from.
 */
export interface ImportSource {
  describe(): string;
  fetchRows(): Promise<RawImportRow[]>;
}

const EXPECTED_HEADERS = [
  'status',
  'state',
  'full_name',
  'county',
  'phone_number',
  'email_address',
  'county_alt',
  'title',
  'contact_status',
  'list_status',
  'notes',
  'response',
];

function rowFromColumns(rowNumber: number, cols: string[]): RawImportRow {
  const get = (i: number) => (cols[i] ?? '').trim();
  return {
    rowNumber,
    status: get(0),
    state: get(1),
    fullName: get(2),
    county: get(3),
    phoneNumber: get(4),
    emailAddress: get(5),
    countyAlt: get(6),
    title: get(7),
    contactStatus: get(8),
    listStatus: get(9),
    notes: get(10),
    response: get(11),
  };
}

/**
 * Reads rows from a local CSV file. The file must have a header row
 * matching EXPECTED_HEADERS (column order mirrors sheet columns A-L).
 * This is the safe, offline path used when Google Sheets credentials
 * are not available — see scripts/README.md.
 */
export class CsvFileSource implements ImportSource {
  constructor(private filePath: string) {}

  describe(): string {
    return `CSV file: ${this.filePath}`;
  }

  async fetchRows(): Promise<RawImportRow[]> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf-8');
    } catch (err) {
      throw new Error(
        `Could not read CSV file "${this.filePath}": ${err instanceof Error ? err.message : err}`
      );
    }

    const table = parseCsv(content);
    if (table.length === 0) {
      throw new Error(`CSV file "${this.filePath}" is empty`);
    }

    const [header, ...dataRows] = table;
    const normalizedHeader = header.map((h) => h.trim().toLowerCase());
    const headersMatch =
      normalizedHeader.length === EXPECTED_HEADERS.length &&
      EXPECTED_HEADERS.every((h, idx) => normalizedHeader[idx] === h);

    if (!headersMatch) {
      throw new Error(
        [
          `CSV header in "${this.filePath}" does not match the expected column contract.`,
          `Expected: ${EXPECTED_HEADERS.join(',')}`,
          `Found:    ${normalizedHeader.join(',')}`,
        ].join('\n')
      );
    }

    return dataRows
      .filter((r) => r.some((cell) => cell.trim() !== ''))
      .map((cols, idx) => rowFromColumns(idx + 2, cols)); // +2: 1-based, skip header row
  }
}

export interface GoogleSheetsSourceOptions {
  sheetId?: string;
  tabName?: string;
  apiKey?: string;
  accessToken?: string;
}

// Values from cards/02-import-existing-data.md — overridable via options/env.
export const DEFAULT_SHEET_ID = '14yKwNOT81CbIlJ80j__wayKUMEySF0LL6tgKZBwV8PY';
export const DEFAULT_TAB_NAME = 'Alex Tax Assessors';

/**
 * Reads rows directly from the live Google Sheet via the Sheets REST API
 * (no googleapis dependency needed — plain fetch). Requires a credential
 * supplied via env var; this is an EXTERNAL PREREQUISITE that this script
 * cannot fabricate. See scripts/README.md for setup instructions.
 */
export class GoogleSheetsSource implements ImportSource {
  private sheetId: string;
  private tabName: string;
  private apiKey?: string;
  private accessToken?: string;

  constructor(options: GoogleSheetsSourceOptions = {}) {
    this.sheetId = options.sheetId || process.env.GOOGLE_SHEETS_ID || DEFAULT_SHEET_ID;
    this.tabName = options.tabName || process.env.GOOGLE_SHEETS_TAB || DEFAULT_TAB_NAME;
    this.apiKey = options.apiKey || process.env.GOOGLE_SHEETS_API_KEY;
    this.accessToken = options.accessToken || process.env.GOOGLE_SHEETS_ACCESS_TOKEN;
  }

  describe(): string {
    return `Google Sheet ${this.sheetId} (tab "${this.tabName}")`;
  }

  async fetchRows(): Promise<RawImportRow[]> {
    if (!this.apiKey && !this.accessToken) {
      throw new Error(
        [
          'Google Sheets source is not configured for this environment (external prerequisite missing).',
          'Set ONE of the following before running with --source=google-sheets:',
          '  - GOOGLE_SHEETS_ACCESS_TOKEN: an OAuth2 access token for an account with read access to the',
          '    sheet (scope https://www.googleapis.com/auth/spreadsheets.readonly), e.g. from',
          '    `gcloud auth print-access-token` after authenticating as that account.',
          '  - GOOGLE_SHEETS_API_KEY: a Google Cloud API key. Only works if the sheet is shared',
          '    "Anyone with the link can view".',
          `Target: ${this.describe()}`,
          '',
          'Until one of these is provided, use --source=csv (see scripts/fixtures/ and scripts/README.md).',
        ].join('\n')
      );
    }

    const range = `${this.tabName}!A2:L`;
    const url = new URL(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(range)}`
    );
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    } else if (this.apiKey) {
      url.searchParams.set('key', this.apiKey);
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Google Sheets API request failed (${res.status} ${res.statusText}): ${body || '<no body>'}`
      );
    }

    const data = (await res.json()) as { values?: string[][] };
    const values = data.values ?? [];
    return values
      .filter((r) => r.some((cell) => (cell ?? '').trim() !== ''))
      .map((cols, idx) => rowFromColumns(idx + 2, cols)); // +2: A2 is row 2
  }
}
