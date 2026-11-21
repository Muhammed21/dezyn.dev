import { and, eq, isNull, sql } from "drizzle-orm";

import type { PostgresDatabase } from "#db";
import { schema } from "@repo/db";

import type { SpaceFinder } from "../application/read-space.ts";
import type { SpaceStore } from "../application/spaces.ts";
import { StoredSpaceWithRole, StoredSpaceWithStorage } from "./stored-rows.ts";

const { project, space, spaceMember } = schema;

export const postgresSpaceStore = (db: PostgresDatabase): SpaceStore & SpaceFinder => ({
  find: async (spaceId) => {
    const [row] = await db.orm
      .select({
        id: space.id,
        name: space.name,
        plan: space.plan,
        storedBytes: sql`coalesce(sum(${project.storedBytes}), 0)`,
      })
      .from(space)
      .leftJoin(project, eq(project.spaceId, space.id))
      .where(eq(space.id, spaceId))
      .groupBy(space.id);
    return StoredSpaceWithStorage.parse(row);
  },
  createPersonal: ({ space: personal, owner, at }) =>
    db.orm.transaction(async (tx) => {
      await tx.insert(space).values({ ...personal, createdAt: at });
      await tx.insert(spaceMember).values({ ...owner, spaceId: personal.id, joinedAt: at });
    }),
  listOpenMembershipsOf: async (userId) => {
    const rows = await db.orm
      .select({ id: space.id, name: space.name, plan: space.plan, role: spaceMember.role })
      .from(spaceMember)
      .innerJoin(space, eq(space.id, spaceMember.spaceId))
      .where(and(eq(spaceMember.userId, userId), isNull(spaceMember.closedAt)))
      .orderBy(spaceMember.joinedAt);
    return rows.map((row) => StoredSpaceWithRole.parse(row));
  },
});
