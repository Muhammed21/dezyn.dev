import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createPostgresDatabase, type PostgresDatabase } from "#db";
import { orphanSpacePurge } from "#modules/space/space-module.ts";
import { replayPendingCancellations } from "#modules/subscription/subscription-module.ts";
import {
  ADA,
  type App,
  BASE_URL,
  callMcp,
  GRACE,
  makeClientIp,
  obtainAccessToken,
  WEB_URL,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { NOTHING_LEFT, remainsOfSpace } from "#testing/orphan-space-fixtures.ts";
import { invite, makeOutbox, personalSpaceOf } from "#testing/space-fixtures.ts";
import {
  makeMerchantOfRecord,
  makeSubscriptionEvent,
  planChangesOf,
  postPolarWebhook,
  seedEndedSubscription,
  seedMember,
  seedSubscription,
  subscriptionOf,
  WEBHOOK_SECRET,
} from "#testing/subscription-fixtures.ts";
import { addToken, historyOf, makeColorToken } from "#testing/token-fixtures.ts";
import {
  AccountDeletionOutput,
  HistoryOutput,
  IDEMPOTENCY_KEY_HEADER,
  LastOwnerProblem,
  SpaceOutput,
  TokensOutput,
} from "@repo/contracts";
import { schema } from "@repo/db";

const SUBSCRIPTION_ID = "0d3f6a2b-7c1e-4b8a-9f2d-5e6a7b8c9d0e";

const LINUS = {
  name: "Linus Torvalds",
  email: "linus@dezyn.test",
  password: "un-troisieme-mot-de-passe",
};

const signInCookie = async (app: App, user: typeof ADA) => {
  const response = await app.request(`${BASE_URL}/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: BASE_URL,
      "x-forwarded-for": makeClientIp(),
    },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  const [pair = ""] = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
  return pair;
};

const deleteAccount = (app: App, cookie: string) =>
  app.request(`${BASE_URL}/v1/account`, {
    method: "DELETE",
    headers: { cookie, origin: WEB_URL },
  });

const readDeletion = async (app: App, cookie: string) => {
  const response = await app.request(`${BASE_URL}/v1/account/deletion`, {
    headers: { cookie, origin: WEB_URL },
  });
  return AccountDeletionOutput.parse(await response.json());
};

const userExists = async (db: PostgresDatabase, userId: string) =>
  (
    await db.orm
      .select({ id: schema.identityUser.id })
      .from(schema.identityUser)
      .where(eq(schema.identityUser.id, userId))
  ).length === 1;

const readSpace = async (app: App, accessToken: string, spaceId: string) => {
  const response = await app.request(`${BASE_URL}/v1/spaces/${spaceId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return SpaceOutput.parse(await response.json());
};

const createProject = async (
  app: App,
  { accessToken, spaceId }: { readonly accessToken: string; readonly spaceId: string },
) => {
  const response = await app.request(`${BASE_URL}/v1/spaces/${spaceId}/projects`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      [IDEMPOTENCY_KEY_HEADER]: randomUUID(),
    },
    body: JSON.stringify({ name: "Site vitrine" }),
  });
  const { id } = await response.json();
  return String(id);
};

const callTool = (
  app: App,
  { token, name, args }: { readonly token: string; readonly name: string; readonly args: object },
) => callMcp(app, { token, method: "tools/call", params: { name, arguments: args } });

const billingWith = (merchantOfRecord: ReturnType<typeof makeMerchantOfRecord>) => ({
  merchant: merchantOfRecord.merchant,
  webhookSecret: WEBHOOK_SECRET,
});

const seedPaidSpaceWithOwner = async (app: App, db: PostgresDatabase) => {
  const payer = await obtainAccessToken(app);
  const spaceId = await personalSpaceOf(db, payer.userId);
  await seedSubscription(db, { spaceId, payerId: payer.userId });
  const owner = await obtainAccessToken(app, { user: GRACE });
  await seedMember(db, { spaceId, userId: owner.userId, role: "owner" });
  return { payer, owner, spaceId };
};

const seedEveryReference = async (app: App, db: PostgresDatabase) => {
  const { payer, owner, spaceId } = await seedPaidSpaceWithOwner(app, db);
  const projectId = await createProject(app, { accessToken: payer.accessToken, spaceId });
  await addToken(app, {
    accessToken: payer.accessToken,
    projectId,
    token: makeColorToken({ name: "couleur.fond" }),
  });
  await callTool(app, {
    token: payer.accessToken,
    name: "declare_figma_states",
    args: { projectId, states: [{ name: "couleur.fond", state: "synced" }] },
  });
  await callTool(app, {
    token: payer.accessToken,
    name: "write_tokens",
    args: { projectId, tokens: [makeColorToken({ name: "couleur.bord" })] },
  });
  await invite(app, { accessToken: payer.accessToken, spaceId, email: LINUS.email });
  return { payer, owner, spaceId, projectId };
};

describe("un utilisateur supprime son compte (ADR 0015, ADR 0050 §3)", () => {
  it("aucune référence ne bloque la suppression : appartenances, invitations, historique, tokens, propositions, sessions, accès OAuth, clés d'idempotence et abonnement payé", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const { payer, spaceId } = await seedEveryReference(app, db);

        const response = await deleteAccount(app, await signInCookie(app, ADA));

        expect(response.status).toBe(204);
        expect(await userExists(db, payer.userId)).toBe(false);
        expect(
          await db.orm
            .select({ invitedBy: schema.spaceInvitation.invitedBy })
            .from(schema.spaceInvitation),
        ).toEqual([{ invitedBy: null }]);
        expect(
          await db.orm.select({ userId: schema.proposalBatch.userId }).from(schema.proposalBatch),
        ).toEqual([{ userId: null }]);
        expect(await subscriptionOf(db, spaceId)).toMatchObject({
          payerId: null,
          status: "active",
        });
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });

  it("les accès de l'IA autorisée par le compte supprimé sont refusés", () =>
    withIdentityApp(async (app, db) => {
      const { payer } = await seedEveryReference(app, db);

      await deleteAccount(app, await signInCookie(app, ADA));

      const response = await callMcp(app, { token: payer.accessToken, method: "tools/list" });
      expect(response.status).toBe(401);
    }));

  it("la session web du compte supprimé est fermée", () =>
    withIdentityApp(async (app) => {
      await obtainAccessToken(app);
      const cookie = await signInCookie(app, ADA);

      await deleteAccount(app, cookie);

      const response = await app.request(`${BASE_URL}/v1/account/deletion`, {
        headers: { cookie, origin: WEB_URL },
      });
      expect(response.status).toBe(401);
    }));

  it("l'historique garde les entrées du compte supprimé, et de son IA, sous un membre supprimé", () =>
    withIdentityApp(async (app, db) => {
      const { owner, projectId } = await seedEveryReference(app, db);

      await deleteAccount(app, await signInCookie(app, ADA));

      const { entries } = HistoryOutput.parse({
        entries: await historyOf(app, { accessToken: owner.accessToken, projectId }),
        nextCursor: null,
        purgedBefore: null,
      });
      expect(entries.length).toBeGreaterThan(2);
      expect(new Set(entries.map(({ author }) => JSON.stringify(author)))).toEqual(
        new Set([JSON.stringify({ kind: "deleted_member", number: 1 })]),
      );
    }));

  it("l'état Figma déclaré par l'IA du compte supprimé reste, sans nom", () =>
    withIdentityApp(async (app, db) => {
      const { owner, projectId } = await seedEveryReference(app, db);

      await deleteAccount(app, await signInCookie(app, ADA));

      const response = await app.request(`${BASE_URL}/v1/projects/${projectId}/tokens`, {
        headers: { authorization: `Bearer ${owner.accessToken}` },
      });
      const { tokens } = TokensOutput.parse(await response.json());
      expect(tokens.find(({ name }) => name === "couleur.fond")?.figma).toMatchObject({
        state: "synced",
        author: { kind: "deleted_member" },
      });
    }));

  it("le numéro d'un membre supprimé suit les membres déjà supprimés de l'espace, et est propre à chaque espace", () =>
    withIdentityApp(async (app, db) => {
      const ada = await obtainAccessToken(app);
      const grace = await obtainAccessToken(app, { user: GRACE });
      const linus = await obtainAccessToken(app, { user: LINUS });
      const graceSpace = await personalSpaceOf(db, grace.userId);
      const linusSpace = await personalSpaceOf(db, linus.userId);
      await seedMember(db, { spaceId: graceSpace, userId: ada.userId, role: "editor" });
      await seedMember(db, { spaceId: graceSpace, userId: linus.userId, role: "editor" });
      await seedMember(db, { spaceId: linusSpace, userId: grace.userId, role: "owner" });
      const graceProject = await createProject(app, {
        accessToken: grace.accessToken,
        spaceId: graceSpace,
      });
      const linusProject = await createProject(app, {
        accessToken: linus.accessToken,
        spaceId: linusSpace,
      });
      await addToken(app, { accessToken: ada.accessToken, projectId: graceProject });
      await addToken(app, {
        accessToken: linus.accessToken,
        projectId: graceProject,
        token: makeColorToken({ name: "couleur.bord" }),
      });

      await deleteAccount(app, await signInCookie(app, ADA));
      await deleteAccount(app, await signInCookie(app, LINUS));

      const authorsOf = async (projectId: string) =>
        (
          (await historyOf(app, { accessToken: grace.accessToken, projectId })) as {
            author: unknown;
          }[]
        ).map(({ author }) => author);
      expect(await authorsOf(graceProject)).toEqual(
        expect.arrayContaining([
          { kind: "deleted_member", number: 1 },
          { kind: "deleted_member", number: 2 },
        ]),
      );
      expect(await authorsOf(linusProject)).toEqual([{ kind: "deleted_member", number: 1 }]);
    }));

  it("le dernier propriétaire d'un espace qui a d'autres membres ne supprime pas son compte", () =>
    withIdentityApp(async (app, db) => {
      const ada = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, ada.userId);
      const grace = await obtainAccessToken(app, { user: GRACE });
      await seedMember(db, { spaceId, userId: grace.userId, role: "editor" });

      const response = await deleteAccount(app, await signInCookie(app, ADA));

      expect(response.status).toBe(409);
      expect(LastOwnerProblem.parse(await response.json())).toMatchObject({
        title: "Dernier propriétaire d'un espace",
        spaces: [{ id: spaceId, name: expect.any(String) }],
      });
      expect(await userExists(db, ada.userId)).toBe(true);
    }));

  it("un utilisateur qui n'appartient plus à aucun espace supprime son compte", () =>
    withIdentityApp(async (app, db) => {
      const ada = await obtainAccessToken(app);
      await db.orm
        .update(schema.spaceMember)
        .set({ closedAt: new Date("2026-11-01T10:00:00.000Z") })
        .where(eq(schema.spaceMember.userId, ada.userId));

      const response = await deleteAccount(app, await signInCookie(app, ADA));

      expect(response.status).toBe(204);
      expect(await userExists(db, ada.userId)).toBe(false);
    }));

  it("le seul membre d'un espace supprime son compte, et l'espace reste sans membre", () =>
    withIdentityApp(async (app, db) => {
      const ada = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, ada.userId);

      const response = await deleteAccount(app, await signInCookie(app, ADA));

      expect(response.status).toBe(204);
      expect(
        await db.orm
          .select({ id: schema.spaceMember.id })
          .from(schema.spaceMember)
          .where(eq(schema.spaceMember.spaceId, spaceId)),
      ).toEqual([]);
      expect(
        await db.orm
          .select({ id: schema.space.id })
          .from(schema.space)
          .where(eq(schema.space.id, spaceId)),
      ).toEqual([{ id: spaceId }]);
    }));

  it("le seul membre d'un espace avec projets, tokens, historique et abonnement terminé supprime son compte, et la purge suivante ne laisse rien de l'espace (ADR 0051)", () =>
    withIdentityApp(async (app, db, { maintainerUrl }) => {
      const ada = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, ada.userId);
      await seedEndedSubscription(db, { spaceId, payerId: ada.userId });
      const projectId = await createProject(app, { accessToken: ada.accessToken, spaceId });
      await addToken(app, {
        accessToken: ada.accessToken,
        projectId,
        token: makeColorToken({ name: "couleur.fond" }),
      });
      await callTool(app, {
        token: ada.accessToken,
        name: "declare_figma_states",
        args: { projectId, states: [{ name: "couleur.fond", state: "synced" }] },
      });
      await callTool(app, {
        token: ada.accessToken,
        name: "write_tokens",
        args: { projectId, tokens: [makeColorToken({ name: "couleur.bord" })] },
      });
      expect(await remainsOfSpace(db, spaceId)).toMatchObject({
        project: 1,
        token: 1,
        token_figma_state: 1,
        proposal: 1,
        history_entry: 4,
        space_subscription: 1,
      });
      await deleteAccount(app, await signInCookie(app, ADA));
      const maintainer = createPostgresDatabase({ url: maintainerUrl });

      try {
        expect(await orphanSpacePurge({ db: maintainer })()).toEqual({
          purgedSpaces: 1,
          waitingSpaces: 0,
        });
      } finally {
        await maintainer.close();
      }

      expect(await remainsOfSpace(db, spaceId)).toEqual(NOTHING_LEFT);
    }));

  it("une IA ne supprime pas le compte de son utilisateur", () =>
    withIdentityApp(async (app, db) => {
      const ada = await obtainAccessToken(app);

      const response = await app.request(`${BASE_URL}/v1/account`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${ada.accessToken}`, origin: WEB_URL },
      });

      expect(response.status).toBe(403);
      expect(await userExists(db, ada.userId)).toBe(true);
    }));
});

describe("avant de supprimer son compte, l'utilisateur voit ce qui l'en empêche et ce qui sera résilié", () => {
  it("la confirmation nomme les espaces dont il paie l'abonnement, avec la date de fin", () =>
    withIdentityApp(async (app, db) => {
      const { spaceId } = await seedPaidSpaceWithOwner(app, db);

      expect(await readDeletion(app, await signInCookie(app, ADA))).toEqual({
        paidSpaces: [
          { id: spaceId, name: expect.any(String), currentPeriodEnd: "2026-12-22T10:00:00.000Z" },
        ],
        lastOwnerSpaces: [],
      });
    }));

  it("elle annonce une fin à la fin de la période payée quand Polar n'a pas donné de date", () =>
    withIdentityApp(async (app, db) => {
      const { spaceId } = await seedPaidSpaceWithOwner(app, db);
      await db.orm
        .update(schema.spaceSubscription)
        .set({ currentPeriodEnd: null })
        .where(eq(schema.spaceSubscription.spaceId, spaceId));

      expect((await readDeletion(app, await signInCookie(app, ADA))).paidSpaces).toEqual([
        { id: spaceId, name: expect.any(String), currentPeriodEnd: null },
      ]);
    }));

  it("elle nomme les espaces dont il est le dernier propriétaire, avec d'autres membres", () =>
    withIdentityApp(async (app, db) => {
      const ada = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, ada.userId);
      const grace = await obtainAccessToken(app, { user: GRACE });
      await seedMember(db, { spaceId, userId: grace.userId, role: "editor" });
      const graceSpace = await personalSpaceOf(db, grace.userId);
      await seedMember(db, { spaceId: graceSpace, userId: ada.userId, role: "owner" });

      expect(await readDeletion(app, await signInCookie(app, ADA))).toEqual({
        paidSpaces: [],
        lastOwnerSpaces: [{ id: spaceId, name: expect.any(String) }],
      });
    }));

  it("un abonnement déjà terminé n'est pas annoncé", () =>
    withIdentityApp(async (app, db) => {
      const ada = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, ada.userId);
      await db.orm.insert(schema.spaceSubscription).values({
        spaceId,
        polarSubscriptionId: SUBSCRIPTION_ID,
        payerId: ada.userId,
        status: "ended",
        currentPeriodEnd: new Date("2026-12-22T10:00:00.000Z"),
        polarModifiedAt: new Date("2026-11-22T10:00:00.000Z"),
      });

      expect((await readDeletion(app, await signInCookie(app, ADA))).paidSpaces).toEqual([]);
    }));
});

describe("la suppression du payeur résilie chaque abonnement qu'il paie en fin de période (ADR 0050 §3)", () => {
  it("dezyn demande la résiliation à Polar, et l'abonnement reste en place, sans payeur", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(
      async (app, db) => {
        const { owner, spaceId } = await seedPaidSpaceWithOwner(app, db);

        await deleteAccount(app, await signInCookie(app, ADA));

        expect(merchantOfRecord.cancellations).toEqual([
          { spaceId, subscriptionId: SUBSCRIPTION_ID },
        ]);
        expect(await subscriptionOf(db, spaceId)).toMatchObject({ cancelRequestedAt: null });
        const space = await readSpace(app, owner.accessToken, spaceId);
        expect(space.plan).toBe("team");
        expect(space.subscription).toEqual({
          status: "active",
          currentPeriodEnd: "2026-12-22T10:00:00.000Z",
          payer: null,
        });
      },
      { billing: billingWith(merchantOfRecord) },
    );
  });

  it("Polar indisponible : la demande est gardée, puis rejouée", () =>
    withIdentityApp(
      async (app, db) => {
        const { spaceId } = await seedPaidSpaceWithOwner(app, db);

        await deleteAccount(app, await signInCookie(app, ADA));
        const replayed = makeMerchantOfRecord();
        await replayPendingCancellations({
          db,
          merchant: replayed.merchant,
          log: () => undefined,
        })();

        expect(replayed.cancellations).toEqual([{ spaceId, subscriptionId: SUBSCRIPTION_ID }]);
      },
      { billing: billingWith(makeMerchantOfRecord({ available: false })) },
    ));

  it("les propriétaires restants reçoivent un email qui dit que le payeur a supprimé son compte", () => {
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { spaceId } = await seedPaidSpaceWithOwner(app, db);

        await deleteAccount(app, await signInCookie(app, ADA));

        expect(outbox.sent).toEqual([
          {
            to: GRACE.email,
            subject: expect.stringContaining("prend fin le 22 décembre 2026"),
            text: expect.stringContaining(`${ADA.name} a supprimé son compte dezyn.`),
          },
        ]);
        expect(outbox.sent[0]?.text).toContain(`${WEB_URL}/espaces/${spaceId}/plan`);
      },
      { mailer: outbox.mailer },
    );
  });

  it("la résiliation puis la révocation reçues de Polar après la suppression s'appliquent, et l'espace redevient Free", () =>
    withIdentityApp(async (app, db) => {
      const { payer, owner, spaceId } = await seedPaidSpaceWithOwner(app, db);
      await deleteAccount(app, await signInCookie(app, ADA));

      const canceled = await postPolarWebhook(app, {
        event: makeSubscriptionEvent({
          type: "subscription.canceled",
          spaceId,
          payerId: payer.userId,
          cancelAtPeriodEnd: true,
          modifiedAt: new Date("2026-11-23T10:00:00.000Z"),
        }),
      });
      expect(canceled.status).toBe(200);
      expect(await subscriptionOf(db, spaceId)).toMatchObject({
        status: "canceling",
        payerId: null,
      });

      await postPolarWebhook(app, {
        event: makeSubscriptionEvent({
          type: "subscription.revoked",
          spaceId,
          payerId: payer.userId,
          status: "canceled",
          modifiedAt: new Date("2026-12-22T10:00:00.000Z"),
        }),
      });
      expect(await subscriptionOf(db, spaceId)).toMatchObject({ status: "ended", payerId: null });
      expect((await readSpace(app, owner.accessToken, spaceId)).plan).toBe("free");
      expect(await planChangesOf(db, spaceId)).toContainEqual(
        expect.objectContaining({ polarEvent: "subscription.revoked", planAfter: "free" }),
      );
    }));
});
