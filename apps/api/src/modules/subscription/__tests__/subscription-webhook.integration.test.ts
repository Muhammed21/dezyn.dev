import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { LogRecord } from "#platform/logging.ts";
import {
  type App,
  BASE_URL,
  GRACE,
  obtainAccessToken,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { seedProjectStoring } from "#testing/project-storage.ts";
import { invite, makeOutbox, personalSpaceOf } from "#testing/space-fixtures.ts";
import {
  makeSubscriptionEvent,
  MODIFIED_AT,
  PERIOD_END,
  planChangesOf,
  postPolarWebhook,
  seedSubscription,
  signedHeaders,
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

const seedFreeSpace = async (app: App, db: Parameters<typeof personalSpaceOf>[0]) => {
  const owner = await obtainAccessToken(app);
  return { ...owner, spaceId: await personalSpaceOf(db, owner.userId) };
};

const SUBSCRIPTION_A = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

const SUBSCRIPTION_B = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

const secondsAfter = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);

const withSubscriptionData = (
  event: ReturnType<typeof makeSubscriptionEvent>,
  data: Readonly<Record<string, unknown>>,
) => ({ ...event, data: { ...event.data, ...data } });

const makeLog = () => {
  const records: LogRecord[] = [];
  return { records, log: (record: LogRecord) => records.push(record) };
};

describe("le webhook « abonnement actif » de Polar passe l'espace en Team (ADR 0050 §3, §4)", () => {
  it("un abonnement actif signé passe l'espace Free en Team, avec 20 Go de stockage", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId, spaceId } = await seedFreeSpace(app, db);

      const response = await postPolarWebhook(app, {
        event: makeSubscriptionEvent({ spaceId, payerId: userId }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });
      expect(await readSpace(app, { accessToken, spaceId })).toMatchObject({
        plan: "team",
        storage: { limitBytes: 20_000_000_000 },
      });
    }));

  it("une activation reconnue ne journalise aucun avertissement", () => {
    const { records, log } = makeLog();
    return withIdentityApp(
      async (app, db) => {
        const { userId, spaceId } = await seedFreeSpace(app, db);

        await postPolarWebhook(app, { event: makeSubscriptionEvent({ spaceId, payerId: userId }) });

        expect(records.filter((record) => record.level === "warn")).toEqual([]);
      },
      { log },
    );
  });

  it("lit les horodatages de Polar écrits avec un décalage horaire", () =>
    withIdentityApp(async (app, db) => {
      const { userId, spaceId } = await seedFreeSpace(app, db);

      await postPolarWebhook(app, {
        event: withSubscriptionData(makeSubscriptionEvent({ spaceId, payerId: userId }), {
          created_at: "2026-11-22T10:59:00+01:00",
          modified_at: "2026-11-22T11:00:00+01:00",
          current_period_end: "2026-12-22T11:00:00+01:00",
        }),
      });

      expect(await subscriptionOf(db, spaceId)).toMatchObject({
        currentPeriodEnd: PERIOD_END,
        polarModifiedAt: MODIFIED_AT,
      });
    }));

  it("enregistre sans fin de période un abonnement dont Polar ne donne pas la fin", () =>
    withIdentityApp(async (app, db) => {
      const { userId, spaceId } = await seedFreeSpace(app, db);

      await postPolarWebhook(app, {
        event: withSubscriptionData(makeSubscriptionEvent({ spaceId, payerId: userId }), {
          current_period_end: null,
        }),
      });

      expect(await subscriptionOf(db, spaceId)).toMatchObject({ currentPeriodEnd: null });
    }));

  it("enregistre l'abonnement de l'espace : identifiant Polar, payeur, statut et fin de période", () =>
    withIdentityApp(async (app, db) => {
      const { userId, spaceId } = await seedFreeSpace(app, db);

      await postPolarWebhook(app, {
        event: makeSubscriptionEvent({
          spaceId,
          payerId: userId,
          subscriptionId: "4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f",
        }),
      });

      expect(await subscriptionOf(db, spaceId)).toEqual({
        spaceId,
        polarSubscriptionId: "4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f",
        payerId: userId,
        status: "active",
        currentPeriodEnd: PERIOD_END,
        polarModifiedAt: MODIFIED_AT,
      });
    }));

  it("trace le changement de plan : événement Polar, abonnement, plan avant et après", () =>
    withIdentityApp(async (app, db) => {
      const { userId, spaceId } = await seedFreeSpace(app, db);

      await postPolarWebhook(app, {
        event: makeSubscriptionEvent({
          spaceId,
          payerId: userId,
          subscriptionId: "4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f",
        }),
      });

      expect(await planChangesOf(db, spaceId)).toEqual([
        {
          polarSubscriptionId: "4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f",
          polarEvent: "subscription.active",
          planBefore: "free",
          planAfter: "team",
        },
      ]);
    }));

  it("le même événement reçu deux fois ne passe l'espace en Team qu'une fois", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId, spaceId } = await seedFreeSpace(app, db);
      const event = makeSubscriptionEvent({ spaceId, payerId: userId });

      const responses = [
        await postPolarWebhook(app, { event }),
        await postPolarWebhook(app, { event }),
      ];

      expect(responses.map(({ status }) => status)).toEqual([200, 200]);
      expect((await readSpace(app, { accessToken, spaceId })).plan).toBe("team");
      expect(await planChangesOf(db, spaceId)).toHaveLength(1);
    }));

  it("le même événement reçu deux fois en même temps ne trace qu'un changement de plan", () =>
    withIdentityApp(async (app, db) => {
      const { userId, spaceId } = await seedFreeSpace(app, db);
      const event = makeSubscriptionEvent({ spaceId, payerId: userId });

      const responses = await Promise.all([
        postPolarWebhook(app, { event }),
        postPolarWebhook(app, { event }),
      ]);

      expect(responses.map(({ status }) => status)).toEqual([200, 200]);
      expect(await planChangesOf(db, spaceId)).toHaveLength(1);
    }));

  it("un second abonnement payé pour l'espace ne remplace pas le premier, et se journalise", () => {
    const { records, log } = makeLog();
    return withIdentityApp(
      async (app, db) => {
        const { userId, spaceId } = await seedFreeSpace(app, db);
        await postPolarWebhook(app, {
          event: makeSubscriptionEvent({
            spaceId,
            payerId: userId,
            subscriptionId: SUBSCRIPTION_A,
          }),
        });

        const response = await postPolarWebhook(app, {
          event: makeSubscriptionEvent({
            spaceId,
            payerId: userId,
            subscriptionId: SUBSCRIPTION_B,
            modifiedAt: secondsAfter(MODIFIED_AT, 60),
            currentPeriodEnd: new Date("2027-01-22T10:00:00.000Z"),
          }),
        });

        expect(response.status).toBe(200);
        expect(await subscriptionOf(db, spaceId)).toMatchObject({
          polarSubscriptionId: SUBSCRIPTION_A,
          currentPeriodEnd: PERIOD_END,
          polarModifiedAt: MODIFIED_AT,
        });
        expect(await planChangesOf(db, spaceId)).toEqual([
          expect.objectContaining({ polarSubscriptionId: SUBSCRIPTION_A }),
        ]);
        expect(records).toContainEqual(
          expect.objectContaining({
            level: "warn",
            msg: "polar event for another subscription of the space",
            event: "subscription.active",
            spaceId,
            storedSubscriptionId: SUBSCRIPTION_A,
            subscriptionId: SUBSCRIPTION_B,
          }),
        );
      },
      { log },
    );
  });

  it("le premier abonnement continue d'évoluer après le refus d'un second", () =>
    withIdentityApp(async (app, db) => {
      const { userId, spaceId } = await seedFreeSpace(app, db);
      const event = (subscriptionId: string, seconds: number, cancelAtPeriodEnd = false) =>
        makeSubscriptionEvent({
          spaceId,
          payerId: userId,
          subscriptionId,
          cancelAtPeriodEnd,
          modifiedAt: secondsAfter(MODIFIED_AT, seconds),
        });
      await postPolarWebhook(app, { event: event(SUBSCRIPTION_A, 0) });
      await postPolarWebhook(app, { event: event(SUBSCRIPTION_B, 60) });

      await postPolarWebhook(app, { event: event(SUBSCRIPTION_A, 30, true) });
      await postPolarWebhook(app, { event: event(SUBSCRIPTION_B, 120) });

      expect(await subscriptionOf(db, spaceId)).toMatchObject({
        polarSubscriptionId: SUBSCRIPTION_A,
        status: "canceling",
        polarModifiedAt: secondsAfter(MODIFIED_AT, 30),
      });
    }));

  it("un état plus ancien reçu après un plus récent est ignoré", () =>
    withIdentityApp(async (app, db) => {
      const { userId, spaceId } = await seedFreeSpace(app, db);
      const laterPeriodEnd = new Date("2027-01-22T10:00:00.000Z");
      await postPolarWebhook(app, {
        event: makeSubscriptionEvent({
          spaceId,
          payerId: userId,
          modifiedAt: secondsAfter(MODIFIED_AT, 60),
          currentPeriodEnd: laterPeriodEnd,
        }),
      });

      const response = await postPolarWebhook(app, {
        event: makeSubscriptionEvent({ spaceId, payerId: userId, modifiedAt: MODIFIED_AT }),
      });

      expect(response.status).toBe(200);
      expect(await subscriptionOf(db, spaceId)).toMatchObject({
        currentPeriodEnd: laterPeriodEnd,
        polarModifiedAt: secondsAfter(MODIFIED_AT, 60),
      });
    }));

  it("un état plus récent d'un abonnement déjà actif met à jour la fin de période sans tracer de changement de plan", () =>
    withIdentityApp(async (app, db) => {
      const { userId, spaceId } = await seedFreeSpace(app, db);
      await seedSubscription(db, { spaceId, payerId: userId });
      const laterPeriodEnd = new Date("2027-01-22T10:00:00.000Z");

      await postPolarWebhook(app, {
        event: makeSubscriptionEvent({
          spaceId,
          payerId: userId,
          modifiedAt: secondsAfter(MODIFIED_AT, 1),
          currentPeriodEnd: laterPeriodEnd,
        }),
      });

      expect(await subscriptionOf(db, spaceId)).toMatchObject({ currentPeriodEnd: laterPeriodEnd });
      expect(await planChangesOf(db, spaceId)).toEqual([]);
    }));

  it("un abonnement actif résilié en fin de période garde l'espace en Team", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId, spaceId } = await seedFreeSpace(app, db);

      await postPolarWebhook(app, {
        event: makeSubscriptionEvent({ spaceId, payerId: userId, cancelAtPeriodEnd: true }),
      });

      expect((await readSpace(app, { accessToken, spaceId })).plan).toBe("team");
      expect(await subscriptionOf(db, spaceId)).toMatchObject({ status: "canceling" });
    }));
});

