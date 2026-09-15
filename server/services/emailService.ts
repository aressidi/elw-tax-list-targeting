import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { listRequests, foiaTemplates, emailTracking } from '../../shared/schema.js';
import { renderTemplateText, DEFAULT_SAMPLE_DATA, type TemplateSampleData } from '../../shared/templateVariables.js';

// ============================================================
// Transport boundary
//
// Dry-run is the default and only transport unless EMAIL_TRANSPORT=gog is
// set in the environment. That env var is the human sign-off gate for live
// sending — nothing in this module (or its callers) should shell out to gog
// through any other path.
// ============================================================

export type EmailTransportName = 'dry_run' | 'gog';

export function getActiveTransport(): EmailTransportName {
  return process.env.EMAIL_TRANSPORT === 'gog' ? 'gog' : 'dry_run';
}

interface TransportSendInput {
  to: string;
  subject: string;
  body: string;
}

interface TransportSendResult {
  success: boolean;
  transport: EmailTransportName;
  messageId: string | null;
  error: string | null;
}

// Looks-like-HTML guard: if the body already starts with a tag, or contains
// a block-level tag we'd otherwise mangle, pass it through untouched.
function looksLikeHtml(body: string): boolean {
  return /^\s*</.test(body) || /<p[\s>]|<div[\s>]|<br\s*\/?>/i.test(body);
}

// Converts a plain-text body to minimal HTML for --body-html: escapes
// &, <, > and turns newlines into <br />. Bullet characters (•, -, etc.)
// are left as-is since no list markup is required.
function plainTextToHtml(body: string): string {
  const escaped = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/\n/g, '<br />');
}

// Live path: shells out to the `gog` CLI, already authenticated for
// alex@eastonlandworks.com. Flags verified against live gog v0.39.1 on
// 2026-09-15 via `gog gmail send --help`: --to, --subject, --body,
// --body-html, -a/--account, --signature all confirmed. Also verified that
// in --body-html mode --signature appends the full HTML signature
// (including picture), while in --body mode it appends the plaintext one.
function sendViaGog(input: TransportSendInput): Promise<TransportSendResult> {
  return new Promise((resolve) => {
    const bin = process.env.EMAIL_GOG_BIN || 'gog';
    const useHtml = /^(1|true)$/i.test(process.env.EMAIL_SEND_HTML || '');
    const useSignature = /^(1|true)$/i.test(process.env.EMAIL_GOG_SIGNATURE || '');
    const account = process.env.EMAIL_GOG_ACCOUNT;

    const body = useHtml && !looksLikeHtml(input.body) ? plainTextToHtml(input.body) : input.body;

    const args = [
      'gmail',
      'send',
      '--to',
      input.to,
      '--subject',
      input.subject,
      useHtml ? '--body-html' : '--body',
      body,
    ];

    if (account) {
      args.push('-a', account);
    }
    if (useSignature) {
      args.push('--signature');
    }

    execFile(
      bin,
      args,
      { timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            transport: 'gog',
            messageId: null,
            error: stderr?.trim() || error.message,
          });
          return;
        }
        resolve({ success: true, transport: 'gog', messageId: stdout.trim() || null, error: null });
      }
    );
  });
}

async function sendViaDryRun(_input: TransportSendInput): Promise<TransportSendResult> {
  return { success: true, transport: 'dry_run', messageId: `dry-${randomUUID()}`, error: null };
}

// The only entry point into either transport. Callers must go through this
// function rather than calling sendViaGog directly.
export async function sendViaTransport(input: TransportSendInput): Promise<TransportSendResult> {
  return getActiveTransport() === 'gog' ? sendViaGog(input) : sendViaDryRun(input);
}

// ============================================================
// Rendering — resolves the request's county/official/template into a
// concrete subject+body. Read-only; safe to call for preview purposes.
// ============================================================

export interface EmailRecipientCandidate {
  id: number;
  fullName: string;
  title: string | null;
  emailAddress: string;
  isPrimary: boolean | null;
}

export type PrepareEmailResult =
  | {
      ok: true;
      listRequestId: number;
      recipientContactId: number;
      recipientName: string;
      recipientTitle: string | null;
      recipientEmail: string;
      templateId: number;
      subject: string;
      body: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      // Set when the request's own referenced contact has no email on file,
      // so the caller can offer an explicit choice among the county's other
      // email-bearing contacts instead of silently guessing a recipient.
      needsRecipientSelection?: boolean;
      referencedContact?: { id: number; fullName: string };
      candidates?: EmailRecipientCandidate[];
    };

