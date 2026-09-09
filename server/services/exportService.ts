import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { and, count as sqlCount, desc, eq } from 'drizzle-orm';
import { db } from '../db.js';
import {
  processedLists,
  processedListRecords,
  mailingListExports,
  listRequests,
  seedStates,
  type ProcessedListRecord,
  type MailingListExport,
} from '../../shared/schema.js';
import type { StandardFieldId } from '../../shared/dataFields.js';

// ============================================================
// Mailing List Export & ELW Integration (card 13) — turns validated
// processed_list_records into the standard ELW mailing-list CSV shape.
// Like fileStorage.ts/dataParser.ts before it, this is a hand-rolled
// implementation (no CSV library, no real ELW API client in this repo):
// the "ELW integration" endpoint below produces the same standardized CSV
// rather than calling a live external service, since no ELW API
// credentials/contract are available in this codebase.
// ============================================================

export const EXPORTS_DIR = path.resolve(process.cwd(), 'exports');

export function ensureExportsDir(): void {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

export function absoluteExportPath(relativePath: string): string {
  const resolved = path.resolve(process.cwd(), relativePath);
  if (!resolved.startsWith(EXPORTS_DIR + path.sep) && resolved !== EXPORTS_DIR) {
    throw new Error('Resolved path escapes the exports directory');
  }
  return resolved;
}

export function relativeExportPath(filename: string): string {
  return path.posix.join('exports', filename);
}

// ------------------------------------------------------------
// Standard ELW export column order. Kept as snake_case (rather than this
// repo's usual camelCase JSON convention) because these are literally the
// column headers the generated CSV uses, and the export-preview endpoint
// returns objects shaped exactly like a CSV row for that same reason.
// ------------------------------------------------------------
export const ELW_EXPORT_COLUMNS = [
  'first_name',
  'last_name',
  'company_name',
  'owner_raw',
  'mailing_street',
  'mailing_city',
  'mailing_state',
  'mailing_zip',
  'property_apn',
  'property_street',
  'property_city',
  'property_state',
  'property_zip',
  'tax_amount_due',
  'county_name',
  'state_name',
  'source_label',
] as const;

export type ElwExportColumn = (typeof ELW_EXPORT_COLUMNS)[number];

export type ElwExportRow = Record<ElwExportColumn, string>;

// ------------------------------------------------------------
// Name parsing
// ------------------------------------------------------------

// Substrings that mark an owner as a business/legal entity rather than an
// individual. Checked case-insensitively against the whole raw string, so
// an entity owner is never split into first/last name.
const ENTITY_MARKERS = [
  'llc',
  'l.l.c',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'trust',
  'trustee',
  'estate of',
  'lp',
  'l.p',
  'llp',
  'partnership',
  'company',
  'co.',
  'bank',
  'church',
  'ministries',
  'foundation',
  'association',
  'assoc.',
  'holdings',
  'properties',
  'enterprises',
  'group',
  'management',
  'services',
  'hoa',
];

function looksLikeEntity(raw: string): boolean {
  const normalized = ` ${raw.toLowerCase().replace(/[.,]/g, ' ')} `;
  return ENTITY_MARKERS.some((marker) => normalized.includes(` ${marker.replace(/\./g, '')} `) || normalized.includes(marker));
}

export interface ParsedOwnerName {
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
}

// Splits an owner_name value into first/last name, or leaves it as a
// company name for LLCs/trusts/other entities. Handles the two common
// individual-owner shapes: "Last, First[ Middle]" and "First[ Middle] Last".
// Multi-owner strings (e.g. "SMITH JOHN & JANE") are not decomposed further
// -- the whole string is parsed as a single name, which is a known
// limitation for jointly-owned parcels.
export function parseOwnerName(raw: string | null | undefined): ParsedOwnerName {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { firstName: null, lastName: null, companyName: null };

  if (looksLikeEntity(trimmed)) {
    return { firstName: null, lastName: null, companyName: trimmed };
  }

  if (trimmed.includes(',')) {
    const [lastPart, ...rest] = trimmed.split(',');
    const lastName = lastPart.trim();
    const firstName = rest.join(',').trim();
    if (lastName && firstName) return { firstName, lastName, companyName: null };
    if (lastName) return { firstName: null, lastName, companyName: null };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    return { firstName: tokens[0], lastName: null, companyName: null };
  }
  const lastName = tokens[tokens.length - 1];
  const firstName = tokens.slice(0, -1).join(' ');
  return { firstName, lastName, companyName: null };
}

// ------------------------------------------------------------
// Address parsing
// ------------------------------------------------------------

const US_STATE_ABBREVIATIONS = new Set(seedStates.map((s) => s.abbreviation));

export interface ParsedAddress {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

// Parses a free-text address into street/city/state/zip. Expects a
// recognizable "..., City, ST 12345[-6789]" or "... City ST 12345" tail —
// anything else falls back to putting the whole string in `street` with
// city/state/zip left null, since there is no reliable way to segment an
// address without at least a state+zip anchor.
export function parseAddress(raw: string | null | undefined): ParsedAddress {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { street: null, city: null, state: null, zip: null };

  const tailMatch = /^(.*?)[,\s]+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/.exec(trimmed);
  if (!tailMatch) {
    return { street: trimmed, city: null, state: null, zip: null };
  }

  const [, head, stateRaw, zip] = tailMatch;
  const state = stateRaw.toUpperCase();
  if (!US_STATE_ABBREVIATIONS.has(state)) {
    return { street: trimmed, city: null, state: null, zip: null };
  }

  const headTrimmed = head.replace(/,\s*$/, '').trim();
  if (!headTrimmed) {
    return { street: null, city: null, state, zip };
  }

  if (headTrimmed.includes(',')) {
    const parts = headTrimmed.split(',').map((p) => p.trim()).filter(Boolean);
    const city = parts.length > 1 ? parts[parts.length - 1] : null;
    const street = parts.length > 1 ? parts.slice(0, -1).join(', ') : parts[0] ?? null;
    return { street, city, state, zip };
  }

  // No comma to anchor on -- can't reliably tell street from city, so keep
  // the whole head as the street and leave city unset.
  return { street: headTrimmed, city: null, state, zip };
}

// ------------------------------------------------------------
// Row building
// ------------------------------------------------------------

function formatAmount(value: unknown): string {
  if (typeof value !== 'number' || isNaN(value)) return '';
  return value.toFixed(2);
}

function fieldOf(mappedData: Record<string, unknown>, field: StandardFieldId): string | null {
  const value = mappedData[field];
  return typeof value === 'string' && value.trim() ? value : null;
}

export interface ElwExportContext {
  countyName: string;
  stateName: string;
  sourceLabel: string;
}

export function buildElwExportRow(record: Pick<ProcessedListRecord, 'mappedData'>, context: ElwExportContext): ElwExportRow {
  const mappedData = record.mappedData as Record<string, unknown>;
  const ownerRaw = fieldOf(mappedData, 'owner_name');
  const { firstName, lastName, companyName } = parseOwnerName(ownerRaw);

  const mailingRaw = fieldOf(mappedData, 'mailing_address') ?? fieldOf(mappedData, 'property_address');
  const propertyRaw = fieldOf(mappedData, 'property_address');
  const mailing = parseAddress(mailingRaw);
  const property = parseAddress(propertyRaw);

  return {
    first_name: firstName ?? '',
    last_name: lastName ?? '',
    company_name: companyName ?? '',
    owner_raw: ownerRaw ?? '',
    mailing_street: mailing.street ?? '',
    mailing_city: mailing.city ?? '',
    mailing_state: mailing.state ?? '',
    mailing_zip: mailing.zip ?? '',
    property_apn: fieldOf(mappedData, 'apn') ?? '',
    property_street: property.street ?? '',
    property_city: property.city ?? '',
    property_state: property.state ?? '',
    property_zip: property.zip ?? '',
    tax_amount_due: formatAmount(mappedData['amount_due']),
    county_name: context.countyName,
    state_name: context.stateName,
    source_label: context.sourceLabel,
  };
}

// ------------------------------------------------------------
// CSV serialization
// ------------------------------------------------------------

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function rowsToCsv(rows: ElwExportRow[]): string {
  const lines = [ELW_EXPORT_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(ELW_EXPORT_COLUMNS.map((col) => csvEscape(row[col])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

// ------------------------------------------------------------
// Export generation
// ------------------------------------------------------------

export interface ExportOptions {
  includeDuplicates: boolean;
  validOnly: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeDuplicates: false,
  validOnly: true,
};

export interface ExportContextResult {
  countyName: string;
  stateName: string;
  sourceLabel: string;
  listRequestId: number;
}

// Resolves the county/state/source-label context shared by every record in
// a given processed_lists file. Returns null if the file (or its parent
// chain) can't be found.
export async function resolveExportContext(processedListId: number): Promise<ExportContextResult | null> {
  const file = await db.query.processedLists.findFirst({
    where: eq(processedLists.id, processedListId),
    with: {
      listRequest: {
        with: {
          taxOfficial: {
            with: {
              county: { with: { state: true } },
            },
          },
        },
      },
    },
  });
  if (!file || !file.listRequest) return null;

  const county = file.listRequest.taxOfficial.county;
  return {
    countyName: county.name,
    stateName: county.state.name,
    sourceLabel: file.listRequest.sourceLabel || file.originalFilename || `List #${file.listRequestId}`,
    listRequestId: file.listRequestId,
  };
}

function recordConditions(processedListId: number, options: ExportOptions) {
  const conditions = [eq(processedListRecords.processedListId, processedListId)];
  if (options.validOnly) conditions.push(eq(processedListRecords.isValid, true));
  if (!options.includeDuplicates) conditions.push(eq(processedListRecords.isDuplicate, false));
  return and(...conditions);
}

export async function fetchExportRecords(
  processedListId: number,
  options: ExportOptions,
  limit?: number
): Promise<ProcessedListRecord[]> {
  return db.query.processedListRecords.findMany({
    where: recordConditions(processedListId, options),
    orderBy: (records, { asc }) => asc(records.id),
    limit,
  });
}

export async function countExportRecords(processedListId: number, options: ExportOptions): Promise<number> {
  const result = await db
    .select({ count: sqlCount() })
    .from(processedListRecords)
    .where(recordConditions(processedListId, options));
  return result[0]?.count ?? 0;
}

export interface GeneratedExport {
  export: MailingListExport;
  recordCount: number;
  downloadUrl: string;
}

// Generates the ELW CSV for a processed list, writes it under exports/,
// records it in mailing_list_exports, and mirrors the outcome onto
// processed_lists / list_requests so the rest of the app can tell an
// export happened without re-reading the exports table.
export async function generateExport(
  processedListId: number,
  options: ExportOptions = DEFAULT_EXPORT_OPTIONS
): Promise<GeneratedExport | { error: string }> {
  const context = await resolveExportContext(processedListId);
  if (!context) return { error: 'File not found' };

  const records = await fetchExportRecords(processedListId, options);
  if (records.length === 0) {
    return { error: 'No records match the selected export filters' };
  }

  const rows = records.map((r) => buildElwExportRow(r, context));
  const csv = rowsToCsv(rows);

  ensureExportsDir();
  const filename = `elw-export-${processedListId}-${randomUUID()}.csv`;
  const relPath = relativeExportPath(filename);
  await fs.promises.writeFile(absoluteExportPath(relPath), csv, 'utf8');

  const [exportRow] = await db
    .insert(mailingListExports)
    .values({
      processedListId,
      filename,
      exportPath: relPath,
      recordCount: records.length,
      exportFormat: 'elw_csv',
      includeDuplicates: options.includeDuplicates,
      validOnly: options.validOnly,
    })
    .returning();

  await db
    .update(processedLists)
    .set({ mailingListCreated: true, mailingListExportPath: relPath })
    .where(eq(processedLists.id, processedListId));

  await db
    .update(listRequests)
    .set({ dataProcessed: true, rawListStatus: 'exported', updatedAt: new Date() })
    .where(eq(listRequests.id, context.listRequestId));

  return { export: exportRow, recordCount: records.length, downloadUrl: `/api/exports/${exportRow.id}/download` };
}

export async function listExportHistory(processedListId: number): Promise<MailingListExport[]> {
  return db.query.mailingListExports.findMany({
    where: eq(mailingListExports.processedListId, processedListId),
    orderBy: desc(mailingListExports.exportedAt),
  });
}