describe("le webhook de Polar refuse ce qu'il ne peut pas vérifier (ADR 0050 §7)", () => {
  it("une signature invalide reçoit 401 et ne change pas le plan", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId, spaceId } = await seedFreeSpace(app, db);

      const response = await postPolarWebhook(app, {
        event: makeSubscriptionEvent({ spaceId, payerId: userId }),
        key: Buffer.from("une-autre-cle-de-signature"),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toBe("application/problem+json");
      expect(await response.json()).toMatchObject({
        type: "about:blank",
        title: "Signature invalide",
        status: 401,
      });
      expect((await readSpace(app, { accessToken, spaceId })).plan).toBe("free");
    }));

  it("un horodatage de plus de 5 minutes reçoit 401", () =>
    withIdentityApp(async (app, db) => {
      const { userId, spaceId } = await seedFreeSpace(app, db);

      const response = await postPolarWebhook(app, {
        event: makeSubscriptionEvent({ spaceId, payerId: userId }),
        sentAt: new Date(Date.now() - 10 * 60 * 1000),
      });

      expect(response.status).toBe(401);
    }));

  it("un corps signé qui n'est pas du JSON reçoit 400", () =>
    withIdentityApp(async (app) => {
      const body = "pas du json";

      const response = await app.request(`${BASE_URL}/webhooks/polar`, {
        method: "POST",
        headers: signedHeaders({ body }),
        body,
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        type: "about:blank",
        title: "Événement illisible",
        status: 400,
      });
    }));

  it("un abonnement signé dont la fin de période n'est pas une date reçoit 400", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId, spaceId } = await seedFreeSpace(app, db);

      const response = await postPolarWebhook(app, {
        event: withSubscriptionData(makeSubscriptionEvent({ spaceId, payerId: userId }), {
          current_period_end: "le mois prochain",
        }),
      });

      expect(response.status).toBe(400);
      expect((await readSpace(app, { accessToken, spaceId })).plan).toBe("free");
    }));

  it("sans secret de webhook configuré, le webhook répond 503 pour que Polar le relance", () =>
    withIdentityApp(
      async (app, db) => {
        const { userId, spaceId } = await seedFreeSpace(app, db);

        const response = await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ spaceId, payerId: userId }),
        });

        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({
          type: "about:blank",
          title: "Paiement indisponible",
          status: 503,
        });
      },
      { billing: null },
    ));
});

