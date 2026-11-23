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
  makeMerchantOfRecord,
  makeSubscriptionEvent,
  MODIFIED_AT,
  planChangesOf,
  postPolarWebhook,
  refusedSubscriptionsOf,
  seedMember,
  seedRefusedSubscription,
  seedSubscription,
  subscriptionOf,
  WEBHOOK_SECRET,
} from "#testing/subscription-fixtures.ts";
import { SpaceOutput } from "@repo/contracts";

const SUBSCRIPTION_ID = "0d3f6a2b-7c1e-4b8a-9f2d-5e6a7b8c9d0e";

const OTHER_SUBSCRIPTION_ID = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

const SETTLED =
  "polar subscription paid by a user who is not an owner of the space: revoked and refunded";

const DEFERRED =
  "polar subscription paid by a user who is not an owner of the space: revocation or refund left to the replay";

const ALREADY_REFUSED = "polar event for a refused subscription";

const BY_HAND = "refused polar subscription: revoke and refund it by hand in Polar";

const secondsAfter = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);

const makeLog = () => {
  const records: LogRecord[] = [];
  return { records, log: (record: LogRecord) => records.push(record) };
};

const billingWith = (merchantOfRecord: ReturnType<typeof makeMerchantOfRecord>) => ({
  merchant: merchantOfRecord.merchant,
  webhookSecret: WEBHOOK_SECRET,
});

