import { describe, expect, it } from "vitest";

import { type App, callMcp, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { addToken, makeColorToken, PRIMARY_BLUE } from "#testing/token-fixtures.ts";

import { observeProject } from "../observation.ts";

const FIGMA_KEY = "aB3dE5fG7hI9jK1lM3nO5p";

const FIGMA_URL = `https://www.figma.com/design/${FIGMA_KEY}/Design-system`;

const DECLARED_AT = new Date("2026-11-25T09:00:00Z");

const callTool = async (
  app: App,
  { accessToken, name, args }: { accessToken: string; name: string; args: object },
) => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const { result } = await response.json();
  return result.structuredContent;
};

describe("l'évaluation observe en base ce qu'un passage de recette a laissé dans un projet", () => {
  it("rend le fichier Figma, les tokens validés et leur état Figma, les lots et le contenu de leurs propositions, et l'historique", () =>
    withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        await callTool(app, {
          accessToken,
          name: "set_project_figma_file",
          args: { projectId, url: FIGMA_URL },
        });
        await addToken(app, { accessToken, projectId, token: makeColorToken() });
        await callTool(app, {
          accessToken,
          name: "declare_figma_states",
          args: { projectId, states: [{ name: "couleur.fond.primaire", state: "synced" }] },
        });
        const opened = await callTool(app, {
          accessToken,
          name: "open_proposal_batch",
          args: {
            projectId,
            intent: "Relevé Figma du 25 nov. : 1 nouveau token",
            recipe: "releve_figma",
          },
        });
        await callTool(app, {
          accessToken,
          name: "write_tokens",
          args: {
            projectId,
            batchId: opened.batch.id,
            tokens: [makeColorToken({ name: "couleur.alerte" })],
          },
        });

        const observed = await observeProject(db, projectId);

        expect(observed).toEqual({
          figmaFile: { url: FIGMA_URL, key: FIGMA_KEY },
          modes: [],
          tokens: [
            { name: "couleur.fond.primaire", figmaState: "synced", declaredAt: DECLARED_AT },
          ],
          batches: [
            {
              id: opened.batch.id,
              intent: "Relevé Figma du 25 nov. : 1 nouveau token",
              recipe: "releve_figma",
              state: "open",
              proposals: [
                {
                  name: "couleur.alerte",
                  kind: "create",
                  status: "proposed",
                  token: expect.objectContaining({ $type: "color", $value: PRIMARY_BLUE }),
                },
              ],
            },
          ],
          history: expect.arrayContaining([
            { id: expect.any(String), action: "project.created", outcome: undefined },
            { id: expect.any(String), action: "mcp.write_tokens", outcome: "success" },
          ]),
        });
      },
      { clock: () => DECLARED_AT },
    ));
});
