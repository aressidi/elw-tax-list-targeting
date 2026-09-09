import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from '../db.js';
import { emailQueue, emailQueueSettings, emailTracking, listRequests } from '../../shared/schema.js';
import { sendListRequestEmail } from './emailService.js';

// ============================================================
// Settings — single-row table, created lazily on first read. There is no
// seed migration for it; getOrCreateSettings() is the only writer of the
// initial row.
// ============================================================

const MIN_DAILY_LIMIT = 20;
const MAX_DAILY_LIMIT = 50;
const DEFAULT_DAILY_LIMIT = 20;

export async function getOrCreateSettings() {
  const existing = await db.query.emailQueueSettings.findFirst();
  if (existing) return existing;

  const [created] = await db
    .insert(emailQueueSettings)
    .values({ dailyLimit: DEFAULT_DAILY_LIMIT, paused: false })
    .returning();
  return created;
}

export function isValidDailyLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_DAILY_LIMIT && value <= MAX_DAILY_LIMIT;
}

export async function updateDailyLimit(dailyLimit: number) {
  const settings = await getOrCreateSettings();
  const [updated] = await db
    .update(emailQueueSettings)
    .set({ dailyLimit, updatedAt: new Date() })
    .where(eq(emailQueueSettings.id, settings.id))
    .returning();
  return updated;
}

export async function setPaused(paused: boolean) {
  const settings = await getOrCreateSettings();
  const [updated] = await db
    .update(emailQueueSettings)
    .set({ paused, updatedAt: new Date() })
    .where(eq(emailQueueSettings.id, settings.id))
    .returning();
  return updated;
}

// ============================================================
// Daily counters — email_tracking has no transport column (see
// emailService.ts), so real vs. dry-run is read off the `[transport:x]`
// prefix baked into bodyPreview. Dry-run sends do NOT count toward the
// throttle: the daily limit exists to protect real deliverability, and
// gating dry-run testing behind it would make the feature unable to be
// exercised without EMAIL_TRANSPORT=gog. They're still surfaced separately
// in stats so testing activity is visible.
// ============================================================

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function getSentTodayCounts(): Promise<{ sentToday: number; realSentToday: number }> {
  const rows = await db
    .select({ bodyPreview: emailTracking.bodyPreview })
    .from(emailTracking)
    .where(gte(emailTracking.sentAt, startOfToday()));

  let sentToday = 0;
  let realSentToday = 0;
  for (const row of rows) {
    sentToday++;
    if (!row.bodyPreview?.startsWith('[transport:dry_run]')) realSentToday++;
  }
  return { sentToday, realSentToday };
}

async function countFailedToday(): Promise<number> {
  const rows = await db
    .select({ id: emailQueue.id })
    .from(emailQueue)
    .where(and(eq(emailQueue.status, 'failed'), gte(emailQueue.updatedAt, startOfToday())));
  return rows.length;
}

// ============================================================
// Status — powers GET /api/email-queue/status
// ============================================================

export async function getQueueStatus() {
  const settings = await getOrCreateSettings();
  const { sentToday, realSentToday } = await getSentTodayCounts();
  const failedToday = await countFailedToday();

  const queuedItems = await db
    .select({ id: emailQueue.id, sendAt: emailQueue.sendAt })
    .from(emailQueue)
    .where(eq(emailQueue.status, 'queued'));

  const now = Date.now();
  const dueNow = queuedItems.filter((item) => !item.sendAt || item.sendAt.getTime() <= now).length;
  const scheduled = queuedItems.length - dueNow;

  return {
    paused: settings.paused,
    dailyLimit: settings.dailyLimit,
    sentToday,
    realSentToday,
    pending: queuedItems.length,
    dueNow,
    scheduled,
    failedToday,
  };
}

// ============================================================
// Enqueue / cancel
// ============================================================

