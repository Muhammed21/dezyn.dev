import { and, eq, isNull } from "drizzle-orm";

import type { PostgresDatabase, PostgresTransaction } from "#db";
import { schema } from "@repo/db";

import type { MemberManagement } from "../application/manage-members.ts";
import type { DepartureListener } from "../application/member-departure.ts";
import { StoredMembership } from "./stored-rows.ts";

const { space, spaceMember } = schema;

export const postgresMemberManagement = (
  db: PostgresDatabase,
  departureOn: (tx: PostgresTransaction) => DepartureListener,
): MemberManagement => ({
  run: (spaceId, work) =>
    db.orm.transaction(async (tx) => {
      await tx.select({ id: space.id }).from(space).where(eq(space.id, spaceId)).for("update");
      const rows = await tx
        .select({
          spaceId: spaceMember.spaceId,
          userId: spaceMember.userId,
          role: spaceMember.role,
        })
        .from(spaceMember)
        .where(and(eq(spaceMember.spaceId, spaceId), isNull(spaceMember.closedAt)));
      const members = rows.map((row) => StoredMembership.parse(row));
      const wasOwner = (userId: string) =>
        members.some((member) => member.userId === userId && member.role === "owner");
      return work({
        members,
        close: async ({ userId, reason, closedAt }) => {
          await tx
            .update(spaceMember)
            .set({ closedAt, closedReason: reason })
            .where(
              and(
                eq(spaceMember.spaceId, spaceId),
                eq(spaceMember.userId, userId),
                isNull(spaceMember.closedAt),
              ),
            );
          if (reason === "removed" || wasOwner(userId)) {
            await departureOn(tx)({ spaceId, userId, at: closedAt });
          }
        },
        open: async ({ id, userId, role, joinedAt }) => {
          await tx.insert(spaceMember).values({ id, spaceId, userId, role, joinedAt });
        },
      });
    }),
});
