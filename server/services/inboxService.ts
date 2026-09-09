import { execFile } from 'node:child_process';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db.js';
import {
  emailTracking,
  inboxItems,
  listRequests,
  listRequestEvents,
  type InboxItem,
  type InboxClassification,
} from '../../shared/schema.js';
import { matchInboxMessage, type MatchCandidateRequest } from '../../shared/inboxMatch.js';
import { classifyInboxMessage } from './inboxClassify.js';

// ============================================================
// Provider boundary
//
// Mock is the default and only provider unless INBOX_PROVIDER=gog is set.
// That env var is the human sign-off gate for live Gmail reads — nothing
// in this module (or its callers) should shell out to gog through any
// other path, and the mock provider never touches the network or the
// filesystem outside this process.
// ============================================================

export type InboxProviderName = 'mock' | 'gog';

export function getActiveInboxProvider(): InboxProviderName {
  return process.env.INBOX_PROVIDER === 'gog' ? 'gog' : 'mock';
}

export interface RawAttachment {
  filename: string;
  sizeBytes: number;
  kind: string;
}

export interface RawInboxMessage {
  gmailMessageId: string;
  threadId: string | null;
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  receivedAt: Date;
  attachments: RawAttachment[];
}

// ------------------------------------------------------------
// Live path: shells out to the `gog` CLI, already authenticated for
// alex@eastonlandworks.com. Flags follow gog's documented `gmail search`
// interface (--json for structured output, --select to pick fields,
// --gmail-no-send as a defense-in-depth belt so this read-only call can
// never trigger a send even if misconfigured). UNVERIFIED against a live
// `gog gmail search --help` — the sandbox this was written in could not
// run that command (same limitation noted in emailService.ts for `gmail
// send`). Confirm the flag names before relying on this path.
// ------------------------------------------------------------

const GOG_SEARCH_QUERY = process.env.INBOX_SEARCH_QUERY || 'newer_than:7d in:inbox';

interface GogSearchMessage {
  id: string;
  threadId?: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  bodyText?: string;
  receivedAt?: string;
  date?: string;
  attachments?: Array<{ filename?: string; name?: string; size?: number; sizeBytes?: number; mimeType?: string }>;
}

function fetchViaGog(): Promise<RawInboxMessage[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'gog',
      [
        'gmail',
        'search',
        '--query',
        GOG_SEARCH_QUERY,
        '--json',
        '--select',
        'id,threadId,from,to,subject,body,receivedAt,attachments',
        '--gmail-no-send',
      ],
      { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as GogSearchMessage[];
          resolve(
            parsed.map((m) => ({
              gmailMessageId: m.id,
              threadId: m.threadId ?? null,
              from: m.from ?? '',
              to: m.to ?? '',
              subject: m.subject ?? '',
              bodyText: m.bodyText ?? m.body ?? '',
              receivedAt: m.receivedAt || m.date ? new Date(m.receivedAt ?? m.date!) : new Date(),
              attachments: (m.attachments ?? []).map((a) => ({
                filename: a.filename ?? a.name ?? 'attachment',
                sizeBytes: a.sizeBytes ?? a.size ?? 0,
                kind: (a.filename ?? a.name ?? '').split('.').pop()?.toLowerCase() ?? a.mimeType ?? 'other',
              })),
            }))
          );
        } catch (parseError) {
          reject(new Error(`Failed to parse gog output: ${(parseError as Error).message}`));
        }
      }
    );
  });
}

// ------------------------------------------------------------
// Mock path: deterministic sample replies for exercising the full match /
// classify / flag pipeline without any network access. Never invoked when
// INBOX_PROVIDER=gog.
//
// Trigger gate: fixtures are only (re)generated when INBOX_MOCK_NEW=1 is
// set for the request, or when at least INBOX_MOCK_INTERVAL_MS (default
// one minute) has passed since the last generation. This keeps repeated
// "Check now" clicks or a 5-minute poll loop from spamming duplicate rows
// -- and since each generation mints fresh gmailMessageIds, the unique
// constraint on inbox_items still lets you re-trigger deliberately (e.g.
// in a demo) to see new rows land.
//
// The two "real" fixtures opportunistically borrow a genuine county/
// official/sent-email from the current database so the demo can show a
// real thread-id match and a real from-address match; if the database has
// no sent emails yet (fresh install), they fall back to synthetic data
// that classification still works on but matching correctly leaves
// unlinked. The third fixture is always fully synthetic and unrelated, to
// exercise the "flagged for manual review" path.
// ------------------------------------------------------------

