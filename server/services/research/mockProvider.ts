import type { ResearchCandidate, ResearchProvider } from './types.js';

// Uses the reserved .test TLD (RFC 2606) so demo URLs can never resolve to a
// real government domain and be mistaken for verified data.
const DEMO_DOMAIN = 'county-research-demo.test';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

const TITLES = ['Tax Collector', 'County Treasurer'];
const CONFIDENCES: ResearchCandidate['confidence'][] = ['high', 'medium', 'low'];

/**
 * Deterministic, offline provider for local development and tests. Every result is
 * clearly labeled as demo data and must never be treated as verified contact info.
 */
export const mockResearchProvider: ResearchProvider = {
  name: 'mock',
  async research({ countyName, stateName, stateAbbreviation }) {
    const seed = hashString(`${countyName}|${stateAbbreviation}`);
    const slug = slugify(`${countyName}-county-${stateAbbreviation}`);
    const numCandidates = 1 + (seed % 2);
    const candidates: ResearchCandidate[] = [];

    for (let i = 0; i < numCandidates; i++) {
      const title = TITLES[i % TITLES.length];
      const confidence = CONFIDENCES[(seed + i) % CONFIDENCES.length];
      const letter = String.fromCharCode(65 + ((seed + i) % 26));
      const titleSlug = title.toLowerCase().replace(/\s+/g, '-');

      candidates.push({
        fullName: `DEMO Official ${letter}. Sample`,
        title,
        emailAddress: `demo.${titleSlug.replace(/-/g, '')}@${DEMO_DOMAIN}`,
        phoneNumber: `555-01${String((seed + i) % 90 + 10)}`,
        websiteUrl: `https://${DEMO_DOMAIN}/${slug}/${titleSlug}`,
        confidence,
        sourceUrl: `https://${DEMO_DOMAIN}/${slug}`,
        sourceSnippet:
          `[DEMO DATA - NOT VERIFIED] Simulated directory listing for the ${title} of ` +
          `${countyName} County, ${stateName}. Configure a real research provider for live results.`,
      });
    }

    return { ok: true, provider: 'mock', isDemo: true, candidates };
  },
};
