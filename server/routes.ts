import { Router } from 'express';
import { eq, and, like, ilike, desc, asc, sql, count, isNull, isNotNull, not, or, gte, lte, inArray } from 'drizzle-orm';
import { db } from './db.js';
import {
  states,
  counties,
  taxOfficials,
  foiaTemplates,
  listRequests,
  listRequestPrices,
  listRequestEvents,
  listRequestStatusHistory,
  emailTracking,
  processedLists,
  countyResearchRuns,
  inboxItems,
} from '../shared/schema.js';
import { triggerCountyResearch } from './services/research/researchService.js';
import {
  analyzeTemplateVariables,
  renderTemplateText,
  SUPPORTED_VARIABLE_KEYS,
  DEFAULT_SAMPLE_DATA,
  type TemplateSampleData,
} from '../shared/templateVariables.js';
import {
  getActiveTransport,
  prepareListRequestEmail,
  sendListRequestEmail,
  sendListRequestEmailsBulk,
} from './services/emailService.js';
import {
  cancelQueueItem,
  enqueueListRequestEmail,
  enqueueListRequestEmailsBulk,
  getOrCreateSettings,
  getQueueStatus,
  isValidDailyLimit,
  listQueueItems,
  setPaused,
  updateDailyLimit,
} from './services/queueService.js';
import { pollInbox, getActiveInboxProvider } from './services/inboxService.js';

const router = Router();

const TARGET_PRIORITIES = ['high', 'medium', 'low'] as const;
type TargetPriority = (typeof TARGET_PRIORITIES)[number];

const RESEARCH_STATUSES = [
  'not_started',
  'in_progress',
  'completed',
  'needs_review',
  'skipped',
  'failed',
] as const;
type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_BULK_RESEARCH_COUNTIES = 25;
const MAX_AI_IMPORT_CONTACTS = 20;
const MAX_BULK_SEND_REQUESTS = 50;
const MAX_BULK_ENQUEUE_REQUESTS = 50;

const REQUEST_STATUSES = [
  'not_started',
  'research_needed',
  'ready_to_email',
  'email_sent',
  'awaiting_response',
  'response_received',
  'list_provided',
  'requires_payment',
  'requires_form',
  'not_available',
  'declined',
] as const;
type RequestStatus = (typeof REQUEST_STATUSES)[number];

// ============================================================
// Helper Functions
// ============================================================

function getPagination(req: any): { limit: number; offset: number; page: number } {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;
  return { limit, offset, page };
}

function successResponse<T>(data: T, meta?: Record<string, any>) {
  return { success: true, data, ...meta };
}

function errorResponse(error: string, statusCode: number = 500) {
  return { success: false, error, statusCode };
}

function isTargetPriority(value: unknown): value is TargetPriority {
  return typeof value === 'string' && (TARGET_PRIORITIES as readonly string[]).includes(value);
}

function isResearchStatus(value: unknown): value is ResearchStatus {
  return typeof value === 'string' && (RESEARCH_STATUSES as readonly string[]).includes(value);
}

function isConfidenceLevel(value: unknown): value is (typeof CONFIDENCE_LEVELS)[number] {
  return typeof value === 'string' && (CONFIDENCE_LEVELS as readonly string[]).includes(value);
}

function isRequestStatus(value: unknown): value is RequestStatus {
  return typeof value === 'string' && (REQUEST_STATUSES as readonly string[]).includes(value);
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as { code?: string; cause?: { code?: string } };
  return err.code === '23505' || err.cause?.code === '23505';
}

function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value);
}

function hasContactMethod(email: string | null | undefined, phone: string | null | undefined): boolean {
  return Boolean(email) || Boolean(phone);
}

// Duplicate detection for manual contact creation/updates: same name or same
// email within a county is rejected rather than silently creating a second
// record for the same person.
async function findDuplicateContact(
  countyId: number,
  fullName: string,
  emailAddress: string | null,
  excludeId?: number
): Promise<string | null> {
  const existing = await db.query.taxOfficials.findMany({ where: eq(taxOfficials.countyId, countyId) });
  const nameKey = fullName.trim().toLowerCase();
  const emailKey = emailAddress ? emailAddress.trim().toLowerCase() : null;

  for (const o of existing) {
    if (excludeId !== undefined && o.id === excludeId) continue;
    if (o.fullName.trim().toLowerCase() === nameKey) {
      return `A contact named "${fullName}" already exists for this county`;
    }
    if (emailKey && o.emailAddress && o.emailAddress.trim().toLowerCase() === emailKey) {
      return `A contact with email "${emailAddress}" already exists for this county`;
    }
  }
  return null;
}

// ============================================================
// Health Check
// ============================================================
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// States Routes
// ============================================================

// GET /api/states - List all states with county counts and priority breakdown
router.get('/states', async (_req, res) => {
  try {
    const results = await db.query.states.findMany({
      orderBy: asc(states.name),
    });

    const countyCounts = await db
      .select({
        stateId: counties.stateId,
        total: count(),
        high: sql<number>`count(*) filter (where ${counties.targetPriority} = 'high')`,
        medium: sql<number>`count(*) filter (where ${counties.targetPriority} = 'medium')`,
        low: sql<number>`count(*) filter (where ${counties.targetPriority} = 'low')`,
      })
      .from(counties)
      .groupBy(counties.stateId);

    const countsByState = new Map(countyCounts.map((c) => [c.stateId, c]));

    const data = results.map((state) => {
      const c = countsByState.get(state.id);
      const highPriorityCountyCount = Number(c?.high ?? 0);
      const mediumPriorityCountyCount = Number(c?.medium ?? 0);
      const lowPriorityCountyCount = Number(c?.low ?? 0);
      const topCountyPriority: TargetPriority | null = highPriorityCountyCount > 0
        ? 'high'
        : mediumPriorityCountyCount > 0
          ? 'medium'
          : lowPriorityCountyCount > 0
            ? 'low'
            : null;

      return {
        ...state,
        countyCount: Number(c?.total ?? 0),
        highPriorityCountyCount,
        mediumPriorityCountyCount,
        lowPriorityCountyCount,
        topCountyPriority,
      };
    });

    res.json(successResponse(data));
  } catch (error) {
    console.error('Error fetching states:', error);
    res.status(500).json(errorResponse('Failed to fetch states'));
  }
});

// GET /api/states/:id - Get state (by numeric ID or abbreviation) with counties,
// contact counts, and request-status summaries
router.get('/states/:id', async (req, res) => {
  try {
    const param = req.params.id;
    const isNumeric = /^\d+$/.test(param);
    const whereClause = isNumeric
      ? eq(states.id, parseInt(param))
      : eq(states.abbreviation, param.toUpperCase());

    const state = await db.query.states.findFirst({
      where: whereClause,
      with: {
        counties: {
          orderBy: asc(counties.name),
        },
      },
    });

    if (!state) {
      return res.status(404).json(errorResponse('State not found', 404));
    }

    const countyIds = state.counties.map((c) => c.id);

    let contactCountByCounty = new Map<number, number>();
    let statusSummaryByCounty = new Map<number, Record<string, number>>();

    if (countyIds.length > 0) {
      const contactCounts = await db
        .select({ countyId: taxOfficials.countyId, total: count() })
        .from(taxOfficials)
        .where(inArray(taxOfficials.countyId, countyIds))
        .groupBy(taxOfficials.countyId);
      contactCountByCounty = new Map(contactCounts.map((c) => [c.countyId, Number(c.total)]));

      const statusRows = await db
        .select({
          countyId: taxOfficials.countyId,
          status: listRequests.requestStatus,
          total: count(),
        })
        .from(listRequests)
        .innerJoin(taxOfficials, eq(listRequests.taxOfficialId, taxOfficials.id))
        .where(inArray(taxOfficials.countyId, countyIds))
        .groupBy(taxOfficials.countyId, listRequests.requestStatus);

      for (const row of statusRows) {
        if (!statusSummaryByCounty.has(row.countyId)) {
          statusSummaryByCounty.set(row.countyId, {});
        }
        statusSummaryByCounty.get(row.countyId)![row.status ?? 'not_started'] = Number(row.total);
      }
    }

    const countiesWithMeta = state.counties.map((c) => ({
      ...c,
      contactCount: contactCountByCounty.get(c.id) ?? 0,
      requestStatusSummary: statusSummaryByCounty.get(c.id) ?? {},
    }));

    res.json(successResponse({ ...state, counties: countiesWithMeta }));
  } catch (error) {
    console.error('Error fetching state:', error);
    res.status(500).json(errorResponse('Failed to fetch state'));
  }
});

// ============================================================
// Counties Routes
// ============================================================

// GET /api/counties - List all counties with optional state filter, search, and
// contact/request-status summaries
router.get('/counties', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { stateId, state: stateAbbreviation, priority, targetPriority, search } = req.query;

    let conditions = [];
    if (stateId) conditions.push(eq(counties.stateId, parseInt(stateId as string)));
    if (stateAbbreviation) {
      const stateRow = await db.query.states.findFirst({
        where: eq(states.abbreviation, (stateAbbreviation as string).toUpperCase()),
      });
      // No matching state means the filter can never match any county
      conditions.push(eq(counties.stateId, stateRow?.id ?? -1));
    }
    const priorityFilter = (targetPriority ?? priority) as string | undefined;
    if (priorityFilter) {
      if (!isTargetPriority(priorityFilter)) {
        return res.status(400).json(errorResponse('Invalid targetPriority filter', 400));
      }
      conditions.push(eq(counties.targetPriority, priorityFilter));
    }
    if (search) conditions.push(like(counties.name, `%${search}%`));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const totalResult = await db.select({ count: count() }).from(counties).where(whereClause);
    const total = totalResult[0]?.count || 0;

    const results = await db.query.counties.findMany({
      where: whereClause,
      with: {
        state: true,
      },
      orderBy: asc(counties.name),
      limit,
      offset,
    });

    const countyIds = results.map((c) => c.id);
    let contactCountByCounty = new Map<number, number>();
    let statusSummaryByCounty = new Map<number, Record<string, number>>();

    if (countyIds.length > 0) {
      const contactCounts = await db
        .select({ countyId: taxOfficials.countyId, total: count() })
        .from(taxOfficials)
        .where(inArray(taxOfficials.countyId, countyIds))
        .groupBy(taxOfficials.countyId);
      contactCountByCounty = new Map(contactCounts.map((c) => [c.countyId, Number(c.total)]));

      const statusRows = await db
        .select({
          countyId: taxOfficials.countyId,
          status: listRequests.requestStatus,
          total: count(),
        })
        .from(listRequests)
        .innerJoin(taxOfficials, eq(listRequests.taxOfficialId, taxOfficials.id))
        .where(inArray(taxOfficials.countyId, countyIds))
        .groupBy(taxOfficials.countyId, listRequests.requestStatus);

      for (const row of statusRows) {
        if (!statusSummaryByCounty.has(row.countyId)) {
          statusSummaryByCounty.set(row.countyId, {});
        }
        statusSummaryByCounty.get(row.countyId)![row.status ?? 'not_started'] = Number(row.total);
      }
    }

    const data = results.map((c) => ({
      ...c,
      contactCount: contactCountByCounty.get(c.id) ?? 0,
      requestStatusSummary: statusSummaryByCounty.get(c.id) ?? {},
    }));

    res.json(successResponse(data, {
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    }));
  } catch (error) {
    console.error('Error fetching counties:', error);
    res.status(500).json(errorResponse('Failed to fetch counties'));
  }
});

