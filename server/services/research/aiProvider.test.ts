import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { aiResearchProvider } from './aiProvider.js';

// Card 10073a62: Nash County research surfaced a raw "This operation was
// aborted" and left the user unsure whether to retry. These tests exercise
// aiResearchProvider's timeout handling as a deterministic seam — no real
// network/OpenRouter calls — by swapping out global.fetch, which is the only
// I/O aiProvider.ts performs.

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string>) {
  process.env.RESEARCH_AI_API_KEY = 'test-key';
  process.env.RESEARCH_AI_BASE_URL = 'https://example.invalid/v1';
  Object.assign(process.env, overrides);
}

/** Mimics real fetch: never settles on its own, only rejects once the AbortSignal fires. */
function neverResolvingUntilAborted(): (input: unknown, init?: RequestInit) => Promise<Response> {
  return (_input, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener('abort', () => {
        reject(new DOMException('This operation was aborted', 'AbortError'));
      });
    });
}

function okResponseWithCandidate(): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              candidates: [
                {
                  fullName: 'Jane Doe',
                  title: 'Tax Collector',
                  emailAddress: 'jane@example.gov',
                  phoneNumber: null,
                  websiteUrl: null,
                  confidence: 'high',
                  sourceUrl: 'https://example.gov/officials',
                  sourceSnippet: null,
                },
              ],
            }),
          },
        },
      ],
    }),
    { status: 200 }
  );
}

const RESEARCH_INPUT = { countyName: 'Nash', stateName: 'North Carolina', stateAbbreviation: 'NC' };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  process.env = { ...ORIGINAL_ENV };
});

test('a single-attempt timeout returns a clear, timeout-specific error (not the raw AbortError message)', async () => {
  setEnv({ RESEARCH_AI_TIMEOUT_MS: '20', RESEARCH_AI_MAX_ATTEMPTS: '1' });
  let calls = 0;
  global.fetch = (async (...args: Parameters<typeof fetch>) => {
    calls++;
    return neverResolvingUntilAborted()(...args);
  }) as typeof fetch;

  const outcome = await aiResearchProvider.research(RESEARCH_INPUT);

  assert.equal(outcome.ok, false);
  assert.equal(calls, 1);
  assert.match(outcome.error ?? '', /timed out after 0s/);
  assert.doesNotMatch(outcome.error ?? '', /^This operation was aborted$/);
  assert.doesNotMatch(outcome.error ?? '', /retried/);
});

test('a timeout is retried once and a subsequent success is returned (does not fabricate candidates)', async () => {
  setEnv({ RESEARCH_AI_TIMEOUT_MS: '20', RESEARCH_AI_MAX_ATTEMPTS: '2' });
  let calls = 0;
  global.fetch = (async (...args: Parameters<typeof fetch>) => {
    calls++;
    if (calls === 1) return neverResolvingUntilAborted()(...args);
    return okResponseWithCandidate();
  }) as typeof fetch;

  const outcome = await aiResearchProvider.research(RESEARCH_INPUT);

  assert.equal(calls, 2, 'expected exactly one retry after the first timeout');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.candidates.length, 1);
  assert.equal(outcome.candidates[0].fullName, 'Jane Doe');
});

test('repeated timeouts across all attempts fail with a bounded, actionable message and no in-progress leak', async () => {
  setEnv({ RESEARCH_AI_TIMEOUT_MS: '20', RESEARCH_AI_MAX_ATTEMPTS: '2' });
  let calls = 0;
  global.fetch = (async (...args: Parameters<typeof fetch>) => {
    calls++;
    return neverResolvingUntilAborted()(...args);
  }) as typeof fetch;

  const outcome = await aiResearchProvider.research(RESEARCH_INPUT);

  assert.equal(calls, 2, 'expected exactly maxAttempts fetch calls, not an unbounded retry loop');
  assert.equal(outcome.ok, false);
  assert.equal(outcome.candidates.length, 0);
  assert.match(outcome.error ?? '', /timed out after 0s per attempt \(retried 1 time, 0s total\)/);
});

test('a non-timeout failure (e.g. network error) is not retried', async () => {
  setEnv({ RESEARCH_AI_TIMEOUT_MS: '20', RESEARCH_AI_MAX_ATTEMPTS: '2' });
  let calls = 0;
  global.fetch = (async () => {
    calls++;
    throw new TypeError('fetch failed: getaddrinfo ENOTFOUND example.invalid');
  }) as typeof fetch;

  const outcome = await aiResearchProvider.research(RESEARCH_INPUT);

  assert.equal(calls, 1, 'non-timeout errors should fail fast rather than retry');
  assert.equal(outcome.ok, false);
  assert.match(outcome.error ?? '', /ENOTFOUND/);
});

test('an empty candidate list is a definitive failure and is not retried', async () => {
  setEnv({ RESEARCH_AI_TIMEOUT_MS: '20', RESEARCH_AI_MAX_ATTEMPTS: '2' });
  let calls = 0;
  global.fetch = (async () => {
    calls++;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ candidates: [] }) } }] }),
      { status: 200 }
    );
  }) as typeof fetch;

  const outcome = await aiResearchProvider.research(RESEARCH_INPUT);

  assert.equal(calls, 1, 'a well-formed empty result should not be retried — retrying the same request would not change the outcome');
  assert.equal(outcome.ok, false);
  assert.match(outcome.error ?? '', /did not return any usable candidates/);
});