const readSpace = async (
  app: App,
  { accessToken, spaceId }: { readonly accessToken: string; readonly spaceId: string },
) => {
  const response = await app.request(`${BASE_URL}/v1/spaces/${spaceId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return SpaceOutput.parse(await response.json());
};

type MembershipSeed = (
  db: PostgresDatabase,
  membership: { readonly spaceId: string; readonly userId: string },
) => Promise<unknown>;

const seedDemotedOwner: MembershipSeed = async (db, membership) => {
  await seedMember(db, { ...membership, role: "owner", closedAt: secondsAfter(MODIFIED_AT, -60) });
  await seedMember(db, { ...membership, role: "editor" });
};

const seedDepartedOwner: MembershipSeed = (db, membership) =>
  seedMember(db, { ...membership, role: "owner", closedAt: secondsAfter(MODIFIED_AT, -60) });

const seedNoMembership: MembershipSeed = async () => undefined;

const seedOpenOwner: MembershipSeed = (db, membership) =>
  seedMember(db, { ...membership, role: "owner" });

const seedSpaceWithSecondUser = async (
  app: App,
  db: PostgresDatabase,
  seedMembership: MembershipSeed,
) => {
  const ownerToken = await obtainAccessToken(app);
  const owner = { ...ownerToken, spaceId: await personalSpaceOf(db, ownerToken.userId) };
  const other = await obtainAccessToken(app, { user: GRACE });
  await seedMembership(db, { spaceId: owner.spaceId, userId: other.userId });
  return { owner, other };
};

const planOf = async (
  app: App,
  owner: { readonly accessToken: string; readonly spaceId: string },
) => (await readSpace(app, owner)).plan;

describe("un abonnement payé par un non-propriétaire est révoqué et remboursé chez Polar (ADR 0055)", () => {
  it.each([
    ["rendu éditeur", seedDemotedOwner],
    ["parti de l'espace", seedDepartedOwner],
    ["qui n'en est pas membre", seedNoMembership],
  ])(
    "un abonnement payé par un utilisateur %s ne passe pas l'espace Team : Polar le révoque et le rembourse",
    (_case, seedMembership) => {
      const merchantOfRecord = makeMerchantOfRecord();
      const { records, log } = makeLog();
      return withIdentityApp(
        async (app, db) => {
          const { owner, other } = await seedSpaceWithSecondUser(app, db, seedMembership);

          const response = await postPolarWebhook(app, {
            event: makeSubscriptionEvent({ spaceId: owner.spaceId, payerId: other.userId }),
          });

          expect(response.status).toBe(200);
          expect(await planOf(app, owner)).toBe("free");
          expect(await subscriptionOf(db, owner.spaceId)).toBeUndefined();
          expect(await planChangesOf(db, owner.spaceId)).toEqual([]);
          const refusal = { spaceId: owner.spaceId, subscriptionId: SUBSCRIPTION_ID };
          expect(merchantOfRecord.revocations).toEqual([refusal]);
          expect(merchantOfRecord.refunds).toEqual([refusal]);
          expect(records).toContainEqual({
            level: "warn",
            msg: SETTLED,
            event: "subscription.active",
            subscriptionId: SUBSCRIPTION_ID,
            spaceId: owner.spaceId,
            payerId: other.userId,
          });
          expect(records.filter(({ level }) => level === "error")).toEqual([]);
        },
        { billing: billingWith(merchantOfRecord), log },
      );
    },
  );

  it("enregistre le refus : abonnement Polar, espace, payeur, réception, révocation et remboursement faits", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const { owner, other } = await seedSpaceWithSecondUser(app, db, seedDemotedOwner);
        const before = Date.now();

        await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ spaceId: owner.spaceId, payerId: other.userId }),
        });

        const [refused] = await refusedSubscriptionsOf(db, owner.spaceId);
        expect(refused).toMatchObject({
          polarSubscriptionId: SUBSCRIPTION_ID,
          spaceId: owner.spaceId,
          payerId: other.userId,
          settlingSince: null,
        });
        expect(refused?.receivedAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(refused?.revokedAt?.getTime()).toBeGreaterThanOrEqual(before);
        expect(refused?.refundedAt?.getTime()).toBeGreaterThanOrEqual(before);
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });
});

describe("un abonnement refusé n'est révoqué et remboursé qu'une fois (ADR 0055)", () => {
  it("le même événement reçu deux fois ne rembourse qu'une fois, sans seconde ligne d'avertissement", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const { records, log } = makeLog();
    return withIdentityApp(
      async (app, db) => {
        const { owner, other } = await seedSpaceWithSecondUser(app, db, seedDemotedOwner);
        const event = makeSubscriptionEvent({ spaceId: owner.spaceId, payerId: other.userId });

        await postPolarWebhook(app, { event });
        const response = await postPolarWebhook(app, { event });

        expect(response.status).toBe(200);
        expect(merchantOfRecord.revocations).toHaveLength(1);
        expect(merchantOfRecord.refunds).toHaveLength(1);
        expect(await refusedSubscriptionsOf(db, owner.spaceId)).toHaveLength(1);
        expect(records.filter(({ msg }) => msg === SETTLED)).toHaveLength(1);
        expect(records).toContainEqual(
          expect.objectContaining({
            level: "info",
            msg: ALREADY_REFUSED,
            subscriptionId: SUBSCRIPTION_ID,
            spaceId: owner.spaceId,
          }),
        );
      },
      { billing: billingWith(merchantOfRecord), log },
    );
  });

  it("le même événement reçu deux fois en même temps ne rembourse qu'une fois", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const { owner, other } = await seedSpaceWithSecondUser(app, db, seedDemotedOwner);
        const event = makeSubscriptionEvent({ spaceId: owner.spaceId, payerId: other.userId });

        await Promise.all([postPolarWebhook(app, { event }), postPolarWebhook(app, { event })]);

        expect(merchantOfRecord.revocations).toHaveLength(1);
        expect(merchantOfRecord.refunds).toHaveLength(1);
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });

  it.each([
    ["la révocation", { type: "subscription.revoked", status: "canceled" }],
    ["une mise à jour", { type: "subscription.updated", status: "active" }],
  ])("%s qui suit le refus ne rappelle pas Polar et ne change pas le plan", (_case, state) => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const { owner, other } = await seedSpaceWithSecondUser(app, db, seedDemotedOwner);
        await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ spaceId: owner.spaceId, payerId: other.userId }),
        });

        await postPolarWebhook(app, {
          event: makeSubscriptionEvent({
            ...state,
            spaceId: owner.spaceId,
            payerId: other.userId,
            modifiedAt: secondsAfter(MODIFIED_AT, 60),
          }),
        });

        expect(merchantOfRecord.revocations).toHaveLength(1);
        expect(merchantOfRecord.refunds).toHaveLength(1);
        expect(await planOf(app, owner)).toBe("free");
        expect(await subscriptionOf(db, owner.spaceId)).toBeUndefined();
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });

  it("un abonnement refusé ne passe pas l'espace Team, même si son payeur redevient propriétaire", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const { owner, other } = await seedSpaceWithSecondUser(app, db, seedDepartedOwner);
        await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ spaceId: owner.spaceId, payerId: other.userId }),
        });
        await seedOpenOwner(db, { spaceId: owner.spaceId, userId: other.userId });

        await postPolarWebhook(app, {
          event: makeSubscriptionEvent({
            type: "subscription.updated",
            spaceId: owner.spaceId,
            payerId: other.userId,
            modifiedAt: secondsAfter(MODIFIED_AT, 60),
          }),
        });

        expect(await planOf(app, owner)).toBe("free");
        expect(await subscriptionOf(db, owner.spaceId)).toBeUndefined();
        expect(merchantOfRecord.refunds).toHaveLength(1);
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });
});

describe("un refus que Polar n'a pas reçu est rejoué par la tâche planifiée (ADR 0055)", () => {
  it("Polar indisponible au webhook : le refus reste à faire, et s'avertit sans erreur", () => {
    const { records, log } = makeLog();
    return withIdentityApp(
      async (app, db) => {
        const { owner, other } = await seedSpaceWithSecondUser(app, db, seedDemotedOwner);

        const response = await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ spaceId: owner.spaceId, payerId: other.userId }),
        });

        expect(response.status).toBe(200);
        expect(await refusedSubscriptionsOf(db, owner.spaceId)).toEqual([
          expect.objectContaining({ revokedAt: null, refundedAt: null, settlingSince: null }),
        ]);
        expect(records).toContainEqual(
          expect.objectContaining({
            level: "warn",
            msg: DEFERRED,
            subscriptionId: SUBSCRIPTION_ID,
            spaceId: owner.spaceId,
          }),
        );
        expect(records.filter(({ level }) => level === "error")).not.toContainEqual(
          expect.objectContaining({ msg: BY_HAND }),
        );
      },
      { billing: billingWith(makeMerchantOfRecord({ available: false })), log },
    );
  });

  it("la tâche planifiée révoque et rembourse quand Polar répond, puis plus jamais", () =>
    withIdentityApp(
      async (app, db) => {
        const { owner, other } = await seedSpaceWithSecondUser(app, db, seedDemotedOwner);
        await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ spaceId: owner.spaceId, payerId: other.userId }),
        });
        const polar = makeMerchantOfRecord();
        const { records, log } = makeLog();

        await replayPendingPolarRequests({ db, merchant: polar.merchant, log })();
        await replayPendingPolarRequests({ db, merchant: polar.merchant, log })();

        const refusal = { spaceId: owner.spaceId, subscriptionId: SUBSCRIPTION_ID };
        expect(polar.revocations).toEqual([refusal]);
        expect(polar.refunds).toEqual([refusal]);
        expect(await refusedSubscriptionsOf(db, owner.spaceId)).toEqual([
          expect.objectContaining({ revokedAt: expect.any(Date), refundedAt: expect.any(Date) }),
        ]);
        expect(records).toContainEqual({ level: "warn", msg: SETTLED, ...refusal });
        expect(records.filter(({ level }) => level === "error")).toEqual([]);
        expect(records).toContainEqual({
          level: "info",
          msg: "polar_refusal_replay_pass",
          settled: 1,
          pending: 0,
        });
      },
      { billing: billingWith(makeMerchantOfRecord({ available: false })) },
    ));

  it("la tâche planifiée ne refait pas une révocation déjà faite, seulement le remboursement", () =>
    withIdentityApp(
      async (app, db) => {
        const { owner, other } = await seedSpaceWithSecondUser(app, db, seedDemotedOwner);
        await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ spaceId: owner.spaceId, payerId: other.userId }),
        });
        const polar = makeMerchantOfRecord();

        await replayPendingPolarRequests({ db, merchant: polar.merchant, log: () => undefined })();

        expect(polar.revocations).toEqual([]);
        expect(polar.refunds).toEqual([
          { spaceId: owner.spaceId, subscriptionId: SUBSCRIPTION_ID },
        ]);
        expect(await refusedSubscriptionsOf(db, owner.spaceId)).toEqual([
          expect.objectContaining({ revokedAt: expect.any(Date), refundedAt: expect.any(Date) }),
        ]);
      },
      { billing: billingWith(makeMerchantOfRecord({ refundAvailable: false })) },
    ));

  it("Polar encore indisponible à la tâche planifiée : l'erreur dit quoi faire à la main", () =>
    withIdentityApp(
      async (app, db) => {
        const { owner, other } = await seedSpaceWithSecondUser(app, db, seedDemotedOwner);
        await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ spaceId: owner.spaceId, payerId: other.userId }),
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
          spaceId: owner.spaceId,
          subscriptionId: SUBSCRIPTION_ID,
          revoked: false,
          refunded: false,
        });
        expect(records).toContainEqual({
          level: "info",
          msg: "polar_refusal_replay_pass",
          settled: 0,
          pending: 1,
        });
        expect(records.filter(({ msg }) => msg === SETTLED)).toEqual([]);
        expect(await refusedSubscriptionsOf(db, owner.spaceId)).toEqual([
          expect.objectContaining({ revokedAt: null, refundedAt: null, settlingSince: null }),
        ]);
      },
      { billing: billingWith(makeMerchantOfRecord({ available: false })) },
    ));

  it("la tâche planifiée ne refait pas un remboursement déjà fait, seulement la révocation", () =>
    withIdentityApp(
      async (app, db) => {
        const { owner, other } = await seedSpaceWithSecondUser(app, db, seedDemotedOwner);
        await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ spaceId: owner.spaceId, payerId: other.userId }),
        });
        const polar = makeMerchantOfRecord();

        await replayPendingPolarRequests({ db, merchant: polar.merchant, log: () => undefined })();

        expect(polar.refunds).toEqual([]);
        expect(polar.revocations).toEqual([
          { spaceId: owner.spaceId, subscriptionId: SUBSCRIPTION_ID },
        ]);
        expect(await refusedSubscriptionsOf(db, owner.spaceId)).toEqual([
          expect.objectContaining({ revokedAt: expect.any(Date), refundedAt: expect.any(Date) }),
        ]);
      },
      { billing: billingWith(makeMerchantOfRecord({ revokeAvailable: false })) },
    ));

  it("une révocation faite et un remboursement encore impossible restent une erreur qui dit où on en est", () =>
    withIdentityApp(
      async (app, db) => {
        const { owner, other } = await seedSpaceWithSecondUser(app, db, seedDemotedOwner);
        await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ spaceId: owner.spaceId, payerId: other.userId }),
        });
        const { records, log } = makeLog();

        await replayPendingPolarRequests({
          db,
          merchant: makeMerchantOfRecord({ refundAvailable: false }).merchant,
          log,
        })();

        expect(records).toContainEqual({
          level: "error",
          msg: BY_HAND,
          spaceId: owner.spaceId,
          subscriptionId: SUBSCRIPTION_ID,
          revoked: true,
          refunded: false,
        });
        expect(records.filter(({ msg }) => msg === SETTLED)).toEqual([]);
      },
      { billing: billingWith(makeMerchantOfRecord({ refundAvailable: false })) },
    ));
});

const minutesBefore = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);

describe("un seul exécutant traite un refus à la fois, pendant cinq minutes au plus (ADR 0055)", () => {
  it("un refus réservé il y a une minute n'est pas repris par la tâche planifiée", () =>
    withIdentityApp(async (app, db) => {
      const { owner, other } = await seedSpaceWithSecondUser(app, db, seedDemotedOwner);
      await seedRefusedSubscription(db, {
        spaceId: owner.spaceId,
        payerId: other.userId,
        settlingSince: minutesBefore(1),
      });
      const polar = makeMerchantOfRecord();

      await replayPendingPolarRequests({ db, merchant: polar.merchant, log: () => undefined })();

      expect(polar.revocations).toEqual([]);
      expect(polar.refunds).toEqual([]);
    }));

  it("un refus réservé il y a six minutes est repris par la tâche planifiée", () =>
    withIdentityApp(async (app, db) => {
      const { owner, other } = await seedSpaceWithSecondUser(app, db, seedDemotedOwner);
      await seedRefusedSubscription(db, {
        spaceId: owner.spaceId,
        payerId: other.userId,
        settlingSince: minutesBefore(6),
      });
      const polar = makeMerchantOfRecord();

      await replayPendingPolarRequests({ db, merchant: polar.merchant, log: () => undefined })();

      expect(polar.refunds).toEqual([{ spaceId: owner.spaceId, subscriptionId: SUBSCRIPTION_ID }]);
    }));

  it("un webhook rejoué pendant qu'un autre exécutant traite le refus ne rappelle pas Polar", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const { records, log } = makeLog();
    return withIdentityApp(
      async (app, db) => {
        const { owner, other } = await seedSpaceWithSecondUser(app, db, seedDemotedOwner);
        await seedRefusedSubscription(db, {
          spaceId: owner.spaceId,
          payerId: other.userId,
          settlingSince: minutesBefore(1),
        });

        const response = await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ spaceId: owner.spaceId, payerId: other.userId }),
        });

        expect(response.status).toBe(200);
        expect(merchantOfRecord.revocations).toEqual([]);
        expect(merchantOfRecord.refunds).toEqual([]);
        expect(records).toContainEqual(
          expect.objectContaining({ level: "info", msg: ALREADY_REFUSED }),
        );
      },
      { billing: billingWith(merchantOfRecord), log },
    );
  });
});

describe("le refus ne touche jamais l'abonnement d'un propriétaire ni l'abonnement enregistré (ADR 0055)", () => {
  it("un abonnement payé par un propriétaire passe l'espace Team, sans révocation ni remboursement", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const { records, log } = makeLog();
    return withIdentityApp(
      async (app, db) => {
        const { owner, other } = await seedSpaceWithSecondUser(app, db, seedOpenOwner);

        await postPolarWebhook(app, {
          event: makeSubscriptionEvent({ spaceId: owner.spaceId, payerId: other.userId }),
        });

        expect(await planOf(app, owner)).toBe("team");
        expect(await subscriptionOf(db, owner.spaceId)).toMatchObject({ payerId: other.userId });
        expect(merchantOfRecord.revocations).toEqual([]);
        expect(merchantOfRecord.refunds).toEqual([]);
        expect(await refusedSubscriptionsOf(db, owner.spaceId)).toEqual([]);
        expect(records.filter(({ level }) => level !== "info")).toEqual([]);
      },
      { billing: billingWith(merchantOfRecord), log },
    );
  });

  it.each([
    ["la révocation", { type: "subscription.revoked", status: "canceled" }, "free"],
    ["le renouvellement", { type: "subscription.updated", status: "active" }, "team"],
  ] as const)(
    "%s d'un abonnement enregistré s'applique sans rien demander à Polar, même si son payeur n'est plus propriétaire",
    (_case, state, plan) => {
      const merchantOfRecord = makeMerchantOfRecord();
      return withIdentityApp(
        async (app, db) => {
          const { owner, other } = await seedSpaceWithSecondUser(app, db, seedDemotedOwner);
          await seedSubscription(db, { spaceId: owner.spaceId, payerId: other.userId });

          await postPolarWebhook(app, {
            event: makeSubscriptionEvent({
              ...state,
              spaceId: owner.spaceId,
              payerId: other.userId,
              currentPeriodEnd: new Date("2027-01-22T10:00:00.000Z"),
              modifiedAt: secondsAfter(MODIFIED_AT, 60),
            }),
          });

          expect(await planOf(app, owner)).toBe(plan);
          expect(await subscriptionOf(db, owner.spaceId)).toMatchObject({
            polarSubscriptionId: SUBSCRIPTION_ID,
            payerId: other.userId,
            polarModifiedAt: secondsAfter(MODIFIED_AT, 60),
          });
          expect(merchantOfRecord.revocations).toEqual([]);
          expect(merchantOfRecord.refunds).toEqual([]);
          expect(await refusedSubscriptionsOf(db, owner.spaceId)).toEqual([]);
        },
        { billing: billingWith(merchantOfRecord) },
      );
    },
  );

  it("un second abonnement payé par un non-propriétaire, quand un autre est en cours, n'est ni révoqué ni remboursé", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const { owner, other } = await seedSpaceWithSecondUser(app, db, seedDemotedOwner);
        await seedSubscription(db, { spaceId: owner.spaceId, payerId: owner.userId });

        await postPolarWebhook(app, {
          event: makeSubscriptionEvent({
            spaceId: owner.spaceId,
            payerId: other.userId,
            subscriptionId: OTHER_SUBSCRIPTION_ID,
            modifiedAt: secondsAfter(MODIFIED_AT, 60),
          }),
        });

        expect(merchantOfRecord.revocations).toEqual([]);
        expect(merchantOfRecord.refunds).toEqual([]);
        expect(await subscriptionOf(db, owner.spaceId)).toMatchObject({
          polarSubscriptionId: SUBSCRIPTION_ID,
        });
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });

  it("un abonnement dont le payeur n'est pas un utilisateur n'est ni révoqué ni remboursé", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const { owner } = await seedSpaceWithSecondUser(app, db, seedNoMembership);

        await postPolarWebhook(app, {
          event: makeSubscriptionEvent({
            spaceId: owner.spaceId,
            payerId: "3e1d2c4b-5a69-4788-9a0b-1c2d3e4f5a6b",
          }),
        });

        expect(merchantOfRecord.revocations).toEqual([]);
        expect(merchantOfRecord.refunds).toEqual([]);
        expect(await refusedSubscriptionsOf(db, owner.spaceId)).toEqual([]);
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });
});
