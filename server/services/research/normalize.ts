import type { ConfidenceLevel, ResearchCandidate } from './types.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONFIDENCE_VALUES: ConfidenceLevel[] = ['high', 'medium', 'low'];

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeCandidate(raw: unknown): ResearchCandidate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const fullName = cleanString(record.fullName);
  if (!fullName) return null;

  const emailAddress = cleanString(record.emailAddress);
  const websiteUrl = cleanString(record.websiteUrl);
  const sourceUrl = cleanString(record.sourceUrl);
  const confidenceRaw = typeof record.confidence === 'string' ? record.confidence : null;

  return {
    fullName,
    title: cleanString(record.title),
    emailAddress: emailAddress && EMAIL_REGEX.test(emailAddress) ? emailAddress : null,
    phoneNumber: cleanString(record.phoneNumber),
    websiteUrl: websiteUrl && isValidUrl(websiteUrl) ? websiteUrl : null,
    confidence: confidenceRaw && CONFIDENCE_VALUES.includes(confidenceRaw as ConfidenceLevel)
      ? (confidenceRaw as ConfidenceLevel)
      : 'low',
    sourceUrl: sourceUrl && isValidUrl(sourceUrl) ? sourceUrl : null,
    sourceSnippet: cleanString(record.sourceSnippet),
  };
}

export function normalizeCandidates(raw: unknown): ResearchCandidate[] {
  if (!Array.isArray(raw)) return [];
  const candidates: ResearchCandidate[] = [];
  for (const item of raw) {
    const normalized = normalizeCandidate(item);
    if (normalized) candidates.push(normalized);
  }
  return candidates.slice(0, 10);
}
