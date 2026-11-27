import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  type App,
  BASE_URL,
  callMcp,
  GRACE,
  obtainAccessToken,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { seedModes, seedProject, seedProjectAsEditor } from "#testing/project-fixtures.ts";
import { makeAllSignalsRecorder } from "#testing/project-signals.ts";
import { bytesOfProjectRows, seedStoredBytes, storedBytesOf } from "#testing/project-storage.ts";
import { addToken, historyOf, PRIMARY_BLUE } from "#testing/token-fixtures.ts";
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  PENDING_PROPOSALS_PROBLEM_TYPE,
} from "@repo/contracts";
import { schema } from "@repo/db";

const ADDITION_CORRELATION_ID = "ajout-du-mode-1";

const NIGHT_BLUE = { colorSpace: "srgb", components: [0.1, 0.2, 0.4] };

const PX = (value: number) => ({ value, unit: "px" });

const makeShadow = (color: unknown) => ({
  color,
  offsetX: PX(0),
  offsetY: PX(2),
  blur: PX(4),
  spread: PX(0),
});

const addMode = (
  app: App,
  {
    accessToken,
    projectId,
    body = { name: "contraste-eleve", copiedFrom: "sombre" },
    idempotencyKey,
  }: {
    readonly accessToken: string;
    readonly projectId: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
  },
) =>
  app.request(`${BASE_URL}/v1/projects/${projectId}/modes`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "x-correlation-id": ADDITION_CORRELATION_ID,
      ...(idempotencyKey === undefined ? {} : { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey }),
    },
    body: JSON.stringify(body),
  });

const exportedDocument = async (
  app: App,
  { accessToken, projectId }: { readonly accessToken: string; readonly projectId: string },
) => {
  const response = await app.request(`${BASE_URL}/v1/projects/${projectId}/tokens/export`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return response.json();
};

const tokensOf = async (
  app: App,
  { accessToken, projectId }: { readonly accessToken: string; readonly projectId: string },
) => {
  const response = await app.request(`${BASE_URL}/v1/projects/${projectId}/tokens`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return response.json();
};

const modeNamesOf = async (db: Parameters<typeof seedModes>[0]) =>
  (await db.orm.select({ name: schema.mode.name }).from(schema.mode)).map(({ name }) => name);

const seedModalProject = async (app: App, db: Parameters<typeof seedModes>[0]) => {
  const project = await seedProjectAsEditor(app, db);
  await seedModes(db, { projectId: project.projectId, modes: ["clair", "sombre"] });
  await addToken(app, {
    ...project,
    token: {
      name: "couleur.fond",
      $type: "color",
      modes: { clair: PRIMARY_BLUE, sombre: NIGHT_BLUE },
    },
  });
  await addToken(app, {
    ...project,
    token: {
      name: "couleur.texte",
      $type: "color",
      modes: { clair: NIGHT_BLUE, sombre: "{couleur.fond}" },
      $description: "Texte courant",
    },
  });
  await addToken(app, {
    ...project,
    token: {
      name: "ombre.douce",
      $type: "shadow",
      modes: { clair: makeShadow(NIGHT_BLUE), sombre: makeShadow("{couleur.fond}") },
    },
  });
  return project;
};

const proposeToken = (
  app: App,
  { accessToken, projectId }: { readonly accessToken: string; readonly projectId: string },
) =>
  callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: {
      name: "write_tokens",
      arguments: {
        projectId,
        tokens: [
          {
            name: "bleu",
            $type: "color",
            modes: { clair: PRIMARY_BLUE, sombre: NIGHT_BLUE },
          },
        ],
      },
    },
  });