// GET /api/counties/:id - Get county with state, contacts, and list requests
// (including pricing, events, and status history)
router.get('/counties/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid county ID', 400));
    }

    const county = await db.query.counties.findFirst({
      where: eq(counties.id, id),
      with: {
        state: true,
        taxOfficials: {
          orderBy: [desc(taxOfficials.isPrimary), asc(taxOfficials.fullName)],
          with: {
            listRequests: {
              orderBy: desc(listRequests.createdAt),
              with: {
                prices: {
                  orderBy: desc(listRequestPrices.effectiveDate),
                },
                events: {
                  orderBy: desc(listRequestEvents.occurredAt),
                },
                statusHistory: {
                  orderBy: desc(listRequestStatusHistory.changedAt),
                },
              },
            },
          },
        },
      },
    });

    if (!county) {
      return res.status(404).json(errorResponse('County not found', 404));
    }

    res.json(successResponse(county));
  } catch (error) {
    console.error('Error fetching county:', error);
    res.status(500).json(errorResponse('Failed to fetch county'));
  }
});

// POST /api/counties - Create a new county
router.post('/counties', async (req, res) => {
  try {
    const { stateId, name, countySeat, fipsCode, population, targetPriority, notes } = req.body;

    const parsedStateId = parseInt(stateId);
    if (!stateId || isNaN(parsedStateId)) {
      return res.status(400).json(errorResponse('stateId is required', 400));
    }

    const cleanName = cleanString(name);
    if (!cleanName) {
      return res.status(400).json(errorResponse('name is required', 400));
    }

    if (targetPriority !== undefined && targetPriority !== null && !isTargetPriority(targetPriority)) {
      return res.status(400).json(errorResponse('targetPriority must be high, medium, or low', 400));
    }

    let parsedPopulation: number | null = null;
    if (population !== undefined && population !== null && population !== '') {
      parsedPopulation = parseInt(population);
      if (isNaN(parsedPopulation)) {
        return res.status(400).json(errorResponse('population must be a number', 400));
      }
    }

    const state = await db.query.states.findFirst({ where: eq(states.id, parsedStateId) });
    if (!state) {
      return res.status(400).json(errorResponse('State not found', 400));
    }

    const result = await db.insert(counties).values({
      stateId: parsedStateId,
      name: cleanName,
      countySeat: cleanString(countySeat),
      fipsCode: cleanString(fipsCode),
      population: parsedPopulation,
      targetPriority: targetPriority || 'medium',
      notes: cleanString(notes),
    }).returning();

    res.status(201).json(successResponse(result[0]));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(400).json(errorResponse('A county with this name already exists in the selected state', 400));
    }
    console.error('Error creating county:', error);
    res.status(500).json(errorResponse('Failed to create county'));
  }
});

// PATCH /api/counties/:id - Update a county
router.patch('/counties/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid county ID', 400));
    }

    const { name, countySeat, fipsCode, population, targetPriority, notes, stateId } = req.body;
    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      const cleanName = cleanString(name);
      if (!cleanName) {
        return res.status(400).json(errorResponse('name cannot be empty', 400));
      }
      updateData.name = cleanName;
    }
    if (countySeat !== undefined) updateData.countySeat = cleanString(countySeat);
    if (fipsCode !== undefined) updateData.fipsCode = cleanString(fipsCode);
    if (population !== undefined) {
      if (population === null || population === '') {
        updateData.population = null;
      } else {
        const parsedPopulation = parseInt(population);
        if (isNaN(parsedPopulation)) {
          return res.status(400).json(errorResponse('population must be a number', 400));
        }
        updateData.population = parsedPopulation;
      }
    }
    if (targetPriority !== undefined) {
      if (!isTargetPriority(targetPriority)) {
        return res.status(400).json(errorResponse('targetPriority must be high, medium, or low', 400));
      }
      updateData.targetPriority = targetPriority;
    }
    if (notes !== undefined) updateData.notes = cleanString(notes);
    if (stateId !== undefined) {
      const parsedStateId = parseInt(stateId);
      if (isNaN(parsedStateId)) {
        return res.status(400).json(errorResponse('Invalid stateId', 400));
      }
      const state = await db.query.states.findFirst({ where: eq(states.id, parsedStateId) });
      if (!state) {
        return res.status(400).json(errorResponse('State not found', 400));
      }
      updateData.stateId = parsedStateId;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json(errorResponse('No valid fields to update', 400));
    }

    const result = await db.update(counties).set(updateData).where(eq(counties.id, id)).returning();

    if (result.length === 0) {
      return res.status(404).json(errorResponse('County not found', 404));
    }

    res.json(successResponse(result[0]));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(400).json(errorResponse('A county with this name already exists in the selected state', 400));
    }
    console.error('Error updating county:', error);
    res.status(500).json(errorResponse('Failed to update county'));
  }
});

// DELETE /api/counties/:id - Delete a county (cascades to contacts and list requests)
router.delete('/counties/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid county ID', 400));
    }

    const result = await db.delete(counties).where(eq(counties.id, id)).returning();

    if (result.length === 0) {
      return res.status(404).json(errorResponse('County not found', 404));
    }

    res.json(successResponse({ id, deleted: true }));
  } catch (error) {
    console.error('Error deleting county:', error);
    res.status(500).json(errorResponse('Failed to delete county'));
  }
});

// ============================================================
// Research Queue & AI Contact Research Routes
//
// AI research results are never written directly into tax_officials.
// They live in county_research_runs until a human explicitly approves
// candidates via POST /api/counties/:id/contacts/ai-import.
// ============================================================

// GET /api/research-queue - Counties needing research, with filters and
// latest-run metadata for the research queue UI
router.get('/research-queue', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { state: stateAbbreviation, priority, targetPriority, status, researchStatus } = req.query;

    let conditions = [];
    if (stateAbbreviation) {
      const stateRow = await db.query.states.findFirst({
        where: eq(states.abbreviation, (stateAbbreviation as string).toUpperCase()),
      });
      conditions.push(eq(counties.stateId, stateRow?.id ?? -1));
    }

    const priorityFilter = (targetPriority ?? priority) as string | undefined;
    if (priorityFilter) {
      if (!isTargetPriority(priorityFilter)) {
        return res.status(400).json(errorResponse('Invalid targetPriority filter', 400));
      }
      conditions.push(eq(counties.targetPriority, priorityFilter));
    }

    const statusFilter = (researchStatus ?? status) as string | undefined;
    if (statusFilter) {
      if (!isResearchStatus(statusFilter)) {
        return res.status(400).json(errorResponse('Invalid researchStatus filter', 400));
      }
      conditions.push(eq(counties.researchStatus, statusFilter));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const totalResult = await db.select({ count: count() }).from(counties).where(whereClause);
    const total = totalResult[0]?.count || 0;

    const results = await db.query.counties.findMany({
      where: whereClause,
      with: { state: true },
      orderBy: asc(counties.name),
      limit,
      offset,
    });

    const countyIds = results.map((c) => c.id);
    let contactCountByCounty = new Map<number, number>();
    let latestRunByCounty = new Map<number, typeof countyResearchRuns.$inferSelect>();

    if (countyIds.length > 0) {
      const contactCounts = await db
        .select({ countyId: taxOfficials.countyId, total: count() })
        .from(taxOfficials)
        .where(inArray(taxOfficials.countyId, countyIds))
        .groupBy(taxOfficials.countyId);
      contactCountByCounty = new Map(contactCounts.map((c) => [c.countyId, Number(c.total)]));

      const runs = await db.query.countyResearchRuns.findMany({
        where: inArray(countyResearchRuns.countyId, countyIds),
        orderBy: desc(countyResearchRuns.requestedAt),
      });
      for (const run of runs) {
        if (!latestRunByCounty.has(run.countyId)) {
          latestRunByCounty.set(run.countyId, run);
        }
      }
    }

    const data = results.map((c) => {
      const latestRun = latestRunByCounty.get(c.id);
      return {
        id: c.id,
        name: c.name,
        targetPriority: c.targetPriority,
        researchStatus: c.researchStatus,
        contactCount: contactCountByCounty.get(c.id) ?? 0,
        state: c.state,
        latestResearchRun: latestRun
          ? {
              id: latestRun.id,
              status: latestRun.status,
              provider: latestRun.provider,
              isDemo: latestRun.isDemo,
              requestedAt: latestRun.requestedAt,
              completedAt: latestRun.completedAt,
              errorMessage: latestRun.errorMessage,
            }
          : null,
      };
    });

    res.json(successResponse(data, {
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    }));
  } catch (error) {
    console.error('Error fetching research queue:', error);
    res.status(500).json(errorResponse('Failed to fetch research queue'));
  }
});