describe("le webhook de Polar accuse en 200 ce qu'il ne traite pas, et le journalise (ADR 0050 §4)", () => {
  it("un espace inconnu reçoit 200 et une ligne de journal", () => {
    const { records, log } = makeLog();
    const unknownSpace = randomUUID();
    return withIdentityApp(
      async (app) => {
        const { userId } = await obtainAccessToken(app);

        const response = await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ spaceId: unknownSpace, payerId: userId }),
        });

        expect(response.status).toBe(200);
        expect(records).toContainEqual(
          expect.objectContaining({
            level: "warn",
            msg: "polar event for an unknown space",
            event: "subscription.active",
            spaceId: unknownSpace,
          }),
        );
      },
      { log },
    );
  });

  it.each([
    ["sans référence d'espace", undefined],
    ["dont la référence d'espace n'est pas un identifiant", "pas-un-uuid"],
  ])("un abonnement %s reçoit 200 et une ligne de journal", (_case, spaceId) => {
    const { records, log } = makeLog();
    return withIdentityApp(
      async (app) => {
        const { userId } = await obtainAccessToken(app);

        const response = await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ spaceId, payerId: userId }),
        });

        expect(response.status).toBe(200);
        expect(records).toContainEqual(
          expect.objectContaining({
            level: "warn",
            msg: "polar event for an unknown space",
            spaceId,
          }),
        );
      },
      { log },
    );
  });

  it.each([
    ["sans payeur", null],
    ["dont le payeur n'est pas un utilisateur", randomUUID()],
    ["dont le payeur n'est pas un identifiant", "pas-un-uuid"],
  ])("un abonnement %s reçoit 200, ne change pas le plan et se journalise", (_case, payerId) => {
    const { records, log } = makeLog();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, spaceId } = await seedFreeSpace(app, db);

        const response = await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ spaceId, payerId }),
        });

        expect(response.status).toBe(200);
        expect((await readSpace(app, { accessToken, spaceId })).plan).toBe("free");
        expect(records).toContainEqual(
          expect.objectContaining({
            level: "warn",
            msg: "polar event for an unknown payer",
            spaceId,
          }),
        );
      },
      { log },
    );
  });

  it("un statut d'abonnement inconnu ne change pas le plan et se journalise", () => {
    const { records, log } = makeLog();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, userId, spaceId } = await seedFreeSpace(app, db);

        const response = await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ spaceId, payerId: userId, status: "paused" }),
        });

        expect(response.status).toBe(200);
        expect((await readSpace(app, { accessToken, spaceId })).plan).toBe("free");
        expect(records).toContainEqual(
          expect.objectContaining({
            level: "warn",
            msg: "polar subscription status unknown",
            status: "paused",
          }),
        );
      },
      { log },
    );
  });

  it.each(["subscription.updated", "order.paid"])(
    "un événement %s, pas encore traité, reçoit 200 et se journalise sans changer le plan",
    (type) => {
      const { records, log } = makeLog();
      return withIdentityApp(
        async (app, db) => {
          const { accessToken, userId, spaceId } = await seedFreeSpace(app, db);

          const response = await postPolarWebhook(app, {
            event: makeSubscriptionEvent({ type, spaceId, payerId: userId }),
          });

          expect(response.status).toBe(200);
          expect((await readSpace(app, { accessToken, spaceId })).plan).toBe("free");
          expect(records).toContainEqual(
            expect.objectContaining({ level: "info", msg: "polar event ignored", event: type }),
          );
        },
        { log },
      );
    },
  );

  it("un type d'événement inconnu de Polar reçoit 200 et se journalise", () => {
    const { records, log } = makeLog();
    return withIdentityApp(
      async (app, db) => {
        const { userId, spaceId } = await seedFreeSpace(app, db);

        const response = await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ type: "un.type.inconnu", spaceId, payerId: userId }),
        });

        expect(response.status).toBe(200);
        expect(records).toContainEqual(
          expect.objectContaining({
            level: "info",
            msg: "polar event ignored",
            event: "un.type.inconnu",
          }),
        );
      },
      { log },
    );
  });
});

describe("une fois Team, l'espace profite du plan (ADR 0006 §1, spec #343)", () => {
  it("l'espace crée un 4ᵉ projet", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId, spaceId } = await seedFreeSpace(app, db);
      await seedProjectStoring(db, { spaceId, bytes: 0 });
      await seedProjectStoring(db, { spaceId, bytes: 0 });
      await seedProjectStoring(db, { spaceId, bytes: 0 });
      await postPolarWebhook(app, { event: makeSubscriptionEvent({ spaceId, payerId: userId }) });

      const response = await app.request(`${BASE_URL}/v1/spaces/${spaceId}/projects`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ name: "Quatrième projet" }),
      });

      expect(response.status).toBe(201);
    }));

  it("l'espace invite un membre", () => {
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, userId, spaceId } = await seedFreeSpace(app, db);
        await postPolarWebhook(app, { event: makeSubscriptionEvent({ spaceId, payerId: userId }) });

        const response = await invite(app, { accessToken, spaceId, email: GRACE.email });

        expect(response.status).toBe(201);
        expect(outbox.sent).toHaveLength(1);
      },
      { mailer: outbox.mailer },
    );
  });
});
