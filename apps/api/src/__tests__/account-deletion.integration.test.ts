import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createPostgresDatabase, type PostgresDatabase } from "#db";
import { PASSWORD_CHECK_RATE_LIMIT } from "#modules/identity/infrastructure/better-auth.ts";
import { orphanSpacePurge } from "#modules/space/space-module.ts";
import { replayPendingPolarRequests } from "#modules/subscription/subscription-module.ts";
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
import {
  invite,
  makeOutbox,
  personalSpaceOf,
  switchToTeam,
  tokenOf,
} from "#testing/space-fixtures.ts";
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

const deleteAccount = (
  app: App,
  {
    cookie,
    body,
    ip = makeClientIp(),
  }: { readonly cookie: string; readonly body: object; readonly ip?: string },
) =>
  app.request(`${BASE_URL}/v1/account`, {
    method: "DELETE",
    headers: {
      cookie,
      origin: WEB_URL,
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });

const deleteAccountOf = async (app: App, user: typeof ADA) =>
  deleteAccount(app, {
    cookie: await signInCookie(app, user),
    body: { password: user.password },
  });

const WRONG_PASSWORD = "pas-le-bon-mot-de-passe";

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

        const response = await deleteAccountOf(app, ADA);

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

      await deleteAccountOf(app, ADA);

      const response = await callMcp(app, { token: payer.accessToken, method: "tools/list" });
      expect(response.status).toBe(401);
    }));

  it("la session web du compte supprimé est fermée", () =>
    withIdentityApp(async (app) => {
      await obtainAccessToken(app);
      const cookie = await signInCookie(app, ADA);

      await deleteAccount(app, { cookie, body: { password: ADA.password } });

      const response = await app.request(`${BASE_URL}/v1/account/deletion`, {
        headers: { cookie, origin: WEB_URL },
      });
      expect(response.status).toBe(401);
    }));

  it("l'historique garde les entrées du compte supprimé, et de son IA, sous un membre supprimé", () =>
    withIdentityApp(async (app, db) => {
      const { owner, projectId } = await seedEveryReference(app, db);

      await deleteAccountOf(app, ADA);

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

      await deleteAccountOf(app, ADA);

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

      await deleteAccountOf(app, ADA);
      await deleteAccountOf(app, LINUS);

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

      const response = await deleteAccountOf(app, ADA);

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

      const response = await deleteAccountOf(app, ADA);

      expect(response.status).toBe(204);
      expect(await userExists(db, ada.userId)).toBe(false);
    }));

  it("le seul membre d'un espace supprime son compte, et l'espace reste sans membre", () =>
    withIdentityApp(async (app, db) => {
      const ada = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, ada.userId);

      const response = await deleteAccountOf(app, ADA);

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

  it("le seul membre ouvert d'un espace supprime son compte : plus aucune invitation de l'espace n'existe, et l'invité ne peut plus y entrer (ADR 0051)", () => {
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const ada = await obtainAccessToken(app);
        const spaceId = await personalSpaceOf(db, ada.userId);
        await switchToTeam(db, spaceId);
        const linus = await obtainAccessToken(app, { user: LINUS });
        await seedMember(db, { spaceId, userId: linus.userId, role: "owner" });
        await db.orm
          .update(schema.spaceMember)
          .set({ closedAt: new Date("2026-11-01T10:00:00.000Z"), closedReason: "left" })
          .where(eq(schema.spaceMember.userId, linus.userId));
        await invite(app, { accessToken: ada.accessToken, spaceId, email: LINUS.email });
        await invite(app, { accessToken: ada.accessToken, spaceId, email: GRACE.email });
        const grace = await obtainAccessToken(app, { user: GRACE });

        await deleteAccountOf(app, ADA);

        expect(
          await db.orm
            .select({ id: schema.spaceInvitation.id })
            .from(schema.spaceInvitation)
            .where(eq(schema.spaceInvitation.spaceId, spaceId)),
        ).toEqual([]);
        const accepted = await app.request(
          `${BASE_URL}/v1/invitations/${tokenOf(outbox.sent.at(-1))}/accept`,
          { method: "POST", headers: { authorization: `Bearer ${grace.accessToken}` } },
        );
        expect(accepted.status).toBe(410);
        expect(
          await db.orm
            .select({ userId: schema.spaceMember.userId })
            .from(schema.spaceMember)
            .where(eq(schema.spaceMember.spaceId, spaceId)),
        ).toEqual([{ userId: linus.userId }]);
      },
      { mailer: outbox.mailer },
    );
  });

  it("les invitations d'un espace où il reste un membre ouvert ne sont pas touchées", () => {
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const ada = await obtainAccessToken(app);
        const grace = await obtainAccessToken(app, { user: GRACE });
        const graceSpace = await personalSpaceOf(db, grace.userId);
        await switchToTeam(db, graceSpace);
        await seedMember(db, { spaceId: graceSpace, userId: ada.userId, role: "owner" });
        await invite(app, {
          accessToken: ada.accessToken,
          spaceId: graceSpace,
          email: LINUS.email,
        });

        await deleteAccountOf(app, ADA);

        expect(
          await db.orm
            .select({ email: schema.spaceInvitation.email })
            .from(schema.spaceInvitation)
            .where(eq(schema.spaceInvitation.spaceId, graceSpace)),
        ).toEqual([{ email: LINUS.email }]);
      },
      { mailer: outbox.mailer },
    );
  });

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
      await deleteAccountOf(app, ADA);
      const maintainer = createPostgresDatabase({ url: maintainerUrl });

      try {
        expect(await orphanSpacePurge({ db: maintainer, log: () => undefined })()).toEqual({
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
        headers: {
          authorization: `Bearer ${ada.accessToken}`,
          origin: WEB_URL,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: ADA.password }),
      });

      expect(response.status).toBe(403);
      expect(await userExists(db, ada.userId)).toBe(true);
    }));
});

