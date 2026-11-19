import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { type App, BASE_URL, callMcp, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { addToken, historyOf, makeColorToken } from "#testing/token-fixtures.ts";

const INVALID_KEY =
  "invalid_idempotency_key : idempotencyKey compte de 1 à 255 caractères ASCII imprimables.";

const SYNCED = [{ name: "couleur.fond", state: "synced" }];

const MISSING = [{ name: "couleur.fond", state: "missing_in_figma" }];

const declareFigmaStates = async (
  app: App,
  { accessToken, args }: { accessToken: string; args: Readonly<Record<string, unknown>> },
) => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: { name: "declare_figma_states", arguments: args },
  });
  const { result } = await response.json();
  return result;
};

const figmaStateOf = async (
  app: App,
  { accessToken, projectId }: { accessToken: string; projectId: string },
) => {
  const response = await app.request(`${BASE_URL}/v1/projects/${projectId}/tokens`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const { tokens } = await response.json();
  return tokens.map(({ name, figma }: { name: string; figma: { state: string } }) => ({
    name,
    state: figma.state,
  }));
};

const declarationsOf = async (
  app: App,
  { accessToken, projectId }: { accessToken: string; projectId: string },
) =>
  (await historyOf(app, { accessToken, projectId }))
    .filter(({ action }: { action: string }) => action === "mcp.declare_figma_states")
    .map(({ after }: { after: unknown }) => after);

const seedComparedProject = async (app: App, db: Parameters<typeof seedProject>[1]) => {
  const seeded = await seedProject(app, db);
  await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.fond" }) });
  return seeded;
};

describe("declare_figma_states relancé avec la même clé d'idempotence rejoue son premier résultat", () => {
  it("rend la première déclaration, sans remplacer l'état déclaré depuis", () => {
    const clock = { instant: new Date("2026-10-19T09:00:00.000Z") };
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedComparedProject(app, db);
        const args = { projectId, states: SYNCED, idempotencyKey: randomUUID() };
        const first = await declareFigmaStates(app, { accessToken, args });
        clock.instant = new Date("2026-10-19T10:00:00.000Z");
        await declareFigmaStates(app, { accessToken, args: { projectId, states: MISSING } });

        const retried = await declareFigmaStates(app, { accessToken, args });

        expect(first.structuredContent.states).toEqual([
          { name: "couleur.fond", state: "synced", declaredAt: "2026-10-19T09:00:00.000Z" },
        ]);
        expect(retried).toEqual(first);
        expect(await figmaStateOf(app, { accessToken, projectId })).toEqual(MISSING);
      },
      { clock: () => clock.instant },
    );
  });

  it("laisse une seule entrée de succès dans l'historique, puis une entrée marquée comme rejeu", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedComparedProject(app, db);
      const args = { projectId, states: SYNCED, idempotencyKey: randomUUID() };
      await declareFigmaStates(app, { accessToken, args });

      await declareFigmaStates(app, { accessToken, args });

      expect(await declarationsOf(app, { accessToken, projectId })).toEqual([
        { outcome: "replayed", input: { states: SYNCED } },
        { outcome: "success", input: { states: SYNCED } },
      ]);
    }));

  it("rejoue un refus de la déclaration, qui n'est pas une erreur serveur", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedComparedProject(app, db);
      const states = [{ name: "couleur.inconnue", state: "synced" }];
      const args = { projectId, states, idempotencyKey: randomUUID() };
      const first = await declareFigmaStates(app, { accessToken, args });

      const retried = await declareFigmaStates(app, { accessToken, args });

      expect(first.isError).toBe(true);
      expect(retried).toEqual(first);
      expect(await declarationsOf(app, { accessToken, projectId })).toEqual([
        { outcome: "replayed", input: { states } },
        { outcome: "error", input: { states } },
      ]);
    }));

  it("ne mémorise pas un historique indisponible : la relance s'exécute, puis se rejoue", () => {
    const history = { failures: 1 };
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedComparedProject(app, db);
        const args = { projectId, states: SYNCED, idempotencyKey: randomUUID() };
        const first = await declareFigmaStates(app, { accessToken, args });

        const retried = await declareFigmaStates(app, { accessToken, args });
        const replayed = await declareFigmaStates(app, { accessToken, args });

        expect(first).toEqual({
          content: [{ type: "text", text: "Historique indisponible" }],
          isError: true,
        });
        expect(retried.structuredContent.states).toEqual([
          expect.objectContaining({ name: "couleur.fond", state: "synced" }),
        ]);
        expect(replayed).toEqual(retried);
        expect(await declarationsOf(app, { accessToken, projectId })).toEqual([
          { outcome: "replayed", input: { states: SYNCED } },
          { outcome: "success", input: { states: SYNCED } },
        ]);
      },
      {
        wrapHistoryWriter: (writer) => ({
          append: (entries) => {
            if (history.failures > 0 && entries.some(({ action }) => action.startsWith("mcp."))) {
              history.failures -= 1;
              return Promise.reject(new Error("historique indisponible"));
            }
            return writer.append(entries);
          },
        }),
      },
    );
  });

  it("refuse une clé invalide sans rien déclarer, et journalise l'appel en échec", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedComparedProject(app, db);

      const refused = await declareFigmaStates(app, {
        accessToken,
        args: { projectId, states: SYNCED, idempotencyKey: "clé" },
      });

      expect(refused).toEqual({ content: [{ type: "text", text: INVALID_KEY }], isError: true });
      const response = await app.request(`${BASE_URL}/v1/projects/${projectId}/tokens`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const { tokens } = await response.json();
      expect(tokens).toEqual([expect.not.objectContaining({ figma: expect.anything() })]);
      expect(await declarationsOf(app, { accessToken, projectId })).toEqual([
        { outcome: "error", input: { states: SYNCED } },
      ]);
    }));
});
