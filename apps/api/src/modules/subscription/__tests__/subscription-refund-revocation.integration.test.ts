import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import { replayPendingPolarRequests } from "#modules/subscription/subscription-module.ts";
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
  FULL_REFUND,
  makeMerchantOfRecord,
  makeOrderEvent,
  makeRefundEvent,
  makeSubscriptionEvent,
  MODIFIED_AT,
  PARTIAL_REFUND,
  postPolarWebhook,
  refundRevocationsOf,
  seedEndedSubscription,
  seedMember,
  seedRefundRevocation,
  seedRefusedSubscription,
  seedSubscription,
  WEBHOOK_SECRET,
} from "#testing/subscription-fixtures.ts";
import { SpaceOutput } from "@repo/contracts";

const SUBSCRIPTION_ID = "0d3f6a2b-7c1e-4b8a-9f2d-5e6a7b8c9d0e";

const OTHER_SUBSCRIPTION_ID = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

const ORDER_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";

const REVOKED = "polar order fully refunded: subscription revoked";

const DEFERRED = "polar order fully refunded: revocation left to the replay";

const NOT_REVOCABLE = "polar order fully refunded: no subscription of a space to revoke";

const KEPT = "polar refund that keeps the subscription";

const BY_HAND = "fully refunded polar order: revoke the subscription by hand in Polar";

const secondsAfter = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);

const minutesBefore = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);

const makeLog = () => {
  const records: LogRecord[] = [];
  return { records, log: (record: LogRecord) => records.push(record) };
};

const billingWith = (merchantOfRecord: ReturnType<typeof makeMerchantOfRecord>) => ({
  merchant: merchantOfRecord.merchant,
  webhookSecret: WEBHOOK_SECRET,
});

