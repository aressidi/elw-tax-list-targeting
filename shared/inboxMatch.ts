// ============================================================
// Inbox reply matching (card 09) — pure, DB-free scoring so it can be unit
// tested without a database and reused identically by the mock and live
// (gog) inbox providers.
//
// Signals, strongest to weakest:
//   (a) thread/message id already tracked in email_tracking for a request
//       ("thread_id") — effectively deterministic, since Gmail sets a
//       thread's id to the id of its first message.
//   (b) subject-line heuristics ("subject") — county name + a FOIA/records
//       token, optionally the state name/abbreviation.
//   (c) sender address matches the county's contact on file
//       ("from_address") — weak alone (shared inboxes, forwarded mail),
//       only informative combined with a subject signal.
//
// MATCH_THRESHOLD is the confidence a message must clear to be linked to a
// request automatically. Below it, the message is still scored (so a
// reviewer can see "why we think this might be X") but is left unlinked —
// conservative by design, per card 09: "when in doubt, flag."
// ============================================================

export const MATCH_THRESHOLD = 70;

export interface MatchCandidateRequest {
  listRequestId: number;
  countyName: string;
  stateName?: string | null;
  stateAbbr?: string | null;
  officialEmail?: string | null;
  /** gmailMessageId values from email_tracking rows sent for this request. */
  sentGmailMessageIds: string[];
}

export interface InboxMessageForMatch {
  threadId: string | null;
  subject: string | null;
  fromAddress: string | null;
}

export type MatchMethod = 'thread_id' | 'subject' | 'from_address';

export interface MatchResult {
  listRequestId: number | null;
  method: MatchMethod | null;
  confidence: number;
}

const FOIA_SUBJECT_TOKEN = /\b(foia|public records?|records? request|open records)\b/i;

function normalizeAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  // Pull the bare address out of "Name <addr@host>" style From headers.
  const match = value.match(/<([^>]+)>/);
  const raw = match ? match[1] : value;
  return raw.trim().toLowerCase() || null;
}

function scoreCandidate(
  message: InboxMessageForMatch,
  candidate: MatchCandidateRequest
): { score: number; method: MatchMethod | null } {
  if (message.threadId && candidate.sentGmailMessageIds.includes(message.threadId)) {
    return { score: 100, method: 'thread_id' };
  }

  const subject = (message.subject ?? '').toLowerCase();
  let subjectScore = 0;
  const countyMatches = candidate.countyName.length > 0 && subject.includes(candidate.countyName.toLowerCase());
  const stateMatches =
    (candidate.stateName && subject.includes(candidate.stateName.toLowerCase())) ||
    (candidate.stateAbbr && subject.includes(candidate.stateAbbr.toLowerCase()));
  const foiaTokenMatches = FOIA_SUBJECT_TOKEN.test(subject);

  if (countyMatches) subjectScore += 40;
  if (foiaTokenMatches) subjectScore += 20;
  if (stateMatches) subjectScore += 15;

  const fromAddress = normalizeAddress(message.fromAddress);
  const officialEmail = normalizeAddress(candidate.officialEmail);
  const fromMatches = Boolean(fromAddress && officialEmail && fromAddress === officialEmail);

  const total = Math.min(100, subjectScore + (fromMatches ? 55 : 0));

  let method: MatchMethod | null = null;
  if (subjectScore > 0) method = 'subject';
  else if (fromMatches) method = 'from_address';

  return { score: total, method };
}

export function matchInboxMessage(
  message: InboxMessageForMatch,
  candidates: MatchCandidateRequest[]
): MatchResult {
  let best: { score: number; method: MatchMethod | null; listRequestId: number } | null = null;

  for (const candidate of candidates) {
    const { score, method } = scoreCandidate(message, candidate);
    if (!best || score > best.score) {
      best = { score, method, listRequestId: candidate.listRequestId };
    }
  }

  if (!best || best.score <= 0) {
    return { listRequestId: null, method: null, confidence: 0 };
  }

  return {
    listRequestId: best.score >= MATCH_THRESHOLD ? best.listRequestId : null,
    method: best.method,
    confidence: best.score,
  };
}