const INBOX_MOCK_INTERVAL_MS = Number(process.env.INBOX_MOCK_INTERVAL_MS) || 60_000;
let lastMockGenerationAt = 0;
let mockRunCounter = 0;

function shouldGenerateMockFixtures(): boolean {
  if (process.env.INBOX_MOCK_NEW === '1') return true;
  return Date.now() - lastMockGenerationAt >= INBOX_MOCK_INTERVAL_MS;
}

async function findSampleSentRequest(excludeListRequestId?: number) {
  const rows = await db
    .select({
      listRequestId: emailTracking.listRequestId,
      gmailMessageId: emailTracking.gmailMessageId,
    })
    .from(emailTracking)
    .where(and(eq(emailTracking.emailType, 'sent'), isNotNull(emailTracking.gmailMessageId)))
    .orderBy(desc(emailTracking.sentAt))
    .limit(10);

  for (const row of rows) {
    if (!row.gmailMessageId) continue;
    if (excludeListRequestId && row.listRequestId === excludeListRequestId) continue;

    const request = await db.query.listRequests.findFirst({
      where: eq(listRequests.id, row.listRequestId),
      with: { taxOfficial: { with: { county: { with: { state: true } } } } },
    });
    if (request?.taxOfficial?.county?.state) {
      return { gmailMessageId: row.gmailMessageId, request };
    }
  }
  return null;
}

async function fetchViaMock(): Promise<RawInboxMessage[]> {
  if (!shouldGenerateMockFixtures()) return [];
  lastMockGenerationAt = Date.now();
  mockRunCounter += 1;
  const suffix = `${Date.now()}-${mockRunCounter}`;
  const now = new Date();

  const sampleA = await findSampleSentRequest();
  const sampleB = await findSampleSentRequest(sampleA?.request.id);

  const fixtures: RawInboxMessage[] = [];

  // Fixture 1: a list arrives as a PDF attachment. When real data is
  // available this reuses a real sent message's id as the reply's
  // threadId, so the strongest ("thread_id") match path is exercised.
  const countyA = sampleA?.request.taxOfficial?.county;
  fixtures.push({
    gmailMessageId: `mock-list-received-${suffix}`,
    threadId: sampleA?.gmailMessageId ?? null,
    from: sampleA?.request.taxOfficial?.emailAddress || 'clerk@sample-county.example.gov',
    to: 'alex@eastonlandworks.com',
    subject: countyA
      ? `Re: FOIA Request - Tax Delinquent Property List - ${countyA.name} County, ${countyA.state.name}`
      : 'Re: FOIA Request - Tax Delinquent Property List - Sample County, Sample State',
    bodyText:
      'Good afternoon,\n\nPlease find attached the list of tax delinquent properties you requested. Let us know if you need anything further.\n\nThank you,\nCounty Treasurer\'s Office',
    receivedAt: now,
    attachments: [{ filename: 'delinquent_properties_list.pdf', sizeBytes: 248_000, kind: 'pdf' }],
  });

  // Fixture 2: a fee quote reply. Reuses a second real county/official
  // when available (matched via subject heuristics + from-address), else
  // falls back to synthetic data.
  const countyB = sampleB?.request.taxOfficial?.county;
  fixtures.push({
    gmailMessageId: `mock-fee-quote-${suffix}`,
    threadId: sampleB?.gmailMessageId ?? null,
    from: sampleB?.request.taxOfficial?.emailAddress || 'records@another-sample-county.example.gov',
    to: 'alex@eastonlandworks.com',
    subject: countyB
      ? `Re: FOIA Request - Tax Delinquent Property List - ${countyB.name} County, ${countyB.state.name}`
      : 'Re: FOIA Request - Tax Delinquent Property List - Another Sample County, Sample State',
    bodyText:
      'Hello,\n\nWe can provide this list, however there is a $75 fee for processing and reproduction. Please remit payment before we proceed with your request.\n\nRegards,\nRecords Office',
    receivedAt: now,
    attachments: [],
  });

  // Fixture 3: an unrelated forwarded message. Always fully synthetic and
  // designed to score zero against every candidate, exercising the
  // unmatched / manual-review path.
  fixtures.push({
    gmailMessageId: `mock-unrelated-${suffix}`,
    threadId: null,
    from: 'newsletter@county-services-weekly.example.test',
    to: 'alex@eastonlandworks.com',
    subject: 'FWD: Weekly County Services Newsletter',
    bodyText: 'Fwd:\n\n---\nThis week in county government: road closures, budget hearings, and more.',
    receivedAt: now,
    attachments: [],
  });

  return fixtures;
}

