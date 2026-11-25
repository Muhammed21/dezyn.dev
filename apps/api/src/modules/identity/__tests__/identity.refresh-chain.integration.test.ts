import { createHash } from "node:crypto";

import { type AnyColumn, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { PostgresDatabase } from "#db";
import {
  type App,
  authorizeAnotherAi,
  callMcp,
  decodeJwtPart,
  obtainAccessToken,
  refreshTokens,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { schema } from "@repo/db";

const { identitySession: session, identityOAuthRefreshToken: refreshToken } = schema;

type Agent = Awaited<ReturnType<typeof obtainAccessToken>>;

const Tokens = z.object({ access_token: z.string(), refresh_token: z.string() });

const hashOf = (token: string) => createHash("sha256").update(token).digest("base64url");

const daysEarlier = (column: AnyColumn, days: number) =>
  sql`${column} - make_interval(days => ${days})`;

const travelDays = async (
  db: PostgresDatabase,
  { userId, days }: { userId: string; days: number },
) => {
  await db.orm
    .update(session)
    .set({
      expiresAt: daysEarlier(session.expiresAt, days),
      createdAt: daysEarlier(session.createdAt, days),
      updatedAt: daysEarlier(session.updatedAt, days),
    })
    .where(eq(session.userId, userId));
  await db.orm
    .update(refreshToken)
    .set({
      authTime: daysEarlier(refreshToken.authTime, days),
      createdAt: daysEarlier(refreshToken.createdAt, days),
      expiresAt: daysEarlier(refreshToken.expiresAt, days),
    })
    .where(eq(refreshToken.userId, userId));
};

const refreshed = async (app: App, agent: Agent): Promise<Agent> => {
  const response = await refreshTokens(app, agent);
  expect(response.status).toBe(200);
  const tokens = Tokens.parse(await response.json());
  return { ...agent, accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
};

const aWeekLater = async (app: App, db: PostgresDatabase, agent: Agent) => {
  await travelDays(db, { userId: agent.userId, days: 7 });
  return refreshed(app, agent);
};

const listTools = (app: App, { accessToken }: { readonly accessToken: string }) =>
  callMcp(app, { token: accessToken, method: "tools/list" });

const webSessionOf = async ({ browser }: Agent) => (await browser.get("/auth/get-session")).json();

const linkedSessionOf = ({ accessToken }: Agent) =>
  z.object({ sid: z.string() }).parse(decodeJwtPart(accessToken, 1)).sid;

const sessionRowsWithId = (db: PostgresDatabase, id: string) =>
  db.orm.select({ id: session.id }).from(session).where(eq(session.id, id));

const sessionExpiryOf = async (db: PostgresDatabase, userId: string) =>
  (
    await db.orm
      .select({ expiresAt: session.expiresAt })
      .from(session)
      .where(eq(session.userId, userId))
  ).map(({ expiresAt }) => expiresAt.toISOString());

const chainCutsOf = (db: PostgresDatabase, agent: Agent) =>
  db.orm
    .select({ cutAt: refreshToken.cutAt })
    .from(refreshToken)
    .where(eq(refreshToken.sessionId, linkedSessionOf(agent)));

const RECORDED_CUT = { cutAt: expect.any(Date) };

describe("l'accès MCP vit avec la chaîne de refresh tokens (ADR 0060 §2 et §3)", () => {
  it("un agent qui rafraîchit chaque semaine garde l'accès au-delà de 7 jours, alors que la session web a expiré", () =>
    withIdentityApp(async (app, db) => {
      const authorized = await obtainAccessToken(app);

      const agent = await aWeekLater(
        app,
        db,
        await aWeekLater(app, db, await aWeekLater(app, db, authorized)),
      );
      const webSession = await webSessionOf(agent);
      const mcp = await listTools(app, agent);
      const nextRefresh = await refreshTokens(app, agent);

      expect(webSession).toBeNull();
      expect(mcp.status).toBe(200);
      expect(nextRefresh.status).toBe(200);
    }));

  it("un rafraîchissement ne prolonge pas la session web", () =>
    withIdentityApp(async (app, db) => {
      const agent = await obtainAccessToken(app);
      await travelDays(db, { userId: agent.userId, days: 3 });
      const before = await sessionExpiryOf(db, agent.userId);

      await refreshed(app, agent);

      expect(await sessionExpiryOf(db, agent.userId)).toEqual(before);
    }));

  it("la suppression par better-auth d'une session déjà expirée ne coupe pas l'accès", () =>
    withIdentityApp(async (app, db) => {
      const agent = await obtainAccessToken(app);
      await travelDays(db, { userId: agent.userId, days: 8 });

      const webSession = await webSessionOf(agent);
      const linkedSession = await sessionRowsWithId(db, linkedSessionOf(agent));
      const after = await refreshed(app, agent);
      const mcp = await listTools(app, after);

      expect(webSession).toBeNull();
      expect(linkedSession).toEqual([]);
      expect(mcp.status).toBe(200);
    }));

  it("au-delà de 180 jours depuis l'autorisation, l'appel MCP répond 401 même avec un jeton d'accès valide", () =>
    withIdentityApp(async (app, db) => {
      const agent = await obtainAccessToken(app);
      const before = await listTools(app, agent);
      await db.orm
        .update(refreshToken)
        .set({ authTime: sql`now() - make_interval(days => 181)` })
        .where(eq(refreshToken.token, hashOf(agent.refreshToken)));

      const after = await listTools(app, agent);

      expect([before.status, after.status]).toEqual([200, 401]);
    }));

  it("un refresh token expiré coupe l'accès MCP", () =>
    withIdentityApp(async (app, db) => {
      const agent = await obtainAccessToken(app);
      await db.orm
        .update(refreshToken)
        .set({ expiresAt: sql`now() - make_interval(secs => 1)` })
        .where(eq(refreshToken.token, hashOf(agent.refreshToken)));

      const mcp = await listTools(app, agent);

      expect(mcp.status).toBe(401);
    }));
});

describe("les coupures de la chaîne (ADR 0060 §4)", () => {
  it("une déconnexion coupe l'accès MCP et le rafraîchissement de l'agent", () =>
    withIdentityApp(async (app) => {
      const agent = await obtainAccessToken(app);

      await agent.browser.postJson("/auth/sign-out", {});
      const mcp = await listTools(app, agent);
      const refresh = await refreshTokens(app, agent);

      expect(mcp.status).toBe(401);
      expect(refresh.status).toBe(400);
      expect(await refresh.json()).toMatchObject({ error: "invalid_grant" });
    }));

  it("la révocation des sessions encore valides coupe l'accès MCP et le rafraîchissement", () =>
    withIdentityApp(async (app) => {
      const agent = await obtainAccessToken(app);

      await agent.browser.postJson("/auth/revoke-sessions", {});
      const mcp = await listTools(app, agent);
      const refresh = await refreshTokens(app, agent);

      expect(mcp.status).toBe(401);
      expect(refresh.status).toBe(400);
    }));

  it("un rejeu hors fenêtre coupe les chaînes des autres IA de l'utilisateur, même sans session web", () =>
    withIdentityApp(async (app, db) => {
      const replayed = await obtainAccessToken(app);
      const other = await authorizeAnotherAi(app, {
        browser: replayed.browser,
        clientName: "ChatGPT",
      });
      await travelDays(db, { userId: replayed.userId, days: 8 });
      await webSessionOf(replayed);
      const rotated = await refreshed(app, replayed);
      const otherRotated = await refreshed(app, { ...replayed, ...other });
      await db.orm
        .update(refreshToken)
        .set({ rotationReplayExpiresAt: sql`now() - make_interval(secs => 1)` })
        .where(eq(refreshToken.token, hashOf(replayed.refreshToken)));

      const replay = await refreshTokens(app, replayed);
      const rotatedMcp = await listTools(app, rotated);
      const otherMcp = await listTools(app, otherRotated);
      const otherRefresh = await refreshTokens(app, otherRotated);

      expect(replay.status).toBe(400);
      expect([rotatedMcp.status, otherMcp.status]).toEqual([401, 401]);
      expect(otherRefresh.status).toBe(400);
    }));

  it("une déconnexion enregistre la coupure sur chaque refresh token de la chaîne, sans les supprimer", () =>
    withIdentityApp(async (app, db) => {
      const agent = await refreshed(app, await obtainAccessToken(app));

      await agent.browser.postJson("/auth/sign-out", {});

      expect(await chainCutsOf(db, agent)).toEqual([RECORDED_CUT, RECORDED_CUT]);
    }));

  it("la suppression d'une session déjà expirée n'enregistre aucune coupure", () =>
    withIdentityApp(async (app, db) => {
      const agent = await obtainAccessToken(app);
      await travelDays(db, { userId: agent.userId, days: 8 });

      await webSessionOf(agent);

      expect(await chainCutsOf(db, agent)).toEqual([{ cutAt: null }]);
    }));

  it("un rejeu hors fenêtre enregistre la coupure sur les chaînes des autres IA de l'utilisateur", () =>
    withIdentityApp(async (app, db) => {
      const replayed = await obtainAccessToken(app);
      const elsewhere = await obtainAccessToken(app, { registeredId: replayed.userId });
      await refreshed(app, replayed);
      await db.orm
        .update(refreshToken)
        .set({ rotationReplayExpiresAt: sql`now() - make_interval(secs => 1)` })
        .where(eq(refreshToken.token, hashOf(replayed.refreshToken)));

      await refreshTokens(app, replayed);

      expect(await chainCutsOf(db, elsewhere)).toEqual([RECORDED_CUT]);
    }));

  it("rejouer un refresh token d'une chaîne coupée n'est pas un rejeu : les autres chaînes continuent", () =>
    withIdentityApp(async (app, db) => {
      const loggedOut = await obtainAccessToken(app);
      const elsewhere = await obtainAccessToken(app, { registeredId: loggedOut.userId });
      await refreshed(app, loggedOut);
      await db.orm
        .update(refreshToken)
        .set({ rotationReplayExpiresAt: sql`now() - make_interval(secs => 1)` })
        .where(eq(refreshToken.token, hashOf(loggedOut.refreshToken)));
      await loggedOut.browser.postJson("/auth/sign-out", {});

      const replay = await refreshTokens(app, loggedOut);
      const elsewhereCuts = await chainCutsOf(db, elsewhere);
      const elsewhereMcp = await listTools(app, elsewhere);
      const elsewhereRefresh = await refreshTokens(app, elsewhere);

      expect(replay.status).toBe(400);
      expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
      expect(elsewhereCuts).toEqual([{ cutAt: null }]);
      expect([elsewhereMcp.status, elsewhereRefresh.status]).toEqual([200, 200]);
    }));
});
