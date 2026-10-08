// Card 96127e3a: Let a user delete a list request that has not been started
// yet — e.g. an accidental request created before/while requesting a county
// list. Deletion is destructive and only ever safe before any outbound action
// or audit trail exists, so the "has this been started?" decision lives here
// as a pure, side-effect-free predicate the DELETE route calls after it has
// loaded the row and counted its audit children. Keeping it pure lets us test
// every refusal branch without a live database.

/** The 409 message surfaced whenever a started request is asked to be deleted. */
export const ALREADY_STARTED_MESSAGE =
  'List request has already been started and cannot be deleted';

export interface ListRequestDeletabilityInput {
  requestStatus: string | null;
  emailSentAt: Date | string | null;
  queuedAt: Date | string | null;
  scheduledSendAt: Date | string | null;
  latestEventAt: Date | string | null;
  /** Number of list_request_events rows for this request. */
  eventCount: number;
  /** Number of list_request_status_history rows for this request. */
  statusHistoryCount: number;
}

export interface ListRequestDeletability {
  deletable: boolean;
  /** Populated only when deletable is false; the 409 message to return. */
  reason?: string;
}

/**
 * A list request is deletable ONLY when every one of these holds:
 *  - requestStatus === 'not_started'
 *  - emailSentAt IS NULL
 *  - queuedAt IS NULL and scheduledSendAt IS NULL
 *  - latestEventAt IS NULL and it has no event / status-history rows
 * If any is false the request has been started in some way and must not be
 * deleted. A freshly created request records none of the above, so creation
 * alone never blocks deletion.
 */
export function evaluateListRequestDeletable(
  input: ListRequestDeletabilityInput
): ListRequestDeletability {
  const started =
    input.requestStatus !== 'not_started' ||
    input.emailSentAt != null ||
    input.queuedAt != null ||
    input.scheduledSendAt != null ||
    input.latestEventAt != null ||
    input.eventCount > 0 ||
    input.statusHistoryCount > 0;

  if (started) {
    return { deletable: false, reason: ALREADY_STARTED_MESSAGE };
  }
  return { deletable: true };
}
