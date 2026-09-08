import type { ConfidenceLevel, ResearchCandidate, ResearchProvider } from './types.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONFIDENCE_VALUES: ConfidenceLevel[] = ['high', 'medium', 'low'];

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeCandidate(raw: unknown): ResearchCandidate | null {
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

function normalizeCandidates(raw: unknown): ResearchCandidate[] {
  if (!Array.isArray(raw)) return [];
  const candidates: ResearchCandidate[] = [];
  for (const item of raw) {
    const normalized = normalizeCandidate(item);
    if (normalized) candidates.push(normalized);
  }
  return candidates.slice(0, 10);
}

/**
 * Thin adapter for an externally hosted research service. No credentials or
 * paid-provider specifics are hard-coded here; the endpoint and API key are
 * supplied entirely through environment variables documented in .env.example.
 * This app has no built-in external research API dependency by default.
 */
export const httpResearchProvider: ResearchProvider = {
  name: 'http',
  async research({ countyName, stateName, stateAbbreviation }) {
    const url = process.env.RESEARCH_PROVIDER_URL;
    if (!url) {
      return {
        ok: false,
        provider: 'http',
        isDemo: false,
        candidates: [],
        error: 'RESEARCH_PROVIDER_URL is not set; cannot reach the configured HTTP research provider.',
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(process.env.RESEARCH_PROVIDER_API_KEY
              ? { Authorization: `Bearer ${process.env.RESEARCH_PROVIDER_API_KEY}` }
              : {}),
          },
          body: JSON.stringify({ countyName, stateName, stateAbbreviation }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        return {
          ok: false,
          provider: 'http',
          isDemo: false,
          candidates: [],
          error: `Research provider responded with status ${response.status}.`,
        };
      }

      const json = await response.json();
      const rawCandidates = json?.candidates ?? json?.data?.candidates ?? [];
      return {
        ok: true,
        provider: 'http',
        isDemo: false,
        candidates: normalizeCandidates(rawCandidates),
      };
    } catch (error) {
      return {
        ok: false,
        provider: 'http',
        isDemo: false,
        candidates: [],
        error: error instanceof Error ? error.message : 'Research provider request failed.',
      };
    }
  },
};
