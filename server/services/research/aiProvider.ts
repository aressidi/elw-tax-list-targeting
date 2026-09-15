import type { ResearchCandidate, ResearchProvider } from './types.js';
import { normalizeCandidates } from './normalize.js';

const DEFAULT_TIMEOUT_MS = 15000;

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

function demoteUnsourcedCandidates(candidates: ResearchCandidate[]): ResearchCandidate[] {
  return candidates.map((candidate) =>
    candidate.sourceUrl ? candidate : { ...candidate, confidence: 'low' }
  );
}

/**
 * Calls an OpenAI-compatible chat-completions endpoint backed by a
 * web-search-capable model to find real, currently-serving county officials.
 * Plain chat models without live web access will hallucinate contacts, so
 * this provider refuses to run without explicit configuration and never
 * fabricates candidates when misconfigured or when the model response is
 * unusable.
 */
export const aiResearchProvider: ResearchProvider = {
  name: 'ai',
  async research({ countyName, stateName, stateAbbreviation }) {
    const baseUrl = process.env.RESEARCH_AI_BASE_URL;
    const apiKey = process.env.RESEARCH_AI_API_KEY;
    const model = process.env.RESEARCH_AI_MODEL;

    if (!baseUrl || !apiKey || !model) {
      const missing = [
        !baseUrl && 'RESEARCH_AI_BASE_URL',
        !apiKey && 'RESEARCH_AI_API_KEY',
        !model && 'RESEARCH_AI_MODEL',
      ].filter(Boolean).join(', ');
      return {
        ok: false,
        provider: 'ai',
        isDemo: false,
        candidates: [],
        error: `AI research provider is not fully configured. Set ${missing} to enable it.`,
      };
    }

    const timeoutMs = Number(process.env.RESEARCH_AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    const systemPrompt =
      'You are an expert researcher who finds official government contact information. ' +
      'You only report real, currently-serving personnel that you can verify with a source URL. ' +
      'You never invent names, emails, phone numbers, or URLs.';
    const userPrompt =
      `Research the current County Treasurer and Tax Collector of ${countyName} County, ` +
      `${stateName} (${stateAbbreviation}). Return only real, currently-serving personnel with ` +
      'source URLs from official government websites. ' +
      'Respond with STRICT JSON only (no markdown, no prose, no code fences) matching this shape: ' +
      '{"candidates":[{"fullName":string,"title":string,"emailAddress":string|null,' +
      '"phoneNumber":string|null,"websiteUrl":string|null,"confidence":"high"|"medium"|"low",' +
      '"sourceUrl":string|null,"sourceSnippet":string|null}]}. ' +
      'If you cannot find a verifiable official, omit them rather than guessing.';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        return {
          ok: false,
          provider: 'ai',
          isDemo: false,
          candidates: [],
          error: `AI research provider responded with status ${response.status}.`,
        };
      }

      const json = await response.json();
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        console.debug('[aiResearchProvider] response missing usable message content', json);
        return {
          ok: false,
          provider: 'ai',
          isDemo: false,
          candidates: [],
          error: 'AI research provider returned an empty or unusable response.',
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(stripCodeFences(content));
      } catch {
        console.debug('[aiResearchProvider] failed to parse model response as JSON', content);
        return {
          ok: false,
          provider: 'ai',
          isDemo: false,
          candidates: [],
          error: 'AI research provider returned a response that could not be parsed as JSON.',
        };
      }

      const rawCandidates = (parsed as Record<string, unknown>)?.candidates;
      const candidates = demoteUnsourcedCandidates(normalizeCandidates(rawCandidates));

      if (candidates.length === 0) {
        return {
          ok: false,
          provider: 'ai',
          isDemo: false,
          candidates: [],
          error: 'AI research provider did not return any usable candidates.',
        };
      }

      return { ok: true, provider: 'ai', isDemo: false, candidates };
    } catch (error) {
      return {
        ok: false,
        provider: 'ai',
        isDemo: false,
        candidates: [],
        error: error instanceof Error ? error.message : 'AI research provider request failed.',
      };
    }
  },
};
