import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isListRequestDeletable,
  type DeletableListRequestFields,
} from '../../shared/listRequestDeletable.js';

// Card 96127e3a (UI follow-up): isListRequestDeletable is the client-side gate
// shared by the ListRequests and CountyDetail pages. It must stay a strict
// subset of the server guard (server/services/listRequestDeletion.ts) — it may
// only ever show Delete for a request the server would actually delete. These
// tests pin that it refuses every "started" signal the row can carry and that
// an absent (undefined) field is treated as "not set".

/** A freshly-created, never-started request: the one deletable shape. */
function freshRequest(): DeletableListRequestFields {
  return {
    requestStatus: 'not_started',
    emailSentAt: null,
    queuedAt: null,
    scheduledSendAt: null,
  };
}

test('a fresh, never-started request is deletable', () => {
  assert.equal(isListRequestDeletable(freshRequest()), true);
});

test('a request whose status has moved past not_started is not deletable', () => {
  assert.equal(isListRequestDeletable({ ...freshRequest(), requestStatus: 'email_sent' }), false);
});

test('a request with an email already sent is not deletable', () => {
  assert.equal(isListRequestDeletable({ ...freshRequest(), emailSentAt: new Date() }), false);
});

test('a queued request is not deletable', () => {
  assert.equal(isListRequestDeletable({ ...freshRequest(), queuedAt: new Date() }), false);
});

test('a scheduled-send request is not deletable', () => {
  assert.equal(isListRequestDeletable({ ...freshRequest(), scheduledSendAt: new Date() }), false);
});

test('timestamps block deletion whether Date or ISO string', () => {
  assert.equal(
    isListRequestDeletable({ ...freshRequest(), emailSentAt: '2026-10-08T00:00:00.000Z' }),
    false
  );
});

test('fields absent from the row (undefined) count as "not set"', () => {
  // CountyDetail historically typed rows without queued/scheduled fields; an
  // omitted field must not falsely block an otherwise-fresh request.
  assert.equal(isListRequestDeletable({ requestStatus: 'not_started' }), true);
});

test('a null status is not deletable', () => {
  assert.equal(isListRequestDeletable({ ...freshRequest(), requestStatus: null }), false);
});
