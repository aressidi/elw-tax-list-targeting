// ============================================================
// Rule-based reply classification (card 09) — deterministic keyword/regex
// checks, no external AI call. This is intentionally v1: the categories
// and this single entry point (classifyInboxMessage) are the extension
// point for a future AI-backed classifier without touching call sites.
//
// Checks run in priority order and the first match wins, since a message
// can plausibly contain more than one signal (e.g. a fee quote that also
// mentions "please clarify"). Order reflects which reading matters most
// operationally: a firm rejection or fee gate should never be masked by a
// milder "other" fallback.
// ============================================================

import type { InboxClassification } from '../../shared/schema.js';

export interface ClassifyInput {
  subject: string | null;
  bodyText: string | null;
  attachments: Array<{ filename: string; kind?: string }>;
}

const REJECTION = /\b(denied|deny|denial|not a public record|not subject to disclosure|exempt from disclosure|cannot provide|unable to (provide|fulfill)|no responsive records)\b/i;

const FEE_PAID = /\b(payment (has been |was )?received|paid in full|invoice (has been |was )?paid|thank you for your payment)\b/i;

const FEE_QUOTE = /(\$\s?\d)|\b(fee|cost|invoice)\b.{0,25}\b(required|due|requested|before we (can|proceed)|must be (paid|received))/i;

const CLARIFICATION = /\b(please (clarify|specify|provide more)|need (more|additional) information|could you (clarify|specify)|which (properties|parcels|tax years?|records))\b/i;

const LIST_TERMS = /\b(delinquent propert(y|ies)|tax list|property list|parcel list|attached (is|please find)|please find attached|find enclosed)\b/i;

const LIST_FILE_EXTENSIONS = /\.(csv|xlsx?|pdf)$/i;

export function classifyInboxMessage(input: ClassifyInput): InboxClassification {
  const text = `${input.subject ?? ''}\n${input.bodyText ?? ''}`;

  if (REJECTION.test(text)) return 'rejection';
  if (FEE_PAID.test(text)) return 'fee_paid';
  if (FEE_QUOTE.test(text)) return 'fee_quote';
  if (CLARIFICATION.test(text)) return 'clarification';

  const hasListAttachment = input.attachments.some((a) => LIST_FILE_EXTENSIONS.test(a.filename));
  if (hasListAttachment || LIST_TERMS.test(text)) return 'list_received';

  return 'other';
}
