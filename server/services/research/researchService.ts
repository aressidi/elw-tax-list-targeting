import { desc, eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { counties, countyResearchRuns, type CountyResearchRun } from '../../../shared/schema.js';
import { getResearchProvider } from './provider.js';

// A county that just started or finished a research run cannot be re-researched
// again within this window (bypassable with `force: true`) to avoid rapid-fire
// duplicate calls to a research provider.
const RESEARCH_COOLDOWN_MS = Number(process.env.RESEARCH_COOLDOWN_MS) || 15_000;

// Completed results are treated as cached and returned as-is within this window
// instead of re-running research, unless the caller passes `force: true`.
const RESEARCH_CACHE_TTL_MS = Number(process.env.RESEARCH_CACHE_TTL_MS) || 60 * 60 * 1000;

export type TriggerResearchResult =
  | { kind: 'not_found' }
  | { kind: 'conflict'; message: string }
  | { kind: 'rate_limited'; message: string; retryAfterMs: number }
  | { kind: 'cached'; run: CountyResearchRun }
  | { kind: 'completed'; run: CountyResearchRun }
  | { kind: 'failed'; run: CountyResearchRun; providerUnavailable: boolean; error?: string };

export async function triggerCountyResearch(
  countyId: number,
  options: { requestedProvider?: string | null; force?: boolean } = {}
): Promise<TriggerResearchResult> {
  const county = await db.query.counties.findFirst({
    where: eq(counties.id, countyId),
    with: { state: true },
  });
  if (!county) return { kind: 'not_found' };

  const latestRun = await db.query.countyResearchRuns.findFirst({
    where: eq(countyResearchRuns.countyId, countyId),
    orderBy: desc(countyResearchRuns.requestedAt),
  });

  const force = options.force === true;
  const now = Date.now();

  if (latestRun && !force) {
    if (latestRun.status === 'in_progress') {
      return { kind: 'conflict', message: 'Research is already in progress for this county.' };
    }

    const elapsed = now - new Date(latestRun.requestedAt).getTime();
    if (elapsed < RESEARCH_COOLDOWN_MS) {
      return {
        kind: 'rate_limited',
        message: 'Please wait before researching this county again.',
        retryAfterMs: RESEARCH_COOLDOWN_MS - elapsed,
      };
    }

    if (latestRun.status === 'completed' && elapsed < RESEARCH_CACHE_TTL_MS) {
      return { kind: 'cached', run: latestRun };
    }
  }

  const provider = getResearchProvider(options.requestedProvider ?? null);
  const cacheKey = `${countyId}:${provider.name}`;

  const [runRow] = await db
    .insert(countyResearchRuns)
    .values({
      countyId,
      status: 'in_progress',
      provider: provider.name,
      isDemo: false,
      cacheKey,
    })
    .returning();

  await db.update(counties).set({ researchStatus: 'in_progress' }).where(eq(counties.id, countyId));

  const outcome = await provider.research({
    countyName: county.name,
    stateName: county.state.name,
    stateAbbreviation: county.state.abbreviation,
  });

  const [updatedRun] = await db
    .update(countyResearchRuns)
    .set({
      status: outcome.ok ? 'completed' : 'failed',
      completedAt: new Date(),
      isDemo: outcome.isDemo,
      resultData: { candidates: outcome.candidates },
      errorMessage: outcome.error ?? null,
    })
    .where(eq(countyResearchRuns.id, runRow.id))
    .returning();

  await db
    .update(counties)
    .set({ researchStatus: outcome.ok ? 'needs_review' : 'failed' })
    .where(eq(counties.id, countyId));

  if (!outcome.ok) {
    return {
      kind: 'failed',
      run: updatedRun,
      providerUnavailable: provider.name === 'none',
      error: outcome.error,
    };
  }

  return { kind: 'completed', run: updatedRun };
}
