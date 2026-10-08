import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  listRequestPrices,
  listRequestEvents,
  listRequestStatusHistory,
  processedLists,
  inboxItems,
} from '../../shared/schema.js';
import type { PgTable } from 'drizzle-orm/pg-core';

// Card 96127e3a: deleting a list request relies entirely on the schema's
// foreign-key onDelete rules to clean up after it — children cascade away and
// inbox_items is detached rather than destroyed. The DELETE route does a bare
// `delete(listRequests)` and trusts these rules, so if any of them regressed
// (e.g. a child FK silently lost its cascade) a delete would either orphan rows
// or fail on a constraint. These tests pin the on-delete behavior the route
// depends on, without needing a live database.

/** The onDelete action configured for the list_request_id FK on a child table. */
function listRequestFkOnDelete(table: PgTable): string | undefined {
  const config = getTableConfig(table);
  for (const fk of config.foreignKeys) {
    const cols = fk.reference().columns.map((c) => c.name);
    if (cols.includes('list_request_id')) {
      return fk.onDelete;
    }
  }
  return undefined;
}

test('list_request child tables cascade on delete', () => {
  assert.equal(listRequestFkOnDelete(listRequestPrices), 'cascade');
  assert.equal(listRequestFkOnDelete(listRequestEvents), 'cascade');
  assert.equal(listRequestFkOnDelete(listRequestStatusHistory), 'cascade');
  assert.equal(listRequestFkOnDelete(processedLists), 'cascade');
});

test('inbox_items is detached (set null), not deleted, when a list request is removed', () => {
  assert.equal(listRequestFkOnDelete(inboxItems), 'set null');
});
