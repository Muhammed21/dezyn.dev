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
import { HistoryOutput, ProjectOutput, ProjectsOutput } from "@repo/contracts";

const FIGMA_KEY = "aB3dE5fG7hI9jK1lM3nO5p";
const FIGMA_URL = `https://www.figma.com/design/${FIGMA_KEY}/Design-system`;
const MOVED_FIGMA_KEY = "zY8xW6vU4tS2rQ0pO8nM6l";
const MOVED_FIGMA_URL = `https://www.figma.com/design/${MOVED_FIGMA_KEY}/Design-system-v2`;
const NOT_A_FIGMA_FILE = "https://www.example.com/design-system";

type Member = { readonly accessToken: string; readonly projectId: string };

const setFigmaFileByApi = (
  app: App,
  { accessToken, projectId, url }: Member & { readonly url: unknown },
) =>
  app.request(`${BASE_URL}/v1/projects/${projectId}/figma-file`, {
    method: "PUT",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });

const readProjectByApi = async (app: App, { accessToken, projectId }: Member) =>
  ProjectOutput.parse(
    await (
      await app.request(`${BASE_URL}/v1/projects/${projectId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      })
    ).json(),
  );

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
  return result;
};

const setFigmaFileByMcp = (
  app: App,
  { accessToken, projectId, url }: Member & { readonly url: unknown },
) => callTool(app, { accessToken, name: "set_project_figma_file", args: { projectId, url } });

const figmaFileChangesOf = async (app: App, { accessToken, projectId }: Member) => {
  const response = await app.request(`${BASE_URL}/v1/projects/${projectId}/history`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const { entries } = HistoryOutput.parse(await response.json());
  return entries
    .filter(({ action }) => action === "project.figma_file_changed")
    .map(({ author, clientId, before, after }) => ({ author, clientId, before, after }));
};

describe("un membre renseigne le fichier Figma du projet par l'API (ADR 0059 §4)", () => {
  it("un projet neuf n'a pas de fichier Figma", () =>
    withIdentityApp(async (app, db) => {
      const owner = await seedProject(app, db);

      expect((await readProjectByApi(app, owner)).figmaFile).toBeNull();
    }));

  it("un propriétaire renseigne le lien, et la lecture du projet rend le lien et sa clé", () =>
    withIdentityApp(async (app, db) => {
      const owner = await seedProject(app, db);

      const response = await setFigmaFileByApi(app, { ...owner, url: FIGMA_URL });

      const figmaFile = { url: FIGMA_URL, key: FIGMA_KEY };
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ figmaFile });
      expect((await readProjectByApi(app, owner)).figmaFile).toEqual(figmaFile);
    }));

  it("un éditeur modifie puis retire le fichier Figma", () =>
    withIdentityApp(async (app, db) => {
      const editor = await seedProjectAsEditor(app, db);
      await setFigmaFileByApi(app, { ...editor, url: FIGMA_URL });

      await setFigmaFileByApi(app, { ...editor, url: MOVED_FIGMA_URL });
      const moved = await readProjectByApi(app, editor);
      const removal = await setFigmaFileByApi(app, { ...editor, url: null });

      expect(moved.figmaFile).toEqual({ url: MOVED_FIGMA_URL, key: MOVED_FIGMA_KEY });
      expect(await removal.json()).toEqual({ figmaFile: null });
      expect((await readProjectByApi(app, editor)).figmaFile).toBeNull();
    }));

  it("la liste des projets d'un espace rend le fichier Figma de chaque projet", () =>
    withIdentityApp(async (app, db) => {
      const owner = await seedProject(app, db);
      await setFigmaFileByApi(app, { ...owner, url: FIGMA_URL });

      const response = await app.request(`${BASE_URL}/v1/spaces/${owner.spaceId}/projects`, {
        headers: { authorization: `Bearer ${owner.accessToken}` },
      });

      expect(ProjectsOutput.parse(await response.json()).projects).toEqual([
        expect.objectContaining({ figmaFile: { url: FIGMA_URL, key: FIGMA_KEY } }),
      ]);
    }));

  it("refuse un lien qui n'est pas un fichier Figma par une erreur de validation, sans rien changer", () =>
    withIdentityApp(async (app, db) => {
      const owner = await seedProject(app, db);
      await setFigmaFileByApi(app, { ...owner, url: FIGMA_URL });

      const response = await setFigmaFileByApi(app, { ...owner, url: NOT_A_FIGMA_FILE });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        errors: [
          expect.objectContaining({ path: "url", message: "Lien de fichier Figma attendu" }),
        ],
      });
      expect((await readProjectByApi(app, owner)).figmaFile).toEqual({
        url: FIGMA_URL,
        key: FIGMA_KEY,
      });
    }));

  it("un non-membre ne modifie pas le fichier Figma et ne le lit pas", () =>
    withIdentityApp(async (app, db) => {
      const owner = await seedProject(app, db);
      await setFigmaFileByApi(app, { ...owner, url: FIGMA_URL });
      const stranger = await obtainAccessToken(app, { user: GRACE });

      const written = await setFigmaFileByApi(app, {
        ...stranger,
        projectId: owner.projectId,
        url: MOVED_FIGMA_URL,
      });
      const read = await app.request(`${BASE_URL}/v1/projects/${owner.projectId}`, {
        headers: { authorization: `Bearer ${stranger.accessToken}` },
      });

      expect([written.status, read.status]).toEqual([404, 404]);
      expect((await readProjectByApi(app, owner)).figmaFile).toEqual({
        url: FIGMA_URL,
        key: FIGMA_KEY,
      });
    }));

  it("chaque changement entre dans l'historique avec son auteur, sans client", () =>
    withIdentityApp(async (app, db) => {
      const owner = await seedProject(app, db);

      await setFigmaFileByApi(app, { ...owner, url: FIGMA_URL });
      await setFigmaFileByApi(app, { ...owner, url: null });

      const author = expect.objectContaining({ kind: "member", userId: owner.userId });
      const figmaFile = { url: FIGMA_URL, key: FIGMA_KEY };
      expect(await figmaFileChangesOf(app, owner)).toEqual([
        { author, clientId: null, before: { figmaFile }, after: { figmaFile: null } },
        { author, clientId: null, before: { figmaFile: null }, after: { figmaFile } },
      ]);
    }));

  it("renseigner le même lien ne change rien et n'entre pas dans l'historique", () =>
    withIdentityApp(async (app, db) => {
      const owner = await seedProject(app, db);
      await setFigmaFileByApi(app, { ...owner, url: FIGMA_URL });

      const response = await setFigmaFileByApi(app, { ...owner, url: FIGMA_URL });

      expect(response.status).toBe(200);
      expect(await figmaFileChangesOf(app, owner)).toHaveLength(1);
    }));
});

describe("l'IA renseigne le fichier Figma du projet par set_project_figma_file (ADR 0059 §4)", () => {
  it("renseigne le lien, que list_projects rend avec le projet", () =>
    withIdentityApp(async (app, db) => {
      const owner = await seedProject(app, db);

      const result = await setFigmaFileByMcp(app, { ...owner, url: FIGMA_URL });
      const listed = await callTool(app, {
        accessToken: owner.accessToken,
        name: "list_projects",
        args: { spaceId: owner.spaceId },
      });

      const figmaFile = { url: FIGMA_URL, key: FIGMA_KEY };
      expect(result).toMatchObject({ structuredContent: { figmaFile } });
      expect(result.isError).toBeUndefined();
      expect(listed.structuredContent.projects).toEqual([
        expect.objectContaining({ id: owner.projectId, figmaFile }),
      ]);
    }));

  it("retire le fichier Figma", () =>
    withIdentityApp(async (app, db) => {
      const owner = await seedProject(app, db);
      await setFigmaFileByMcp(app, { ...owner, url: FIGMA_URL });

      const result = await setFigmaFileByMcp(app, { ...owner, url: null });

      expect(result.structuredContent).toEqual({ figmaFile: null });
      expect((await readProjectByApi(app, owner)).figmaFile).toBeNull();
    }));

  it.each([
    ["un lien qui n'est pas un fichier Figma", NOT_A_FIGMA_FILE],
    ["une entrée sans lien", undefined],
    ["un lien qui n'est pas un texte", 42],
  ])("refuse %s par une erreur de validation, sans rien changer", (_case, url) =>
    withIdentityApp(async (app, db) => {
      const owner = await seedProject(app, db);

      const result = await setFigmaFileByMcp(app, { ...owner, url });

      expect(result).toMatchObject({
        isError: true,
        content: [{ type: "text", text: expect.stringMatching(/^url : /) }],
      });
      expect((await readProjectByApi(app, owner)).figmaFile).toBeNull();
    }),
  );

  it("refuse un projet dont l'utilisateur n'est pas membre", () =>
    withIdentityApp(async (app, db) => {
      const owner = await seedProject(app, db);
      const stranger = await obtainAccessToken(app, { user: GRACE });

      const result = await setFigmaFileByMcp(app, {
        ...stranger,
        projectId: owner.projectId,
        url: FIGMA_URL,
      });

      expect(result).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "Projet introuvable" }],
      });
      expect((await readProjectByApi(app, owner)).figmaFile).toBeNull();
    }));

  it("le changement entre dans l'historique avec son auteur et son client", () =>
    withIdentityApp(async (app, db) => {
      const owner = await seedProject(app, db);

      await setFigmaFileByMcp(app, { ...owner, url: FIGMA_URL });

      expect(await figmaFileChangesOf(app, owner)).toEqual([
        {
          author: expect.objectContaining({ kind: "member", userId: owner.userId }),
          clientId: owner.clientId,
          before: { figmaFile: null },
          after: { figmaFile: { url: FIGMA_URL, key: FIGMA_KEY } },
        },
      ]);
    }));

  it("rejoue la réponse d'un appel relancé avec la même clé d'idempotence, sans rien réécrire", () =>
    withIdentityApp(async (app, db) => {
      const owner = await seedProject(app, db);
      const args = { projectId: owner.projectId, url: FIGMA_URL, idempotencyKey: "figma-1" };
      const first = await callTool(app, { ...owner, name: "set_project_figma_file", args });
      await setFigmaFileByMcp(app, { ...owner, url: null });

      const retried = await callTool(app, { ...owner, name: "set_project_figma_file", args });

      expect(retried.structuredContent).toEqual(first.structuredContent);
      expect((await readProjectByApi(app, owner)).figmaFile).toBeNull();
    }));
});
