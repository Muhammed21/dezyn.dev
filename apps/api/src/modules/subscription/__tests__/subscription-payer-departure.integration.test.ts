import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import type { LogRecord } from "#platform/logging.ts";
import {
  ADA,
  type App,
  BASE_URL,
  GRACE,
  obtainAccessToken,
  WEB_URL,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { makeOutbox, membershipsOf, personalSpaceOf } from "#testing/space-fixtures.ts";
import {
  makeMerchantOfRecord,
  seedMember,
  seedSubscription,
  subscriptionOf,
  WEBHOOK_SECRET,
} from "#testing/subscription-fixtures.ts";
import { SpaceOutput } from "@repo/contracts";
import { err } from "@repo/result";

const SUBSCRIPTION_ID = "0d3f6a2b-7c1e-4b8a-9f2d-5e6a7b8c9d0e";

const LINUS = {
  name: "Linus Torvalds",
  email: "linus@dezyn.test",
  password: "un-troisieme-mot-de-passe",
};

const leave = (
  app: App,
  { accessToken, spaceId }: { readonly accessToken: string; readonly spaceId: string },
) =>
  app.request(`${BASE_URL}/v1/spaces/${spaceId}/members/me`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
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

const seedPaidSpaceWithOwner = async (
  app: App,
  db: PostgresDatabase,
  { status }: { readonly status?: "active" | "canceling" | "past_due" } = {},
) => {
  const payer = await obtainAccessToken(app);
  const spaceId = await personalSpaceOf(db, payer.userId);
  await seedSubscription(db, { spaceId, payerId: payer.userId, status });
  const owner = await obtainAccessToken(app, { user: GRACE });
  await seedMember(db, { spaceId, userId: owner.userId, role: "owner" });
  return { payer, owner, spaceId };
};

const billingWith = (merchantOfRecord: ReturnType<typeof makeMerchantOfRecord>) => ({
  merchant: merchantOfRecord.merchant,
  webhookSecret: WEBHOOK_SECRET,
});

describe("le départ du payeur résilie l'abonnement en fin de période (ADR 0050 §3)", () => {
  it("le payeur qui quitte l'espace demande à Polar la résiliation, et l'espace reste Team", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const outbox = makeOutbox();
    const records: LogRecord[] = [];
    return withIdentityApp(
      async (app, db) => {
        const { payer, owner, spaceId } = await seedPaidSpaceWithOwner(app, db);

        const response = await leave(app, { accessToken: payer.accessToken, spaceId });

        expect(response.status).toBe(204);
        expect(merchantOfRecord.cancellations).toEqual([
          { spaceId, subscriptionId: SUBSCRIPTION_ID },
        ]);
        expect(await subscriptionOf(db, spaceId)).toMatchObject({ status: "active" });
        expect((await readSpace(app, { accessToken: owner.accessToken, spaceId })).plan).toBe(
          "team",
        );
        expect(outbox.sent).toHaveLength(1);
        expect(records.filter(({ level }) => level === "error")).toEqual([]);
      },
      {
        billing: billingWith(merchantOfRecord),
        mailer: outbox.mailer,
        log: (record) => records.push(record),
      },
    );
  });

  it("le payeur d'un abonnement déjà résilié part sans nouvelle demande, et prévient les propriétaires", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { payer, spaceId } = await seedPaidSpaceWithOwner(app, db, { status: "canceling" });

        await leave(app, { accessToken: payer.accessToken, spaceId });

        expect(merchantOfRecord.cancellations).toEqual([]);
        expect(outbox.sent.map(({ to }) => to)).toEqual([GRACE.email]);
      },
      { billing: billingWith(merchantOfRecord), mailer: outbox.mailer },
    );
  });

  it("les autres propriétaires, et eux seuls, reçoivent un email qui annonce la fin", () => {
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { payer, spaceId } = await seedPaidSpaceWithOwner(app, db);
        const editor = await obtainAccessToken(app, { user: LINUS });
        await seedMember(db, { spaceId, userId: editor.userId, role: "editor" });

        await leave(app, { accessToken: payer.accessToken, spaceId });

        expect(outbox.sent).toEqual([
          {
            to: GRACE.email,
            subject: expect.stringContaining("prend fin le 22 décembre 2026"),
            text: expect.stringContaining(`${WEB_URL}/espaces/${spaceId}/plan`),
          },
        ]);
        expect(outbox.sent[0]?.text).toContain(`${ADA.name} a quitté l'espace`);
      },
      { mailer: outbox.mailer },
    );
  });

  it("un autre propriétaire voit sur la page « Plan » que le payeur est parti", () =>
    withIdentityApp(async (app, db) => {
      const { payer, owner, spaceId } = await seedPaidSpaceWithOwner(app, db);

      await leave(app, { accessToken: payer.accessToken, spaceId });

      expect(
        (await readSpace(app, { accessToken: owner.accessToken, spaceId })).subscription?.payer,
      ).toEqual({ name: ADA.name, email: ADA.email, you: false, left: true });
    }));

  it("le payeur encore membre n'est pas parti", () =>
    withIdentityApp(async (app, db) => {
      const { owner, spaceId } = await seedPaidSpaceWithOwner(app, db);

      expect(
        (await readSpace(app, { accessToken: owner.accessToken, spaceId })).subscription?.payer,
      ).toMatchObject({ left: false });
    }));

  it("un propriétaire qui ne paie pas part sans toucher l'abonnement ni prévenir personne", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { owner, spaceId } = await seedPaidSpaceWithOwner(app, db);
        const before = await subscriptionOf(db, spaceId);

        const response = await leave(app, { accessToken: owner.accessToken, spaceId });

        expect(response.status).toBe(204);
        expect(merchantOfRecord.cancellations).toEqual([]);
        expect(outbox.sent).toEqual([]);
        expect(await subscriptionOf(db, spaceId)).toEqual(before);
      },
      { billing: billingWith(merchantOfRecord), mailer: outbox.mailer },
    );
  });

  it("un payeur qui ne peut pas partir ne demande aucune résiliation", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const payer = await obtainAccessToken(app);
        const spaceId = await personalSpaceOf(db, payer.userId);
        await seedSubscription(db, { spaceId, payerId: payer.userId });

        const response = await leave(app, { accessToken: payer.accessToken, spaceId });

        expect(response.status).toBe(409);
        expect(merchantOfRecord.cancellations).toEqual([]);
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });

  it("Polar indisponible ne bloque pas le départ : la demande à rejouer se journalise", () => {
    const merchantOfRecord = makeMerchantOfRecord({ available: false });
    const outbox = makeOutbox();
    const records: LogRecord[] = [];
    return withIdentityApp(
      async (app, db) => {
        const { payer, spaceId } = await seedPaidSpaceWithOwner(app, db);

        const response = await leave(app, { accessToken: payer.accessToken, spaceId });

        expect(response.status).toBe(204);
        expect(await membershipsOf(db, { spaceId, userId: payer.userId })).toEqual([
          expect.objectContaining({ closedReason: "left" }),
        ]);
        expect(records).toContainEqual({
          level: "error",
          msg: "payer departure: cancel the subscription at period end by hand in Polar",
          spaceId,
          subscriptionId: SUBSCRIPTION_ID,
        });
        expect(outbox.sent).toHaveLength(1);
      },
      {
        billing: billingWith(merchantOfRecord),
        mailer: outbox.mailer,
        log: (record) => records.push(record),
      },
    );
  });

  it("un email qui ne part pas ne bloque pas le départ, et se journalise", () => {
    const records: LogRecord[] = [];
    return withIdentityApp(
      async (app, db) => {
        const { payer, spaceId } = await seedPaidSpaceWithOwner(app, db);

        const response = await leave(app, { accessToken: payer.accessToken, spaceId });

        expect(response.status).toBe(204);
        expect(records).toContainEqual({
          level: "error",
          msg: "payer_departure_notice_unsent",
          spaceId,
          to: GRACE.email,
          error: "mail_unavailable",
        });
      },
      {
        mailer: { send: async () => err("mail_unavailable") },
        log: (record) => records.push(record),
      },
    );
  });
});

