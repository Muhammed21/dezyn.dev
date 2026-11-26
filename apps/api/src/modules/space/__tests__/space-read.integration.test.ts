import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import {
  ADA,
  type App,
  BASE_URL,
  obtainAccessToken,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { seedProjectStoring } from "#testing/project-storage.ts";
import { makeOutbox, seedSpaceWithInvitedEditor } from "#testing/space-fixtures.ts";
import { SpaceOutput } from "@repo/contracts";
import { schema } from "@repo/db";

const getSpace = (app: App, { accessToken, spaceId }: { accessToken: string; spaceId: string }) =>
  app.request(`${BASE_URL}/v1/spaces/${spaceId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

const personalSpaceOf = async (db: PostgresDatabase, userId: string) => {
  const [membership] = await db.orm
    .select({ spaceId: schema.spaceMember.spaceId })
    .from(schema.spaceMember)
    .where(eq(schema.spaceMember.userId, userId));
  return membership?.spaceId ?? "";
};

const seedSpace = async (db: PostgresDatabase) => {
  const id = randomUUID();
  await db.orm
    .insert(schema.space)
    .values({ id, name: "Studio Grace", plan: "team", createdAt: new Date() });
  return id;
};

describe("lire un espace (ADR 0017 §3)", () => {
  it("un membre lit son espace, avec son rôle et les actions qu'il lui permet", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId } = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, userId);

      const response = await getSpace(app, { accessToken, spaceId });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: spaceId,
        name: ADA.name,
        plan: "free",
        role: "owner",
        allowedActions: [
          "space.read",
          "project.create",
          "member.invite",
          "member.leave",
          "member.manage",
          "project.setFigmaFile",
          "token.create",
          "token.delete",
          "token.declareFigmaState",
          "proposal.review",
          "subscription.checkout",
        ],
        storage: { usedBytes: 0, limitBytes: 500_000_000, alertReached: false },
        frozen: false,
        exceededFreeLimits: [],
      });
    }));

  it("un propriétaire lit le stockage cumulé des projets de son espace, sous 80 % (ADR 0032 §1)", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId } = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, userId);
      await seedProjectStoring(db, { spaceId, bytes: 250_000_000 });
      await seedProjectStoring(db, { spaceId, bytes: 149_999_999 });

      const response = await getSpace(app, { accessToken, spaceId });

      expect(await response.json()).toMatchObject({
        storage: { usedBytes: 399_999_999, limitBytes: 500_000_000, alertReached: false },
      });
    }));

  it("un éditeur lit le stockage de l'espace et l'alerte à 80 % de la limite Team", () => {
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { grace, spaceId } = await seedSpaceWithInvitedEditor(app, db, outbox);
        await seedProjectStoring(db, { spaceId, bytes: 16_000_000_000 });

        const response = await getSpace(app, { accessToken: grace.accessToken, spaceId });

        expect(SpaceOutput.parse(await response.json())).toMatchObject({
          role: "editor",
          storage: { usedBytes: 16_000_000_000, limitBytes: 20_000_000_000, alertReached: true },
        });
      },
      { mailer: outbox.mailer },
    );
  });

  it("le stockage d'un espace ne compte pas les projets d'un autre espace", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId } = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, userId);
      await seedProjectStoring(db, { spaceId, bytes: 1_000 });
      await seedProjectStoring(db, { spaceId: await seedSpace(db), bytes: 450_000_000 });

      const response = await getSpace(app, { accessToken, spaceId });

      expect(await response.json()).toMatchObject({
        storage: { usedBytes: 1_000, alertReached: false },
      });
    }));

  it("un non-membre reçoit 404, comme pour un espace qui n'existe pas", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken } = await obtainAccessToken(app);
      const othersSpace = await seedSpace(db);

      const notMember = await getSpace(app, { accessToken, spaceId: othersSpace });
      const missing = await getSpace(app, { accessToken, spaceId: randomUUID() });

      expect([notMember.status, missing.status]).toEqual([404, 404]);
      expect(await notMember.json()).toMatchObject({
        type: "about:blank",
        title: "Ressource introuvable",
        status: 404,
      });
    }));

  it("un membre parti reçoit 404", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId } = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, userId);
      await db.orm
        .update(schema.spaceMember)
        .set({ closedAt: new Date(), closedReason: "left" })
        .where(eq(schema.spaceMember.userId, userId));

      const response = await getSpace(app, { accessToken, spaceId });

      expect(response.status).toBe(404);
    }));

  it("un identifiant qui n'est pas un UUID reçoit 404", () =>
    withIdentityApp(async (app) => {
      const { accessToken } = await obtainAccessToken(app);

      const response = await getSpace(app, { accessToken, spaceId: "pas-un-uuid" });

      expect(response.status).toBe(404);
    }));
});
