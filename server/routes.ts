import { Router } from 'express';
import { eq, and, like, desc, asc, sql, count, isNull, not, or, gte, lte, inArray } from 'drizzle-orm';
import { db } from './db.js';
import {
  states,
  counties,
  taxOfficials,
  foiaTemplates,
  listRequests,
  emailTracking,
  processedLists,
} from '../shared/schema.js';

const router = Router();

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

// ============================================================
// Health Check
// ============================================================
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// States Routes
// ============================================================

// GET /api/states - List all states
router.get('/states', async (_req, res) => {
  try {
    const results = await db.query.states.findMany({
      orderBy: asc(states.name),
    });
    res.json(successResponse(results));
  } catch (error) {
    console.error('Error fetching states:', error);
    res.status(500).json(errorResponse('Failed to fetch states'));
  }
});

// GET /api/states/:id - Get state with counties
router.get('/states/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid state ID', 400));
    }

    const state = await db.query.states.findFirst({
      where: eq(states.id, id),
      with: {
        counties: {
          orderBy: asc(counties.name),
        },
      },
    });

    if (!state) {
      return res.status(404).json(errorResponse('State not found', 404));
    }

    res.json(successResponse(state));
  } catch (error) {
    console.error('Error fetching state:', error);
    res.status(500).json(errorResponse('Failed to fetch state'));
  }
});

// ============================================================
// Counties Routes
// ============================================================

// GET /api/counties - List all counties with optional state filter
router.get('/counties', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { stateId, priority, search } = req.query;

    let conditions = [];
    if (stateId) conditions.push(eq(counties.stateId, parseInt(stateId as string)));
    if (priority) conditions.push(eq(counties.targetPriority, priority as any));
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

    res.json(successResponse(results, {
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

// GET /api/counties/:id - Get county with tax officials
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

// POST /api/tax-officials - Create new tax official
router.post('/tax-officials', async (req, res) => {
  try {
    const { countyId, fullName, title, phoneNumber, emailAddress, officeAddress, websiteUrl, isPrimary } = req.body;

    if (!countyId || !fullName) {
      return res.status(400).json(errorResponse('countyId and fullName are required', 400));
    }

    const result = await db.insert(taxOfficials).values({
      countyId,
      fullName,
      title,
      phoneNumber,
      emailAddress,
      officeAddress,
      websiteUrl,
      isPrimary: isPrimary || false,
    }).returning();

    res.status(201).json(successResponse(result[0]));
  } catch (error) {
    console.error('Error creating tax official:', error);
    res.status(500).json(errorResponse('Failed to create tax official'));
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