const removeMember = (
  app: App,
  {
    accessToken,
    spaceId,
    memberId,
  }: { readonly accessToken: string; readonly spaceId: string; readonly memberId: string },
) =>
  app.request(`${BASE_URL}/v1/spaces/${spaceId}/members/${memberId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });

const changeRole = (
  app: App,
  {
    accessToken,
    spaceId,
    memberId,
    role = "editor",
  }: {
    readonly accessToken: string;
    readonly spaceId: string;
    readonly memberId: string;
    readonly role?: "owner" | "editor";
  },
) =>
  app.request(`${BASE_URL}/v1/spaces/${spaceId}/members/${memberId}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });

describe("le payeur retiré par un autre propriétaire part comme s'il quittait l'espace (ADR 0050 §3)", () => {
  it("le retrait du payeur demande la résiliation et prévient les propriétaires restants, sans le payeur", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { payer, owner, spaceId } = await seedPaidSpaceWithOwner(app, db);

        const response = await removeMember(app, {
          accessToken: owner.accessToken,
          spaceId,
          memberId: payer.userId,
        });

        expect(response.status).toBe(204);
        expect(merchantOfRecord.cancellations).toEqual([
          { spaceId, subscriptionId: SUBSCRIPTION_ID },
        ]);
        expect(outbox.sent.map(({ to }) => to)).toEqual([GRACE.email]);
        expect(await subscriptionOf(db, spaceId)).toMatchObject({ cancelRequestedAt: null });
      },
      { billing: billingWith(merchantOfRecord), mailer: outbox.mailer },
    );
  });

  it("l'email du retrait dit que le payeur a quitté l'espace", () => {
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { payer, owner, spaceId } = await seedPaidSpaceWithOwner(app, db);

        await removeMember(app, {
          accessToken: owner.accessToken,
          spaceId,
          memberId: payer.userId,
        });

        expect(outbox.sent).toEqual([
          expect.objectContaining({
            text: expect.stringContaining(`${ADA.name} a quitté l'espace`),
          }),
        ]);
      },
      { mailer: outbox.mailer },
    );
  });

  it("Polar indisponible au retrait d'un éditeur qui paie : l'intention de résiliation reste enregistrée", () => {
    const merchantOfRecord = makeMerchantOfRecord({ available: false });
    return withIdentityApp(
      async (app, db) => {
        const owner = await obtainAccessToken(app);
        const spaceId = await personalSpaceOf(db, owner.userId);
        const editor = await obtainAccessToken(app, { user: LINUS });
        await seedMember(db, { spaceId, userId: editor.userId, role: "editor" });
        await seedSubscription(db, { spaceId, payerId: editor.userId });

        const response = await removeMember(app, {
          accessToken: owner.accessToken,
          spaceId,
          memberId: editor.userId,
        });

        expect(response.status).toBe(204);
        expect((await subscriptionOf(db, spaceId))?.cancelRequestedAt).toBeInstanceOf(Date);
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });

  it("le retrait d'un propriétaire qui ne paie pas ne touche pas l'abonnement", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { payer, owner, spaceId } = await seedPaidSpaceWithOwner(app, db);
        const before = await subscriptionOf(db, spaceId);

        await removeMember(app, {
          accessToken: payer.accessToken,
          spaceId,
          memberId: owner.userId,
        });

        expect(merchantOfRecord.cancellations).toEqual([]);
        expect(outbox.sent).toEqual([]);
        expect(await subscriptionOf(db, spaceId)).toEqual(before);
      },
      { billing: billingWith(merchantOfRecord), mailer: outbox.mailer },
    );
  });

  it("un retrait refusé ne demande aucune résiliation", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const { payer, spaceId } = await seedPaidSpaceWithOwner(app, db);

        const response = await removeMember(app, {
          accessToken: payer.accessToken,
          spaceId,
          memberId: payer.userId,
        });

        expect(response.status).toBe(409);
        expect(merchantOfRecord.cancellations).toEqual([]);
        expect(await subscriptionOf(db, spaceId)).toMatchObject({ cancelRequestedAt: null });
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });
});

