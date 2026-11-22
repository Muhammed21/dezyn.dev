import { describe, expect, it } from "vitest";

import {
  type App,
  BASE_URL,
  obtainAccessToken,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import {
  makeOutbox,
  personalSpaceOf,
  seedSpaceWithInvitedEditor,
} from "#testing/space-fixtures.ts";
import {
  makeSubscriptionEvent,
  MODIFIED_AT,
  planChangesOf,
  postPolarWebhook,
  seedSubscription,
  subscriptionOf,
} from "#testing/subscription-fixtures.ts";
import { SpaceOutput } from "@repo/contracts";

const readSpace = async (
  app: App,
  { accessToken, spaceId }: { readonly accessToken: string; readonly spaceId: string },
) => {
  const response = await app.request(`${BASE_URL}/v1/spaces/${spaceId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return SpaceOutput.parse(await response.json());
};

const seedSubscribedSpace = async (app: App, db: Parameters<typeof personalSpaceOf>[0]) => {
  const owner = await obtainAccessToken(app);
  const spaceId = await personalSpaceOf(db, owner.userId);
  await seedSubscription(db, { spaceId, payerId: owner.userId });
  return { ...owner, spaceId };
};

const secondsAfter = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);

const makePastDueEvent = ({
  type = "subscription.past_due",
  spaceId,
  payerId,
  modifiedAt = secondsAfter(MODIFIED_AT, 60),
}: {
  readonly type?: string;
  readonly spaceId: string;
  readonly payerId: string;
  readonly modifiedAt?: Date;
}) => makeSubscriptionEvent({ type, spaceId, payerId, status: "past_due", modifiedAt });

describe("un retard de paiement garde l'espace en Team pendant les relances de Polar (ADR 0050 §4)", () => {
  it.each(["subscription.past_due", "subscription.updated"])(
    "un événement %s en retard de paiement enregistre le retard et laisse l'espace en Team",
    (type) =>
      withIdentityApp(async (app, db) => {
        const { accessToken, userId, spaceId } = await seedSubscribedSpace(app, db);

        const response = await postPolarWebhook(app, {
          event: makePastDueEvent({ type, spaceId, payerId: userId }),
        });

        expect(response.status).toBe(200);
        expect(await subscriptionOf(db, spaceId)).toMatchObject({
          status: "past_due",
          polarModifiedAt: secondsAfter(MODIFIED_AT, 60),
        });
        expect((await readSpace(app, { accessToken, spaceId })).plan).toBe("team");
        expect(await planChangesOf(db, spaceId)).toEqual([]);
      }),
  );

  it("le même retard reçu deux fois en même temps s'enregistre sans changer le plan", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId, spaceId } = await seedSubscribedSpace(app, db);
      const event = makePastDueEvent({ spaceId, payerId: userId });

      const responses = await Promise.all([
        postPolarWebhook(app, { event }),
        postPolarWebhook(app, { event }),
      ]);

      expect(responses.map(({ status }) => status)).toEqual([200, 200]);
      expect(await subscriptionOf(db, spaceId)).toMatchObject({ status: "past_due" });
      expect((await readSpace(app, { accessToken, spaceId })).plan).toBe("team");
    }));

  it("un retard plus ancien que l'état enregistré est ignoré", () =>
    withIdentityApp(async (app, db) => {
      const { userId, spaceId } = await seedSubscribedSpace(app, db);

      await postPolarWebhook(app, {
        event: makePastDueEvent({
          spaceId,
          payerId: userId,
          modifiedAt: secondsAfter(MODIFIED_AT, -1),
        }),
      });

      expect(await subscriptionOf(db, spaceId)).toMatchObject({
        status: "active",
        polarModifiedAt: MODIFIED_AT,
      });
    }));

  it.each([
    ["subscription.updated", "active"],
    ["subscription.created", "active"],
  ])(
    "un événement %s au statut %s, pas encore traité, reçoit 200 et laisse le retard enregistré",
    (type, status) =>
      withIdentityApp(async (app, db) => {
        const { userId, spaceId } = await seedSubscribedSpace(app, db);
        await postPolarWebhook(app, { event: makePastDueEvent({ spaceId, payerId: userId }) });

        const response = await postPolarWebhook(app, {
          event: makeSubscriptionEvent({
            type,
            spaceId,
            payerId: userId,
            status,
            modifiedAt: secondsAfter(MODIFIED_AT, 120),
          }),
        });

        expect(response.status).toBe(200);
        expect(await subscriptionOf(db, spaceId)).toMatchObject({ status: "past_due" });
      }),
  );

  it("le retour à l'état actif efface le retard", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId, spaceId } = await seedSubscribedSpace(app, db);
      await postPolarWebhook(app, { event: makePastDueEvent({ spaceId, payerId: userId }) });

      await postPolarWebhook(app, {
        event: makeSubscriptionEvent({
          spaceId,
          payerId: userId,
          modifiedAt: secondsAfter(MODIFIED_AT, 120),
        }),
      });

      expect(await subscriptionOf(db, spaceId)).toMatchObject({ status: "active" });
      expect((await readSpace(app, { accessToken, spaceId })).subscription).toEqual({
        status: "active",
      });
    }));
});

describe("le retard de paiement se lit sur l'espace, par ses propriétaires seuls (spec #343)", () => {
  it("un propriétaire lit le retard de paiement de l'espace", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId, spaceId } = await seedSubscribedSpace(app, db);
      await postPolarWebhook(app, { event: makePastDueEvent({ spaceId, payerId: userId }) });

      expect((await readSpace(app, { accessToken, spaceId })).subscription).toEqual({
        status: "past_due",
      });
    }));

  it("un éditeur ne lit pas l'abonnement de l'espace", () => {
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { ada, grace, spaceId } = await seedSpaceWithInvitedEditor(app, db, outbox);
        await seedSubscription(db, { spaceId, payerId: ada.userId, status: "past_due" });

        const space = await readSpace(app, { accessToken: grace.accessToken, spaceId });

        expect(space.plan).toBe("team");
        expect(space).not.toHaveProperty("subscription");
      },
      { mailer: outbox.mailer },
    );
  });

  it("un propriétaire d'un espace sans abonnement ne lit aucun abonnement", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId } = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, userId);

      expect(await readSpace(app, { accessToken, spaceId })).not.toHaveProperty("subscription");
    }));
});
