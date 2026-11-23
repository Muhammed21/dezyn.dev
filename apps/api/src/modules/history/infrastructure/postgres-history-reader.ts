import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";

import type { PostgresDatabase } from "#db";
import { schema } from "@repo/db";

import type { HistoryReader } from "../application/read-history.ts";

const { historyAuthor, historyEntry, identityUser, project, spaceMember } = schema;

const DeletedMemberNumber = z.number();

const PurgeTrace = z.object({ purgedBefore: z.date().nullable() });

const StoredEntry = z.object({
  id: z.string(),
  action: z.string(),
  spaceId: z.string(),
  projectId: z.string(),
  userId: z.string().nullable(),
  name: z.string().nullable(),
  deletedMemberNumber: z.number().nullable(),
  openMembershipId: z.string().nullable(),
  clientId: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  occurredAt: z.date(),
  correlationId: z.string(),
});

export const postgresHistoryReader = (db: PostgresDatabase): HistoryReader => ({
  purgedBeforeOf: async (projectId) => {
    const [row] = await db.orm
      .select({ purgedBefore: project.historyPurgedBefore })
      .from(project)
      .where(eq(project.id, projectId));
    return PurgeTrace.parse(row).purgedBefore;
  },
  entriesOf: async (projectId, { after, take }) => {
    const rows = await db.orm
      .select({
        id: historyEntry.id,
        action: historyEntry.action,
        spaceId: historyEntry.spaceId,
        projectId: historyEntry.projectId,
        userId: historyAuthor.userId,
        name: identityUser.name,
        deletedMemberNumber: historyAuthor.deletedMemberNumber,
        openMembershipId: spaceMember.id,
        clientId: historyEntry.clientId,
        before: historyEntry.before,
        after: historyEntry.after,
        occurredAt: historyEntry.occurredAt,
        correlationId: historyEntry.correlationId,
      })
      .from(historyEntry)
      .innerJoin(historyAuthor, eq(historyAuthor.id, historyEntry.authorId))
      .leftJoin(identityUser, eq(identityUser.id, historyAuthor.userId))
      .leftJoin(
        spaceMember,
        and(
          eq(spaceMember.spaceId, historyEntry.spaceId),
          eq(spaceMember.userId, historyAuthor.userId),
          isNull(spaceMember.closedAt),
        ),
      )
      .where(
        and(
          eq(historyEntry.projectId, projectId),
          after === undefined
            ? undefined
            : or(
                lt(historyEntry.occurredAt, after.occurredAt),
                and(eq(historyEntry.occurredAt, after.occurredAt), lt(historyEntry.id, after.id)),
              ),
        ),
      )
      .orderBy(desc(historyEntry.occurredAt), desc(historyEntry.id))
      .limit(take);
    return rows.map((row) => {
      const { userId, name, deletedMemberNumber, openMembershipId, ...entry } =
        StoredEntry.parse(row);
      return {
        ...entry,
        author:
          userId === null || name === null
            ? { kind: "deleted_member", number: DeletedMemberNumber.parse(deletedMemberNumber) }
            : {
                kind: "member",
                userId,
                name,
                membership: openMembershipId === null ? "left" : "active",
              },
      };
    });
  },
});