// POST /api/counties/:id/research - Trigger AI research for a county.
// Never writes contacts; only creates/updates a research run and the
// county's research_status. Rate-limited and cached to avoid rapid-fire
// duplicate provider calls (see server/services/research).
router.post('/counties/:id/research', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid county ID', 400));
    }

    const { provider, force } = req.body ?? {};
    if (provider !== undefined && provider !== null && provider !== 'mock' && provider !== 'http') {
      return res.status(400).json(errorResponse('provider must be "mock" or "http"', 400));
    }

    const result = await triggerCountyResearch(id, {
      requestedProvider: provider ?? null,
      force: force === true,
    });

    switch (result.kind) {
      case 'not_found':
        return res.status(404).json(errorResponse('County not found', 404));
      case 'conflict':
        return res.status(409).json(errorResponse(result.message, 409));
      case 'rate_limited':
        return res.status(429).json(errorResponse(result.message, 429));
      case 'cached':
        return res.json(successResponse(result.run, { cached: true }));
      case 'failed':
        if (result.providerUnavailable) {
          return res
            .status(503)
            .json(errorResponse(result.error || 'No research provider configured.', 503));
        }
        // Provider ran but the attempt failed (e.g. nothing found, upstream error).
        // This is a legitimate, recorded research outcome, not a server error.
        return res.json(successResponse(result.run));
      case 'completed':
        return res.status(201).json(successResponse(result.run));
      default:
        return res.status(500).json(errorResponse('Unexpected research result'));
    }
  } catch (error) {
    console.error('Error triggering research:', error);
    res.status(500).json(errorResponse('Failed to trigger research'));
  }
});

// GET /api/counties/:id/research-results - Get cached/past research runs for a county
router.get('/counties/:id/research-results', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid county ID', 400));
    }

    const county = await db.query.counties.findFirst({ where: eq(counties.id, id) });
    if (!county) {
      return res.status(404).json(errorResponse('County not found', 404));
    }

    const runs = await db.query.countyResearchRuns.findMany({
      where: eq(countyResearchRuns.countyId, id),
      orderBy: desc(countyResearchRuns.requestedAt),
      limit: 10,
    });

    res.json(successResponse({ researchStatus: county.researchStatus, runs }));
  } catch (error) {
    console.error('Error fetching research results:', error);
    res.status(500).json(errorResponse('Failed to fetch research results'));
  }
});

// POST /api/counties/:id/contacts/ai-import - Save explicitly approved AI research
// candidates (or manually-entered contacts) as real tax_officials. This is the ONLY
// path that turns research candidates into contacts; nothing is imported automatically.
router.post('/counties/:id/contacts/ai-import', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid county ID', 400));
    }

    const county = await db.query.counties.findFirst({ where: eq(counties.id, id) });
    if (!county) {
      return res.status(404).json(errorResponse('County not found', 404));
    }

    const { runId, contacts } = req.body ?? {};
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json(errorResponse('contacts must be a non-empty array of approved candidates', 400));
    }
    if (contacts.length > MAX_AI_IMPORT_CONTACTS) {
      return res.status(400).json(errorResponse(`contacts cannot exceed ${MAX_AI_IMPORT_CONTACTS} per request`, 400));
    }

    let parsedRunId: number | null = null;
    if (runId !== undefined && runId !== null) {
      parsedRunId = parseInt(runId);
      if (isNaN(parsedRunId)) {
        return res.status(400).json(errorResponse('Invalid runId', 400));
      }
      const run = await db.query.countyResearchRuns.findFirst({ where: eq(countyResearchRuns.id, parsedRunId) });
      if (!run || run.countyId !== id) {
        return res.status(400).json(errorResponse('Research run not found for this county', 400));
      }
    }

    const primaryCount = contacts.filter((c: any) => c?.isPrimary === true).length;
    if (primaryCount > 1) {
      return res.status(400).json(errorResponse('Only one contact can be marked as primary', 400));
    }

    const prepared: Array<Record<string, unknown>> = [];
    for (let index = 0; index < contacts.length; index++) {
      const raw = contacts[index];
      const fullName = cleanString(raw?.fullName);
      if (!fullName) {
        return res.status(400).json(errorResponse(`contacts[${index}].fullName is required`, 400));
      }

      const emailAddress = cleanString(raw?.emailAddress);
      if (emailAddress && !EMAIL_REGEX.test(emailAddress)) {
        return res.status(400).json(errorResponse(`contacts[${index}].emailAddress is not a valid email`, 400));
      }

      const websiteUrl = cleanString(raw?.websiteUrl);
      if (websiteUrl && !isValidUrl(websiteUrl)) {
        return res.status(400).json(errorResponse(`contacts[${index}].websiteUrl is not a valid URL`, 400));
      }

      const sourceUrl = cleanString(raw?.sourceUrl);
      if (sourceUrl && !isValidUrl(sourceUrl)) {
        return res.status(400).json(errorResponse(`contacts[${index}].sourceUrl is not a valid URL`, 400));
      }

      if (raw?.confidence !== undefined && raw?.confidence !== null && !isConfidenceLevel(raw.confidence)) {
        return res.status(400).json(errorResponse(`contacts[${index}].confidence must be high, medium, or low`, 400));
      }

      prepared.push({
        countyId: id,
        fullName,
        title: cleanString(raw?.title),
        emailAddress,
        phoneNumber: cleanString(raw?.phoneNumber),
        officeAddress: cleanString(raw?.officeAddress),
        websiteUrl,
        notes: cleanString(raw?.sourceSnippet),
        isPrimary: raw?.isPrimary === true,
        researchSource: parsedRunId !== null ? 'ai_search' : 'manual',
        confidenceScore: isConfidenceLevel(raw?.confidence) ? raw.confidence : null,
        sourceUrl,
      });
    }

    // Duplicate detection against existing contacts in the county (by name or email)
    const existing = await db.query.taxOfficials.findMany({ where: eq(taxOfficials.countyId, id) });
    const existingNames = new Set(existing.map((o) => o.fullName.trim().toLowerCase()));
    const existingEmails = new Set(
      existing.filter((o) => o.emailAddress).map((o) => o.emailAddress!.trim().toLowerCase())
    );

    const conflicts: string[] = [];
    const seenNames = new Set<string>();
    const seenEmails = new Set<string>();
    for (const c of prepared) {
      const nameKey = (c.fullName as string).toLowerCase();
      const emailKey = c.emailAddress ? (c.emailAddress as string).toLowerCase() : null;

      if (existingNames.has(nameKey)) {
        conflicts.push(`"${c.fullName}" already exists for this county`);
      } else if (emailKey && existingEmails.has(emailKey)) {
        conflicts.push(`"${c.emailAddress}" already exists for this county`);
      }

      if (seenNames.has(nameKey)) {
        conflicts.push(`Duplicate contact "${c.fullName}" in this submission`);
      }
      if (emailKey && seenEmails.has(emailKey)) {
        conflicts.push(`Duplicate email "${c.emailAddress}" in this submission`);
      }
      seenNames.add(nameKey);
      if (emailKey) seenEmails.add(emailKey);
    }

    if (conflicts.length > 0) {
      return res.status(409).json(errorResponse(`Duplicate contact(s) detected: ${conflicts.join('; ')}`, 409));
    }

    const inserted = await db.transaction(async (tx) => {
      if (prepared.some((c) => c.isPrimary)) {
        await tx.update(taxOfficials).set({ isPrimary: false }).where(eq(taxOfficials.countyId, id));
      }
      const rows = [];
      for (const c of prepared) {
        const [row] = await tx.insert(taxOfficials).values(c as any).returning();
        rows.push(row);
      }
      if (parsedRunId !== null) {
        await tx.update(countyResearchRuns).set({ status: 'completed' }).where(eq(countyResearchRuns.id, parsedRunId));
      }
      await tx.update(counties).set({ researchStatus: 'completed' }).where(eq(counties.id, id));
      return rows;
    });

    res.status(201).json(successResponse(inserted));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json(errorResponse('Duplicate contact detected', 409));
    }
    console.error('Error importing AI contacts:', error);
    res.status(500).json(errorResponse('Failed to import contacts'));
  }
});

// POST /api/research/bulk - Bulk-trigger research or mark counties skipped.
// Safe by construction: this endpoint only enqueues/records research runs or
// updates research_status. It never writes tax_officials rows.
router.post('/research/bulk', async (req, res) => {
  try {
    const { countyIds, action, provider, force } = req.body ?? {};

    if (!Array.isArray(countyIds) || countyIds.length === 0) {
      return res.status(400).json(errorResponse('countyIds must be a non-empty array', 400));
    }
    if (countyIds.length > MAX_BULK_RESEARCH_COUNTIES) {
      return res.status(400).json(errorResponse(`countyIds cannot exceed ${MAX_BULK_RESEARCH_COUNTIES} per request`, 400));
    }
    if (action !== 'research' && action !== 'skip') {
      return res.status(400).json(errorResponse('action must be "research" or "skip"', 400));
    }
    if (provider !== undefined && provider !== null && provider !== 'mock' && provider !== 'http') {
      return res.status(400).json(errorResponse('provider must be "mock" or "http"', 400));
    }

    const parsedIds: number[] = [];
    for (const raw of countyIds) {
      const parsed = parseInt(raw);
      if (isNaN(parsed)) {
        return res.status(400).json(errorResponse('countyIds must contain valid numeric IDs', 400));
      }
      parsedIds.push(parsed);
    }

    const results: Array<Record<string, unknown>> = [];

    if (action === 'skip') {
      for (const countyId of parsedIds) {
        const updated = await db
          .update(counties)
          .set({ researchStatus: 'skipped' })
          .where(eq(counties.id, countyId))
          .returning();
        results.push({ countyId, status: updated.length ? 'skipped' : 'not_found' });
      }
    } else {
      for (const countyId of parsedIds) {
        const outcome = await triggerCountyResearch(countyId, {
          requestedProvider: provider ?? null,
          force: force === true,
        });
        results.push({
          countyId,
          status: outcome.kind,
          message: 'message' in outcome ? outcome.message : ('error' in outcome ? outcome.error : undefined),
        });
      }
    }

    res.json(successResponse({ results }));
  } catch (error) {
    console.error('Error processing bulk research:', error);
    res.status(500).json(errorResponse('Failed to process bulk research request'));
  }
});

// ============================================================
// Contacts / Tax Officials Routes
//
// "/api/contacts" is the card-05 surface: global search/filter/sort across
// counties, plus primary/verify actions. "/api/tax-officials" is preserved
// for backward compatibility (card 03) and delegates to the same handlers
// so both surfaces share validation and the single-primary invariant.
// ============================================================

