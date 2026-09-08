import {
  eventChannelEnum,
  listRequestEventTypeEnum,
  listTypeEnum,
  priceBasisEnum,
  quantityUnitEnum,
  requestStatusEnum,
} from '../../shared/schema.js';
import type { RawImportRow } from './sources.js';
import {
  cleanCountyName,
  cleanStateAbbreviation,
  normalizePhoneNumber,
  normalizeTitle,
  parseEmailOrUrl,
  trimToNull,
} from './clean.js';

export type RequestStatus = (typeof requestStatusEnum.enumValues)[number];
export type ListType = (typeof listTypeEnum.enumValues)[number];
export type PriceBasis = (typeof priceBasisEnum.enumValues)[number];
export type QuantityUnit = (typeof quantityUnitEnum.enumValues)[number];
export type ListRequestEventType = (typeof listRequestEventTypeEnum.enumValues)[number];
export type EventChannel = (typeof eventChannelEnum.enumValues)[number];

/** One list_request_prices row's worth of data, basis-preserving even when quantity/total are unknown. */
export interface ParsedPrice {
  basis: PriceBasis;
  unitAmount?: number;
  quantity?: number;
  quantityUnit?: QuantityUnit;
  totalAmount?: number;
  rawText: string;
  sourceLabel?: string;
}

/** One list_request_events row's worth of data, keyed by source field for idempotent re-import. */
export interface ParsedEvent {
  field: 'contact_status' | 'notes' | 'response';
  eventType: ListRequestEventType;
  channel?: EventChannel;
  summary?: string;
  body?: string;
}

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
  websiteUrl: string | null;

  requestStatus: RequestStatus;
  dataProcessed?: boolean;
  price: ParsedPrice | null;

  /** Raw source text that drove `requestStatus` — preserved verbatim for list_requests.raw_list_status / source_label. */
  rawListStatus: string | null;

  /** Combined "Contact Status | Notes" text, kept for list_requests.notes compatibility. */
  notes: string | null;
  /** Response column alone, kept for list_requests.full_response_text compatibility. */
  fullResponseText: string | null;

  /** Per-field events for list_request_events (Contact Status, Notes, Response), only populated when raw text present. */
  events: ParsedEvent[];
}

