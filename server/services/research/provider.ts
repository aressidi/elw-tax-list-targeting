import { mockResearchProvider } from './mockProvider.js';
import { unavailableResearchProvider } from './unavailableProvider.js';
import { httpResearchProvider } from './httpProvider.js';
import { aiResearchProvider } from './aiProvider.js';
import type { ResearchProvider } from './types.js';

/**
 * Selects which research provider handles a request.
 *
 * - RESEARCH_PROVIDER=mock enables the deterministic offline provider everywhere.
 * - RESEARCH_PROVIDER=http enables the generic HTTP adapter (needs RESEARCH_PROVIDER_URL).
 * - RESEARCH_PROVIDER=ai enables the AI web-search adapter (needs RESEARCH_AI_BASE_URL,
 *   RESEARCH_AI_API_KEY, RESEARCH_AI_MODEL).
 * - A per-request `mode: 'mock'` override is honored outside production, or in
 *   production only when RESEARCH_ALLOW_MOCK_OVERRIDE=true is explicitly set —
 *   demo data must never appear in production by default.
 * - Otherwise, no provider is configured and callers get a clear failure instead
 *   of fabricated results.
 */
export function getResearchProvider(requestedMode?: string | null): ResearchProvider {
  const configured = process.env.RESEARCH_PROVIDER;
  const allowMockOverride =
    process.env.NODE_ENV !== 'production' || process.env.RESEARCH_ALLOW_MOCK_OVERRIDE === 'true';

  if (requestedMode === 'mock' && allowMockOverride) return mockResearchProvider;
  if (requestedMode === 'http') return httpResearchProvider;
  if (requestedMode === 'ai') return aiResearchProvider;
  if (configured === 'mock') return mockResearchProvider;
  if (configured === 'http') return httpResearchProvider;
  if (configured === 'ai') return aiResearchProvider;
  return unavailableResearchProvider;
}