// GET /api/tax-officials - List all officials with filters (legacy surface)
router.get('/tax-officials', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { countyId, hasEmail, search } = req.query;

    let conditions = [];
    if (countyId) conditions.push(eq(taxOfficials.countyId, parseInt(countyId as string)));
    if (hasEmail === 'true') conditions.push(not(isNull(taxOfficials.emailAddress)));
    if (hasEmail === 'false') conditions.push(isNull(taxOfficials.emailAddress));
    if (search) conditions.push(like(taxOfficials.fullName, `%${search}%`));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const totalResult = await db.select({ count: count() }).from(taxOfficials).where(whereClause);
    const total = totalResult[0]?.count || 0;

    const results = await db.query.taxOfficials.findMany({
      where: whereClause,
      with: {
        county: {
          with: {
            state: true,
          },
        },
      },
      orderBy: asc(taxOfficials.fullName),
      limit,
      offset,
    });

    res.json(successResponse(results, {
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    }));
  } catch (error) {
    console.error('Error fetching tax officials:', error);
    res.status(500).json(errorResponse('Failed to fetch tax officials'));
  }
});

// GET /api/contacts - Global contact search/list: search across name/email/
// county, filter by state or county, sort by county or name, paginated.
router.get('/contacts', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { search, state: stateAbbreviation, countyId, hasEmail, sort } = req.query;

    let conditions = [];
    if (countyId) {
      const parsedCountyId = parseInt(countyId as string);
      if (isNaN(parsedCountyId)) {
        return res.status(400).json(errorResponse('Invalid countyId filter', 400));
      }
      conditions.push(eq(taxOfficials.countyId, parsedCountyId));
    }
    if (stateAbbreviation) {
      conditions.push(eq(states.abbreviation, (stateAbbreviation as string).toUpperCase()));
    }
    if (hasEmail === 'true') conditions.push(not(isNull(taxOfficials.emailAddress)));
    if (hasEmail === 'false') conditions.push(isNull(taxOfficials.emailAddress));
    if (search) {
      const term = `%${search}%`;
      conditions.push(
        or(
          ilike(taxOfficials.fullName, term),
          ilike(taxOfficials.emailAddress, term),
          ilike(counties.name, term)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const totalResult = await db
      .select({ count: count() })
      .from(taxOfficials)
      .innerJoin(counties, eq(taxOfficials.countyId, counties.id))
      .innerJoin(states, eq(counties.stateId, states.id))
      .where(whereClause);
    const total = totalResult[0]?.count || 0;

    const orderByClauses =
      sort === 'name' ? [asc(taxOfficials.fullName)] : [asc(counties.name), asc(taxOfficials.fullName)];

    const rows = await db
      .select({
        id: taxOfficials.id,
        countyId: taxOfficials.countyId,
        fullName: taxOfficials.fullName,
        title: taxOfficials.title,
        phoneNumber: taxOfficials.phoneNumber,
        emailAddress: taxOfficials.emailAddress,
        officeAddress: taxOfficials.officeAddress,
        websiteUrl: taxOfficials.websiteUrl,
        isPrimary: taxOfficials.isPrimary,
        researchSource: taxOfficials.researchSource,
        confidenceScore: taxOfficials.confidenceScore,
        sourceUrl: taxOfficials.sourceUrl,
        verifiedAt: taxOfficials.verifiedAt,
        notes: taxOfficials.notes,
        createdAt: taxOfficials.createdAt,
        countyName: counties.name,
        stateId: counties.stateId,
        stateAbbreviation: states.abbreviation,
        stateName: states.name,
      })
      .from(taxOfficials)
      .innerJoin(counties, eq(taxOfficials.countyId, counties.id))
      .innerJoin(states, eq(counties.stateId, states.id))
      .where(whereClause)
      .orderBy(...orderByClauses)
      .limit(limit)
      .offset(offset);

    const data = rows.map((r) => ({
      id: r.id,
      countyId: r.countyId,
      fullName: r.fullName,
      title: r.title,
      phoneNumber: r.phoneNumber,
      emailAddress: r.emailAddress,
      officeAddress: r.officeAddress,
      websiteUrl: r.websiteUrl,
      isPrimary: r.isPrimary,
      researchSource: r.researchSource,
      confidenceScore: r.confidenceScore,
      sourceUrl: r.sourceUrl,
      verifiedAt: r.verifiedAt,
      notes: r.notes,
      createdAt: r.createdAt,
      county: {
        id: r.countyId,
        name: r.countyName,
        stateId: r.stateId,
        state: { abbreviation: r.stateAbbreviation, name: r.stateName },
      },
    }));

    res.json(successResponse(data, {
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    }));
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json(errorResponse('Failed to fetch contacts'));
  }
});

// GET /api/counties/:id/contacts - Contacts for a single county, primary first then name
router.get('/counties/:id/contacts', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid county ID', 400));
    }

    const county = await db.query.counties.findFirst({ where: eq(counties.id, id) });
    if (!county) {
      return res.status(404).json(errorResponse('County not found', 404));
    }

    const results = await db.query.taxOfficials.findMany({
      where: eq(taxOfficials.countyId, id),
      orderBy: [desc(taxOfficials.isPrimary), asc(taxOfficials.fullName)],
    });

    res.json(successResponse(results));
  } catch (error) {
    console.error('Error fetching county contacts:', error);
    res.status(500).json(errorResponse('Failed to fetch county contacts'));
  }
});

// POST /api/tax-officials, POST /api/contacts - Create a new contact.
// Requires a name and at least one contact method (email or phone), and
// rejects a duplicate name/email within the same county.
async function createContactHandler(req: any, res: any) {
  try {
    const { countyId, fullName, title, phoneNumber, emailAddress, officeAddress, websiteUrl, notes, isPrimary } = req.body ?? {};

    const parsedCountyId = parseInt(countyId);
    if (!countyId || isNaN(parsedCountyId)) {
      return res.status(400).json(errorResponse('countyId is required', 400));
    }

    const cleanName = cleanString(fullName);
    if (!cleanName) {
      return res.status(400).json(errorResponse('fullName is required', 400));
    }

    const cleanEmail = cleanString(emailAddress);
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      return res.status(400).json(errorResponse('emailAddress is not a valid email', 400));
    }

    const cleanPhone = cleanString(phoneNumber);
    if (!hasContactMethod(cleanEmail, cleanPhone)) {
      return res.status(400).json(errorResponse('Provide an email address or phone number', 400));
    }

    const cleanWebsite = cleanString(websiteUrl);
    if (cleanWebsite && !isValidUrl(cleanWebsite)) {
      return res.status(400).json(errorResponse('websiteUrl is not a valid URL', 400));
    }

    const county = await db.query.counties.findFirst({ where: eq(counties.id, parsedCountyId) });
    if (!county) {
      return res.status(400).json(errorResponse('County not found', 400));
    }

    const duplicate = await findDuplicateContact(parsedCountyId, cleanName, cleanEmail);
    if (duplicate) {
      return res.status(409).json(errorResponse(duplicate, 409));
    }

    const shouldBePrimary = isPrimary === true;
    const values = {
      countyId: parsedCountyId,
      fullName: cleanName,
      title: cleanString(title),
      phoneNumber: cleanPhone,
      emailAddress: cleanEmail,
      officeAddress: cleanString(officeAddress),
      websiteUrl: cleanWebsite,
      notes: cleanString(notes),
      isPrimary: shouldBePrimary,
    };

    const result = shouldBePrimary
      ? await db.transaction(async (tx) => {
          await tx.update(taxOfficials).set({ isPrimary: false }).where(eq(taxOfficials.countyId, parsedCountyId));
          return tx.insert(taxOfficials).values(values).returning();
        })
      : await db.insert(taxOfficials).values(values).returning();

    res.status(201).json(successResponse(result[0]));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json(errorResponse('Duplicate contact detected', 409));
    }
    console.error('Error creating contact:', error);
    res.status(500).json(errorResponse('Failed to create contact'));
  }
}

router.post('/tax-officials', createContactHandler);
router.post('/contacts', createContactHandler);

// PATCH /api/tax-officials/:id, PATCH /api/contacts/:id - Update a contact's
// details. isPrimary changes must go through the dedicated /primary endpoint
// to preserve the single-primary invariant. `markVerified: true` stamps
// verifiedAt without touching any other field (an explicit human action,
// never an automatic overwrite).
async function updateContactHandler(req: any, res: any) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid contact ID', 400));
    }

    const existing = await db.query.taxOfficials.findFirst({ where: eq(taxOfficials.id, id) });
    if (!existing) {
      return res.status(404).json(errorResponse('Contact not found', 404));
    }

    const { fullName, title, phoneNumber, emailAddress, officeAddress, websiteUrl, notes, markVerified } = req.body ?? {};
    const updateData: Record<string, unknown> = {};

    if (fullName !== undefined) {
      const cleanName = cleanString(fullName);
      if (!cleanName) {
        return res.status(400).json(errorResponse('fullName cannot be empty', 400));
      }
      updateData.fullName = cleanName;
    }
    if (title !== undefined) updateData.title = cleanString(title);
    if (phoneNumber !== undefined) updateData.phoneNumber = cleanString(phoneNumber);
    if (emailAddress !== undefined) {
      const cleanEmail = cleanString(emailAddress);
      if (cleanEmail && !isValidEmail(cleanEmail)) {
        return res.status(400).json(errorResponse('emailAddress is not a valid email', 400));
      }
      updateData.emailAddress = cleanEmail;
    }
    if (officeAddress !== undefined) updateData.officeAddress = cleanString(officeAddress);
    if (websiteUrl !== undefined) {
      const cleanWebsite = cleanString(websiteUrl);
      if (cleanWebsite && !isValidUrl(cleanWebsite)) {
        return res.status(400).json(errorResponse('websiteUrl is not a valid URL', 400));
      }
      updateData.websiteUrl = cleanWebsite;
    }
    if (notes !== undefined) updateData.notes = cleanString(notes);
    if (markVerified === true) updateData.verifiedAt = new Date();

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json(errorResponse('No valid fields to update', 400));
    }

    const finalEmail = 'emailAddress' in updateData ? (updateData.emailAddress as string | null) : existing.emailAddress;
    const finalPhone = 'phoneNumber' in updateData ? (updateData.phoneNumber as string | null) : existing.phoneNumber;
    if (!hasContactMethod(finalEmail, finalPhone)) {
      return res.status(400).json(errorResponse('Contact must have an email address or phone number', 400));
    }

    const finalName = (updateData.fullName as string | undefined) ?? existing.fullName;
    const duplicate = await findDuplicateContact(existing.countyId, finalName, finalEmail, id);
    if (duplicate) {
      return res.status(409).json(errorResponse(duplicate, 409));
    }

    const result = await db.update(taxOfficials).set(updateData).where(eq(taxOfficials.id, id)).returning();

    res.json(successResponse(result[0]));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json(errorResponse('Duplicate contact detected', 409));
    }
    console.error('Error updating contact:', error);
    res.status(500).json(errorResponse('Failed to update contact'));
  }
}

