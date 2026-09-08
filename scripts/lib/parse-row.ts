import { requestStatusEnum, listTypeEnum } from '../../shared/schema.js';
import type { RawImportRow } from './sources.js';
import {
  cleanCountyName,
  cleanStateAbbreviation,
  normalizeEmail,
  normalizePhoneNumber,
  normalizeTitle,
  trimToNull,
} from './clean.js';

export type RequestStatus = (typeof requestStatusEnum.enumValues)[number];
export type ListType = (typeof listTypeEnum.enumValues)[number];

export interface ParsedRow {
  rowNumber: number;
  skip: boolean;
  skipReason?: string;
  warnings: string[];

  stateAbbreviation: string | null;
  countyName: string | null;

  fullName: string;
  isPlaceholderName: boolean;
  title: string;
  phoneNumber: string | null;
  emailAddress: string | null;

  requestStatus: RequestStatus;
  dataProcessed?: boolean;
  listType?: ListType;
  costAmount?: number;
  costNotes?: string;

  notes: string | null;
  fullResponseText: string | null;
}

/** Column A: "M"/"m" -> email_sent; "Needs data extraction" -> list_provided (+ data_processed=false); empty -> not_started. */
export function parseStatusColumn(raw: string | undefined | null): {
  requestStatus: RequestStatus;
  dataProcessed?: boolean;
  recognized: boolean;
} {
  const trimmed = trimToNull(raw);
  if (!trimmed) return { requestStatus: 'not_started', recognized: true };
  if (/^m$/i.test(trimmed)) return { requestStatus: 'email_sent', recognized: true };
  if (/needs data extraction/i.test(trimmed)) {
    return { requestStatus: 'list_provided', dataProcessed: false, recognized: true };
  }
  return { requestStatus: 'not_started', recognized: false };
}

/**
 * Column J: free-text status + cost info, e.g. "$75 flat for list",
 * "$1 per page, 269 pages", "Provided!", "Not providing", "Going to
 * provide", "Pending written request". Status phrases and cost phrases
 * are independent (a cell could theoretically contain both).
 */
export function parseListStatus(raw: string | undefined | null): {
  requestStatus?: RequestStatus;
  listType?: ListType;
  costAmount?: number;
  costNotes?: string;
} {
  const text = trimToNull(raw);
  if (!text) return {};

  const result: {
    requestStatus?: RequestStatus;
    listType?: ListType;
    costAmount?: number;
    costNotes?: string;
  } = {};

  if (/not providing/i.test(text)) result.requestStatus = 'not_available';
  else if (/going to provide/i.test(text)) result.requestStatus = 'awaiting_response';
  else if (/provided!?/i.test(text)) result.requestStatus = 'list_provided';
  else if (/pending written request/i.test(text)) result.requestStatus = 'requires_form';

  const perPageMatch = text.match(/\$\s*([\d.]+)\s*per\s*page,?\s*(\d+)\s*pages?/i);
  const flatMatch = text.match(/\$\s*([\d.]+)\s*flat/i);

  if (perPageMatch) {
    const rate = parseFloat(perPageMatch[1]);
    const pages = parseInt(perPageMatch[2], 10);
    result.listType = 'paid';
    result.costAmount = Math.round(rate * pages * 100) / 100;
    result.costNotes = text;
  } else if (flatMatch) {
    result.listType = 'paid';
    result.costAmount = parseFloat(flatMatch[1]);
    result.costNotes = text;
  }

  return result;
}

function buildNotes(contactStatus: string | null, notesColumn: string | null): string | null {
  const parts = [contactStatus, notesColumn].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(' | ') : null;
}

/** Maps one raw source row (columns A-L) into a cleaned, validated record ready for upsert. */
export function parseRow(raw: RawImportRow): ParsedRow {
  const warnings: string[] = [];

  const stateAbbreviation = cleanStateAbbreviation(raw.state);
  if (!stateAbbreviation) {
    warnings.push(`Could not parse a valid state abbreviation from "${raw.state}"`);
  }

  const countyPrimary = cleanCountyName(raw.county);
  const countyFallback = cleanCountyName(raw.countyAlt);
  const countyName = countyPrimary ?? countyFallback;
  if (!countyName) {
    warnings.push('Could not parse a county name from either column D or column G');
  } else if (
    countyPrimary &&
    countyFallback &&
    countyPrimary.toLowerCase() !== countyFallback.toLowerCase()
  ) {
    warnings.push(
      `County name mismatch between column D ("${countyPrimary}") and column G ("${countyFallback}") — using column D`
    );
  }

  let fullName = trimToNull(raw.fullName);
  let isPlaceholderName = false;
  if (!fullName) {
    fullName = 'Unknown Official';
    isPlaceholderName = true;
    warnings.push('Missing official name — using placeholder "Unknown Official"');
  }

  const title = normalizeTitle(raw.title);
  const phoneNumber = normalizePhoneNumber(raw.phoneNumber);
  const emailAddress = normalizeEmail(raw.emailAddress);

  const statusResult = parseStatusColumn(raw.status);
  if (!statusResult.recognized) {
    warnings.push(`Unrecognized value in Status column: "${raw.status}" — defaulted to not_started`);
  }
  const listStatusResult = parseListStatus(raw.listStatus);
  const requestStatus = listStatusResult.requestStatus ?? statusResult.requestStatus;

  const missing: string[] = [];
  if (!stateAbbreviation) missing.push('state');
  if (!countyName) missing.push('county');
  const skip = missing.length > 0;

  return {
    rowNumber: raw.rowNumber,
    skip,
    skipReason: skip ? `Missing required field(s): ${missing.join(', ')}` : undefined,
    warnings,
    stateAbbreviation,
    countyName,
    fullName,
    isPlaceholderName,
    title,
    phoneNumber,
    emailAddress,
    requestStatus,
    dataProcessed: statusResult.dataProcessed,
    listType: listStatusResult.listType,
    costAmount: listStatusResult.costAmount,
    costNotes: listStatusResult.costNotes,
    notes: buildNotes(trimToNull(raw.contactStatus), trimToNull(raw.notes)),
    fullResponseText: trimToNull(raw.response),
  };
}