const planOf = async (
  app: App,
  { accessToken, spaceId }: { readonly accessToken: string; readonly spaceId: string },
) => {
  const response = await app.request(`${BASE_URL}/v1/spaces/${spaceId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return SpaceOutput.parse(await response.json()).plan;
};

const seedOwnerSpace = async (app: App, db: PostgresDatabase) => {
  const owner = await obtainAccessToken(app);
  return { ...owner, spaceId: await personalSpaceOf(db, owner.userId) };
};

const seedSpacePaidByOwner = async (
  app: App,
  db: PostgresDatabase,
  status: "active" | "canceling" | "past_due" = "active",
) => {
  const owner = await seedOwnerSpace(app, db);
  await seedSubscription(db, { spaceId: owner.spaceId, payerId: owner.userId, status });
  return owner;
};

describe("un remboursement total de la commande d'un abonnement enregistré le révoque chez Polar (ADR 0058)", () => {
  it("Polar révoque l'abonnement, puis sa révocation repasse l'espace en Free", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const { records, log } = makeLog();
    return withIdentityApp(
      async (app, db) => {
        const owner = await seedSpacePaidByOwner(app, db);

        const response = await postPolarWebhook(app, {
          event: makeOrderEvent({ spaceId: owner.spaceId, ...FULL_REFUND }),
        });

        expect(response.status).toBe(200);
        expect(merchantOfRecord.revocations).toEqual([
          { spaceId: owner.spaceId, subscriptionId: SUBSCRIPTION_ID },
        ]);
        expect(await planOf(app, owner)).toBe("team");
        expect(records).toContainEqual({
          level: "warn",
          msg: REVOKED,
          orderId: ORDER_ID,
          subscriptionId: SUBSCRIPTION_ID,
          spaceId: owner.spaceId,
        });
        expect(records.filter(({ level }) => level === "error")).toEqual([]);

        await postPolarWebhook(app, {
          event: makeSubscriptionEvent({
            type: "subscription.revoked",
            status: "canceled",
            spaceId: owner.spaceId,
            payerId: owner.userId,
            modifiedAt: secondsAfter(MODIFIED_AT, 60),
          }),
        });

        expect(await planOf(app, owner)).toBe("free");
      },
      { billing: billingWith(merchantOfRecord), log },
    );
  });

  it.each(["canceling", "past_due"] as const)(
    "un abonnement enregistré au statut %s est révoqué aussi",
    (status) => {
      const merchantOfRecord = makeMerchantOfRecord();
      return withIdentityApp(
        async (app, db) => {
          const owner = await seedSpacePaidByOwner(app, db, status);

          await postPolarWebhook(app, {
            event: makeOrderEvent({ spaceId: owner.spaceId, ...FULL_REFUND }),
          });

          expect(merchantOfRecord.revocations).toEqual([
            { spaceId: owner.spaceId, subscriptionId: SUBSCRIPTION_ID },
          ]);
        },
        { billing: billingWith(merchantOfRecord) },
      );
    },
  );

  it("enregistre la révocation : abonnement Polar, espace, commande, réception et révocation faite", () =>
    withIdentityApp(
      async (app, db) => {
        const owner = await seedSpacePaidByOwner(app, db);
        const before = Date.now();

        await postPolarWebhook(app, {
          event: makeOrderEvent({ spaceId: owner.spaceId, ...FULL_REFUND }),
        });

        const [revocation] = await refundRevocationsOf(db, owner.spaceId);
        expect(revocation).toMatchObject({
          polarSubscriptionId: SUBSCRIPTION_ID,
          spaceId: owner.spaceId,
          polarOrderId: ORDER_ID,
          settlingSince: null,
        });
        expect(revocation?.receivedAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(revocation?.revokedAt?.getTime()).toBeGreaterThanOrEqual(before);
      },
      { billing: billingWith(makeMerchantOfRecord()) },
    ));

  it("un abonnement payé par un propriétaire qui n'est plus payeur ni membre est révoqué aussi : le remboursement suffit", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const owner = await seedOwnerSpace(app, db);
        const payer = await obtainAccessToken(app, { user: GRACE });
        await seedMember(db, { spaceId: owner.spaceId, userId: payer.userId, role: "editor" });
        await seedSubscription(db, { spaceId: owner.spaceId, payerId: payer.userId });

        await postPolarWebhook(app, {
          event: makeOrderEvent({ spaceId: owner.spaceId, ...FULL_REFUND }),
        });

        expect(merchantOfRecord.revocations).toEqual([
          { spaceId: owner.spaceId, subscriptionId: SUBSCRIPTION_ID },
        ]);
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });
});

describe("un abonnement payé par un propriétaire n'est jamais révoqué sans remboursement total (ADR 0058)", () => {
  it("un remboursement partiel garde l'abonnement et l'espace en Team, et se journalise", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const { records, log } = makeLog();
    return withIdentityApp(
      async (app, db) => {
        const owner = await seedSpacePaidByOwner(app, db);

        const response = await postPolarWebhook(app, {
          event: makeOrderEvent({ spaceId: owner.spaceId, ...PARTIAL_REFUND }),
        });

        expect(response.status).toBe(200);
        expect(merchantOfRecord.revocations).toEqual([]);
        expect(await refundRevocationsOf(db, owner.spaceId)).toEqual([]);
        expect(await planOf(app, owner)).toBe("team");
        expect(records).toContainEqual({
          level: "info",
          msg: KEPT,
          orderId: ORDER_ID,
          subscriptionId: SUBSCRIPTION_ID,
          orderStatus: PARTIAL_REFUND.status,
        });
      },
      { billing: billingWith(merchantOfRecord), log },
    );
  });

  it("un remboursement partiel puis le reste : seul le remboursement qui rend la commande remboursée en entier révoque", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const owner = await seedSpacePaidByOwner(app, db);

        await postPolarWebhook(app, {
          event: makeOrderEvent({ spaceId: owner.spaceId, ...PARTIAL_REFUND }),
        });
        expect(merchantOfRecord.revocations).toEqual([]);

        await postPolarWebhook(app, {
          event: makeOrderEvent({ spaceId: owner.spaceId, ...FULL_REFUND }),
        });
        expect(merchantOfRecord.revocations).toHaveLength(1);
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });

  it.each([
    [
      "un remboursement créé, en attente",
      makeRefundEvent({ type: "refund.created", status: "pending" }),
    ],
    [
      "un remboursement réussi, annoncé par refund.updated",
      makeRefundEvent({ type: "refund.updated", status: "succeeded" }),
    ],
    ["un remboursement échoué", makeRefundEvent({ type: "refund.updated", status: "failed" })],
  ])("%s ne révoque rien : seul order.refunded compte", (_case, event) => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const owner = await seedSpacePaidByOwner(app, db);

        const response = await postPolarWebhook(app, { event });

        expect(response.status).toBe(200);
        expect(merchantOfRecord.revocations).toEqual([]);
        expect(await planOf(app, owner)).toBe("team");
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });

  it.each(["order.paid", "order.updated", "order.created"])(
    "un événement %s d'une commande remboursée en entier ne révoque rien",
    (type) => {
      const merchantOfRecord = makeMerchantOfRecord();
      return withIdentityApp(
        async (app, db) => {
          const owner = await seedSpacePaidByOwner(app, db);

          await postPolarWebhook(app, {
            event: makeOrderEvent({ type, spaceId: owner.spaceId, ...FULL_REFUND }),
          });

          expect(merchantOfRecord.revocations).toEqual([]);
          expect(await planOf(app, owner)).toBe("team");
        },
        { billing: billingWith(merchantOfRecord) },
      );
    },
  );
});

describe("un remboursement total qui ne vise pas l'abonnement en cours d'un espace ne révoque rien (ADR 0058)", () => {
  it("une commande hors abonnement se journalise sans rien révoquer", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const { records, log } = makeLog();
    return withIdentityApp(
      async (app, db) => {
        const owner = await seedSpacePaidByOwner(app, db);

        await postPolarWebhook(app, {
          event: makeOrderEvent({ spaceId: owner.spaceId, subscriptionId: null, ...FULL_REFUND }),
        });

        expect(merchantOfRecord.revocations).toEqual([]);
        expect(await refundRevocationsOf(db, owner.spaceId)).toEqual([]);
        expect(records).toContainEqual({
          level: "info",
          msg: KEPT,
          orderId: ORDER_ID,
          subscriptionId: undefined,
          orderStatus: FULL_REFUND.status,
        });
      },
      { billing: billingWith(merchantOfRecord), log },
    );
  });

  it("un abonnement inconnu de dezyn se journalise sans rien révoquer", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const { records, log } = makeLog();
    return withIdentityApp(
      async (app, db) => {
        const owner = await seedSpacePaidByOwner(app, db);

        await postPolarWebhook(app, {
          event: makeOrderEvent({
            spaceId: owner.spaceId,
            subscriptionId: OTHER_SUBSCRIPTION_ID,
            ...FULL_REFUND,
          }),
        });

        expect(merchantOfRecord.revocations).toEqual([]);
        expect(await planOf(app, owner)).toBe("team");
        expect(records).toContainEqual({
          level: "info",
          msg: NOT_REVOCABLE,
          orderId: ORDER_ID,
          subscriptionId: OTHER_SUBSCRIPTION_ID,
        });
      },
      { billing: billingWith(merchantOfRecord), log },
    );
  });

  it("un abonnement déjà terminé n'est pas révoqué une seconde fois", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const owner = await seedOwnerSpace(app, db);
        await seedEndedSubscription(db, { spaceId: owner.spaceId, payerId: owner.userId });

        await postPolarWebhook(app, {
          event: makeOrderEvent({ spaceId: owner.spaceId, ...FULL_REFUND }),
        });

        expect(merchantOfRecord.revocations).toEqual([]);
        expect(await refundRevocationsOf(db, owner.spaceId)).toEqual([]);
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });

  it("un abonnement refusé (ADR 0055), remboursé par dezyn, n'est pas révoqué une seconde fois", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const owner = await seedOwnerSpace(app, db);
        const other = await obtainAccessToken(app, { user: GRACE });
        await seedRefusedSubscription(db, { spaceId: owner.spaceId, payerId: other.userId });

        await postPolarWebhook(app, {
          event: makeOrderEvent({ spaceId: owner.spaceId, ...FULL_REFUND }),
        });

        expect(merchantOfRecord.revocations).toEqual([]);
        expect(await refundRevocationsOf(db, owner.spaceId)).toEqual([]);
        expect(await planOf(app, owner)).toBe("free");
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });

  it("un remboursement total signé sans statut de commande reçoit 400", () =>
    withIdentityApp(
      async (app, db) => {
        const owner = await seedSpacePaidByOwner(app, db);
        const event = makeOrderEvent({ spaceId: owner.spaceId, ...FULL_REFUND });

        const response = await postPolarWebhook(app, {
          event: { ...event, data: { ...event.data, status: undefined } },
        });

        expect(response.status).toBe(400);
      },
      { billing: billingWith(makeMerchantOfRecord()) },
    ));
});

describe("un remboursement total ne révoque l'abonnement qu'une fois (ADR 0058)", () => {
  it("le même webhook reçu deux fois ne révoque qu'une fois, sans second avertissement", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const { records, log } = makeLog();
    return withIdentityApp(
      async (app, db) => {
        const owner = await seedSpacePaidByOwner(app, db);
        const event = makeOrderEvent({ spaceId: owner.spaceId, ...FULL_REFUND });

        await postPolarWebhook(app, { event });
        const response = await postPolarWebhook(app, { event });

        expect(response.status).toBe(200);
        expect(merchantOfRecord.revocations).toHaveLength(1);
        expect(await refundRevocationsOf(db, owner.spaceId)).toHaveLength(1);
        expect(records.filter(({ msg }) => msg === REVOKED)).toHaveLength(1);
        expect(records).toContainEqual({
          level: "info",
          msg: NOT_REVOCABLE,
          orderId: ORDER_ID,
          subscriptionId: SUBSCRIPTION_ID,
        });
      },
      { billing: billingWith(merchantOfRecord), log },
    );
  });

  it("le même webhook reçu deux fois en même temps ne révoque qu'une fois", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const owner = await seedSpacePaidByOwner(app, db);
        const event = makeOrderEvent({ spaceId: owner.spaceId, ...FULL_REFUND });

        await Promise.all([postPolarWebhook(app, { event }), postPolarWebhook(app, { event })]);

        expect(merchantOfRecord.revocations).toHaveLength(1);
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });

  it("la tâche planifiée ne rappelle pas Polar pour une révocation déjà faite", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const owner = await seedSpacePaidByOwner(app, db);
        await postPolarWebhook(app, {
          event: makeOrderEvent({ spaceId: owner.spaceId, ...FULL_REFUND }),
        });
        const polar = makeMerchantOfRecord();

        await replayPendingPolarRequests({ db, merchant: polar.merchant, log: () => undefined })();

        expect(polar.revocations).toEqual([]);
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });
});

describe("une révocation que Polar n'a pas reçue est rejouée par la tâche planifiée (ADR 0058)", () => {
  it("Polar indisponible au webhook : la révocation reste à faire, et s'avertit sans erreur", () => {
    const { records, log } = makeLog();
    return withIdentityApp(
      async (app, db) => {
        const owner = await seedSpacePaidByOwner(app, db);

        const response = await postPolarWebhook(app, {
          event: makeOrderEvent({ spaceId: owner.spaceId, ...FULL_REFUND }),
        });

        expect(response.status).toBe(200);
        expect(await refundRevocationsOf(db, owner.spaceId)).toEqual([
          expect.objectContaining({ revokedAt: null, settlingSince: null }),
        ]);
        expect(records).toContainEqual({
          level: "warn",
          msg: DEFERRED,
          orderId: ORDER_ID,
          subscriptionId: SUBSCRIPTION_ID,
          spaceId: owner.spaceId,
        });
        expect(records.filter(({ level }) => level === "error")).not.toContainEqual(
          expect.objectContaining({ msg: BY_HAND }),
        );
      },
      { billing: billingWith(makeMerchantOfRecord({ available: false })), log },
    );
  });

  it("la tâche planifiée révoque quand Polar répond, puis plus jamais", () =>
    withIdentityApp(
      async (app, db) => {
        const owner = await seedSpacePaidByOwner(app, db);
        await postPolarWebhook(app, {
          event: makeOrderEvent({ spaceId: owner.spaceId, ...FULL_REFUND }),
        });
        const polar = makeMerchantOfRecord();
        const { records, log } = makeLog();

        await replayPendingPolarRequests({ db, merchant: polar.merchant, log })();
        await replayPendingPolarRequests({ db, merchant: polar.merchant, log })();

        const revocation = { spaceId: owner.spaceId, subscriptionId: SUBSCRIPTION_ID };
        expect(polar.revocations).toEqual([revocation]);
        expect(await refundRevocationsOf(db, owner.spaceId)).toEqual([
          expect.objectContaining({ revokedAt: expect.any(Date), settlingSince: null }),
        ]);
        expect(records).toContainEqual({
          level: "warn",
          msg: REVOKED,
          orderId: ORDER_ID,
          ...revocation,
        });
        expect(records.filter(({ level }) => level === "error")).toEqual([]);
        expect(records).toContainEqual({
          level: "info",
          msg: "polar_refund_revocation_replay_pass",
          revoked: 1,
          pending: 0,
        });
      },
      { billing: billingWith(makeMerchantOfRecord({ available: false })) },
    ));

  it("Polar encore indisponible à la tâche planifiée : l'erreur dit quoi faire à la main", () =>
    withIdentityApp(
      async (app, db) => {
        const owner = await seedSpacePaidByOwner(app, db);
        await postPolarWebhook(app, {
          event: makeOrderEvent({ spaceId: owner.spaceId, ...FULL_REFUND }),
        });
        const { records, log } = makeLog();

        await replayPendingPolarRequests({
          db,
          merchant: makeMerchantOfRecord({ available: false }).merchant,
          log,
        })();

        expect(records).toContainEqual({
          level: "error",
          msg: BY_HAND,
          orderId: ORDER_ID,
          spaceId: owner.spaceId,
          subscriptionId: SUBSCRIPTION_ID,
        });
        expect(records).toContainEqual({
          level: "info",
          msg: "polar_refund_revocation_replay_pass",
          revoked: 0,
          pending: 1,
        });
        expect(records.filter(({ msg }) => msg === REVOKED)).toEqual([]);
        expect(await refundRevocationsOf(db, owner.spaceId)).toEqual([
          expect.objectContaining({ revokedAt: null, settlingSince: null }),
        ]);
      },
      { billing: billingWith(makeMerchantOfRecord({ available: false })) },
    ));
});

describe("un seul exécutant révoque à la fois, pendant cinq minutes au plus (ADR 0058)", () => {
  it("une révocation réservée il y a une minute n'est pas reprise par la tâche planifiée", () =>
    withIdentityApp(async (app, db) => {
      const owner = await seedSpacePaidByOwner(app, db);
      await seedRefundRevocation(db, {
        spaceId: owner.spaceId,
        settlingSince: minutesBefore(1),
      });
      const polar = makeMerchantOfRecord();
      const { records, log } = makeLog();

      await replayPendingPolarRequests({ db, merchant: polar.merchant, log })();

      expect(polar.revocations).toEqual([]);
      expect(records).toContainEqual({
        level: "info",
        msg: "polar_refund_revocation_replay_pass",
        revoked: 0,
        pending: 1,
      });
    }));

  it("une révocation réservée il y a six minutes est reprise par la tâche planifiée", () =>
    withIdentityApp(async (app, db) => {
      const owner = await seedSpacePaidByOwner(app, db);
      await seedRefundRevocation(db, {
        spaceId: owner.spaceId,
        settlingSince: minutesBefore(6),
      });
      const polar = makeMerchantOfRecord();

      await replayPendingPolarRequests({ db, merchant: polar.merchant, log: () => undefined })();

      expect(polar.revocations).toEqual([
        { spaceId: owner.spaceId, subscriptionId: SUBSCRIPTION_ID },
      ]);
    }));
});
