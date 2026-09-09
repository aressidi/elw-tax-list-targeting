import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import {
  listRequests,
  listRequestEvents,
  listRequestStatusHistory,
  type ListRequest,
  type ReviewClassification,
} from '../../shared/schema.js';

// ============================================================
// Human review classification (card 10) — the layer on top of card 09's
// rule-based auto-classification. Every review classification maps 1:1
// onto an existing request_status value (needs_clarification was added to
// that enum specifically to complete this mapping), so applying one is
// just "set the status, fill in whatever response data came with it, and
// leave an audit trail" -- shared by both the direct list-request route
// and the inbox-item review route so the two stay in lockstep.
// ============================================================

const REQUEST_STATUS_BY_REVIEW: Record<ReviewClassification, NonNullable<ListRequest['requestStatus']>> = {
  list_provided: 'list_provided',
  requires_payment: 'requires_payment',
  requires_form: 'requires_form',
  not_available: 'not_available',
  needs_clarification: 'needs_clarification',
  declined: 'declined',
};

const EVENT_TYPE_BY_REVIEW: Record<ReviewClassification, (typeof listRequestEvents.$inferInsert)['eventType']> = {
  list_provided: 'file_received',
  requires_payment: 'payment_requested',
  requires_form: 'status_changed',
  not_available: 'status_changed',
  needs_clarification: 'status_changed',
  declined: 'status_changed',
};

interface ReviewSourceItem {
  gmailMessageId: string;
  bodyText: string | null;
  receivedAt: Date | null;
  attachmentMetadata: unknown;
}

export interface ReviewClassificationInput {
  classification: ReviewClassification;
  amount?: string | number | null;
  currency?: string | null;
  formUrl?: string | null;
  notes?: string | null;
  // Present when the review originates from a matched inbox item (the
  // normal path from the Responses UI); omitted for a direct
  // /list-requests/:id/classify call made with no linked message.
  sourceItem?: ReviewSourceItem | null;
}

export interface ReviewClassificationResult {
  listRequest: ListRequest;
  previousStatus: ListRequest['requestStatus'];
}

export async function applyReviewClassification(
  listRequestId: number,
  input: ReviewClassificationInput
): Promise<ReviewClassificationResult | null> {
  const request = await db.query.listRequests.findFirst({ where: eq(listRequests.id, listRequestId) });
  if (!request) return null;

  const { classification, amount, currency, formUrl, notes, sourceItem } = input;
  const newStatus = REQUEST_STATUS_BY_REVIEW[classification];
  const previousStatus = request.requestStatus;

  const attachments = Array.isArray(sourceItem?.attachmentMetadata)
    ? (sourceItem!.attachmentMetadata as Array<{ filename: string }>)
    : [];
  const isListFile = classification === 'list_provided' && attachments.length > 0;

  let summary = notes?.trim() || null;
  if (!summary && sourceItem?.bodyText) summary = sourceItem.bodyText.slice(0, 300);
  if (formUrl) summary = summary ? `${summary}\n\nForm to complete: ${formUrl}` : `Form to complete: ${formUrl}`;

  const updateData: Record<string, unknown> = {
    requestStatus: newStatus,
    updatedAt: new Date(),
  };

  if (sourceItem) {
    updateData.responseReceivedAt = request.responseReceivedAt ?? sourceItem.receivedAt ?? new Date();
    updateData.fullResponseText = sourceItem.bodyText ?? request.fullResponseText;
  } else if (!request.responseReceivedAt) {
    updateData.responseReceivedAt = new Date();
  }

  if (summary) updateData.responseSummary = summary;

  if (isListFile) {
    updateData.listFileReceived = true;
    updateData.fileLocation = `inbox/${sourceItem!.gmailMessageId}/${attachments[0].filename}`;
  }

  const hasAmount = amount !== undefined && amount !== null && amount !== '';
  if (classification === 'requires_payment' && hasAmount) {
    updateData.costAmount = String(amount);
    updateData.costCurrency = (currency && currency.trim()) || 'USD';
    updateData.paymentStatus = 'requested';
  }

  const [updated] = await db
    .update(listRequests)
    .set(updateData)
    .where(eq(listRequests.id, listRequestId))
    .returning();

  if (previousStatus !== newStatus) {
    await db.insert(listRequestStatusHistory).values({
      listRequestId,
      fromStatus: previousStatus,
      toStatus: newStatus,
      reason: notes || `Marked "${classification}" during response review`,
      sourceLabel: 'response_classification_review',
    });
  }

  await db.insert(listRequestEvents).values({
    listRequestId,
    eventType: EVENT_TYPE_BY_REVIEW[classification],
    channel: 'email',
    summary: `Response reviewed and classified as "${classification}"`,
    body: notes || null,
    metadata: {
      classification,
      amount: amount ?? null,
      currency: currency ?? null,
      formUrl: formUrl ?? null,
      previousStatus,
      newStatus,
      gmailMessageId: sourceItem?.gmailMessageId ?? null,
    },
  });

  return { listRequest: updated, previousStatus };
}
