import { and, eq, gt, gte, isNotNull, isNull, notExists, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { PostgresDatabase } from "#db";
import type { Clock } from "#platform/clock.ts";
import type { ActiveGrants } from "@repo/auth-verifier";
import { schema } from "@repo/db";

import { earliestAllowedAuthTime } from "../domain/refresh-chain.ts";

const { identityOAuthRefreshToken: refreshToken, identityOAuthConsent: consent } = schema;

const cutToken = alias(refreshToken, "cut_token");

export const postgresActiveGrants = (db: PostgresDatabase, clock: Clock): ActiveGrants => ({
  isActive: async ({ sid, userId, clientId }) => {
    const now = clock();
    const cutTokens = db.orm
      .select({ id: cutToken.id })
      .from(cutToken)
      .where(
        and(
          eq(cutToken.sessionId, sid),
          eq(cutToken.userId, userId),
          eq(cutToken.clientId, clientId),
          isNotNull(cutToken.cutAt),
        ),
      );
    const rows = await db.orm
      .select({ id: refreshToken.id })
      .from(refreshToken)
      .innerJoin(
        consent,
        and(eq(consent.userId, refreshToken.userId), eq(consent.clientId, refreshToken.clientId)),
      )
      .where(
        and(
          eq(refreshToken.sessionId, sid),
          eq(refreshToken.userId, userId),
          eq(refreshToken.clientId, clientId),
          gt(refreshToken.expiresAt, now),
          gte(refreshToken.authTime, earliestAllowedAuthTime(now)),
          or(isNull(refreshToken.revoked), gte(refreshToken.rotationReplayExpiresAt, now)),
          notExists(cutTokens),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },
});
