import { readFile } from 'node:fs/promises';
import { parseCsv } from './csv-parser.js';

/**
 * Which raw column layout a row came from. "legacy" is the original
 * positional A-L contract from card 02 (status,state,full_name,county,
 * phone_number,email_address,county_alt,title,contact_status,list_status,
 * notes,response). "human" is the real desktop CSV export's header/shape
 * (card 02B), which has separate Cost/Cost Type columns and a clean
 * List Status label instead of legacy's free-text status+cost column.
 */
export type RawImportFormat = 'legacy' | 'human';

/**
 * A single raw row from a source spreadsheet/CSV. All values are raw
 * strings (trimmed of surrounding whitespace only) — cleaning/parsing
 * happens later in parse-row.ts. Fields that only apply to one format are
 * optional; parse-row.ts branches on `format`.
 */
export interface RawImportRow {
  /** 1-based row number in the source, for error/warning reporting. */
  rowNumber: number;
  format: RawImportFormat;

  state: string;
  fullName: string;
  /** Explicit county column, when present. */
  county: string;
  /**
   * Fallback/office label used only for county-name cleaning when `county`
   * is blank — legacy's duplicated "county_alt" column, or the human CSV's
   * "County Treasurer Website" column (which despite its name usually
   * holds an office label like "Pennington County Treasurer" or a bare
   * county name, not a URL).
   */
  countyOfficeLabel: string;
  phoneNumber: string;
  /** May be a real email OR (human format) a web-form URL — see parse-row.ts. */
  emailAddress: string;
  title: string;
  contactStatus: string;
  /**
   * legacy: free text combining status + cost, e.g. "$75 flat for list".
   * human: a clean status label, e.g. "Requires Payment", "List Provided!".
   */
  listStatus: string;
  notes: string;
  response: string;

  /** legacy only — column A: "M"/"m"/"Needs data extraction"/empty. */
  legacyStatus?: string;
  /** human only — raw currency amount, e.g. "$75", "$0.50". */
  cost?: string;
  /** human only — raw pricing basis label, e.g. "List", "Page", "Listing". */
  costType?: string;

  /** Source-level warnings (e.g. non-empty data in an unnamed trailing column). */
  warnings?: string[];
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

const LEGACY_HEADERS = [
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

/** Header names (normalized: trimmed + lowercased) for the real desktop CSV export. */
const HUMAN_HEADER_FIELD_MAP: Record<string, keyof RawImportRow> = {
  'state': 'state',
  'full name': 'fullName',
  'county treasurer website': 'countyOfficeLabel',
  'phone number': 'phoneNumber',
  'email address': 'emailAddress',
  'county': 'county',
  'title': 'title',
  'contact status': 'contactStatus',
  'list status': 'listStatus',
  'cost': 'cost',
  'cost type': 'costType',
  'notes': 'notes',
  'response': 'response',
};

function legacyRowFromColumns(rowNumber: number, cols: string[]): RawImportRow {
  const get = (i: number) => (cols[i] ?? '').trim();
  return {
    rowNumber,
    format: 'legacy',
    legacyStatus: get(0),
    state: get(1),
    fullName: get(2),
    county: get(3),
    phoneNumber: get(4),
    emailAddress: get(5),
    countyOfficeLabel: get(6),
    title: get(7),
    contactStatus: get(8),
    listStatus: get(9),
    notes: get(10),
    response: get(11),
  };
}

/**
 * Builds a name -> column-index map for the human header, then reads each
 * data row via that map (order-independent, unlike the legacy positional
 * contract). Any header column not in HUMAN_HEADER_FIELD_MAP (typically
 * blank trailing columns from a spreadsheet export) is tracked so that
 * non-empty data in it can be reported as a warning rather than silently
 * dropped or mistyped.
 */
function buildHumanRowReader(normalizedHeader: string[]): (rowNumber: number, cols: string[]) => RawImportRow {
  const indexByField = new Map<keyof RawImportRow, number>();
  const recognizedIndexes = new Set<number>();
  normalizedHeader.forEach((h, idx) => {
    const field = HUMAN_HEADER_FIELD_MAP[h];
    if (field) {
      indexByField.set(field, idx);
      recognizedIndexes.add(idx);
    }
  });

  const unnamedIndexes = normalizedHeader
    .map((_, idx) => idx)
    .filter((idx) => !recognizedIndexes.has(idx));

  return (rowNumber: number, cols: string[]): RawImportRow => {
    const get = (field: keyof RawImportRow) => {
      const idx = indexByField.get(field);
      return idx == null ? '' : (cols[idx] ?? '').trim();
    };

    const warnings: string[] = [];
    for (const idx of unnamedIndexes) {
      const value = (cols[idx] ?? '').trim();
      if (value !== '') {
        warnings.push(
          `Row ${rowNumber} has non-empty data in an unnamed trailing column (position ${idx + 1}): "${value}" — ignored`
        );
      }
    }

    return {
      rowNumber,
      format: 'human',
      state: get('state'),
      fullName: get('fullName'),
      county: get('county'),
      countyOfficeLabel: get('countyOfficeLabel'),
      phoneNumber: get('phoneNumber'),
      emailAddress: get('emailAddress'),
      title: get('title'),
      contactStatus: get('contactStatus'),
      listStatus: get('listStatus'),
      cost: get('cost'),
      costType: get('costType'),
      notes: get('notes'),
      response: get('response'),
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  };
}

/**
 * Reads rows from a local CSV file. Accepts either the legacy positional
 * A-L contract (see scripts/fixtures/county-treasurer-target-list.sample.csv)
 * or the real desktop export's human-readable header (State, Full Name,
 * County Treasurer Website, Phone Number, Email Address, County, Title,
 * Contact Status, List Status, Cost, Cost Type, Notes, Response, plus any
 * unnamed trailing columns). Detection is by header shape, so no manual
 * normalized copy is required. See scripts/README.md.
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

    const isLegacy =
      normalizedHeader.length === LEGACY_HEADERS.length &&
      LEGACY_HEADERS.every((h, idx) => normalizedHeader[idx] === h);
    const isHuman = Object.keys(HUMAN_HEADER_FIELD_MAP).every((h) => normalizedHeader.includes(h));

    if (!isLegacy && !isHuman) {
      throw new Error(
        [
          `CSV header in "${this.filePath}" does not match a recognized column contract.`,
          `Legacy contract: ${LEGACY_HEADERS.join(',')}`,
          `Human export contract requires (any order/extra columns OK): ${Object.keys(HUMAN_HEADER_FIELD_MAP).join(', ')}`,
          `Found: ${normalizedHeader.join(',')}`,
        ].join('\n')
      );
    }

    const nonEmptyDataRows = dataRows.filter((r) => r.some((cell) => cell.trim() !== ''));

    if (isLegacy) {
      return nonEmptyDataRows.map((cols, idx) => legacyRowFromColumns(idx + 2, cols)); // +2: 1-based, skip header row
    }

    const readHumanRow = buildHumanRowReader(normalizedHeader);
    return nonEmptyDataRows.map((cols, idx) => readHumanRow(idx + 2, cols));
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
 *
 * Still reads the legacy positional A-L layout (the live sheet's shape).
 * If/when the live sheet is reshaped to match the human CSV export, this
 * adapter should switch to header-based mapping like CsvFileSource does.
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
      .map((cols, idx) => legacyRowFromColumns(idx + 2, cols)); // +2: A2 is row 2
  }
}
