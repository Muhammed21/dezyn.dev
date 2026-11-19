import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import type { HistoryWriter } from "#modules/history/contracts/history-writer.ts";
import {
  type App,
  BASE_URL,
  GRACE,
  obtainAccessToken,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { seedProject, seedProjectAsEditor } from "#testing/project-fixtures.ts";
import { makeAllSignalsRecorder } from "#testing/project-signals.ts";
import { historyOf, makeColorToken } from "#testing/token-fixtures.ts";
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  IdempotencyInProgressProblem,
  IdempotencyKeyReusedProblem,
  InvalidIdempotencyKeyProblem,
} from "@repo/contracts";
import { schema } from "@repo/db";

const addTokenWithKey = (
  app: App,
  {
    accessToken,
    projectId,
    idempotencyKey,
    token = makeColorToken(),
  }: {
    readonly accessToken: string;
    readonly projectId: string;
    readonly idempotencyKey?: string;
    readonly token?: unknown;
  },
) =>
  app.request(`${BASE_URL}/v1/projects/${projectId}/tokens`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(idempotencyKey === undefined ? {} : { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey }),
    },
    body: JSON.stringify(token),
  });

const tokenNamesOf = async (
  app: App,
  { accessToken, projectId }: { readonly accessToken: string; readonly projectId: string },
) => {
  const response = await app.request(`${BASE_URL}/v1/projects/${projectId}/tokens`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const { tokens } = await response.json();
  return tokens.map(({ name }: { name: string }) => name);
};

const createdEntriesOf = async (
  app: App,
  { accessToken, projectId }: { readonly accessToken: string; readonly projectId: string },
) =>
  (await historyOf(app, { accessToken, projectId })).filter(
    ({ action }: { action: string }) => action === "token.created",
  );

const seedOtherProject = async (
  db: PostgresDatabase,
  { spaceId }: { readonly spaceId: string },
) => {
  const projectId = randomUUID();
  await db.orm
    .insert(schema.project)
    .values({ id: projectId, spaceId, name: "Autre site", createdAt: new Date() });
  return projectId;
};

const closeMembership = (
  db: PostgresDatabase,
  { spaceId, userId }: { readonly spaceId: string; readonly userId: string },
) =>
  db.orm
    .update(schema.spaceMember)
    .set({ closedAt: new Date(), closedReason: "removed" })
    .where(
      and(
        eq(schema.spaceMember.spaceId, spaceId),
        eq(schema.spaceMember.userId, userId),
        isNull(schema.spaceMember.closedAt),
      ),
    );

const withoutCorrelation = async (response: Response) => {
  const { correlationId: _correlationId, ...body } = await response.json();
  return { status: response.status, body };
};

const makeLatch = () => {
  const latch = { resolve: () => {} };
  const promise = new Promise<void>((resolve) => {
    latch.resolve = resolve;
  });
  return { promise, resolve: () => latch.resolve() };
};

const makeHistoryGate = () => {
  const reached = makeLatch();
  const released = makeLatch();
  const gate = { pending: true };
  const wrapHistoryWriter = (writer: HistoryWriter): HistoryWriter => ({
    append: async (entries) => {
      if (gate.pending && entries.some(({ action }) => action === "token.created")) {
        gate.pending = false;
        reached.resolve();
        await released.promise;
      }
      return writer.append(entries);
    },
  });
  return { reached: reached.promise, release: released.resolve, wrapHistoryWriter };
};

describe("POST /tokens renvoyé avec la même Idempotency-Key rend le même 201", () => {
  it("rejoue le statut et le corps du premier envoi, signalés par Idempotency-Replayed", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const request = { accessToken, projectId, idempotencyKey: randomUUID() };
      const first = await addTokenWithKey(app, request);
      const firstBody = await first.json();

      const retried = await addTokenWithKey(app, request);

      expect(first.status).toBe(201);
      expect(first.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
      expect(retried.status).toBe(201);
      expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe("true");
      expect(retried.headers.get("content-type")).toBe(first.headers.get("content-type"));
      expect(await retried.json()).toEqual(firstBody);
    }));

  it("ne crée qu'un token, avec une seule entrée d'historique et un seul signal", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const request = { accessToken, projectId, idempotencyKey: randomUUID() };
        await addTokenWithKey(app, request);
        const signalsAfterFirst = recorder.received.length;

        await addTokenWithKey(app, request);

        expect(await tokenNamesOf(app, { accessToken, projectId })).toEqual([
          "couleur.fond.primaire",
        ]);
        expect(await createdEntriesOf(app, { accessToken, projectId })).toHaveLength(1);
        expect(recorder.since(signalsAfterFirst)).toEqual([]);
      },
      { signals: recorder.signals },
    );
  });

  it("rejoue tel quel un premier refus 4xx, sans écrire à la relance", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const request = {
        accessToken,
        projectId,
        idempotencyKey: randomUUID(),
        token: makeColorToken({ name: "couleur..fond" }),
      };
      const first = await addTokenWithKey(app, request);
      const firstBody = await first.json();

      const retried = await addTokenWithKey(app, request);

      expect(first.status).toBe(400);
      expect(retried.status).toBe(400);
      expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe("true");
      expect(retried.headers.get("content-type")).toBe("application/problem+json");
      expect(await retried.json()).toEqual(firstBody);
    }));

  it("ne mémorise pas une erreur serveur : la relance s'exécute et crée le token", () => {
    const history = { failures: 1 };
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const request = { accessToken, projectId, idempotencyKey: randomUUID() };
        const first = await addTokenWithKey(app, request);

        const retried = await addTokenWithKey(app, request);
        const replayed = await addTokenWithKey(app, request);

        expect(first.status).toBe(500);
        expect(retried.status).toBe(201);
        expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
        expect(replayed.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe("true");
        expect(await replayed.json()).toEqual(await retried.json());
      },
      {
        wrapHistoryWriter: (writer) => ({
          append: (entries) => {
            if (history.failures > 0 && entries.some(({ action }) => action === "token.created")) {
              history.failures -= 1;
              return Promise.reject(new Error("historique indisponible"));
            }
            return writer.append(entries);
          },
        }),
      },
    );
  });

  it("traite la même clé sur une autre route comme une nouvelle requête", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId, spaceId } = await seedProject(app, db);
      const otherProjectId = await seedOtherProject(db, { spaceId });
      const idempotencyKey = randomUUID();
      await addTokenWithKey(app, { accessToken, projectId, idempotencyKey });

      const other = await addTokenWithKey(app, {
        accessToken,
        projectId: otherProjectId,
        idempotencyKey,
      });

      expect(other.status).toBe(201);
      expect(other.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
      expect(await tokenNamesOf(app, { accessToken, projectId: otherProjectId })).toEqual([
        "couleur.fond.primaire",
      ]);
    }));

  it("traite la même clé envoyée par un autre membre comme une nouvelle requête", () =>
    withIdentityApp(async (app, db) => {
      const ada = await seedProject(app, db);
      const grace = await obtainAccessToken(app, { user: GRACE });
      await db.orm.insert(schema.spaceMember).values({
        id: randomUUID(),
        spaceId: ada.spaceId,
        userId: grace.userId,
        role: "editor",
        joinedAt: new Date(),
      });
      const idempotencyKey = randomUUID();
      await addTokenWithKey(app, {
        accessToken: ada.accessToken,
        projectId: ada.projectId,
        idempotencyKey,
      });

      const graceCall = await addTokenWithKey(app, {
        accessToken: grace.accessToken,
        projectId: ada.projectId,
        idempotencyKey,
      });

      expect(graceCall.status).toBe(400);
      expect(graceCall.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
      expect(await graceCall.json()).toMatchObject({
        errors: [{ path: "name", message: expect.any(String) }],
      });
    }));

  it.each([
    ["un 201", makeColorToken(), 404],
    ["un refus de validation", makeColorToken({ name: "couleur..fond" }), 400],
  ])(
    "ne rejoue pas %s à un membre retiré de l'espace : il reçoit la réponse d'un envoi sans clé",
    (_, token, status) =>
      withIdentityApp(async (app, db) => {
        const { accessToken, projectId, spaceId, userId } = await seedProjectAsEditor(app, db);
        const request = { accessToken, projectId, idempotencyKey: randomUUID(), token };
        await addTokenWithKey(app, request);
        const whileMember = await addTokenWithKey(app, request);
        await closeMembership(db, { spaceId, userId });
        const withoutKey = await addTokenWithKey(app, { accessToken, projectId, token });

        const retried = await addTokenWithKey(app, request);

        expect(whileMember.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe("true");
        expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
        expect(await withoutCorrelation(retried)).toEqual(await withoutCorrelation(withoutKey));
        expect(retried.status).toBe(status);
      }),
  );

  it("ne rejoue pas l'envoi vers un identifiant de projet invalide : il répond 404 comme sans clé", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken } = await seedProject(app, db);
      const request = { accessToken, projectId: "pas-un-uuid", idempotencyKey: randomUUID() };
      await addTokenWithKey(app, request);

      const retried = await addTokenWithKey(app, request);

      expect(retried.status).toBe(404);
      expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
    }));

  it("sans en-tête, un second envoi est refusé comme aujourd'hui : le nom est déjà pris", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      await addTokenWithKey(app, { accessToken, projectId });

      const second = await addTokenWithKey(app, { accessToken, projectId });

      expect(second.status).toBe(400);
      expect(second.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
    }));
});