describe("un membre ajoute un mode à un projet à modes en copiant un mode existant (ADR 0062)", () => {
  it("chaque token validé reçoit la valeur, l'alias ou la référence de champ du mode copié, en dernier mode", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const project = await seedModalProject(app, db);
        await seedStoredBytes(db, {
          projectId: project.projectId,
          bytes: await bytesOfProjectRows(db, project.projectId),
        });
        const before = await exportedDocument(app, project);
        const signalsBefore = recorder.received.length;

        const response = await addMode(app, project);

        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({
          mode: "contraste-eleve",
          copiedFrom: "sombre",
          modes: ["clair", "sombre", "contraste-eleve"],
        });
        const after = await exportedDocument(app, project);
        expect(after.modifiers.apparence).toEqual({
          contexts: {
            ...before.modifiers.apparence.contexts,
            "contraste-eleve": before.modifiers.apparence.contexts.sombre,
          },
          default: "clair",
        });
        expect(Object.keys(after.modifiers.apparence.contexts)).toEqual([
          "clair",
          "sombre",
          "contraste-eleve",
        ]);
        expect((await tokensOf(app, project)).modes).toEqual([
          "clair",
          "sombre",
          "contraste-eleve",
        ]);
        expect(await storedBytesOf(db, project.projectId)).toBe(
          await bytesOfProjectRows(db, project.projectId),
        );
        expect(recorder.since(signalsBefore)).toEqual([
          { projectId: project.projectId, topics: ["history", "tokens"] },
        ]);
      },
      { signals: recorder.signals },
    );
  });

  it("l'ajout laisse une seule entrée mode.added, sans état avant ni entrée par token", () =>
    withIdentityApp(async (app, db) => {
      const project = await seedModalProject(app, db);
      const entriesBefore = await historyOf(app, project);

      await addMode(app, project);

      const entries = await historyOf(app, project);
      expect(entries).toHaveLength(entriesBefore.length + 1);
      expect(entries[0]).toMatchObject({
        action: "mode.added",
        before: null,
        after: { mode: "contraste-eleve", copiedFrom: "sombre" },
        correlationId: ADDITION_CORRELATION_ID,
        author: { kind: "member", userId: project.userId },
        clientId: null,
      });
    }));

  it("le propriétaire ajoute aussi un mode, dans un projet à modes sans token", () =>
    withIdentityApp(async (app, db) => {
      const project = await seedProject(app, db);
      await seedModes(db, { projectId: project.projectId, modes: ["clair"] });

      const response = await addMode(app, {
        ...project,
        body: { name: "  sombre  ", copiedFrom: "clair" },
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ mode: "sombre", modes: ["clair", "sombre"] });
    }));

  it("renvoyé avec la même Idempotency-Key, l'ajout rejoue le 201 sans réécrire", () =>
    withIdentityApp(async (app, db) => {
      const project = await seedModalProject(app, db);
      const request = { ...project, idempotencyKey: randomUUID() };
      const first = await addMode(app, request);
      const firstBody = await first.json();
      const historyAfterFirst = await historyOf(app, project);

      const retried = await addMode(app, request);

      expect(retried.status).toBe(201);
      expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe("true");
      expect(await retried.json()).toEqual(firstBody);
      expect(await historyOf(app, project)).toEqual(historyAfterFirst);
      expect(await modeNamesOf(db)).toHaveLength(3);
    }));
});

describe("l'ajout d'un mode refuse ce qui laisserait un mode incomplet (ADR 0062 §3, §5, §6)", () => {
  it("une proposition en attente répond 400 et renvoie à la relecture des lots, sans rien écrire", () =>
    withIdentityApp(async (app, db) => {
      const project = await seedModalProject(app, db);
      await proposeToken(app, project);
      const historyBefore = await historyOf(app, project);

      const response = await addMode(app, project);

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        type: PENDING_PROPOSALS_PROBLEM_TYPE,
        status: 400,
        errors: [
          {
            path: "modes",
            message:
              "Propositions en attente : relisez les lots en attente avant d'ajouter un mode",
          },
        ],
      });
      expect(await modeNamesOf(db)).toEqual(["clair", "sombre"]);
      expect(await historyOf(app, project)).toEqual(historyBefore);
    }));

  it.each<[string, { readonly name: string; readonly copiedFrom: string }, number, string]>([
    ["un nom vide", { name: "  ", copiedFrom: "sombre" }, 400, "name"],
    ["un nom déjà pris", { name: "clair", copiedFrom: "sombre" }, 409, "name"],
    [
      "un mode à copier inconnu",
      { name: "contraste-eleve", copiedFrom: "nuit" },
      400,
      "copiedFrom",
    ],
  ])("%s est refusé, sans rien écrire", (_case, body, status, path) =>
    withIdentityApp(async (app, db) => {
      const project = await seedModalProject(app, db);

      const response = await addMode(app, { ...project, body });

      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ errors: [expect.objectContaining({ path })] });
      expect(await modeNamesOf(db)).toEqual(["clair", "sombre"]);
    }),
  );

  it("un projet sans modes répond 400, sans créer de mode", () =>
    withIdentityApp(async (app, db) => {
      const project = await seedProject(app, db);

      const response = await addMode(app, {
        ...project,
        body: { name: "sombre", copiedFrom: "clair" },
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        errors: [{ path: "modes", message: "Projet sans modes : aucun mode à copier" }],
      });
      expect(await db.orm.select().from(schema.modifier)).toEqual([]);
    }));

  it("une proposition écrite pendant l'ajout : un seul des deux réussit", () =>
    withIdentityApp(async (app, db) => {
      const project = await seedModalProject(app, db);

      const [added] = await Promise.all([addMode(app, project), proposeToken(app, project)]);
      const proposed = await db.orm.select().from(schema.proposal);

      expect([added.status === 201, proposed.length > 0].filter(Boolean)).toHaveLength(1);
    }));

  it("un non-membre reçoit 404, sans rien écrire", () =>
    withIdentityApp(async (app, db) => {
      const project = await seedModalProject(app, db);
      const grace = await obtainAccessToken(app, { user: GRACE });

      const response = await addMode(app, { ...grace, projectId: project.projectId });

      expect(response.status).toBe(404);
      expect(await modeNamesOf(db)).toEqual(["clair", "sombre"]);
    }));
});
