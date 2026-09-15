import type { ResearchCandidate, ResearchProvider } from './types.js';
import { normalizeCandidates } from './normalize.js';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'moonshotai/kimi-k2.5';
const DEFAULT_WEB_SEARCH_ENGINE = 'exa';

interface UrlCitationAnnotation {
  url: string;
  title?: string;
  content?: string;
}

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
 * Extracts OpenRouter's `url_citation` message annotations, which point at the
 * server-side web_search results the model actually consulted.
 */
function extractUrlCitations(message: Record<string, unknown> | undefined): UrlCitationAnnotation[] {
  const annotations = message?.annotations;
  if (!Array.isArray(annotations)) return [];

  const citations: UrlCitationAnnotation[] = [];
  for (const annotation of annotations) {
    if (typeof annotation !== 'object' || annotation === null) continue;
    const record = annotation as Record<string, unknown>;
    if (record.type !== 'url_citation') continue;
    const citation = record.url_citation as Record<string, unknown> | undefined;
    const url = typeof citation?.url === 'string' ? citation.url : null;
    if (!url) continue;
    citations.push({
      url,
      title: typeof citation?.title === 'string' ? citation.title : undefined,
      content: typeof citation?.content === 'string' ? citation.content : undefined,
    });
  }
  return citations;
}

/**
 * Fills in sourceSnippet from a matching url_citation when the model provided
 * a sourceUrl but skipped the snippet. Never invents a sourceUrl for a
 * candidate that didn't already have one — citations only enrich, they never
 * become the sole basis for a source.
 */
function enrichWithCitations(
  candidates: ResearchCandidate[],
  citations: UrlCitationAnnotation[]
): ResearchCandidate[] {
  if (citations.length === 0) return candidates;
  return candidates.map((candidate) => {
    if (!candidate.sourceUrl || candidate.sourceSnippet) return candidate;
    const match = citations.find((citation) => citation.url === candidate.sourceUrl);
    if (!match) return candidate;
    const snippet = match.content || match.title || null;
    return snippet ? { ...candidate, sourceSnippet: snippet } : candidate;
  });
}

/**
 * Calls an OpenAI-compatible chat-completions endpoint (defaults to OpenRouter
 * with Kimi K2.5) to find real, currently-serving county officials. Optionally
 * attaches OpenRouter's server-side web_search tool (Exa engine) so the model
 * can look up current officials instead of relying on training data, which it
 * has no live access to and would otherwise hallucinate.
 */
export const aiResearchProvider: ResearchProvider = {
  name: 'ai',
  async research({ countyName, stateName, stateAbbreviation }) {
    const baseUrl = process.env.RESEARCH_AI_BASE_URL || DEFAULT_BASE_URL;
    const apiKey = process.env.RESEARCH_AI_API_KEY;
    const model = process.env.RESEARCH_AI_MODEL || DEFAULT_MODEL;
    const webSearchEngine = process.env.RESEARCH_AI_WEB_SEARCH || DEFAULT_WEB_SEARCH_ENGINE;
    const webSearchEnabled = webSearchEngine !== 'none';

    if (!apiKey) {
      return {
        ok: false,
        provider: 'ai',
        isDemo: false,
        candidates: [],
        error: 'AI research provider is not fully configured. Set RESEARCH_AI_API_KEY to enable it.',
      };
    }

    const timeoutMs = Number(process.env.RESEARCH_AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    const systemPrompt =
      'You are an expert researcher who finds official government contact information. ' +
      (webSearchEnabled
        ? 'Use the web_search tool to look up current information — you may search multiple ' +
          'times if needed. '
        : '') +
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

    const tools = webSearchEnabled
      ? [
          {
            type: 'openrouter:web_search',
            parameters: {
              engine: webSearchEngine,
              max_results: 5,
              max_uses: 2,
              max_total_results: 10,
            },
          },
        ]
      : undefined;

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
            ...(tools ? { tools } : {}),
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
      // OpenRouter executes server-side tools (like web_search) internally and
      // only returns to us once the model has produced its final answer, so a
      // single response here may reflect several searches. We intentionally
      // don't gate on finish_reason (it may read "tool_calls" even on a final,
      // content-bearing turn) — the only thing that matters is whether usable
      // message content is present.
      const message = json?.choices?.[0]?.message as Record<string, unknown> | undefined;
      const content = message?.content;
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
      const citations = extractUrlCitations(message);
      const candidates = demoteUnsourcedCandidates(
        enrichWithCitations(normalizeCandidates(rawCandidates), citations)
      );

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