export async function prepareListRequestEmail(listRequestId: number): Promise<PrepareEmailResult> {
  const request = await db.query.listRequests.findFirst({
    where: eq(listRequests.id, listRequestId),
    with: {
      taxOfficial: {
        with: {
          county: {
            with: {
              state: true,
              taxOfficials: true,
            },
          },
        },
      },
      foiaTemplate: true,
    },
  });

  if (!request || !request.taxOfficial || !request.taxOfficial.county || !request.taxOfficial.county.state) {
    return { ok: false, status: 404, error: 'List request not found' };
  }

  const county = request.taxOfficial.county;
  const contacts = county.taxOfficials ?? [];
  // Emails always go to the contact this specific request references (not
  // just "whoever is county primary today") so preview/send target the same
  // person the request was actually made to.
  const referencedContact = request.taxOfficial;

  if (!referencedContact.emailAddress) {
    const candidates: EmailRecipientCandidate[] = contacts
      .filter((c) => c.id !== referencedContact.id && !!c.emailAddress)
      .map((c) => ({
        id: c.id,
        fullName: c.fullName,
        title: c.title,
        emailAddress: c.emailAddress as string,
        isPrimary: c.isPrimary,
      }));

    return {
      ok: false,
      status: 409,
      error: `${referencedContact.fullName}${
        referencedContact.title ? ` (${referencedContact.title})` : ''
      } has no email address on file for this request.`,
      needsRecipientSelection: true,
      referencedContact: { id: referencedContact.id, fullName: referencedContact.fullName },
      candidates,
    };
  }

  const recipient = referencedContact;

  const template =
    request.foiaTemplate ??
    (await db.query.foiaTemplates.findFirst({ where: eq(foiaTemplates.isDefault, true) }));

  if (!template) {
    return {
      ok: false,
      status: 400,
      error: 'No FOIA template is assigned to this request and no default template exists.',
    };
  }

  const sampleData: TemplateSampleData = {
    countyName: county.name,
    stateName: county.state.name,
    stateAbbr: county.state.abbreviation,
    officialName: recipient.fullName,
    officialTitle: recipient.title || DEFAULT_SAMPLE_DATA.officialTitle,
  };

  return {
    ok: true,
    listRequestId,
    recipientContactId: recipient.id,
    recipientName: recipient.fullName,
    recipientTitle: recipient.title,
    recipientEmail: recipient.emailAddress,
    templateId: template.id,
    subject: renderTemplateText(template.subjectLine, sampleData).slice(0, 500),
    body: renderTemplateText(template.bodyText, sampleData),
  };
}

// ============================================================
// Send orchestration — the only path that writes email_tracking rows or
// flips a request to email_sent. Every attempt (success or failure) is
// recorded; failures never touch list_requests.requestStatus/emailSentAt.
//
// email_tracking has no dedicated transport/status column (schema is fixed
// for this card), so the transport used and any failure reason are encoded
// as a `[transport:x]`/`[FAILED: ...]` prefix on bodyPreview, which is the
// only place callers need to look to see what actually happened.
// ============================================================

export interface SendListRequestEmailResult {
  listRequestId: number;
  outcome: 'sent' | 'skipped' | 'failed';
  transport?: EmailTransportName;
  messageId?: string | null;
  recipientContactId?: number;
  recipientName?: string;
  recipientEmail?: string;
  subject?: string;
  body?: string;
  error?: string;
  statusCode: number;
}

export async function sendListRequestEmail(
  listRequestId: number,
  options: { force?: boolean } = {}
): Promise<SendListRequestEmailResult> {
  const existing = await db.query.listRequests.findFirst({ where: eq(listRequests.id, listRequestId) });
  if (!existing) {
    return { listRequestId, outcome: 'failed', error: 'List request not found', statusCode: 404 };
  }

  if (existing.emailSentAt && !options.force) {
    return {
      listRequestId,
      outcome: 'skipped',
      error: 'Email already sent for this request. Pass force=true to resend.',
      statusCode: 409,
    };
  }

  const prepared = await prepareListRequestEmail(listRequestId);
  if (!prepared.ok) {
    return { listRequestId, outcome: 'failed', error: prepared.error, statusCode: prepared.status };
  }

  const transportResult = await sendViaTransport({
    to: prepared.recipientEmail,
    subject: prepared.subject,
    body: prepared.body,
  });

  const bodyPreview = `[transport:${transportResult.transport}]${
    transportResult.success ? '' : ` [FAILED: ${transportResult.error}]`
  }\n\n${prepared.body}`;

  await db.insert(emailTracking).values({
    listRequestId,
    emailType: 'sent',
    gmailMessageId: transportResult.messageId,
    sentAt: transportResult.success ? new Date() : null,
    subject: prepared.subject,
    bodyPreview,
    processed: false,
  });

  if (!transportResult.success) {
    return {
      listRequestId,
      outcome: 'failed',
      transport: transportResult.transport,
      error: transportResult.error ?? 'Send failed',
      statusCode: 502,
    };
  }

  await db
    .update(listRequests)
    .set({ emailSentAt: new Date(), requestStatus: 'email_sent', updatedAt: new Date() })
    .where(eq(listRequests.id, listRequestId));

  return {
    listRequestId,
    outcome: 'sent',
    transport: transportResult.transport,
    messageId: transportResult.messageId,
    recipientContactId: prepared.recipientContactId,
    recipientName: prepared.recipientName,
    recipientEmail: prepared.recipientEmail,
    subject: prepared.subject,
    body: prepared.body,
    statusCode: 200,
  };
}

const BULK_SEND_DELAY_MS = Number(process.env.EMAIL_BULK_SEND_DELAY_MS) || 300;

// Sequential by design: a failure on one request must never abort the rest,
// and a small delay between attempts avoids hammering the transport (real
// Gmail sends included) in a tight loop.
export async function sendListRequestEmailsBulk(
  listRequestIds: number[],
  options: { force?: boolean } = {}
): Promise<SendListRequestEmailResult[]> {
  const results: SendListRequestEmailResult[] = [];
  for (let i = 0; i < listRequestIds.length; i++) {
    try {
      results.push(await sendListRequestEmail(listRequestIds[i], options));
    } catch (error) {
      results.push({
        listRequestId: listRequestIds[i],
        outcome: 'failed',
        error: error instanceof Error ? error.message : 'Unexpected error while sending',
        statusCode: 500,
      });
    }
    if (i < listRequestIds.length - 1 && BULK_SEND_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, BULK_SEND_DELAY_MS));
    }
  }
  return results;
}
