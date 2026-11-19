import { eq } from "drizzle-orm";

import type { PostgresDatabase } from "#db";
import { schema } from "@repo/db";

import type { InvitedSpaces } from "../application/accept-invitation.ts";

const { spaceInvitation } = schema;

export const postgresInvitedSpaces = (db: PostgresDatabase): InvitedSpaces => ({
  spaceOf: async (tokenHash) => {
    const [invitation] = await db.orm
      .select({ spaceId: spaceInvitation.spaceId })
      .from(spaceInvitation)
      .where(eq(spaceInvitation.tokenHash, tokenHash));
    return invitation?.spaceId;
  },
});
