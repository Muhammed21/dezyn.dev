import { describe, expect, it } from "vitest";

import {
  type App,
  BASE_URL,
  callMcp,
  GRACE,
  obtainAccessToken,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { seedProject, seedProjectAsEditor } from "#testing/project-fixtures.ts";
import { seedPurgeTrace } from "#testing/project-storage.ts";
import { addToken, makeColorToken } from "#testing/token-fixtures.ts";
import { ProjectOutput } from "@repo/contracts";

const PURGED_AT = new Date("2026-11-10T08:00:00.000Z");
const UNKNOWN_PROJECT_ID = "9b8a7f6e-5d4c-4b3a-8f2e-1d0c9b8a7f6e";

const readProject = (
  app: App,
  { accessToken, projectId }: { readonly accessToken: string; readonly projectId: string },
) =>
  app.request(`${BASE_URL}/v1/projects/${projectId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

const declareFigmaStates = async (
  app: App,
  {
    accessToken,
    projectId,
    names,
  }: { readonly accessToken: string; readonly projectId: string; readonly names: string[] },
) => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: {
      name: "declare_figma_states",
      arguments: { projectId, states: names.map((name) => ({ name, state: "synced" })) },
    },
  });
  const { result } = await response.json();
  expect(result.isError).not.toBe(true);
};

const seedProjectWithTokens = async (
  app: App,
  db: Parameters<typeof seedProject>[1],
  names: readonly string[],
) => {
  const seeded = await seedProject(app, db);
  for (const name of names) {
    await addToken(app, { ...seeded, token: makeColorToken({ name }) });
  }
  return seeded;
};

describe("un membre lit un projet seul, avec son espace (ADR 0042 §6)", () => {
  it("un propriétaire lit le nom, l'espace et la date de création d'un projet jamais purgé", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId, spaceId } = await seedProject(app, db);

      const response = await readProject(app, { accessToken, projectId });

      expect(response.status).toBe(200);
      expect(ProjectOutput.parse(await response.json())).toEqual({
        id: projectId,
        spaceId,
        name: "Site vitrine",
        createdAt: expect.any(String),
        historyPurgedAt: null,
        figmaFile: null,
        lastFigmaSurveyAt: null,
      });
    }));

  it("un éditeur lit la date de la dernière purge de l'historique du projet", () =>
    withIdentityApp(async (app, db, { migratorUrl }) => {
      const { accessToken, projectId, spaceId } = await seedProjectAsEditor(app, db);
      await seedPurgeTrace(migratorUrl, {
        projectId,
        purgedBefore: new Date("2026-10-24T13:57:39.007Z"),
        purgedAt: PURGED_AT,
      });

      const response = await readProject(app, { accessToken, projectId });

      expect(await response.json()).toMatchObject({
        id: projectId,
        spaceId,
        historyPurgedAt: PURGED_AT.toISOString(),
      });
    }));

  it("un non-membre, un projet inconnu et un identifiant malformé reçoivent 404", () =>
    withIdentityApp(async (app, db) => {
      const owner = await seedProject(app, db);
      const stranger = await obtainAccessToken(app, { user: GRACE });

      const foreign = await readProject(app, { ...stranger, projectId: owner.projectId });
      const unknown = await readProject(app, { ...owner, projectId: UNKNOWN_PROJECT_ID });
      const malformed = await readProject(app, { ...owner, projectId: "pas-un-uuid" });

      expect([foreign.status, unknown.status, malformed.status]).toEqual([404, 404, 404]);
    }));
});

describe("la lecture du projet rend la date du dernier relevé Figma (ADR 0059 §6)", () => {
  it("un projet dont aucun token n'a été comparé n'a pas de date de dernier relevé", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProjectWithTokens(app, db, ["couleur.fond"]);

      const response = await readProject(app, seeded);

      expect(await response.json()).toMatchObject({ lastFigmaSurveyAt: null });
    }));

  it("la date est celle de la déclaration d'état Figma la plus récente d'un token du projet", () => {
    const clock = { instant: new Date("2026-11-02T09:00:00.000Z") };
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProjectWithTokens(app, db, ["couleur.fond", "couleur.bord"]);
        await declareFigmaStates(app, { ...seeded, names: ["couleur.fond", "couleur.bord"] });
        clock.instant = new Date("2026-11-16T10:30:00.000Z");
        await declareFigmaStates(app, { ...seeded, names: ["couleur.bord"] });

        const response = await readProject(app, seeded);

        expect(await response.json()).toMatchObject({
          lastFigmaSurveyAt: "2026-11-16T10:30:00.000Z",
        });
      },
      { clock: () => clock.instant },
    );
  });

  it("les déclarations d'un autre projet ne comptent pas", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProjectWithTokens(app, db, ["couleur.fond"]);
      const other = await seedProjectAsEditor(app, db, { user: GRACE });
      await addToken(app, { ...other, token: makeColorToken({ name: "couleur.fond" }) });
      await declareFigmaStates(app, { ...other, names: ["couleur.fond"] });

      const response = await readProject(app, seeded);

      expect(await response.json()).toMatchObject({ lastFigmaSurveyAt: null });
    }));
});