async function fetchRawMessages(): Promise<RawInboxMessage[]> {
  return getActiveInboxProvider() === 'gog' ? fetchViaGog() : fetchViaMock();
}

// ============================================================
// Matching candidates — every list request with an official/county/state
// on file, plus the gmailMessageIds of emails sent for it (email_tracking
// is the only source of truth for what "our side" sent).
// ============================================================

async function buildMatchCandidates(): Promise<MatchCandidateRequest[]> {
  const requests = await db.query.listRequests.findMany({
    with: {
      taxOfficial: { with: { county: { with: { state: true } } } },
      emailTracking: { where: eq(emailTracking.emailType, 'sent') },
    },
  });

  return requests
    .filter((r) => r.taxOfficial?.county?.state)
    .map((r) => ({
      listRequestId: r.id,
      countyName: r.taxOfficial!.county!.name,
      stateName: r.taxOfficial!.county!.state.name,
      stateAbbr: r.taxOfficial!.county!.state.abbreviation,
      officialEmail: r.taxOfficial!.emailAddress,
      sentGmailMessageIds: r.emailTracking
        .map((t) => t.gmailMessageId)
        .filter((id): id is string => Boolean(id)),
    }));
}

// ============================================================
// Applying a confidently-matched item back onto its list_request. Only
// called for items that cleared MATCH_THRESHOLD (status 'matched' or
// 'attached') — unmatched items never touch list_requests.
//
// requestStatus is only auto-advanced when the request hasn't already
// progressed past "waiting to hear back" (email_sent / awaiting_response /
// response_received). A request already marked list_provided, declined,
// requires_payment, etc. is left alone so a stray or duplicate reply can
// never regress it — a human owns any further transition from there.
// ============================================================

const ADVANCEABLE_STATUSES = new Set(['email_sent', 'awaiting_response', 'response_received']);

const STATUS_BY_CLASSIFICATION: Partial<Record<InboxClassification, string>> = {
  list_received: 'list_provided',
  fee_quote: 'requires_payment',
  rejection: 'declined',
};

async function applyMatchToListRequest(
  item: RawInboxMessage,
  listRequestId: number,
  classification: InboxClassification
): Promise<void> {
  const request = await db.query.listRequests.findFirst({ where: eq(listRequests.id, listRequestId) });
  if (!request) return;

  const isListFile = classification === 'list_received' && item.attachments.length > 0;
  const summary = isListFile
    ? `List received via email attachment (${item.attachments.map((a) => a.filename).join(', ')})`
    : item.bodyText.slice(0, 300);

  const updateData: Record<string, unknown> = {
    responseReceivedAt: request.responseReceivedAt ?? item.receivedAt,
    responseSummary: summary,
    fullResponseText: item.bodyText,
    updatedAt: new Date(),
  };

  if (isListFile) {
    updateData.listFileReceived = true;
    updateData.fileLocation = `inbox/${item.gmailMessageId}/${item.attachments[0].filename}`;
  }

  if (classification === 'fee_paid') {
    updateData.paymentStatus = 'paid';
  }

  const targetStatus = STATUS_BY_CLASSIFICATION[classification];
  if (targetStatus && ADVANCEABLE_STATUSES.has(request.requestStatus ?? '')) {
    updateData.requestStatus = targetStatus;
  } else if (ADVANCEABLE_STATUSES.has(request.requestStatus ?? '') && classification !== 'other') {
    // clarification / fee_paid: no dedicated terminal status, but a reply
    // did arrive -- record that generically without inventing a status.
    updateData.requestStatus = 'response_received';
  }

  await db.update(listRequests).set(updateData).where(eq(listRequests.id, listRequestId));

  await db.insert(listRequestEvents).values({
    listRequestId,
    eventType: 'email_received',
    channel: 'email',
    summary: `Inbox reply classified as "${classification}"`,
    body: item.bodyText,
    metadata: {
      gmailMessageId: item.gmailMessageId,
      classification,
      fromAddress: item.from,
    },
  });
}

