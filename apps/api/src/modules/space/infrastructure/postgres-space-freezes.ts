import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { PostgresDatabase } from "#db";
import { schema } from "@repo/db";

import type { SpaceFreezes } from "../application/frozen-space-guard.ts";
import { PLANS } from "../domain/space.ts";

const { project, space, spaceMember, spaceSubscription } = schema;

const StoredFreezeFacts = z
  .object({
    plan: z.enum(PLANS),
    subscriptionStatus: z.string().nullable(),
    projects: z.coerce.number(),
    storedBytes: z.coerce.number(),
    members: z.coerce.number(),
  })
  .transform(({ plan, subscriptionStatus, ...usage }) => ({
    plan,
    subscriptionEnded: subscriptionStatus === "ended",
    usage,
  }));

export const postgresSpaceFreezes = (db: PostgresDatabase): SpaceFreezes => ({
  freezeFactsOf: async (spaceId) => {
    const [row] = await db.orm
      .select({
        plan: space.plan,
        subscriptionStatus: spaceSubscription.status,
        projects: sql`(select count(*) from ${project} where ${project.spaceId} = ${space.id})`,
        storedBytes: sql`(select coalesce(sum(${project.storedBytes}), 0) from ${project} where ${project.spaceId} = ${space.id})`,
        members: sql`(select count(*) from ${spaceMember} where ${spaceMember.spaceId} = ${space.id} and ${spaceMember.closedAt} is null)`,
      })
      .from(space)
      .leftJoin(spaceSubscription, eq(spaceSubscription.spaceId, space.id))
      .where(eq(space.id, spaceId));
    return StoredFreezeFacts.parse(row);
  },
});
