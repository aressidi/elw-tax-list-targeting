import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateListRequestDeletable,
  ALREADY_STARTED_MESSAGE,
  type ListRequestDeletabilityInput,
} from './listRequestDeletion.js';

// Card 96127e3a: deleting a list request is only ever safe before it has been
// started — before any email is sent/queued/scheduled and before any audit
// trail (events / status history) exists. These tests pin every refusal branch
// of the server-side guard so the DELETE route can never widen it by accident.

/** A freshly-created, never-touched request: the one deletable shape. */
function freshRequest(): ListRequestDeletabilityInput {
  return {
    requestStatus: 'not_started',
    emailSentAt: null,
    queuedAt: null,
    scheduledSendAt: null,
    latestEventAt: null,
    eventCount: 0,
    statusHistoryCount: 0,
  };
}

test('a fresh, never-started request is deletable', () => {
  const result = evaluateListRequestDeletable(freshRequest());
  assert.equal(result.deletable, true);
  assert.equal(result.reason, undefined);
});

test('a request whose status has moved past not_started is refused', () => {
  const result = evaluateListRequestDeletable({ ...freshRequest(), requestStatus: 'email_sent' });
  assert.equal(result.deletable, false);
  assert.equal(result.reason, ALREADY_STARTED_MESSAGE);
});

test('a request with an email already sent is refused', () => {
  const result = evaluateListRequestDeletable({ ...freshRequest(), emailSentAt: new Date() });
  assert.equal(result.deletable, false);
  assert.equal(result.reason, ALREADY_STARTED_MESSAGE);
});

test('a queued request is refused', () => {
  const result = evaluateListRequestDeletable({ ...freshRequest(), queuedAt: new Date() });
  assert.equal(result.deletable, false);
  assert.equal(result.reason, ALREADY_STARTED_MESSAGE);
});

test('a scheduled-send request is refused', () => {
  const result = evaluateListRequestDeletable({ ...freshRequest(), scheduledSendAt: new Date() });
  assert.equal(result.deletable, false);
  assert.equal(result.reason, ALREADY_STARTED_MESSAGE);
});

test('a request with a recorded latest event timestamp is refused', () => {
  const result = evaluateListRequestDeletable({ ...freshRequest(), latestEventAt: new Date() });
  assert.equal(result.deletable, false);
  assert.equal(result.reason, ALREADY_STARTED_MESSAGE);
});

test('a request with event rows is refused', () => {
  const result = evaluateListRequestDeletable({ ...freshRequest(), eventCount: 1 });
  assert.equal(result.deletable, false);
  assert.equal(result.reason, ALREADY_STARTED_MESSAGE);
});

test('a request with status-history rows is refused', () => {
  const result = evaluateListRequestDeletable({ ...freshRequest(), statusHistoryCount: 1 });
  assert.equal(result.deletable, false);
  assert.equal(result.reason, ALREADY_STARTED_MESSAGE);
});

test('timestamp fields are honored whether Date or ISO string', () => {
  const result = evaluateListRequestDeletable({
    ...freshRequest(),
    emailSentAt: '2026-10-08T00:00:00.000Z',
  });
  assert.equal(result.deletable, false);
  assert.equal(result.reason, ALREADY_STARTED_MESSAGE);
});