router.patch('/tax-officials/:id', updateContactHandler);
router.patch('/contacts/:id', updateContactHandler);

// PATCH/POST /api/contacts/:id/primary (and legacy PATCH /api/tax-officials/:id/primary) -
// Set or unset the primary contact for a county. Setting primary unsets any
// other primary contact in the same county within one transaction.
async function setPrimaryHandler(req: any, res: any) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid contact ID', 400));
    }

    const makePrimary = req.body?.isPrimary !== false;

    const existing = await db.query.taxOfficials.findFirst({ where: eq(taxOfficials.id, id) });
    if (!existing) {
      return res.status(404).json(errorResponse('Contact not found', 404));
    }

    let result;
    if (makePrimary) {
      result = await db.transaction(async (tx) => {
        await tx.update(taxOfficials).set({ isPrimary: false }).where(eq(taxOfficials.countyId, existing.countyId));
        return tx.update(taxOfficials).set({ isPrimary: true }).where(eq(taxOfficials.id, id)).returning();
      });
    } else {
      result = await db.update(taxOfficials).set({ isPrimary: false }).where(eq(taxOfficials.id, id)).returning();
    }

    res.json(successResponse(result[0]));
  } catch (error) {
    console.error('Error updating primary contact:', error);
    res.status(500).json(errorResponse('Failed to update primary contact'));
  }
}

router.patch('/tax-officials/:id/primary', setPrimaryHandler);
router.patch('/contacts/:id/primary', setPrimaryHandler);
router.post('/contacts/:id/primary', setPrimaryHandler);

// POST /api/contacts/:id/verify - Re-research a contact's county via the
// card-04 provider pipeline. This never writes to tax_officials directly:
// results still land in county_research_runs and must go through the
// explicit ai-import review flow, exactly like the county-level research
// action. Returns 503 when no provider is configured (no fake verification).
router.post('/contacts/:id/verify', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid contact ID', 400));
    }

    const contact = await db.query.taxOfficials.findFirst({ where: eq(taxOfficials.id, id) });
    if (!contact) {
      return res.status(404).json(errorResponse('Contact not found', 404));
    }

    const { provider, force } = req.body ?? {};
    if (provider !== undefined && provider !== null && provider !== 'mock' && provider !== 'http') {
      return res.status(400).json(errorResponse('provider must be "mock" or "http"', 400));
    }

    const result = await triggerCountyResearch(contact.countyId, {
      requestedProvider: provider ?? null,
      force: force === true,
    });

    switch (result.kind) {
      case 'not_found':
        return res.status(404).json(errorResponse('County not found for this contact', 404));
      case 'conflict':
        return res.status(409).json(errorResponse(result.message, 409));
      case 'rate_limited':
        return res.status(429).json(errorResponse(result.message, 429));
      case 'cached':
        return res.json(
          successResponse({ contactId: id, countyId: contact.countyId, run: result.run }, { cached: true })
        );
      case 'failed':
        if (result.providerUnavailable) {
          return res
            .status(503)
            .json(
              errorResponse(
                result.error || 'No research provider configured. Verify this contact manually or configure RESEARCH_PROVIDER.',
                503
              )
            );
        }
        return res.json(successResponse({ contactId: id, countyId: contact.countyId, run: result.run }));
      case 'completed':
        return res.status(201).json(successResponse({ contactId: id, countyId: contact.countyId, run: result.run }));
      default:
        return res.status(500).json(errorResponse('Unexpected verification result'));
    }
  } catch (error) {
    console.error('Error verifying contact:', error);
    res.status(500).json(errorResponse('Failed to verify contact'));
  }
});

// DELETE /api/tax-officials/:id, DELETE /api/contacts/:id - Delete a contact
// (cascades to their list requests)
async function deleteContactHandler(req: any, res: any) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid contact ID', 400));
    }

    const result = await db.delete(taxOfficials).where(eq(taxOfficials.id, id)).returning();

    if (result.length === 0) {
      return res.status(404).json(errorResponse('Contact not found', 404));
    }

    res.json(successResponse({ id, deleted: true }));
  } catch (error) {
    console.error('Error deleting contact:', error);
    res.status(500).json(errorResponse('Failed to delete contact'));
  }
}

router.delete('/tax-officials/:id', deleteContactHandler);
router.delete('/contacts/:id', deleteContactHandler);

// ============================================================
// FOIA Templates Routes
// ============================================================

// GET /api/foia-templates - List all templates
router.get('/foia-templates', async (_req, res) => {
  try {
    const results = await db.query.foiaTemplates.findMany({
      orderBy: desc(foiaTemplates.isDefault),
    });
    res.json(successResponse(results));
  } catch (error) {
    console.error('Error fetching FOIA templates:', error);
    res.status(500).json(errorResponse('Failed to fetch FOIA templates'));
  }
});

// GET /api/foia-templates/default - Get default template
router.get('/foia-templates/default', async (_req, res) => {
  try {
    const template = await db.query.foiaTemplates.findFirst({
      where: eq(foiaTemplates.isDefault, true),
    });

    if (!template) {
      return res.status(404).json(errorResponse('Default template not found', 404));
    }

    res.json(successResponse(template));
  } catch (error) {
    console.error('Error fetching default FOIA template:', error);
    res.status(500).json(errorResponse('Failed to fetch default FOIA template'));
  }
});

// POST /api/foia-templates - Create new template
router.post('/foia-templates', async (req, res) => {
  try {
    const { name, subjectLine, bodyText, isDefault } = req.body;

    if (!name || !subjectLine || !bodyText) {
      return res.status(400).json(errorResponse('name, subjectLine, and bodyText are required', 400));
    }

    const result = await db.insert(foiaTemplates).values({
      name,
      subjectLine,
      bodyText,
      isDefault: isDefault || false,
    }).returning();

    res.status(201).json(successResponse(result[0]));
  } catch (error) {
    console.error('Error creating FOIA template:', error);
    res.status(500).json(errorResponse('Failed to create FOIA template'));
  }
});

// ============================================================
// Templates Routes (card 06) — FOIA request template CRUD, variable
// validation, live preview, and single-default enforcement.
// "/api/foia-templates" (GET list/:id/default, POST) remains available
// above for backward compatibility; both surfaces share the same table.
// ============================================================

const TEMPLATE_NAME_MAX = 100;
const TEMPLATE_SUBJECT_MAX = 500;
const TEMPLATE_BODY_MAX = 10000;

interface TemplateFieldUpdate {
  name?: string;
  subjectLine?: string;
  bodyText?: string;
}

function validateTemplateFields(
  body: any,
  { requireAll }: { requireAll: boolean }
): { error: string } | TemplateFieldUpdate {
  const result: TemplateFieldUpdate = {};

  if (requireAll || body?.name !== undefined) {
    const name = cleanString(body?.name);
    if (!name) return { error: 'name is required' };
    if (name.length > TEMPLATE_NAME_MAX) return { error: `name must be ${TEMPLATE_NAME_MAX} characters or fewer` };
    result.name = name;
  }
  if (requireAll || body?.subjectLine !== undefined) {
    const subjectLine = cleanString(body?.subjectLine);
    if (!subjectLine) return { error: 'subjectLine is required' };
    if (subjectLine.length > TEMPLATE_SUBJECT_MAX) {
      return { error: `subjectLine must be ${TEMPLATE_SUBJECT_MAX} characters or fewer` };
    }
    result.subjectLine = subjectLine;
  }
  if (requireAll || body?.bodyText !== undefined) {
    const bodyText = typeof body?.bodyText === 'string' ? body.bodyText : '';
    if (!bodyText.trim()) return { error: 'bodyText is required' };
    if (bodyText.length > TEMPLATE_BODY_MAX) {
      return { error: `bodyText must be ${TEMPLATE_BODY_MAX} characters or fewer` };
    }
    result.bodyText = bodyText;
  }

  return result;
}

// Rejects unknown {{variables}} and requires at least one supported variable,
// so every saved template stays personalizable and no unrecognized token can
// ever be mistaken for something the renderer will execute.
function templateVariableError(subjectLine: string, bodyText: string): string | null {
  const { unknown, known } = analyzeTemplateVariables(subjectLine, bodyText);
  if (unknown.length > 0) {
    return `Unknown template variable(s): ${unknown.map((v) => `{{${v}}}`).join(', ')}`;
  }
  if (known.length === 0) {
    return `Template must use at least one supported variable: ${SUPPORTED_VARIABLE_KEYS.map((v) => `{{${v}}}`).join(', ')}`;
  }
  return null;
}

// GET /api/templates - List all templates, default first
router.get('/templates', async (_req, res) => {
  try {
    const results = await db.query.foiaTemplates.findMany({
      orderBy: [desc(foiaTemplates.isDefault), asc(foiaTemplates.name)],
    });
    res.json(successResponse(results));
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json(errorResponse('Failed to fetch templates'));
  }
});

// GET /api/templates/:id - Get a single template
router.get('/templates/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json(errorResponse('Invalid template ID', 400));

    const template = await db.query.foiaTemplates.findFirst({ where: eq(foiaTemplates.id, id) });
    if (!template) return res.status(404).json(errorResponse('Template not found', 404));

    res.json(successResponse(template));
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json(errorResponse('Failed to fetch template'));
  }
});

