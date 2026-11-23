import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import { replayPendingCancellations } from "#modules/subscription/subscription-module.ts";
import type { LogRecord } from "#platform/logging.ts";
import {
  type App,
  BASE_URL,
  GRACE,
  obtainAccessToken,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { personalSpaceOf } from "#testing/space-fixtures.ts";
import {
  makeMerchantOfRecord,
  makeSubscriptionEvent,
  MODIFIED_AT,
  postPolarWebhook,
  seedMember,
  seedSubscription,
  subscriptionOf,
  WEBHOOK_SECRET,
} from "#testing/subscription-fixtures.ts";

const SUBSCRIPTION_ID = "0d3f6a2b-7c1e-4b8a-9f2d-5e6a7b8c9d0e";

const REQUESTED_AT = new Date("2026-11-23T08:00:00.000Z");

const leave = (
  app: App,
  { accessToken, spaceId }: { readonly accessToken: string; readonly spaceId: string },
) =>
  app.request(`${BASE_URL}/v1/spaces/${spaceId}/members/me`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });

const manageMember = (
  app: App,
  {
    accessToken,
    spaceId,
    memberId,
    method,
  }: {
    readonly accessToken: string;
    readonly spaceId: string;
    readonly memberId: string;
    readonly method: "DELETE" | "PATCH";
  },
) =>
  app.request(`${BASE_URL}/v1/spaces/${spaceId}/members/${memberId}`, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    ...(method === "PATCH" ? { body: JSON.stringify({ role: "editor" }) } : {}),
  });

const seedPaidSpaceWithOwner = async (app: App, db: PostgresDatabase) => {
  const payer = await obtainAccessToken(app);
  const spaceId = await personalSpaceOf(db, payer.userId);
  await seedSubscription(db, { spaceId, payerId: payer.userId });
  const owner = await obtainAccessToken(app, { user: GRACE });
  await seedMember(db, { spaceId, userId: owner.userId, role: "owner" });
  return { payer, owner, spaceId };
};

const unavailablePolar = () => ({
  merchant: makeMerchantOfRecord({ available: false }).merchant,
  webhookSecret: WEBHOOK_SECRET,
});

const secondsAfter = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);