// ============================================================
// Poll orchestration — the only entry point callers (routes, the
// background loop) should use. Fetches raw messages from the active
// provider, skips anything already recorded (by gmailMessageId), scores
// and classifies the rest, persists an inbox_items row for each, and
// applies list_request side effects for confident matches only.
// ============================================================

export interface PollInboxResult {
  provider: InboxProviderName;
  fetched: number;
  newItemsCount: number;
  items: InboxItem[];
}

export async function pollInbox(): Promise<PollInboxResult> {
  const provider = getActiveInboxProvider();
  const rawMessages = await fetchRawMessages();
  if (rawMessages.length === 0) {
    return { provider, fetched: 0, newItemsCount: 0, items: [] };
  }

  const candidates = await buildMatchCandidates();
  const newItems: InboxItem[] = [];

  for (const raw of rawMessages) {
    const existing = await db.query.inboxItems.findFirst({
      where: eq(inboxItems.gmailMessageId, raw.gmailMessageId),
    });
    if (existing) continue;

    const matchResult = matchInboxMessage(
      { threadId: raw.threadId, subject: raw.subject, fromAddress: raw.from },
      candidates
    );
    const classification = classifyInboxMessage({
      subject: raw.subject,
      bodyText: raw.bodyText,
      attachments: raw.attachments,
    });
    const matched = matchResult.listRequestId !== null;
    const status = matched ? (classification === 'list_received' ? 'attached' : 'matched') : 'unmatched';

    const [inserted] = await db
      .insert(inboxItems)
      .values({
        gmailMessageId: raw.gmailMessageId,
        threadId: raw.threadId,
        fromAddress: raw.from,
        subject: raw.subject,
        bodyText: raw.bodyText,
        receivedAt: raw.receivedAt,
        listRequestId: matchResult.listRequestId,
        matchConfidence: matchResult.confidence,
        matchMethod: matchResult.method,
        classification,
        status,
        attachmentMetadata: raw.attachments,
      })
      .returning();

    if (matched) {
      await applyMatchToListRequest(raw, matchResult.listRequestId!, classification);
    }

    newItems.push(inserted);
  }

  return { provider, fetched: rawMessages.length, newItemsCount: newItems.length, items: newItems };
}

// ============================================================
// Background loop — mirrors queueService's setInterval pattern. Runs in
// mock mode by default (useful for demoing the pipeline); set
// INBOX_POLL_ENABLED=false to disable entirely, e.g. in a test process.
// ============================================================

const POLL_INTERVAL_MS = Number(process.env.INBOX_POLL_INTERVAL_MS) || 5 * 60_000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let polling = false;

async function runPollTick(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    await pollInbox();
  } catch (error) {
    console.error('Inbox poll tick failed:', error);
  } finally {
    polling = false;
  }
}

export function startInboxPoller(): void {
  if (intervalHandle) return;
  if (process.env.INBOX_POLL_ENABLED === 'false') return;
  intervalHandle = setInterval(() => {
    runPollTick();
  }, POLL_INTERVAL_MS);
  runPollTick();
}

export function stopInboxPoller(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
