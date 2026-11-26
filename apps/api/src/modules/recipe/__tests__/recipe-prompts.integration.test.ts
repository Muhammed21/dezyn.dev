import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import {
  ADA,
  type App,
  BASE_URL,
  callMcp,
  GRACE,
  obtainAccessToken,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { schema } from "@repo/db";

const CORRELATION_ID = "recette-obtenue-1";

const FIGMA_KEY = "aB3dE5fG7hI9jK1lM3nO5p";

const FIGMA_URL = `https://www.figma.com/design/${FIGMA_KEY}/Design-system`;

const UNKNOWN_PROJECT_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";

const RELEVE_DAY = new Date("2026-12-01T08:00:00Z");

const getPrompt = async (
  app: App,
  { token, name, args }: { token: string; name: string; args: object },
) => {
  const response = await callMcp(app, {
    token,
    method: "prompts/get",
    params: { name, arguments: args },
    correlationId: CORRELATION_ID,
  });
  return response.json();
};

const getReleveFigma = (app: App, { token, projectId }: { token: string; projectId: string }) =>
  getPrompt(app, { token, name: "releve_figma", args: { projectId } });

const recipeTextOf = (reply: {
  result: { messages: readonly { content: { text: string } }[] };
}): string => reply.result.messages.map(({ content }) => content.text).join("\n");

const setFigmaFile = (
  app: App,
  { token, projectId, url }: { token: string; projectId: string; url: string },
) =>
  callMcp(app, {
    token,
    method: "tools/call",
    params: { name: "set_project_figma_file", arguments: { projectId, url } },
  });

const historyByApi = async (
  app: App,
  { accessToken, projectId }: { accessToken: string; projectId: string },
) => {
  const response = await app.request(`${BASE_URL}/v1/projects/${projectId}/history`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return response.json();
};

const actionsOf = async (db: PostgresDatabase, projectId: string) =>
  (
    await db.orm
      .select({ action: schema.historyEntry.action })
      .from(schema.historyEntry)
      .where(eq(schema.historyEntry.projectId, projectId))
  ).map(({ action }) => action);

describe("le MCP de dezyn sert ses recettes en prompts (ADR 0059 §1)", () => {
  it("déclare la capacité prompts", () =>
    withIdentityApp(async (app) => {
      const { accessToken } = await obtainAccessToken(app);

      const initialize = await callMcp(app, {
        token: accessToken,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      });

      expect(await initialize.json()).toMatchObject({
        result: { capabilities: { prompts: expect.any(Object) } },
      });
    }));

  it("prompts/list liste releve_figma, avec son titre, sa description et le projet en paramètre requis", () =>
    withIdentityApp(async (app) => {
      const { accessToken } = await obtainAccessToken(app);

      const response = await callMcp(app, { token: accessToken, method: "prompts/list" });

      expect(await response.json()).toMatchObject({
        result: {
          prompts: expect.arrayContaining([
            expect.objectContaining({
              name: "releve_figma",
              title: "Relevé Figma",
              description:
                "Relevé Figma d'un projet : compare le fichier Figma du projet à ses tokens, déclare l'état Figma de chaque token comparé et, seulement s'il y a du nouveau, ouvre un seul lot de propositions à relire.",
              arguments: [expect.objectContaining({ name: "projectId", required: true })],
            }),
          ]),
        },
      });
    }));
});

describe("prompts/get rend la recette du bilan de santé pour un projet (spec #425)", () => {
  it("prompts/list la liste, et prompts/get la rend pour le projet en entrant dans son historique", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);

      const listed = await (
        await callMcp(app, { token: accessToken, method: "prompts/list" })
      ).json();
      const reply = await getPrompt(app, {
        token: accessToken,
        name: "bilan_sante",
        args: { projectId },
      });

      expect(listed.result.prompts).toContainEqual(
        expect.objectContaining({
          name: "bilan_sante",
          title: "Bilan de santé",
          arguments: [expect.objectContaining({ name: "projectId", required: true })],
        }),
      );
      expect(recipeTextOf(reply)).toContain(projectId);
      expect(recipeTextOf(reply)).toContain("check_contrast");
      expect((await historyByApi(app, { accessToken, projectId })).entries[0]).toMatchObject({
        action: "mcp.bilan_sante",
        after: { outcome: "success", input: {} },
        correlationId: CORRELATION_ID,
      });
    }));

  it("refuse un projet inconnu, sans entrée d'historique", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken } = await seedProject(app, db);

      const reply = await getPrompt(app, {
        token: accessToken,
        name: "bilan_sante",
        args: { projectId: UNKNOWN_PROJECT_ID },
      });

      expect(reply).toMatchObject({
        error: { message: expect.stringContaining("Projet introuvable") },
      });
      expect(await db.orm.select().from(schema.historyEntry)).toHaveLength(1);
    }));
});