// POST /api/templates - Create a template. The first template ever created
// is always made default; later ones default only if isDefault is requested,
// which unsets any existing default in the same transaction.
router.post('/templates', async (req, res) => {
  try {
    const validation = validateTemplateFields(req.body ?? {}, { requireAll: true });
    if ('error' in validation) return res.status(400).json(errorResponse(validation.error, 400));
    const { name, subjectLine, bodyText } = validation as Required<TemplateFieldUpdate>;

    const variableError = templateVariableError(subjectLine, bodyText);
    if (variableError) return res.status(400).json(errorResponse(variableError, 400));

    const existingCount = await db.select({ count: count() }).from(foiaTemplates);
    const isFirstTemplate = (existingCount[0]?.count ?? 0) === 0;
    const shouldBeDefault = req.body?.isDefault === true || isFirstTemplate;

    const result = await db.transaction(async (tx) => {
      if (shouldBeDefault) {
        await tx.update(foiaTemplates).set({ isDefault: false }).where(eq(foiaTemplates.isDefault, true));
      }
      return tx.insert(foiaTemplates).values({ name, subjectLine, bodyText, isDefault: shouldBeDefault }).returning();
    });

    res.status(201).json(successResponse(result[0]));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json(errorResponse('A template with this name already exists', 409));
    }
    console.error('Error creating template:', error);
    res.status(500).json(errorResponse('Failed to create template'));
  }
});

// PATCH /api/templates/:id - Update a template's fields and/or default status.
// Field edits and setting isDefault:true can be combined in one request;
// isDefault:false is rejected while the template is still the default (use
// set-default on another template instead, which keeps exactly one default).
router.patch('/templates/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json(errorResponse('Invalid template ID', 400));

    const existing = await db.query.foiaTemplates.findFirst({ where: eq(foiaTemplates.id, id) });
    if (!existing) return res.status(404).json(errorResponse('Template not found', 404));

    const validation = validateTemplateFields(req.body ?? {}, { requireAll: false });
    if ('error' in validation) return res.status(400).json(errorResponse(validation.error, 400));

    const effectiveSubject = validation.subjectLine ?? existing.subjectLine;
    const effectiveBody = validation.bodyText ?? existing.bodyText;
    const variableError = templateVariableError(effectiveSubject, effectiveBody);
    if (variableError) return res.status(400).json(errorResponse(variableError, 400));

    const updateData: Record<string, unknown> = { ...validation };
    const hasFieldUpdates = Object.keys(updateData).length > 0;
    const isDefaultProvided = req.body?.isDefault !== undefined;
    const setDefaultTrue = isDefaultProvided && req.body.isDefault === true;
    const setDefaultFalse = isDefaultProvided && req.body.isDefault === false;

    if (setDefaultFalse && existing.isDefault) {
      return res.status(409).json(
        errorResponse('Cannot unset the default template directly; set another template as default instead', 409)
      );
    }

    if (!hasFieldUpdates && !isDefaultProvided) {
      return res.status(400).json(errorResponse('No valid fields to update', 400));
    }

    let result;
    if (setDefaultTrue && !existing.isDefault) {
      result = await db.transaction(async (tx) => {
        await tx.update(foiaTemplates).set({ isDefault: false }).where(eq(foiaTemplates.isDefault, true));
        return tx
          .update(foiaTemplates)
          .set({ ...updateData, isDefault: true })
          .where(eq(foiaTemplates.id, id))
          .returning();
      });
    } else if (hasFieldUpdates) {
      result = await db.update(foiaTemplates).set(updateData).where(eq(foiaTemplates.id, id)).returning();
    } else {
      // isDefault was provided but is already a no-op (true-and-already-default,
      // or false-and-already-not-default) and no other fields changed.
      result = [existing];
    }

    res.json(successResponse(result[0]));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json(errorResponse('A template with this name already exists', 409));
    }
    console.error('Error updating template:', error);
    res.status(500).json(errorResponse('Failed to update template'));
  }
});

// DELETE /api/templates/:id - Delete a non-default template. Deleting the
// default is blocked (409) until another template has been made default.
router.delete('/templates/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json(errorResponse('Invalid template ID', 400));

    const existing = await db.query.foiaTemplates.findFirst({ where: eq(foiaTemplates.id, id) });
    if (!existing) return res.status(404).json(errorResponse('Template not found', 404));

    if (existing.isDefault) {
      return res.status(409).json(
        errorResponse('Cannot delete the default template. Set another template as default first.', 409)
      );
    }

    await db.delete(foiaTemplates).where(eq(foiaTemplates.id, id));
    res.json(successResponse({ id, deleted: true }));
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json(errorResponse('Failed to delete template'));
  }
});

// POST /api/templates/:id/set-default - Make this template the default,
// unsetting any other default in the same transaction so exactly one
// template is ever marked default.
router.post('/templates/:id/set-default', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json(errorResponse('Invalid template ID', 400));

    const existing = await db.query.foiaTemplates.findFirst({ where: eq(foiaTemplates.id, id) });
    if (!existing) return res.status(404).json(errorResponse('Template not found', 404));

    if (existing.isDefault) {
      return res.json(successResponse(existing));
    }

    const result = await db.transaction(async (tx) => {
      await tx.update(foiaTemplates).set({ isDefault: false }).where(eq(foiaTemplates.isDefault, true));
      return tx.update(foiaTemplates).set({ isDefault: true }).where(eq(foiaTemplates.id, id)).returning();
    });

    res.json(successResponse(result[0]));
  } catch (error) {
    console.error('Error setting default template:', error);
    res.status(500).json(errorResponse('Failed to set default template'));
  }
});

// POST /api/templates/:id/preview - Render a template with sample or real
// (read-only) county/contact data. Never writes anything; unknown variables
// are surfaced in the response but never evaluated.
router.post('/templates/:id/preview', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json(errorResponse('Invalid template ID', 400));

    const template = await db.query.foiaTemplates.findFirst({ where: eq(foiaTemplates.id, id) });
    if (!template) return res.status(404).json(errorResponse('Template not found', 404));

    const { sampleData, countyId, contactId, customNote } = req.body ?? {};
    let resolvedSample: TemplateSampleData;

    if (sampleData && typeof sampleData === 'object') {
      resolvedSample = {
        countyName: cleanString(sampleData.countyName) ?? DEFAULT_SAMPLE_DATA.countyName,
        stateName: cleanString(sampleData.stateName) ?? DEFAULT_SAMPLE_DATA.stateName,
        stateAbbr: cleanString(sampleData.stateAbbr) ?? DEFAULT_SAMPLE_DATA.stateAbbr,
        officialName: cleanString(sampleData.officialName) ?? DEFAULT_SAMPLE_DATA.officialName,
        officialTitle: cleanString(sampleData.officialTitle) ?? DEFAULT_SAMPLE_DATA.officialTitle,
        customNote: cleanString(sampleData.customNote) ?? '',
      };
    } else if (countyId !== undefined && countyId !== null) {
      const parsedCountyId = parseInt(countyId);
      if (isNaN(parsedCountyId)) return res.status(400).json(errorResponse('Invalid countyId', 400));

      const county = await db.query.counties.findFirst({
        where: eq(counties.id, parsedCountyId),
        with: { state: true },
      });
      if (!county) return res.status(400).json(errorResponse('County not found', 400));

      let officialName = DEFAULT_SAMPLE_DATA.officialName;
      let officialTitle = DEFAULT_SAMPLE_DATA.officialTitle;
      if (contactId !== undefined && contactId !== null) {
        const parsedContactId = parseInt(contactId);
        if (isNaN(parsedContactId)) return res.status(400).json(errorResponse('Invalid contactId', 400));

        const contact = await db.query.taxOfficials.findFirst({ where: eq(taxOfficials.id, parsedContactId) });
        if (!contact || contact.countyId !== parsedCountyId) {
          return res.status(400).json(errorResponse('Contact not found for this county', 400));
        }
        officialName = contact.fullName;
        officialTitle = contact.title || DEFAULT_SAMPLE_DATA.officialTitle;
      }

      resolvedSample = {
        countyName: county.name,
        stateName: county.state.name,
        stateAbbr: county.state.abbreviation,
        officialName,
        officialTitle,
        customNote: cleanString(customNote) ?? '',
      };
    } else {
      resolvedSample = { ...DEFAULT_SAMPLE_DATA, customNote: cleanString(customNote) ?? '' };
    }

    const { unknown, used } = analyzeTemplateVariables(template.subjectLine, template.bodyText);

    res.json(
      successResponse({
        subject: renderTemplateText(template.subjectLine, resolvedSample),
        body: renderTemplateText(template.bodyText, resolvedSample),
        sampleData: resolvedSample,
        usedVariables: used,
        unknownVariables: unknown,
      })
    );
  } catch (error) {
    console.error('Error previewing template:', error);
    res.status(500).json(errorResponse('Failed to preview template'));
  }
});

// ============================================================
// List Requests Routes
// ============================================================

// GET /api/list-requests - List all requests with filters
router.get('/list-requests', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { status, assignedTo, stateId } = req.query;

    let conditions = [];
    if (status) conditions.push(eq(listRequests.requestStatus, status as any));
    if (assignedTo) conditions.push(eq(listRequests.assignedTo, assignedTo as string));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const totalResult = await db.select({ count: count() }).from(listRequests).where(whereClause);
    const total = totalResult[0]?.count || 0;

    const results = await db.query.listRequests.findMany({
      where: whereClause,
      with: {
        taxOfficial: {
          with: {
            county: {
              with: {
                state: true,
              },
            },
          },
        },
        foiaTemplate: true,
      },
      orderBy: desc(listRequests.createdAt),
      limit,
      offset,
    });

    // Filter by state if requested (post-query filter)
    let filteredResults = results;
    if (stateId) {
      filteredResults = results.filter(r => r.taxOfficial?.county?.stateId === parseInt(stateId as string));
    }

    res.json(successResponse(filteredResults, {
      pagination: {
        total: stateId ? filteredResults.length : total,
        page,
        limit,
        totalPages: Math.ceil((stateId ? filteredResults.length : total) / limit),
      },
    }));
  } catch (error) {
    console.error('Error fetching list requests:', error);
    res.status(500).json(errorResponse('Failed to fetch list requests'));
  }
});

