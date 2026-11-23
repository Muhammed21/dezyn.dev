import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { PostgresTransaction } from "#db";
import { schema } from "@repo/db";

import { blocksAccountDeletion } from "../domain/departure.ts";
import { ROLES } from "../domain/space.ts";

const { space, spaceMember } = schema;

const StoredOwnership = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(ROLES),
  openOwners: z.coerce.number(),
  openMembers: z.coerce.number(),
});

export const lastOwnerSpacesOn =
  (tx: PostgresTransaction) =>
  async (userId: string): Promise<readonly { readonly id: string; readonly name: string }[]> => {
    const memberships = await tx
      .select({ spaceId: spaceMember.spaceId })
      .from(spaceMember)
      .where(and(eq(spaceMember.userId, userId), isNull(spaceMember.closedAt)))
      .orderBy(asc(spaceMember.spaceId));
    const spaceIds = memberships.map(({ spaceId }) => spaceId);
    await tx
      .select({ id: space.id })
      .from(space)
      .where(inArray(space.id, spaceIds))
      .orderBy(asc(space.id))
      .for("update");
    const rows = await tx
      .select({
        id: space.id,
        name: space.name,
        role: spaceMember.role,
        openOwners: sql`(select count(*) from ${spaceMember} as owner where owner.space_id = ${space.id} and owner.role = 'owner' and owner.closed_at is null)`,
        openMembers: sql`(select count(*) from ${spaceMember} as member where member.space_id = ${space.id} and member.closed_at is null)`,
      })
      .from(spaceMember)
      .innerJoin(space, eq(space.id, spaceMember.spaceId))
      .where(and(eq(spaceMember.userId, userId), isNull(spaceMember.closedAt)))
      .orderBy(asc(space.name), asc(space.id));
    return rows
      .map((row) => StoredOwnership.parse(row))
      .filter(blocksAccountDeletion)
      .map(({ id, name }) => ({ id, name }));
  };