describe("une Idempotency-Key mal employée sur POST /tokens est refusée sans rien écrire", () => {
  it("refuse la même clé avec un autre corps par idempotency-key-reused (422)", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const idempotencyKey = randomUUID();
      await addTokenWithKey(app, { accessToken, projectId, idempotencyKey });

      const other = await addTokenWithKey(app, {
        accessToken,
        projectId,
        idempotencyKey,
        token: makeColorToken({ name: "couleur.bord" }),
      });

      expect(other.status).toBe(422);
      expect(other.headers.get("content-type")).toBe("application/problem+json");
      expect(IdempotencyKeyReusedProblem.safeParse(await other.json()).success).toBe(true);
      expect(await tokenNamesOf(app, { accessToken, projectId })).toEqual([
        "couleur.fond.primaire",
      ]);
    }));

  it("refuse un envoi qui arrive pendant le premier par idempotency-in-progress (409)", () => {
    const gate = makeHistoryGate();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const request = { accessToken, projectId, idempotencyKey: randomUUID() };
        const pending = addTokenWithKey(app, request);
        await gate.reached;

        const concurrent = await addTokenWithKey(app, request);
        gate.release();
        const first = await pending;

        expect(concurrent.status).toBe(409);
        expect(IdempotencyInProgressProblem.safeParse(await concurrent.json()).success).toBe(true);
        expect(first.status).toBe(201);
        expect(await createdEntriesOf(app, { accessToken, projectId })).toHaveLength(1);
      },
      { wrapHistoryWriter: gate.wrapHistoryWriter },
    );
  });

  it.each([
    ["vide", ""],
    ["de 256 caractères", "a".repeat(256)],
    ["hors ASCII", "clé"],
  ])("refuse une clé %s par invalid-idempotency-key (400), sans créer le token", (_, key) =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);

      const refused = await addTokenWithKey(app, { accessToken, projectId, idempotencyKey: key });

      expect(refused.status).toBe(400);
      expect(InvalidIdempotencyKeyProblem.safeParse(await refused.json()).success).toBe(true);
      expect(await tokenNamesOf(app, { accessToken, projectId })).toEqual([]);
    }),
  );
});
