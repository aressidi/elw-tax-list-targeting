import { Router } from 'express';
import { eq, and, like, desc, asc, sql, count, isNull, not, or, gte, lte, inArray } from 'drizzle-orm';
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
} from '../shared/schema.js';

const router = Router();

const TARGET_PRIORITIES = ['high', 'medium', 'low'] as const;
type TargetPriority = (typeof TARGET_PRIORITIES)[number];

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
          orderBy: desc(taxOfficials.isPrimary),
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
// Tax Officials Routes
// ============================================================

// GET /api/tax-officials - List all officials with filters
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

// POST /api/tax-officials - Create new tax official (contact)
router.post('/tax-officials', async (req, res) => {
  try {
    const { countyId, fullName, title, phoneNumber, emailAddress, officeAddress, websiteUrl, notes, isPrimary } = req.body;

    const parsedCountyId = parseInt(countyId);
    if (!countyId || isNaN(parsedCountyId)) {
      return res.status(400).json(errorResponse('countyId is required', 400));
    }

    const cleanName = cleanString(fullName);
    if (!cleanName) {
      return res.status(400).json(errorResponse('fullName is required', 400));
    }

    const county = await db.query.counties.findFirst({ where: eq(counties.id, parsedCountyId) });
    if (!county) {
      return res.status(400).json(errorResponse('County not found', 400));
    }

    const shouldBePrimary = isPrimary === true;
    const values = {
      countyId: parsedCountyId,
      fullName: cleanName,
      title: cleanString(title),
      phoneNumber: cleanString(phoneNumber),
      emailAddress: cleanString(emailAddress),
      officeAddress: cleanString(officeAddress),
      websiteUrl: cleanString(websiteUrl),
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
    console.error('Error creating tax official:', error);
    res.status(500).json(errorResponse('Failed to create tax official'));
  }
});

// PATCH /api/tax-officials/:id - Update a contact's details (isPrimary changes
// must go through the dedicated /primary endpoint to preserve the single-primary invariant)
router.patch('/tax-officials/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid tax official ID', 400));
    }

    const { fullName, title, phoneNumber, emailAddress, officeAddress, websiteUrl, notes } = req.body;
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
    if (emailAddress !== undefined) updateData.emailAddress = cleanString(emailAddress);
    if (officeAddress !== undefined) updateData.officeAddress = cleanString(officeAddress);
    if (websiteUrl !== undefined) updateData.websiteUrl = cleanString(websiteUrl);
    if (notes !== undefined) updateData.notes = cleanString(notes);

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json(errorResponse('No valid fields to update', 400));
    }

    const result = await db.update(taxOfficials).set(updateData).where(eq(taxOfficials.id, id)).returning();

    if (result.length === 0) {
      return res.status(404).json(errorResponse('Tax official not found', 404));
    }

    res.json(successResponse(result[0]));
  } catch (error) {
    console.error('Error updating tax official:', error);
    res.status(500).json(errorResponse('Failed to update tax official'));
  }
});

// PATCH /api/tax-officials/:id/primary - Set or unset the primary contact for a county.
// Setting primary unsets any other primary contact in the same county within one transaction.
router.patch('/tax-officials/:id/primary', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid tax official ID', 400));
    }

    const makePrimary = req.body?.isPrimary !== false;

    const existing = await db.query.taxOfficials.findFirst({ where: eq(taxOfficials.id, id) });
    if (!existing) {
      return res.status(404).json(errorResponse('Tax official not found', 404));
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
});

// DELETE /api/tax-officials/:id - Delete a contact (cascades to their list requests)
router.delete('/tax-officials/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid tax official ID', 400));
    }

    const result = await db.delete(taxOfficials).where(eq(taxOfficials.id, id)).returning();

    if (result.length === 0) {
      return res.status(404).json(errorResponse('Tax official not found', 404));
    }

    res.json(successResponse({ id, deleted: true }));
  } catch (error) {
    console.error('Error deleting tax official:', error);
    res.status(500).json(errorResponse('Failed to delete tax official'));
  }
});

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