export interface EnqueueResult {
  listRequestId: number;
  outcome: 'queued' | 'skipped' | 'failed';
  queueId?: number;
  error?: string;
  statusCode: number;
}

export async function enqueueListRequestEmail(listRequestId: number, sendAt?: string | null): Promise<EnqueueResult> {
  const request = await db.query.listRequests.findFirst({ where: eq(listRequests.id, listRequestId) });
  if (!request) {
    return { listRequestId, outcome: 'failed', error: 'List request not found', statusCode: 404 };
  }

  if (request.emailSentAt) {
    return {
      listRequestId,
      outcome: 'skipped',
      error: 'Email already sent for this request.',
      statusCode: 409,
    };
  }

  const existingActive = await db.query.emailQueue.findFirst({
    where: and(eq(emailQueue.listRequestId, listRequestId), inArray(emailQueue.status, ['queued', 'sending'])),
  });
  if (existingActive) {
    return {
      listRequestId,
      outcome: 'skipped',
      error: 'This request is already in the queue.',
      statusCode: 409,
    };
  }

  let parsedSendAt: Date | null = null;
  if (sendAt) {
    const parsed = new Date(sendAt);
    if (isNaN(parsed.getTime())) {
      return { listRequestId, outcome: 'failed', error: 'Invalid sendAt date', statusCode: 400 };
    }
    parsedSendAt = parsed;
  }

  const [created] = await db
    .insert(emailQueue)
    .values({ listRequestId, status: 'queued', sendAt: parsedSendAt })
    .returning();

  await db
    .update(listRequests)
    .set({ queuedAt: new Date(), scheduledSendAt: parsedSendAt, updatedAt: new Date() })
    .where(eq(listRequests.id, listRequestId));

  return { listRequestId, outcome: 'queued', queueId: created.id, statusCode: 200 };
}

export async function enqueueListRequestEmailsBulk(
  listRequestIds: number[],
  sendAt?: string | null
): Promise<EnqueueResult[]> {
  const results: EnqueueResult[] = [];
  for (const id of listRequestIds) {
    results.push(await enqueueListRequestEmail(id, sendAt));
  }
  return results;
}

export interface CancelResult {
  ok: boolean;
  error?: string;
  statusCode: number;
}

export async function cancelQueueItem(queueId: number): Promise<CancelResult> {
  const item = await db.query.emailQueue.findFirst({ where: eq(emailQueue.id, queueId) });
  if (!item) {
    return { ok: false, error: 'Queue item not found', statusCode: 404 };
  }
  if (item.status !== 'queued') {
    return { ok: false, error: `Cannot cancel an item with status "${item.status}"`, statusCode: 409 };
  }

  await db.update(emailQueue).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(emailQueue.id, queueId));

  const stillActive = await db.query.emailQueue.findFirst({
    where: and(eq(emailQueue.listRequestId, item.listRequestId), inArray(emailQueue.status, ['queued', 'sending'])),
  });
  if (!stillActive) {
    await db
      .update(listRequests)
      .set({ queuedAt: null, scheduledSendAt: null, updatedAt: new Date() })
      .where(eq(listRequests.id, item.listRequestId));
  }

  return { ok: true, statusCode: 200 };
}

// ============================================================
// List — powers the queue dashboard. Defaults to active (queued/sending)
// items; pass includeAll to also see sent/failed/cancelled history.
// ============================================================

export async function listQueueItems(includeAll = false) {
  return db.query.emailQueue.findMany({
    where: includeAll ? undefined : inArray(emailQueue.status, ['queued', 'sending']),
    orderBy: [asc(emailQueue.sendAt), asc(emailQueue.queuedAt)],
    with: {
      listRequest: {
        with: {
          taxOfficial: {
            with: {
              county: { with: { state: true } },
            },
          },
        },
      },
    },
  });
}