/** Legacy column A: "M"/"m" -> email_sent; "Needs data extraction" -> list_provided (+ data_processed=false); empty -> not_started. */
export function parseLegacyStatusColumn(raw: string | undefined | null): {
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
 * Legacy column J: free-text status + cost info, e.g. "$75 flat for list",
 * "$1 per page, 269 pages", "Provided!", "Not providing", "Going to
 * provide", "Pending written request". Status phrases and cost phrases
 * are independent (a cell could theoretically contain both).
 */
export function parseLegacyListStatus(raw: string | undefined | null): {
  requestStatus?: RequestStatus;
  price?: ParsedPrice;
} {
  const text = trimToNull(raw);
  if (!text) return {};

  const result: { requestStatus?: RequestStatus; price?: ParsedPrice } = {};

  if (/not providing/i.test(text)) result.requestStatus = 'not_available';
  else if (/going to provide/i.test(text)) result.requestStatus = 'awaiting_response';
  else if (/provided!?/i.test(text)) result.requestStatus = 'list_provided';
  else if (/pending written request/i.test(text)) result.requestStatus = 'requires_form';

  const perPageMatch = text.match(/\$\s*([\d.]+)\s*per\s*page,?\s*(\d+)\s*pages?/i);
  const flatMatch = text.match(/\$\s*([\d.]+)\s*flat/i);

  if (perPageMatch) {
    const rate = parseFloat(perPageMatch[1]);
    const pages = parseInt(perPageMatch[2], 10);
    result.price = {
      basis: 'per_page',
      unitAmount: rate,
      quantity: pages,
      quantityUnit: 'pages',
      totalAmount: Math.round(rate * pages * 100) / 100,
      rawText: text,
    };
  } else if (flatMatch) {
    const amount = parseFloat(flatMatch[1]);
    result.price = {
      basis: 'flat_list',
      unitAmount: amount,
      totalAmount: amount,
      rawText: text,
    };
  }

  return result;
}

/**
 * Human CSV's List Status column: a clean status label rather than legacy's
 * free-text status+cost mix. Six recognized labels per the real export;
 * anything else (including blank) defaults to not_started with a warning
 * only when non-blank.
 */
export function parseHumanListStatus(raw: string | undefined | null): {
  requestStatus: RequestStatus;
  recognized: boolean;
} {
  const trimmed = trimToNull(raw);
  if (!trimmed) return { requestStatus: 'not_started', recognized: true };

  const normalized = trimmed.toLowerCase();
  const map: Record<string, RequestStatus> = {
    'list provided!': 'list_provided',
    'requires payment': 'requires_payment',
    'requires written request': 'requires_form',
    'do not provide': 'not_available',
    'do not have data': 'not_available',
    'providing': 'awaiting_response',
  };

  const status = map[normalized];
  if (status) return { requestStatus: status, recognized: true };
  return { requestStatus: 'not_started', recognized: false };
}

const HUMAN_COST_TYPE_TO_BASIS: Record<string, PriceBasis> = {
  list: 'flat_list',
  listing: 'per_listing',
  page: 'per_page',
};

const BASIS_TO_QUANTITY_UNIT: Partial<Record<PriceBasis, QuantityUnit>> = {
  per_page: 'pages',
  per_listing: 'listings',
};

/**
 * Human CSV's Cost/Cost Type columns: Cost is a currency amount ("$75",
 * "$1", "$0.50", "$106.60"); Cost Type is the pricing basis label ("List",
 * "Page", "Listing"). Unlike legacy's per-page format, no quantity is given
 * here — basis is preserved and quantity/total are left null per spec.
 */
export function parseHumanPrice(
  rawCost: string | undefined | null,
  rawCostType: string | undefined | null
): { price?: ParsedPrice; warning?: string } {
  const costText = trimToNull(rawCost);
  const costTypeText = trimToNull(rawCostType);
  if (!costText && !costTypeText) return {};

  const amount = costText ? parseFloat(costText.replace(/[$,]/g, '')) : undefined;
  const normalizedType = costTypeText?.toLowerCase();
  const basis: PriceBasis = (normalizedType && HUMAN_COST_TYPE_TO_BASIS[normalizedType]) || 'unknown';

  let warning: string | undefined;
  if (costText && !costTypeText) {
    warning = `Cost "${costText}" given without a Cost Type — basis recorded as unknown`;
  } else if (!costText && costTypeText) {
    warning = `Cost Type "${costTypeText}" given without a Cost amount`;
  } else if (costTypeText && basis === 'unknown') {
    warning = `Unrecognized Cost Type "${costTypeText}" — basis recorded as unknown`;
  }
  if (costText && Number.isNaN(amount)) {
    warning = `Could not parse Cost amount "${costText}"`;
  }

  const validAmount = amount != null && !Number.isNaN(amount) ? amount : undefined;
  // Per-unit bases (per_page/per_listing) with no quantity given: Cost is a
  // unit rate, not a total — leave totalAmount unknown rather than guessing.
  // flat_list/unknown: Cost is already the whole amount.
  const isPerUnitBasis = basis === 'per_page' || basis === 'per_listing';

  const price: ParsedPrice = {
    basis,
    unitAmount: validAmount,
    totalAmount: isPerUnitBasis ? undefined : validAmount,
    quantityUnit: BASIS_TO_QUANTITY_UNIT[basis],
    rawText: [costText, costTypeText].filter(Boolean).join(' '),
    sourceLabel: costTypeText ?? undefined,
  };

  return { price, warning };
}

function buildNotes(contactStatus: string | null, notesColumn: string | null): string | null {
  const parts = [contactStatus, notesColumn].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(' | ') : null;
}

function inferContactStatusEvent(text: string): { eventType: ListRequestEventType; channel?: EventChannel } {
  if (/form/i.test(text)) return { eventType: 'form_submitted', channel: 'web_form' };
  if (/call/i.test(text)) return { eventType: 'phone_call', channel: 'phone' };
  if (/email/i.test(text)) return { eventType: 'email_sent', channel: 'email' };
  return { eventType: 'other' };
}

function buildEvents(contactStatus: string | null, notes: string | null, response: string | null): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  if (contactStatus) {
    const { eventType, channel } = inferContactStatusEvent(contactStatus);
    events.push({ field: 'contact_status', eventType, channel, summary: contactStatus });
  }
  if (notes) {
    events.push({ field: 'notes', eventType: 'note', body: notes });
  }
  if (response) {
    events.push({ field: 'response', eventType: 'response_received', body: response });
  }
  return events;
}

