import type { ResearchProvider } from './types.js';
import { normalizeCandidates } from './normalize.js';

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