const attemptsUpToTheLimit = (attempt: () => Response | Promise<Response>) =>
  Array.from({ length: PASSWORD_CHECK_RATE_LIMIT.max }).reduce<Promise<readonly number[]>>(
    async (previous) => [...(await previous), (await attempt()).status],
    Promise.resolve([]),
  );

describe("la suppression du compte demande le mot de passe actuel", () => {
  it("sans mot de passe, la suppression est refusée et le compte reste intact", () =>
    withIdentityApp(async (app, db) => {
      const ada = await obtainAccessToken(app);

      const response = await deleteAccount(app, {
        cookie: await signInCookie(app, ADA),
        body: {},
      });

      expect(response.status).toBe(400);
      expect(await userExists(db, ada.userId)).toBe(true);
    }));

  it("avec un mauvais mot de passe, la suppression est refusée sans renvoyer le mot de passe, et le compte reste intact", () =>
    withIdentityApp(async (app, db) => {
      const ada = await obtainAccessToken(app);

      const response = await deleteAccount(app, {
        cookie: await signInCookie(app, ADA),
        body: { password: WRONG_PASSWORD },
      });

      expect(response.status).toBe(403);
      const problem = await response.text();
      expect(JSON.parse(problem)).toMatchObject({
        type: "https://dezyn.dev/problems/wrong-password",
        title: "Mot de passe incorrect",
        status: 403,
      });
      expect(problem).not.toContain(WRONG_PASSWORD);
      expect(await userExists(db, ada.userId)).toBe(true);
    }));

  it("des essais répétés avec un mauvais mot de passe finissent limités en débit, même avec le bon mot de passe ensuite", () =>
    withIdentityApp(async (app, db) => {
      const ada = await obtainAccessToken(app);
      const cookie = await signInCookie(app, ADA);
      const ip = makeClientIp();

      const statuses = await attemptsUpToTheLimit(() =>
        deleteAccount(app, { cookie, ip, body: { password: WRONG_PASSWORD } }),
      );
      const limited = await deleteAccount(app, { cookie, ip, body: { password: ADA.password } });

      expect(statuses).toEqual(Array(PASSWORD_CHECK_RATE_LIMIT.max).fill(403));
      expect(limited.status).toBe(429);
      expect(await limited.json()).toMatchObject({ title: "Trop d'essais", status: 429 });
      expect(await userExists(db, ada.userId)).toBe(true);
    }));

  it("la limite compte les essais par adresse IP", () =>
    withIdentityApp(async (app, db) => {
      const ada = await obtainAccessToken(app);
      const cookie = await signInCookie(app, ADA);

      await attemptsUpToTheLimit(() =>
        deleteAccount(app, { cookie, ip: makeClientIp(), body: { password: WRONG_PASSWORD } }),
      );
      const response = await deleteAccount(app, { cookie, body: { password: ADA.password } });

      expect(response.status).toBe(204);
      expect(await userExists(db, ada.userId)).toBe(false);
    }));

  it("les essais sur la vérification du mot de passe de better-auth comptent dans la même limite", () =>
    withIdentityApp(async (app, db) => {
      const ada = await obtainAccessToken(app);
      const cookie = await signInCookie(app, ADA);
      const ip = makeClientIp();

      await attemptsUpToTheLimit(() =>
        app.request(`${BASE_URL}/auth/verify-password`, {
          method: "POST",
          headers: {
            cookie,
            origin: WEB_URL,
            "content-type": "application/json",
            "x-forwarded-for": ip,
          },
          body: JSON.stringify({ password: WRONG_PASSWORD }),
        }),
      );
      const limited = await deleteAccount(app, { cookie, ip, body: { password: ADA.password } });

      expect(limited.status).toBe(429);
      expect(await userExists(db, ada.userId)).toBe(true);
    }));

  it("le dernier propriétaire reçoit le même refus 409 quel que soit le mot de passe", () =>
    withIdentityApp(async (app, db) => {
      const ada = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, ada.userId);
      const grace = await obtainAccessToken(app, { user: GRACE });
      await seedMember(db, { spaceId, userId: grace.userId, role: "editor" });
      const cookie = await signInCookie(app, ADA);
      const refusalWith = async (password: string) => {
        const response = await deleteAccount(app, { cookie, body: { password } });
        const { correlationId: _correlationId, ...problem } = await response.json();
        return { status: response.status, problem };
      };

      const wrong = await refusalWith(WRONG_PASSWORD);
      const right = await refusalWith(ADA.password);

      expect(wrong.status).toBe(409);
      expect(wrong).toEqual(right);
      expect(await userExists(db, ada.userId)).toBe(true);
    }));

  it("le mot de passe n'apparaît dans aucun journal, qu'il soit refusé ou accepté", () => {
    const records: unknown[] = [];
    const log = (record: unknown) => {
      records.push(record);
    };
    return withIdentityApp(
      async (app) => {
        await obtainAccessToken(app);
        const cookie = await signInCookie(app, ADA);

        await deleteAccount(app, { cookie, body: { password: WRONG_PASSWORD } });
        await deleteAccount(app, { cookie, body: { password: ADA.password } });

        expect(records.length).toBeGreaterThan(0);
        const logged = JSON.stringify(records);
        expect(logged).not.toContain(WRONG_PASSWORD);
        expect(logged).not.toContain(ADA.password);
      },
      { log, authLog: log, requestLog: log },
    );
  });
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

        await deleteAccountOf(app, ADA);

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

        await deleteAccountOf(app, ADA);
        const replayed = makeMerchantOfRecord();
        await replayPendingPolarRequests({
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

        await deleteAccountOf(app, ADA);

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
      await deleteAccountOf(app, ADA);

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
