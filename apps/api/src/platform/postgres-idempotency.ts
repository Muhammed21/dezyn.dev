import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { schema } from "@repo/db";

import type { IdempotencyClaim, IdempotencyStore, StoredIdempotencyKey } from "./idempotency.ts";
import type { PostgresDatabase } from "./postgres-database.ts";

const COMPLETED = "completed";

const ABANDONED_RESERVATION_SECONDS = 5 * 60;

const { idempotencyKey } = schema;

const abandoned = sql`${idempotencyKey.response} is null and ${idempotencyKey.createdAt} < now() - make_interval(secs => ${ABANDONED_RESERVATION_SECONDS})`;

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
  reserve: async (claim) => {
    const id = randomUUID();
    const [row] = await db.orm
      .insert(schema.idempotencyKey)
      .values({ id, ...claim, state: "in_progress", response: null, createdAt: sql`now()` })
      .onConflictDoUpdate({
        target: [
          schema.idempotencyKey.userId,
          schema.idempotencyKey.scope,
          schema.idempotencyKey.key,
        ],
        set: {
          id: sql`case when ${abandoned} then excluded.id else ${idempotencyKey.id} end`,
          fingerprint: sql`case when ${abandoned} then excluded.fingerprint else ${idempotencyKey.fingerprint} end`,
          createdAt: sql`case when ${abandoned} then excluded.created_at else ${idempotencyKey.createdAt} end`,
        },
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
