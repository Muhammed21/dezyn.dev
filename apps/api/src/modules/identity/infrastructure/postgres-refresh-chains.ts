import { and, eq, isNotNull, isNull, type SQL } from "drizzle-orm";

import type { PostgresDatabase } from "#db";
import type { Clock } from "#platform/clock.ts";
import { schema } from "@repo/db";

const { identityOAuthRefreshToken: refreshToken } = schema;

export type RefreshChain = {
  readonly userId: string;
  readonly clientId: string;
  readonly sessionId: string;
};

export interface RefreshChains {
  cutChainsOfSession(sessionId: string): Promise<void>;
  cutChainsOfUser(userId: string): Promise<void>;
  isCut(chain: RefreshChain): Promise<boolean>;
}

const chainOf = ({ userId, clientId, sessionId }: RefreshChain): SQL | undefined =>
  and(
    eq(refreshToken.userId, userId),
    eq(refreshToken.clientId, clientId),
    eq(refreshToken.sessionId, sessionId),
  );

export const postgresRefreshChains = (db: PostgresDatabase, clock: Clock): RefreshChains => {
  const cut = async (chains: SQL) => {
    await db.orm
      .update(refreshToken)
      .set({ cutAt: clock() })
      .where(and(chains, isNull(refreshToken.cutAt)));
  };
  return {
    cutChainsOfSession: (sessionId) => cut(eq(refreshToken.sessionId, sessionId)),
    cutChainsOfUser: (userId) => cut(eq(refreshToken.userId, userId)),
    isCut: async (chain) => {
      const rows = await db.orm
        .select({ id: refreshToken.id })
        .from(refreshToken)
        .where(and(chainOf(chain), isNotNull(refreshToken.cutAt)))
        .limit(1);
      return rows.length > 0;
    },
  };
};