describe("le payeur rendu éditeur part comme s'il quittait l'espace (ADR 0050 §3)", () => {
  it("rendre le payeur éditeur demande la résiliation et prévient les autres propriétaires, sans le payeur", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const outbox = makeOutbox();
    const records: LogRecord[] = [];
    return withIdentityApp(
      async (app, db) => {
        const { payer, owner, spaceId } = await seedPaidSpaceWithOwner(app, db);

        const response = await changeRole(app, {
          accessToken: owner.accessToken,
          spaceId,
          memberId: payer.userId,
        });

        expect(response.status).toBe(200);
        expect(merchantOfRecord.cancellations).toEqual([
          { spaceId, subscriptionId: SUBSCRIPTION_ID },
        ]);
        expect(outbox.sent).toEqual([
          {
            to: GRACE.email,
            subject: expect.stringContaining("prend fin le 22 décembre 2026"),
            text: expect.stringContaining(`${ADA.name} n'est plus propriétaire de l'espace`),
          },
        ]);
        expect(await subscriptionOf(db, spaceId)).toMatchObject({
          status: "active",
          cancelRequestedAt: null,
        });
        expect((await readSpace(app, { accessToken: owner.accessToken, spaceId })).plan).toBe(
          "team",
        );
        expect(records.filter(({ level }) => level === "error")).toEqual([]);
      },
      {
        billing: billingWith(merchantOfRecord),
        mailer: outbox.mailer,
        log: (record) => records.push(record),
      },
    );
  });

  it("Polar indisponible ne bloque pas la rétrogradation : l'intention reste à rejouer, et se journalise", () => {
    const merchantOfRecord = makeMerchantOfRecord({ available: false });
    const records: LogRecord[] = [];
    return withIdentityApp(
      async (app, db) => {
        const { payer, owner, spaceId } = await seedPaidSpaceWithOwner(app, db);

        const response = await changeRole(app, {
          accessToken: owner.accessToken,
          spaceId,
          memberId: payer.userId,
        });

        expect(response.status).toBe(200);
        expect(await membershipsOf(db, { spaceId, userId: payer.userId })).toEqual(
          expect.arrayContaining([expect.objectContaining({ role: "editor", closedAt: null })]),
        );
        expect(await subscriptionOf(db, spaceId)).toMatchObject({
          cancelRequestedAt: expect.any(Date),
        });
        expect(records).toContainEqual({
          level: "error",
          msg: "payer departure: cancel the subscription at period end by hand in Polar",
          spaceId,
          subscriptionId: SUBSCRIPTION_ID,
        });
      },
      { billing: billingWith(merchantOfRecord), log: (record) => records.push(record) },
    );
  });

  it("rendre éditeur un propriétaire qui ne paie pas ne résilie rien et ne prévient personne", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { payer, owner, spaceId } = await seedPaidSpaceWithOwner(app, db);
        const before = await subscriptionOf(db, spaceId);

        const response = await changeRole(app, {
          accessToken: payer.accessToken,
          spaceId,
          memberId: owner.userId,
        });

        expect(response.status).toBe(200);
        expect(merchantOfRecord.cancellations).toEqual([]);
        expect(outbox.sent).toEqual([]);
        expect(await subscriptionOf(db, spaceId)).toEqual(before);
      },
      { billing: billingWith(merchantOfRecord), mailer: outbox.mailer },
    );
  });

  it("rendre propriétaire un éditeur qui paie l'abonnement ne le résilie pas", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const owner = await obtainAccessToken(app);
        const spaceId = await personalSpaceOf(db, owner.userId);
        const editor = await obtainAccessToken(app, { user: LINUS });
        await seedMember(db, { spaceId, userId: editor.userId, role: "editor" });
        await seedSubscription(db, { spaceId, payerId: editor.userId });
        const before = await subscriptionOf(db, spaceId);

        const response = await changeRole(app, {
          accessToken: owner.accessToken,
          spaceId,
          memberId: editor.userId,
          role: "owner",
        });

        expect(response.status).toBe(200);
        expect(merchantOfRecord.cancellations).toEqual([]);
        expect(outbox.sent).toEqual([]);
        expect(await subscriptionOf(db, spaceId)).toEqual(before);
      },
      { billing: billingWith(merchantOfRecord), mailer: outbox.mailer },
    );
  });

  it("redemander le rôle éditeur pour un payeur déjà rétrogradé ne redemande rien et ne prévient personne", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { payer, owner, spaceId } = await seedPaidSpaceWithOwner(app, db);
        const demotion = { accessToken: owner.accessToken, spaceId, memberId: payer.userId };
        await changeRole(app, demotion);

        const response = await changeRole(app, demotion);

        expect(response.status).toBe(200);
        expect(merchantOfRecord.cancellations).toHaveLength(1);
        expect(outbox.sent).toHaveLength(1);
      },
      { billing: billingWith(merchantOfRecord), mailer: outbox.mailer },
    );
  });

  it("redemander le rôle propriétaire pour le payeur, déjà propriétaire, ne résilie rien", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { payer, owner, spaceId } = await seedPaidSpaceWithOwner(app, db);

        const response = await changeRole(app, {
          accessToken: owner.accessToken,
          spaceId,
          memberId: payer.userId,
          role: "owner",
        });

        expect(response.status).toBe(200);
        expect(merchantOfRecord.cancellations).toEqual([]);
        expect(outbox.sent).toEqual([]);
      },
      { billing: billingWith(merchantOfRecord), mailer: outbox.mailer },
    );
  });

  it("une rétrogradation refusée ne demande aucune résiliation", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const payer = await obtainAccessToken(app);
        const spaceId = await personalSpaceOf(db, payer.userId);
        await seedSubscription(db, { spaceId, payerId: payer.userId });

        const response = await changeRole(app, {
          accessToken: payer.accessToken,
          spaceId,
          memberId: payer.userId,
        });

        expect(response.status).toBe(409);
        expect(merchantOfRecord.cancellations).toEqual([]);
        expect(await subscriptionOf(db, spaceId)).toMatchObject({ cancelRequestedAt: null });
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });
});
