import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

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

const storedOf = ({
  fingerprint,
  response,
}: {
  readonly fingerprint: string;
  readonly response: string | null;
}): StoredIdempotencyKey =>
  response === null
    ? { state: "in_progress", fingerprint }
    : { state: COMPLETED, fingerprint, response };

export const postgresIdempotencyStore = (db: PostgresDatabase): IdempotencyStore => ({
  reserve: async ({ createdAt, ...claim }) => {
    const id = randomUUID();
    const [row] = await db.orm
      .insert(schema.idempotencyKey)
      .values({ id, ...claim, state: "in_progress", response: null, createdAt })
      .onConflictDoUpdate({
        target: [
          schema.idempotencyKey.userId,
          schema.idempotencyKey.scope,
          schema.idempotencyKey.key,
        ],
        set: { key: sql`excluded.key` },
      })
      .returning({
        id: schema.idempotencyKey.id,
        fingerprint: schema.idempotencyKey.fingerprint,
        response: schema.idempotencyKey.response,
      });
    if (row === undefined || row.id === id) {
      return { reserved: true };
    }
    return { reserved: false, stored: storedOf(row) };
  },
  complete: async (claim, response) => {
    await db.orm
      .update(schema.idempotencyKey)
      .set({ state: COMPLETED, response })
      .where(ofClaim(claim));
  },
  release: async (claim) => {
    await db.orm.delete(schema.idempotencyKey).where(ofClaim(claim));
  },
});