/** Maps one raw source row (legacy A-L or the human CSV export) into a cleaned, validated record ready for upsert. */
export function parseRow(raw: RawImportRow): ParsedRow {
  const warnings: string[] = [...(raw.warnings ?? [])];

  const stateAbbreviation = cleanStateAbbreviation(raw.state);
  if (!stateAbbreviation) {
    warnings.push(`Could not parse a valid state abbreviation from "${raw.state}"`);
  }

  const countyPrimary = cleanCountyName(raw.county);
  const countyFallback = cleanCountyName(raw.countyOfficeLabel);
  const countyName = countyPrimary ?? countyFallback;
  if (!countyName) {
    warnings.push('Could not parse a county name from either the County column or the office-label fallback');
  } else if (
    countyPrimary &&
    countyFallback &&
    countyPrimary.toLowerCase() !== countyFallback.toLowerCase()
  ) {
    warnings.push(
      `County name mismatch between County ("${countyPrimary}") and the office-label fallback ("${countyFallback}") — using County`
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
  const { email: emailAddress, websiteUrl } = parseEmailOrUrl(raw.emailAddress);

  let requestStatus: RequestStatus;
  let dataProcessed: boolean | undefined;
  let price: ParsedPrice | null = null;
  let rawListStatus: string | null;

  if (raw.format === 'human') {
    const statusResult = parseHumanListStatus(raw.listStatus);
    if (!statusResult.recognized) {
      warnings.push(`Unrecognized value in List Status column: "${raw.listStatus}" — defaulted to not_started`);
    }
    requestStatus = statusResult.requestStatus;
    rawListStatus = trimToNull(raw.listStatus);

    const { price: humanPrice, warning: priceWarning } = parseHumanPrice(raw.cost, raw.costType);
    if (priceWarning) warnings.push(priceWarning);
    price = humanPrice ?? null;
  } else {
    const statusResult = parseLegacyStatusColumn(raw.legacyStatus);
    if (!statusResult.recognized) {
      warnings.push(`Unrecognized value in Status column: "${raw.legacyStatus}" — defaulted to not_started`);
    }
    const listStatusResult = parseLegacyListStatus(raw.listStatus);
    requestStatus = listStatusResult.requestStatus ?? statusResult.requestStatus;
    dataProcessed = statusResult.dataProcessed;
    price = listStatusResult.price ?? null;
    rawListStatus = trimToNull(raw.listStatus) ?? trimToNull(raw.legacyStatus);
  }

  const missing: string[] = [];
  if (!stateAbbreviation) missing.push('state');
  if (!countyName) missing.push('county');
  const skip = missing.length > 0;

  const contactStatusRaw = trimToNull(raw.contactStatus);
  const notesRaw = trimToNull(raw.notes);
  const responseRaw = trimToNull(raw.response);

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
    websiteUrl,
    requestStatus,
    dataProcessed,
    price,
    rawListStatus,
    notes: buildNotes(contactStatusRaw, notesRaw),
    fullResponseText: responseRaw,
    events: buildEvents(contactStatusRaw, notesRaw, responseRaw),
  };
}
