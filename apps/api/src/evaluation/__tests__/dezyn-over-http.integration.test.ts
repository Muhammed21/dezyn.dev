import { describe, expect, it } from "vitest";

import { withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";

import { exposeOverHttp, recipePromptOf } from "../dezyn-over-http.ts";

describe("l'évaluation branche la vraie IA sur le MCP de dezyn en local", () => {
  it("sert le MCP de dezyn sur un port local, avec le vrai jeton OAuth du membre", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken } = await seedProject(app, db);
      const exposed = await exposeOverHttp(app);
      try {
        const response = await fetch(`${exposed.url}/v1/mcp`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompts/list", params: {} }),
        });

        expect(await response.json()).toMatchObject({
          result: {
            prompts: expect.arrayContaining([expect.objectContaining({ name: "releve_figma" })]),
          },
        });
      } finally {
        await exposed.close();
      }
    }));

  it("refuse un appel sans jeton, comme le vrai serveur", () =>
    withIdentityApp(async (app) => {
      const exposed = await exposeOverHttp(app);
      try {
        const response = await fetch(`${exposed.url}/v1/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompts/list", params: {} }),
        });

        expect(response.status).toBe(401);
      } finally {
        await exposed.close();
      }
    }));

  it("obtient le texte de la recette pour le projet du scénario", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);

      const prompt = await recipePromptOf(app, { accessToken, projectId, recipe: "releve_figma" });

      expect(prompt).toContain(`# Relevé Figma du projet « Site vitrine » (${projectId})`);
    }));

  it("signale une recette qu'il n'obtient pas", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);

      await expect(
        recipePromptOf(app, { accessToken, projectId, recipe: "recette_inconnue" }),
      ).rejects.toThrow("prompts/get recette_inconnue");
    }));
});