describe("prompts/get rend la recette du relevé Figma pour un projet (ADR 0059 §5)", () => {
  it("avec le lien et la clé du fichier Figma du projet", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      await setFigmaFile(app, { token: accessToken, projectId, url: FIGMA_URL });

      const reply = await getReleveFigma(app, { token: accessToken, projectId });
      const text = recipeTextOf(reply);

      expect(reply.result).toMatchObject({
        messages: [{ role: "user", content: { type: "text" } }],
      });
      expect(text).toContain(FIGMA_URL);
      expect(text).toContain(FIGMA_KEY);
      expect(text).toContain(projectId);
      expect(text).not.toContain("demande à l'utilisateur le lien");
    }));

  it("sans fichier Figma, consigne de demander le lien à l'utilisateur puis de l'enregistrer", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);

      const text = recipeTextOf(await getReleveFigma(app, { token: accessToken, projectId }));

      expect(text).toContain("demande à l'utilisateur le lien");
      expect(text).toContain("set_project_figma_file");
    }));

  it("date l'intention du lot du jour où la recette est obtenue", () =>
    withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);

        const text = recipeTextOf(await getReleveFigma(app, { token: accessToken, projectId }));

        expect(text).toContain(
          "« Relevé Figma du 1er déc. : <N> nouveaux tokens, <M> valeurs changées »",
        );
      },
      { clock: () => RELEVE_DAY },
    ));

  it("entre dans l'historique du projet au nom de l'utilisateur et du client (ADR 0021 §1)", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, clientId, userId, spaceId, projectId } = await seedProject(app, db);

      await getReleveFigma(app, { token: accessToken, projectId });
      const { entries } = await historyByApi(app, { accessToken, projectId });

      expect(entries[0]).toEqual({
        id: expect.any(String),
        action: "mcp.releve_figma",
        spaceId,
        projectId,
        author: { kind: "member", userId, name: ADA.name, membership: "active" },
        clientId,
        before: null,
        after: { outcome: "success", input: {} },
        occurredAt: expect.any(String),
        correlationId: CORRELATION_ID,
      });
    }));

  it("refuse un projet inconnu, sans entrée d'historique", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken } = await seedProject(app, db);

      const reply = await getReleveFigma(app, {
        token: accessToken,
        projectId: UNKNOWN_PROJECT_ID,
      });

      expect(reply).toMatchObject({
        error: { message: expect.stringContaining("Projet introuvable") },
      });
      expect(reply.result).toBeUndefined();
      expect(await db.orm.select().from(schema.historyEntry)).toHaveLength(1);
    }));

  it("refuse un projet que l'utilisateur ne voit pas, sans entrée dans son historique", () =>
    withIdentityApp(async (app, db) => {
      const { projectId } = await seedProject(app, db);
      const grace = await obtainAccessToken(app, { user: GRACE });

      const reply = await getReleveFigma(app, { token: grace.accessToken, projectId });

      expect(reply).toMatchObject({
        error: { message: expect.stringContaining("Projet introuvable") },
      });
      expect(await actionsOf(db, projectId)).toEqual(["project.created"]);
    }));

  it("si l'entrée ne peut pas être écrite, rend une erreur au lieu de la recette", () =>
    withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);

        const reply = await getReleveFigma(app, { token: accessToken, projectId });

        expect(reply).toMatchObject({
          error: { message: expect.stringContaining("Historique indisponible") },
        });
        expect(reply.result).toBeUndefined();
      },
      {
        wrapHistoryWriter: (writer) => ({
          append: (entries) =>
            entries.some((entry) => entry.action.startsWith("mcp."))
              ? Promise.reject(new Error("historique indisponible"))
              : writer.append(entries),
        }),
      },
    ));
});