// ============================================================
// Processor — in-process, setInterval-based. Picks due items (sendAt <=
// now, or null = immediate) respecting the paused flag and the remaining
// daily budget, then hands each one to emailService's existing send path
// so the transport gate (dry_run vs. gog) never moves. A boolean lock
// guards against overlapping ticks if a previous run is still in flight
// when the next timer fires; the queued->sending->sent/failed transition
// is the guard against double-sending any single item.
// ============================================================

const PROCESS_INTERVAL_MS = Number(process.env.EMAIL_QUEUE_INTERVAL_MS) || 60_000;

let processing = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function claimItem(queueId: number): Promise<boolean> {
  const claimed = await db
    .update(emailQueue)
    .set({ status: 'sending', updatedAt: new Date() })
    .where(and(eq(emailQueue.id, queueId), eq(emailQueue.status, 'queued')))
    .returning({ id: emailQueue.id });
  return claimed.length > 0;
}

async function processDueItem(item: { id: number; listRequestId: number }): Promise<void> {
  const claimed = await claimItem(item.id);
  if (!claimed) return;

  try {
    const result = await sendListRequestEmail(item.listRequestId);

    if (result.outcome === 'sent') {
      await db
        .update(emailQueue)
        .set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() })
        .where(eq(emailQueue.id, item.id));
      await db
        .update(listRequests)
        .set({ queuedAt: null, scheduledSendAt: null })
        .where(eq(listRequests.id, item.listRequestId));
    } else if (result.outcome === 'skipped') {
      // Already sent via another path (manual send, another queue entry).
      // Nothing left for this queue item to do.
      await db
        .update(emailQueue)
        .set({ status: 'cancelled', error: result.error ?? 'Already sent', updatedAt: new Date() })
        .where(eq(emailQueue.id, item.id));
      await db
        .update(listRequests)
        .set({ queuedAt: null, scheduledSendAt: null })
        .where(eq(listRequests.id, item.listRequestId));
    } else {
      await db
        .update(emailQueue)
        .set({ status: 'failed', error: result.error ?? 'Send failed', updatedAt: new Date() })
        .where(eq(emailQueue.id, item.id));
    }
  } catch (error) {
    await db
      .update(emailQueue)
      .set({
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unexpected error while sending',
        updatedAt: new Date(),
      })
      .where(eq(emailQueue.id, item.id));
  }
}

export async function processQueueTick(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const settings = await getOrCreateSettings();
    if (settings.paused) return;

    const { realSentToday } = await getSentTodayCounts();
    const remaining = settings.dailyLimit - realSentToday;
    if (remaining <= 0) return;

    const now = new Date();
    const dueItems = await db.query.emailQueue.findMany({
      where: and(eq(emailQueue.status, 'queued'), or(isNull(emailQueue.sendAt), lte(emailQueue.sendAt, now))),
      orderBy: asc(emailQueue.queuedAt),
      limit: remaining,
    });

    for (const item of dueItems) {
      await processDueItem(item);
    }
  } catch (error) {
    console.error('Email queue processor tick failed:', error);
  } finally {
    processing = false;
  }
}

// Crash/restart recovery: any item left in 'sending' from an unclean
// shutdown is not being processed by anyone anymore, so it must go back to
// 'queued' or it would be stuck forever (claimItem only ever claims from
// 'queued').
async function recoverStuckItems(): Promise<void> {
  await db
    .update(emailQueue)
    .set({ status: 'queued', updatedAt: new Date() })
    .where(eq(emailQueue.status, 'sending'));
}

export async function startQueueProcessor(): Promise<void> {
  if (intervalHandle) return;
  await recoverStuckItems();
  intervalHandle = setInterval(() => {
    processQueueTick().catch((error) => console.error('Email queue processor tick failed:', error));
  }, PROCESS_INTERVAL_MS);
  // Run one tick immediately on boot so already-queued items (persisted
  // from before a restart) don't wait a full interval.
  processQueueTick().catch((error) => console.error('Email queue processor tick failed:', error));
}

export function stopQueueProcessor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
