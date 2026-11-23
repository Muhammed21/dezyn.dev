import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import {
  ADA,
  type App,
  BASE_URL,
  GRACE,
  obtainAccessToken,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { personalSpaceOf } from "#testing/space-fixtures.ts";
import {
  makeSubscriptionEvent,
  MODIFIED_AT,
  PERIOD_END,
  postPolarWebhook,
  seedSubscription,
} from "#testing/subscription-fixtures.ts";
import { SpaceOutput } from "@repo/contracts";
import { schema } from "@repo/db";

const readSpace = async (
  app: App,
  { accessToken, spaceId }: { readonly accessToken: string; readonly spaceId: string },
) => {
  const response = await app.request(`${BASE_URL}/v1/spaces/${spaceId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return SpaceOutput.parse(await response.json());
};

const seedMember = (
  db: PostgresDatabase,
  {
    spaceId,
    userId,
    role,
  }: { readonly spaceId: string; readonly userId: string; readonly role: "owner" | "editor" },
) =>
  db.orm
    .insert(schema.spaceMember)
    .values({ id: randomUUID(), spaceId, userId, role, joinedAt: new Date() });

const seedPaidSpace = async (app: App, db: PostgresDatabase) => {
  const payer = await obtainAccessToken(app);
  const spaceId = await personalSpaceOf(db, payer.userId);
  await seedSubscription(db, { spaceId, payerId: payer.userId });
  return { payer, spaceId };
};

const secondsAfter = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);

describe("la lecture d'un espace montre son abonnement aux propriétaires (ADR 0050 §3)", () => {
  it("le payeur lit le statut, la date de renouvellement, et se voit payeur", () =>
    withIdentityApp(async (app, db) => {
      const { payer, spaceId } = await seedPaidSpace(app, db);

      expect(
        (await readSpace(app, { accessToken: payer.accessToken, spaceId })).subscription,
      ).toEqual({
        status: "active",
        currentPeriodEnd: PERIOD_END.toISOString(),
        payer: { name: ADA.name, email: ADA.email, you: true, left: false },
      });
    }));

  it("un autre propriétaire voit qui paie", () =>
    withIdentityApp(async (app, db) => {
      const { spaceId } = await seedPaidSpace(app, db);
      const owner = await obtainAccessToken(app, { user: GRACE });
      await seedMember(db, { spaceId, userId: owner.userId, role: "owner" });

      expect(
        (await readSpace(app, { accessToken: owner.accessToken, spaceId })).subscription?.payer,
      ).toEqual({ name: ADA.name, email: ADA.email, you: false, left: false });
    }));

  it("un éditeur ne lit pas l'abonnement", () =>
    withIdentityApp(async (app, db) => {
      const { spaceId } = await seedPaidSpace(app, db);
      const editor = await obtainAccessToken(app, { user: GRACE });
      await seedMember(db, { spaceId, userId: editor.userId, role: "editor" });

      const space = await readSpace(app, { accessToken: editor.accessToken, spaceId });

      expect(space.plan).toBe("team");
      expect(space).not.toHaveProperty("subscription");
    }));

  it("un espace qui n'a jamais payé n'a pas d'abonnement", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId } = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, userId);

      expect(await readSpace(app, { accessToken, spaceId })).not.toHaveProperty("subscription");
    }));

  it("après une résiliation, l'espace reste Team et l'abonnement donne sa date de fin", () =>
    withIdentityApp(async (app, db) => {
      const { payer, spaceId } = await seedPaidSpace(app, db);
      await postPolarWebhook(app, {
        event: makeSubscriptionEvent({
          type: "subscription.canceled",
          spaceId,
          payerId: payer.userId,
          status: "active",
          cancelAtPeriodEnd: true,
          modifiedAt: secondsAfter(MODIFIED_AT, 60),
        }),
      });

      expect(await readSpace(app, { accessToken: payer.accessToken, spaceId })).toMatchObject({
        plan: "team",
        subscription: { status: "canceling", currentPeriodEnd: PERIOD_END.toISOString() },
      });
    }));

  it("un abonnement sans fin de période se lit sans date", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId } = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, userId);
      await postPolarWebhook(app, {
        event: {
          ...makeSubscriptionEvent({ spaceId, payerId: userId }),
          data: {
            ...makeSubscriptionEvent({ spaceId, payerId: userId }).data,
            current_period_end: null,
          },
        },
      });

      expect((await readSpace(app, { accessToken, spaceId })).subscription).toMatchObject({
        currentPeriodEnd: null,
      });
    }));
});
