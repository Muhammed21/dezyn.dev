import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { schema } from "@repo/db";

import type { IdempotencyClaim, IdempotencyStore, StoredIdempotencyKey } from "./idempotency.ts";
import type { PostgresDatabase } from "./postgres-database.ts";

const COMPLETED = "completed";

const ofClaim = ({ userId, scope, key }: IdempotencyClaim) =>
  and(
    eq(schema.idempotencyKey.userId, userId),
    eq(schema.idempotencyKey.scope, scope),
    eq(schema.idempotencyKey.key, key),
  );

const storedOf = (row: {
  readonly state: string;
  readonly fingerprint: string;
  readonly response: string | null;
}): StoredIdempotencyKey =>
  row.state === COMPLETED && row.response !== null
    ? { state: COMPLETED, fingerprint: row.fingerprint, response: row.response }
    : { state: "in_progress", fingerprint: row.fingerprint };

export const postgresIdempotencyStore = (db: PostgresDatabase): IdempotencyStore => ({
  reserve: async ({ createdAt, ...claim }) => {
    const reserved = await db.orm
      .insert(schema.idempotencyKey)
      .values({ id: randomUUID(), ...claim, state: "in_progress", response: null, createdAt })
      .onConflictDoNothing()
      .returning({ id: schema.idempotencyKey.id });
    if (reserved.length > 0) {
      return { kind: "reserved" };
    }
    const [row] = await db.orm
      .select({
        state: schema.idempotencyKey.state,
        fingerprint: schema.idempotencyKey.fingerprint,
        response: schema.idempotencyKey.response,
      })
      .from(schema.idempotencyKey)
      .where(ofClaim(claim));
    return { kind: "taken", stored: row === undefined ? undefined : storedOf(row) };
  },
  complete: async (claim, response) => {
    await db.orm
      .update(schema.idempotencyKey)
      .set({ state: COMPLETED, response })
      .where(ofClaim(claim));
  },
});
