import { and, asc, eq, sql } from "drizzle-orm";

import type { PostgresTransaction } from "#db";
import { schema } from "@repo/db";

const { historyAuthor, space } = schema;

export const pseudonymizeAuthorOn =
  (tx: PostgresTransaction) =>
  async (userId: string): Promise<void> => {
    const authored = await tx
      .select({ spaceId: historyAuthor.spaceId })
      .from(historyAuthor)
      .where(eq(historyAuthor.userId, userId))
      .orderBy(asc(historyAuthor.spaceId));
    for (const { spaceId } of authored) {
      await tx.select({ id: space.id }).from(space).where(eq(space.id, spaceId)).for("update");
      await tx
        .update(historyAuthor)
        .set({
          userId: null,
          deletedMemberNumber: sql`(select coalesce(max(${historyAuthor.deletedMemberNumber}), 0) + 1 from ${historyAuthor} where ${historyAuthor.spaceId} = ${spaceId})`,
        })
        .where(and(eq(historyAuthor.spaceId, spaceId), eq(historyAuthor.userId, userId)));
    }
  };