// GET /api/list-requests/:id - Get single request with details
router.get('/list-requests/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid list request ID', 400));
    }

    const request = await db.query.listRequests.findFirst({
      where: eq(listRequests.id, id),
      with: {
        taxOfficial: {
          with: {
            county: {
              with: {
                state: true,
              },
            },
          },
        },
        foiaTemplate: true,
        emailTracking: {
          orderBy: desc(emailTracking.createdAt),
        },
        processedLists: true,
      },
    });

    if (!request) {
      return res.status(404).json(errorResponse('List request not found', 404));
    }

    res.json(successResponse(request));
  } catch (error) {
    console.error('Error fetching list request:', error);
    res.status(500).json(errorResponse('Failed to fetch list request'));
  }
});

// POST /api/list-requests - Create new request
router.post('/list-requests', async (req, res) => {
  try {
    const { taxOfficialId, requestStatus, assignedTo, notes } = req.body;

    if (!taxOfficialId) {
      return res.status(400).json(errorResponse('taxOfficialId is required', 400));
    }

    const result = await db.insert(listRequests).values({
      taxOfficialId,
      requestStatus: requestStatus || 'not_started',
      assignedTo,
      notes,
    }).returning();

    res.status(201).json(successResponse(result[0]));
  } catch (error) {
    console.error('Error creating list request:', error);
    res.status(500).json(errorResponse('Failed to create list request'));
  }
});

// PATCH /api/list-requests/:id - Update request
router.patch('/list-requests/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid list request ID', 400));
    }

    const updateData: any = { ...req.body, updatedAt: new Date() };
    delete updateData.id; // Prevent ID modification

    const result = await db.update(listRequests)
      .set(updateData)
      .where(eq(listRequests.id, id))
      .returning();

    if (result.length === 0) {
      return res.status(404).json(errorResponse('List request not found', 404));
    }

    res.json(successResponse(result[0]));
  } catch (error) {
    console.error('Error updating list request:', error);
    res.status(500).json(errorResponse('Failed to update list request'));
  }
});

// ============================================================
// Email Sending (card 07)
//
// Dry-run is the default transport (see server/services/emailService.ts);
// EMAIL_TRANSPORT=gog is the only way to reach a real Gmail send, and that
// env var is itself the human sign-off gate — nothing here flips it on
// automatically. Every response and tracking row labels which transport
// was actually used.
// ============================================================

// POST /api/list-requests/:id/send-email - Render + send (or dry-run) the
// FOIA email for this request to the county's primary contact. Pass
// { dryRun: true } to only render and return the preview with no side
// effects (no tracking row, no status change). Refuses to re-send an
// already-sent request unless ?force=true or { force: true } is set.
router.post('/list-requests/:id/send-email', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid list request ID', 400));
    }

    if (req.body?.dryRun === true) {
      const prepared = await prepareListRequestEmail(id);
      if (!prepared.ok) {
        return res.status(prepared.status).json(errorResponse(prepared.error, prepared.status));
      }
      return res.json(
        successResponse({
          listRequestId: id,
          recipientEmail: prepared.recipientEmail,
          subject: prepared.subject,
          body: prepared.body,
          transport: getActiveTransport(),
          preview: true,
        })
      );
    }

    const force = req.query.force === 'true' || req.body?.force === true;
    const result = await sendListRequestEmail(id, { force });

    if (result.outcome === 'failed' || result.outcome === 'skipped') {
      return res.status(result.statusCode).json(errorResponse(result.error || 'Failed to send email', result.statusCode));
    }

    res.json(successResponse(result));
  } catch (error) {
    console.error('Error sending list request email:', error);
    res.status(500).json(errorResponse('Failed to send email'));
  }
});

// POST /api/list-requests/bulk-send - Send (or dry-run) emails for several
// requests at once. Accepts either { requestIds: number[] } or
// { status: RequestStatus } to select every request currently in that
// status (e.g. "ready_to_email"). Processes sequentially; one failure never
// aborts the rest. Returns a per-item result plus a summary count.
router.post('/list-requests/bulk-send', async (req, res) => {
  try {
    const { requestIds, status, force } = req.body ?? {};

    let parsedIds: number[];

    if (Array.isArray(requestIds) && requestIds.length > 0) {
      parsedIds = [];
      for (const raw of requestIds) {
        const parsed = parseInt(raw);
        if (isNaN(parsed)) {
          return res.status(400).json(errorResponse('requestIds must contain valid numeric IDs', 400));
        }
        parsedIds.push(parsed);
      }
    } else if (typeof status === 'string') {
      if (!isRequestStatus(status)) {
        return res.status(400).json(errorResponse('Invalid status filter', 400));
      }
      const rows = await db.query.listRequests.findMany({
        where: eq(listRequests.requestStatus, status),
        limit: MAX_BULK_SEND_REQUESTS,
      });
      parsedIds = rows.map((r) => r.id);
      if (parsedIds.length === 0) {
        return res.status(400).json(errorResponse('No list requests match the given status filter', 400));
      }
    } else {
      return res.status(400).json(errorResponse('Provide requestIds (non-empty array) or a status filter', 400));
    }

    if (parsedIds.length > MAX_BULK_SEND_REQUESTS) {
      return res.status(400).json(errorResponse(`Cannot send more than ${MAX_BULK_SEND_REQUESTS} requests at once`, 400));
    }

    const results = await sendListRequestEmailsBulk(parsedIds, { force: force === true });

    const summary = {
      total: results.length,
      sent: results.filter((r) => r.outcome === 'sent').length,
      skipped: results.filter((r) => r.outcome === 'skipped').length,
      failed: results.filter((r) => r.outcome === 'failed').length,
      transport: getActiveTransport(),
    };

    res.json(successResponse({ results, summary }));
  } catch (error) {
    console.error('Error processing bulk email send:', error);
    res.status(500).json(errorResponse('Failed to process bulk send'));
  }
});

// ============================================================
// Email Queue & Throttle (card 08)
//
// enqueue/bulk-enqueue add items to the email_queue table instead of
// sending immediately; the in-process scheduler in queueService.ts picks
// them up (respecting the daily limit + paused flag) and sends through the
// exact same emailService.sendListRequestEmail path as manual sends, so
// the dry-run/gog transport gate is identical either way.
// ============================================================

// POST /api/list-requests/:id/enqueue - Add a single request to the send
// queue. Body: { sendAt?: ISO string }. Omitting sendAt means "as soon as
// the processor next runs and the daily budget allows"; passing sendAt
// means "not before that time".
router.post('/list-requests/:id/enqueue', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid list request ID', 400));
    }

    const sendAt = typeof req.body?.sendAt === 'string' ? req.body.sendAt : undefined;
    const result = await enqueueListRequestEmail(id, sendAt);

    if (result.outcome === 'failed' || result.outcome === 'skipped') {
      return res.status(result.statusCode).json(errorResponse(result.error || 'Failed to enqueue email', result.statusCode));
    }

    res.json(successResponse(result));
  } catch (error) {
    console.error('Error enqueueing list request email:', error);
    res.status(500).json(errorResponse('Failed to enqueue email'));
  }
});

// POST /api/list-requests/bulk-enqueue - Add several requests to the send
// queue at once. Body: { requestIds: number[], sendAt?: ISO string }.
// Mirrors the bulk-send endpoint's per-item result shape; one item failing
// to enqueue never blocks the rest.
router.post('/list-requests/bulk-enqueue', async (req, res) => {
  try {
    const { requestIds, sendAt } = req.body ?? {};

    if (!Array.isArray(requestIds) || requestIds.length === 0) {
      return res.status(400).json(errorResponse('requestIds must be a non-empty array', 400));
    }
    if (requestIds.length > MAX_BULK_ENQUEUE_REQUESTS) {
      return res.status(400).json(errorResponse(`Cannot enqueue more than ${MAX_BULK_ENQUEUE_REQUESTS} requests at once`, 400));
    }

    const parsedIds: number[] = [];
    for (const raw of requestIds) {
      const parsed = parseInt(raw);
      if (isNaN(parsed)) {
        return res.status(400).json(errorResponse('requestIds must contain valid numeric IDs', 400));
      }
      parsedIds.push(parsed);
    }

    const parsedSendAt = typeof sendAt === 'string' ? sendAt : undefined;
    const results = await enqueueListRequestEmailsBulk(parsedIds, parsedSendAt);

    const summary = {
      total: results.length,
      queued: results.filter((r) => r.outcome === 'queued').length,
      skipped: results.filter((r) => r.outcome === 'skipped').length,
      failed: results.filter((r) => r.outcome === 'failed').length,
    };

    res.json(successResponse({ results, summary }));
  } catch (error) {
    console.error('Error processing bulk enqueue:', error);
    res.status(500).json(errorResponse('Failed to process bulk enqueue'));
  }
});

// GET /api/email-queue - List active (queued/sending) queue items with
// enough list-request/county/contact detail for the dashboard. Pass
// ?all=true to include sent/failed/cancelled history as well.
router.get('/email-queue', async (req, res) => {
  try {
    const includeAll = req.query.all === 'true';
    const items = await listQueueItems(includeAll);
    res.json(successResponse(items));
  } catch (error) {
    console.error('Error fetching email queue:', error);
    res.status(500).json(errorResponse('Failed to fetch email queue'));
  }
});

// GET /api/email-queue/status - Throttle + queue stats for the dashboard.
router.get('/email-queue/status', async (_req, res) => {
  try {
    const status = await getQueueStatus();
    res.json(successResponse(status));
  } catch (error) {
    console.error('Error fetching email queue status:', error);
    res.status(500).json(errorResponse('Failed to fetch email queue status'));
  }
});

// POST /api/email-queue/pause - Stop the processor from sending. Queued
// items are untouched and will resume being picked up once unpaused.
router.post('/email-queue/pause', async (_req, res) => {
  try {
    const settings = await setPaused(true);
    res.json(successResponse(settings));
  } catch (error) {
    console.error('Error pausing email queue:', error);
    res.status(500).json(errorResponse('Failed to pause email queue'));
  }
});

// POST /api/email-queue/resume
router.post('/email-queue/resume', async (_req, res) => {
  try {
    const settings = await setPaused(false);
    res.json(successResponse(settings));
  } catch (error) {
    console.error('Error resuming email queue:', error);
    res.status(500).json(errorResponse('Failed to resume email queue'));
  }
});

