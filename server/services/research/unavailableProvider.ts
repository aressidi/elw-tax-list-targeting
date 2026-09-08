import type { ResearchProvider } from './types.js';

/**
 * Used whenever no research provider is configured. Returns a clear, actionable
 * failure instead of ever fabricating contact data.
 */
export const unavailableResearchProvider: ResearchProvider = {
  name: 'none',
  async research() {
    return {
      ok: false,
      provider: 'none',
      isDemo: false,
      candidates: [],
      error:
        'No research provider is configured. Set RESEARCH_PROVIDER=mock for local development/testing, ' +
        'or set RESEARCH_PROVIDER=http with RESEARCH_PROVIDER_URL for a real provider. ' +
        'You can still add contacts manually while research is unavailable.',
    };
  },
};
