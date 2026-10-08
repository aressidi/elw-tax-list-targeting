// Card 96127e3a (UI follow-up): the client-side "can I offer a Delete action?"
// predicate, shared verbatim by every page that lists list requests
// (ListRequests + CountyDetail) so the rule can never drift between them.
//
// It mirrors the server guard in server/services/listRequestDeletion.ts using
// only the fields a list row carries — a request is offerable-for-delete while
// it has not been started in any outbound way. The server (DELETE
// /api/list-requests/:id) stays authoritative and re-checks the FULL condition,
// including audit-trail rows the client never sees, before actually deleting;
// this predicate only decides whether to show the control.

export interface DeletableListRequestFields {
  requestStatus: string | null;
  // Optional so a row that simply omits a field (e.g. a view that never selects
  // it) is treated as "not set" rather than failing to type-check.
  emailSentAt?: Date | string | null;
  queuedAt?: Date | string | null;
  scheduledSendAt?: Date | string | null;
}

/**
 * True only before the request has been started in any way the row exposes:
 * status is still 'not_started' and nothing has been sent, queued, or scheduled.
 */
export function isListRequestDeletable(request: DeletableListRequestFields): boolean {
  return (
    request.requestStatus === 'not_started' &&
    request.emailSentAt == null &&
    request.queuedAt == null &&
    request.scheduledSendAt == null
  );
}