describe("une résiliation que Polar n'a pas reçue est rejouée (ADR 0050 §3)", () => {
  it("Polar indisponible au départ : l'intention de résiliation reste enregistrée", () =>
    withIdentityApp(
      async (app, db) => {
        const { payer, spaceId } = await seedPaidSpaceWithOwner(app, db);
        const before = Date.now();

        const response = await leave(app, { accessToken: payer.accessToken, spaceId });

        expect(response.status).toBe(204);
        const requestedAt = (await subscriptionOf(db, spaceId))?.cancelRequestedAt;
        expect(requestedAt?.getTime()).toBeGreaterThanOrEqual(before);
      },
      { billing: unavailablePolar() },
    ));

  it("Polar indisponible au retrait du payeur : l'intention de résiliation reste enregistrée", () =>
    withIdentityApp(
      async (app, db) => {
        const { payer, owner, spaceId } = await seedPaidSpaceWithOwner(app, db);

        const response = await manageMember(app, {
          accessToken: owner.accessToken,
          spaceId,
          memberId: payer.userId,
          method: "DELETE",
        });

        expect(response.status).toBe(204);
        expect((await subscriptionOf(db, spaceId))?.cancelRequestedAt).toBeInstanceOf(Date);
      },
      { billing: unavailablePolar() },
    ));

  it("le payeur rendu éditeur n'enregistre aucune intention, même Polar indisponible", () =>
    withIdentityApp(
      async (app, db) => {
        const { payer, owner, spaceId } = await seedPaidSpaceWithOwner(app, db);

        const response = await manageMember(app, {
          accessToken: owner.accessToken,
          spaceId,
          memberId: payer.userId,
          method: "PATCH",
        });

        expect(response.status).toBe(200);
        expect(await subscriptionOf(db, spaceId)).toMatchObject({ cancelRequestedAt: null });
      },
      { billing: unavailablePolar() },
    ));

  it("Polar disponible au départ : l'intention est effacée", () =>
    withIdentityApp(async (app, db) => {
      const { payer, spaceId } = await seedPaidSpaceWithOwner(app, db);

      await leave(app, { accessToken: payer.accessToken, spaceId });

      expect(await subscriptionOf(db, spaceId)).toMatchObject({ cancelRequestedAt: null });
    }));

  it("la tâche planifiée rejoue l'intention quand Polar répond, puis l'efface", () =>
    withIdentityApp(
      async (app, db) => {
        const { payer, spaceId } = await seedPaidSpaceWithOwner(app, db);
        await leave(app, { accessToken: payer.accessToken, spaceId });
        const polar = makeMerchantOfRecord();
        const records: LogRecord[] = [];

        await replayPendingCancellations({
          db,
          merchant: polar.merchant,
          log: (record) => records.push(record),
        })();

        expect(polar.cancellations).toEqual([{ spaceId, subscriptionId: SUBSCRIPTION_ID }]);
        expect(await subscriptionOf(db, spaceId)).toMatchObject({ cancelRequestedAt: null });
        expect(records).toContainEqual({
          level: "info",
          msg: "polar_cancellation_replay_pass",
          replayed: 1,
          pending: 0,
        });
      },
      { billing: unavailablePolar() },
    ));

  it("la tâche planifiée garde l'intention et journalise quand Polar reste indisponible", () =>
    withIdentityApp(
      async (app, db) => {
        const { payer, spaceId } = await seedPaidSpaceWithOwner(app, db);
        await leave(app, { accessToken: payer.accessToken, spaceId });
        const kept = (await subscriptionOf(db, spaceId))?.cancelRequestedAt;
        const records: LogRecord[] = [];

        await replayPendingCancellations({
          db,
          merchant: makeMerchantOfRecord({ available: false }).merchant,
          log: (record) => records.push(record),
        })();

        expect(await subscriptionOf(db, spaceId)).toMatchObject({ cancelRequestedAt: kept });
        expect(records).toContainEqual({
          level: "error",
          msg: "payer departure: cancel the subscription at period end by hand in Polar",
          spaceId,
          subscriptionId: SUBSCRIPTION_ID,
        });
        expect(records).toContainEqual({
          level: "info",
          msg: "polar_cancellation_replay_pass",
          replayed: 0,
          pending: 1,
        });
      },
      { billing: unavailablePolar() },
    ));

  it("la tâche planifiée ne demande rien sans intention en attente", () =>
    withIdentityApp(async (app, db) => {
      await seedPaidSpaceWithOwner(app, db);
      const polar = makeMerchantOfRecord();

      await replayPendingCancellations({ db, merchant: polar.merchant, log: () => undefined })();

      expect(polar.cancellations).toEqual([]);
    }));

  it.each([
    [
      "la résiliation",
      { type: "subscription.canceled", status: "active", cancelAtPeriodEnd: true },
    ],
    [
      "la révocation",
      { type: "subscription.revoked", status: "canceled", cancelAtPeriodEnd: true },
    ],
  ])("%s reçue de Polar efface l'intention", (_case, event) =>
    withIdentityApp(async (app, db) => {
      const payer = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, payer.userId);
      await seedSubscription(db, {
        spaceId,
        payerId: payer.userId,
        cancelRequestedAt: REQUESTED_AT,
      });

      await postPolarWebhook(app, {
        event: makeSubscriptionEvent({
          ...event,
          spaceId,
          payerId: payer.userId,
          modifiedAt: secondsAfter(MODIFIED_AT, 60),
        }),
      });

      expect(await subscriptionOf(db, spaceId)).toMatchObject({ cancelRequestedAt: null });
    }),
  );

  it("un renouvellement reçu de Polar garde l'intention, que la tâche rejouera", () =>
    withIdentityApp(async (app, db) => {
      const payer = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, payer.userId);
      await seedSubscription(db, {
        spaceId,
        payerId: payer.userId,
        cancelRequestedAt: REQUESTED_AT,
      });

      await postPolarWebhook(app, {
        event: makeSubscriptionEvent({
          type: "subscription.updated",
          spaceId,
          payerId: payer.userId,
          modifiedAt: secondsAfter(MODIFIED_AT, 60),
        }),
      });

      expect(await subscriptionOf(db, spaceId)).toMatchObject({
        status: "active",
        cancelRequestedAt: REQUESTED_AT,
      });
    }));
});