// PATCH /api/email-queue/settings - Body: { dailyLimit: number (20-50) }.
router.patch('/email-queue/settings', async (req, res) => {
  try {
    const { dailyLimit } = req.body ?? {};
    if (!isValidDailyLimit(dailyLimit)) {
      return res.status(400).json(errorResponse('dailyLimit must be an integer between 20 and 50', 400));
    }
    const settings = await updateDailyLimit(dailyLimit);
    res.json(successResponse(settings));
  } catch (error) {
    console.error('Error updating email queue settings:', error);
    res.status(500).json(errorResponse('Failed to update email queue settings'));
  }
});

// GET /api/email-queue/settings
router.get('/email-queue/settings', async (_req, res) => {
  try {
    const settings = await getOrCreateSettings();
    res.json(successResponse(settings));
  } catch (error) {
    console.error('Error fetching email queue settings:', error);
    res.status(500).json(errorResponse('Failed to fetch email queue settings'));
  }
});

// POST /api/email-queue/:id/cancel - Dequeue an item. Only items still in
// 'queued' status can be cancelled; anything already claimed by the
// processor ('sending') or resolved ('sent'/'failed'/'cancelled') is left
// alone.
router.post('/email-queue/:id/cancel', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid queue item ID', 400));
    }
    const result = await cancelQueueItem(id);
    if (!result.ok) {
      return res.status(result.statusCode).json(errorResponse(result.error || 'Failed to cancel queue item', result.statusCode));
    }
    res.json(successResponse({ id, cancelled: true }));
  } catch (error) {
    console.error('Error cancelling queue item:', error);
    res.status(500).json(errorResponse('Failed to cancel queue item'));
  }
});

// ============================================================
// Inbox Monitoring Routes (card 09)
//
// INBOX_PROVIDER gates the transport exactly like EMAIL_TRANSPORT does for
// sending (see emailService.ts): unset or anything other than "gog" means
// every "check now" here runs against the mock provider only. No route in
// this section ever sends or replies to anything.
// ============================================================

const INBOX_ITEM_STATUSES = ['unprocessed', 'matched', 'unmatched', 'reviewed', 'attached'] as const;
type InboxItemStatusValue = (typeof INBOX_ITEM_STATUSES)[number];

const INBOX_CLASSIFICATIONS = [
  'list_received',
  'fee_quote',
  'fee_paid',
  'clarification',
  'rejection',
  'other',
] as const;
type InboxClassificationValue = (typeof INBOX_CLASSIFICATIONS)[number];

function isInboxItemStatus(value: unknown): value is InboxItemStatusValue {
  return typeof value === 'string' && (INBOX_ITEM_STATUSES as readonly string[]).includes(value);
}

function isInboxClassification(value: unknown): value is InboxClassificationValue {
  return typeof value === 'string' && (INBOX_CLASSIFICATIONS as readonly string[]).includes(value);
}

// POST /api/inbox/check - Trigger a poll now. In mock mode (default) this
// generates sample replies at most once a minute (or immediately if
// INBOX_MOCK_NEW=1 is set); in live mode (INBOX_PROVIDER=gog) it searches
// Gmail read-only via the gog CLI. Returns the newly-created items only.
router.post('/inbox/check', async (_req, res) => {
  try {
    const result = await pollInbox();
    res.json(successResponse(result));
  } catch (error) {
    console.error('Error polling inbox:', error);
    res.status(500).json(errorResponse('Failed to poll inbox'));
  }
});

// GET /api/inbox/unprocessed - Items still awaiting human review, i.e.
// anything not yet explicitly marked "reviewed".
router.get('/inbox/unprocessed', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);

    const whereClause = not(eq(inboxItems.status, 'reviewed'));
    const totalResult = await db.select({ count: count() }).from(inboxItems).where(whereClause);
    const total = totalResult[0]?.count || 0;

    const results = await db.query.inboxItems.findMany({
      where: whereClause,
      with: {
        listRequest: {
          with: { taxOfficial: { with: { county: { with: { state: true } } } } },
        },
      },
      orderBy: desc(inboxItems.receivedAt),
      limit,
      offset,
    });

    res.json(successResponse(results, {
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }));
  } catch (error) {
    console.error('Error fetching unprocessed inbox items:', error);
    res.status(500).json(errorResponse('Failed to fetch unprocessed inbox items'));
  }
});

// GET /api/inbox/items - All inbox items with optional filters, newest first.
router.get('/inbox/items', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { status, classification, listRequestId, matched } = req.query;

    const conditions = [];
    if (status !== undefined) {
      if (!isInboxItemStatus(status)) {
        return res.status(400).json(errorResponse('Invalid status filter', 400));
      }
      conditions.push(eq(inboxItems.status, status));
    }
    if (classification !== undefined) {
      if (!isInboxClassification(classification)) {
        return res.status(400).json(errorResponse('Invalid classification filter', 400));
      }
      conditions.push(eq(inboxItems.classification, classification));
    }
    if (listRequestId !== undefined) {
      const parsed = parseInt(listRequestId as string);
      if (isNaN(parsed)) return res.status(400).json(errorResponse('Invalid listRequestId filter', 400));
      conditions.push(eq(inboxItems.listRequestId, parsed));
    }
    if (matched === 'true') conditions.push(isNotNull(inboxItems.listRequestId));
    if (matched === 'false') conditions.push(isNull(inboxItems.listRequestId));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const totalResult = await db.select({ count: count() }).from(inboxItems).where(whereClause);
    const total = totalResult[0]?.count || 0;

    const results = await db.query.inboxItems.findMany({
      where: whereClause,
      with: {
        listRequest: {
          with: { taxOfficial: { with: { county: { with: { state: true } } } } },
        },
      },
      orderBy: desc(inboxItems.receivedAt),
      limit,
      offset,
    });

    res.json(successResponse(results, {
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }));
  } catch (error) {
    console.error('Error fetching inbox items:', error);
    res.status(500).json(errorResponse('Failed to fetch inbox items'));
  }
});

// GET /api/inbox/settings - Surfaces which provider is active so the UI
// can show a clear "mock" vs "live Gmail" indicator.
router.get('/inbox/settings', async (_req, res) => {
  res.json(successResponse({ provider: getActiveInboxProvider() }));
});

// POST /api/inbox/:id/classify - One-click manual (re)classification.
// Only updates the label; it does not retroactively touch the linked
// list_request (that already happened, if at all, using the rule-engine's
// classification at ingest time).
router.post('/inbox/:id/classify', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json(errorResponse('Invalid inbox item ID', 400));

    const { classification } = req.body ?? {};
    if (!isInboxClassification(classification)) {
      return res.status(400).json(errorResponse(`classification must be one of: ${INBOX_CLASSIFICATIONS.join(', ')}`, 400));
    }

    const result = await db
      .update(inboxItems)
      .set({ classification })
      .where(eq(inboxItems.id, id))
      .returning();

    if (result.length === 0) return res.status(404).json(errorResponse('Inbox item not found', 404));

    res.json(successResponse(result[0]));
  } catch (error) {
    console.error('Error classifying inbox item:', error);
    res.status(500).json(errorResponse('Failed to classify inbox item'));
  }
});

// POST /api/inbox/:id/link - Manually link or relink an item to a list
// request (or unlink with listRequestId: null). Manual links are always
// full confidence since a human made the call.
router.post('/inbox/:id/link', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json(errorResponse('Invalid inbox item ID', 400));

    const existing = await db.query.inboxItems.findFirst({ where: eq(inboxItems.id, id) });
    if (!existing) return res.status(404).json(errorResponse('Inbox item not found', 404));

    const { listRequestId } = req.body ?? {};

    if (listRequestId === null) {
      const result = await db
        .update(inboxItems)
        .set({ listRequestId: null, matchMethod: null, matchConfidence: 0, status: 'unmatched' })
        .where(eq(inboxItems.id, id))
        .returning();
      return res.json(successResponse(result[0]));
    }

    const parsedId = parseInt(listRequestId);
    if (isNaN(parsedId)) return res.status(400).json(errorResponse('listRequestId is required', 400));

    const request = await db.query.listRequests.findFirst({ where: eq(listRequests.id, parsedId) });
    if (!request) return res.status(400).json(errorResponse('List request not found', 400));

    const result = await db
      .update(inboxItems)
      .set({ listRequestId: parsedId, matchMethod: 'manual', matchConfidence: 100, status: 'matched' })
      .where(eq(inboxItems.id, id))
      .returning();

    res.json(successResponse(result[0]));
  } catch (error) {
    console.error('Error linking inbox item:', error);
    res.status(500).json(errorResponse('Failed to link inbox item'));
  }
});

// POST /api/inbox/:id/status - Manual status override, e.g. marking an
// item "reviewed" once a human has looked at it.
router.post('/inbox/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json(errorResponse('Invalid inbox item ID', 400));

    const { status } = req.body ?? {};
    if (!isInboxItemStatus(status)) {
      return res.status(400).json(errorResponse(`status must be one of: ${INBOX_ITEM_STATUSES.join(', ')}`, 400));
    }

    const result = await db.update(inboxItems).set({ status }).where(eq(inboxItems.id, id)).returning();
    if (result.length === 0) return res.status(404).json(errorResponse('Inbox item not found', 404));

    res.json(successResponse(result[0]));
  } catch (error) {
    console.error('Error updating inbox item status:', error);
    res.status(500).json(errorResponse('Failed to update inbox item status'));
  }
});

// ============================================================
// Dashboard Stats
// ============================================================

router.get('/dashboard/stats', async (_req, res) => {
  try {
    const [
      statesResult,
      countiesResult,
      officialsResult,
      requestsResult,
      byStatusResult,
    ] = await Promise.all([
      db.select({ count: count() }).from(states),
      db.select({ count: count() }).from(counties),
      db.select({ count: count() }).from(taxOfficials),
      db.select({ count: count() }).from(listRequests),
      db.select({ status: listRequests.requestStatus, count: count() })
        .from(listRequests)
        .groupBy(listRequests.requestStatus),
    ]);

    const stats = {
      overview: {
        totalStates: statesResult[0]?.count || 0,
        totalCounties: countiesResult[0]?.count || 0,
        totalTaxOfficials: officialsResult[0]?.count || 0,
        totalListRequests: requestsResult[0]?.count || 0,
      },
      requestsByStatus: byStatusResult,
    };

    res.json(successResponse(stats));
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json(errorResponse('Failed to fetch dashboard stats'));
  }
});

export default router;
