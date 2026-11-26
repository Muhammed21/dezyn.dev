import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  type App,
  authorizeAnotherAi,
  BASE_URL,
  callMcp,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { seedModes, seedProject } from "#testing/project-fixtures.ts";
import { bytesOfProjectRows, seedStoredBytes, storedBytesOf } from "#testing/project-storage.ts";
import {
  addToken,
  historyOf,
  makeColorToken,
  PRIMARY_BLUE,
  seedFigmaState,
} from "#testing/token-fixtures.ts";
import { InvalidBatchProblem, InvalidProposalProblem } from "@repo/contracts";
import { schema } from "@repo/db";

const NIGHT_BLUE = { colorSpace: "srgb", components: [0.1, 0.2, 0.4] };

const BODY_SIZE = { name: "taille.corps", $type: "dimension", $value: { value: 16, unit: "px" } };

const TITLE_SIZE = { name: "taille.titre", $type: "dimension", $value: "{taille.corps}" };

const BODY_TEXT = {
  name: "texte.corps",
  $type: "typography",
  $value: {
    fontFamily: "Inter",
    fontSize: "{taille.corps}",
    fontWeight: 400,
    lineHeight: 1.5,
    letterSpacing: { value: 0, unit: "px" },
  },
};

const callTool = async (
  app: App,
  { accessToken, name, args }: { accessToken: string; name: string; args: object },
) => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return (await response.json()).result;
};

const deleteTokens = async (
  app: App,
  { accessToken, projectId, names }: { accessToken: string; projectId: string; names: string[] },
) => callTool(app, { accessToken, name: "delete_tokens", args: { projectId, names } });

const writeTokens = async (
  app: App,
  { accessToken, projectId, tokens }: { accessToken: string; projectId: string; tokens: object[] },
) =>
  (await callTool(app, { accessToken, name: "write_tokens", args: { projectId, tokens } }))
    .structuredContent;

const post = (app: App, { accessToken, path }: { accessToken: string; path: string }) =>
  app.request(`${BASE_URL}/v1${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: "{}",
  });

const tokenNamesOf = async (
  app: App,
  { accessToken, projectId }: { accessToken: string; projectId: string },
) => {
  const response = await app.request(`${BASE_URL}/v1/projects/${projectId}/tokens`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return (await response.json()).tokens.map(({ name }: { name: string }) => name);
};

const BACKGROUND = { name: "couleur.fond", $type: "color", $value: PRIMARY_BLUE };

const makeText = (extensions?: object) => ({
  name: "couleur.texte",
  $type: "color",
  $value: NIGHT_BLUE,
  ...(extensions === undefined ? {} : { $extensions: extensions }),
});

const TEXT_ON_BACKGROUND = makeText({ "dev.dezyn": { contrastOn: ["{couleur.fond}"] } });

const seedCitedSize = async (app: App, seeded: { accessToken: string; projectId: string }) => {
  for (const token of [BODY_SIZE, TITLE_SIZE, BODY_TEXT]) {
    await addToken(app, { ...seeded, token });
  }
};

describe("l'IA propose la suppression d'un token (ADR 0026 §1 et §3)", () => {
  it("la suppression rejoint le lot vivant ; validée, le token disparaît de tous les modes avec son état Figma, et l'historique la nomme", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      const { accessToken, projectId } = seeded;
      await seedModes(db, { projectId, modes: ["clair", "sombre"] });
      const token = {
        name: "couleur.fond.primaire",
        $type: "color",
        modes: { clair: PRIMARY_BLUE, sombre: NIGHT_BLUE },
      };
      const added = await (await addToken(app, { ...seeded, token })).json();
      await seedFigmaState(db, { tokenId: added.id, state: "synced", declaredAt: new Date() });
      await seedStoredBytes(db, { projectId, bytes: await bytesOfProjectRows(db, projectId) });
      const written = await writeTokens(app, {
        ...seeded,
        tokens: [
          {
            name: "couleur.neuve",
            $type: "color",
            modes: { clair: NIGHT_BLUE, sombre: NIGHT_BLUE },
          },
        ],
      });

      const deleted = await deleteTokens(app, { ...seeded, names: [token.name] });

      expect(deleted.structuredContent).toEqual({
        batch: { id: written.batch.id, state: "open" },
        proposals: [
          { id: expect.any(String), name: token.name, kind: "delete", status: "proposed" },
        ],
        unchanged: [],
        replaced: [],
      });
      const proposalId = deleted.structuredContent.proposals[0].id;
      expect(
        (await post(app, { accessToken, path: `/proposals/${proposalId}/validate` })).status,
      ).toBe(200);
      expect(await tokenNamesOf(app, seeded)).toEqual([]);
      const [validated, call] = await historyOf(app, seeded);
      expect(validated).toMatchObject({
        action: "proposal.validated",
        before: token,
        after: { proposalId, kind: "delete", token },
      });
      expect(call).toMatchObject({ action: "mcp.delete_tokens", after: { outcome: "success" } });
      expect(await storedBytesOf(db, projectId)).toBe(await bytesOfProjectRows(db, projectId));
    }));

  it("rejetée, la suppression ne change rien", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await addToken(app, seeded);
      const deleted = await deleteTokens(app, { ...seeded, names: ["couleur.fond.primaire"] });

      const response = await post(app, {
        accessToken: seeded.accessToken,
        path: `/proposals/${deleted.structuredContent.proposals[0].id}/reject`,
      });

      expect(response.status).toBe(200);
      expect(await tokenNamesOf(app, seeded)).toEqual(["couleur.fond.primaire"]);
    }));

  it("refuse un nom inconnu et un token seulement en attente de création, en les nommant", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await writeTokens(app, { ...seeded, tokens: [makeColorToken({ name: "couleur.proposee" })] });

      const refused = await deleteTokens(app, {
        ...seeded,
        names: ["couleur.inconnue", "couleur.proposee"],
      });

      expect(refused).toEqual({
        content: [
          {
            type: "text",
            text: [
              "names[0] : Token inexistant dans le projet",
              "names[1] : Token en attente de création : rejeter sa proposition plutôt que le supprimer",
            ].join("\n"),
          },
        ],
        isError: true,
      });
    }));

  it("une suppression déjà en attente revient inchangée ; une modification en attente est remplacée", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.a" }) });
      await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.b" }) });
      await deleteTokens(app, { ...seeded, names: ["couleur.a"] });
      const update = await writeTokens(app, {
        ...seeded,
        tokens: [makeColorToken({ name: "couleur.b", $value: NIGHT_BLUE })],
      });

      const deleted = await deleteTokens(app, { ...seeded, names: ["couleur.a", "couleur.b"] });

      expect(deleted.structuredContent).toMatchObject({
        proposals: [{ name: "couleur.b", kind: "delete" }],
        unchanged: ["couleur.a"],
        replaced: [{ id: update.proposals[0].id, name: "couleur.b", batchId: update.batch.id }],
      });
    }));
});

describe("un token encore cité ne se supprime pas (ADR 0026 §2, ADR 0029)", () => {
  it("à la proposition, refuse en nommant les citations ; supprimer aussi les tokens qui citent dans le même appel l'accepte", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await seedCitedSize(app, seeded);

      const refused = await deleteTokens(app, { ...seeded, names: ["taille.corps"] });
      const together = await deleteTokens(app, {
        ...seeded,
        names: ["taille.corps", "taille.titre", "texte.corps"],
      });

      expect(refused).toEqual({
        content: [
          {
            type: "text",
            text: "names[0] : Token encore cité : taille.titre (alias), texte.corps (champ)",
          },
        ],
        isError: true,
      });
      expect(together.structuredContent.proposals).toHaveLength(3);
    }));

  it("à la proposition, une modification en attente dans le même lot qui retire l'alias rend la suppression possible", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await addToken(app, { ...seeded, token: BODY_SIZE });
      await addToken(app, { ...seeded, token: TITLE_SIZE });
      const written = await writeTokens(app, {
        ...seeded,
        tokens: [{ ...TITLE_SIZE, $value: { value: 24, unit: "px" } }],
      });

      const deleted = await deleteTokens(app, { ...seeded, names: ["taille.corps"] });

      expect(deleted.structuredContent).toMatchObject({
        batch: { id: written.batch.id },
        proposals: [{ name: "taille.corps", kind: "delete", status: "proposed" }],
      });
    }));

  it("à la proposition, une modification en attente dans un autre lot ne retire pas l'alias", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      const other = await authorizeAnotherAi(app, {
        browser: seeded.browser,
        clientName: "Cursor",
      });
      await addToken(app, { ...seeded, token: BODY_SIZE });
      await addToken(app, { ...seeded, token: TITLE_SIZE });
      await writeTokens(app, {
        accessToken: other.accessToken,
        projectId: seeded.projectId,
        tokens: [{ ...TITLE_SIZE, $value: { value: 24, unit: "px" } }],
      });

      const refused = await deleteTokens(app, { ...seeded, names: ["taille.corps"] });

      expect(refused).toEqual({
        content: [{ type: "text", text: "names[0] : Token encore cité : taille.titre (alias)" }],
        isError: true,
      });
    }));

  it("à la validation d'une proposition, refuse en 409 si un alias est apparu depuis", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await addToken(app, { ...seeded, token: BODY_SIZE });
      const deleted = await deleteTokens(app, { ...seeded, names: ["taille.corps"] });
      await addToken(app, { ...seeded, token: TITLE_SIZE });

      const response = await post(app, {
        accessToken: seeded.accessToken,
        path: `/proposals/${deleted.structuredContent.proposals[0].id}/validate`,
      });

      expect(response.status).toBe(409);
      expect(InvalidProposalProblem.parse(await response.json()).errors).toEqual([
        { path: "name", message: "Token encore cité : taille.titre (alias)" },
      ]);
      expect(await tokenNamesOf(app, seeded)).toContain("taille.corps");
    }));

  it("à la validation d'un lot, les modifications du lot qui retirent les citations apparues depuis passent avant la suppression ; sans elles, le lot est refusé", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      const { accessToken } = seeded;
      await addToken(app, { ...seeded, token: BODY_SIZE });
      await deleteTokens(app, { ...seeded, names: ["taille.corps"] });
      await addToken(app, { ...seeded, token: TITLE_SIZE });
      await addToken(app, { ...seeded, token: BODY_TEXT });
      const written = await writeTokens(app, {
        ...seeded,
        tokens: [
          { ...TITLE_SIZE, $value: { value: 24, unit: "px" } },
          { ...BODY_TEXT, $value: { ...BODY_TEXT.$value, fontSize: { value: 16, unit: "px" } } },
        ],
      });
      await callTool(app, {
        accessToken,
        name: "close_proposal_batch",
        args: { projectId: seeded.projectId },
      });
      const validate = (rejected: readonly string[]) =>
        app.request(`${BASE_URL}/v1/proposal-batches/${written.batch.id}/validate`, {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify({ rejected }),
        });

      const refused = await validate([written.proposals[0].id]);
      const validated = await validate([]);

      expect(refused.status).toBe(409);
      expect(InvalidBatchProblem.parse(await refused.json()).errors).toEqual([
        {
          path: expect.stringMatching(/^proposals\..+\.name$/),
          message: "Token encore cité : taille.titre (alias)",
        },
      ]);
      expect(validated.status).toBe(200);
      expect(await tokenNamesOf(app, seeded)).toEqual(["taille.titre", "texte.corps"]);
    }));
});

describe("un fond cité dans une paire de contraste ne se supprime pas (ADR 0061 §3)", () => {
  it("à la proposition, refuse en nommant la paire ; une modification en attente dans le même lot qui retire la paire rend la suppression possible", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await addToken(app, { ...seeded, token: BACKGROUND });
      await addToken(app, { ...seeded, token: TEXT_ON_BACKGROUND });

      const refused = await deleteTokens(app, { ...seeded, names: ["couleur.fond"] });
      const written = await writeTokens(app, { ...seeded, tokens: [makeText()] });
      const deleted = await deleteTokens(app, { ...seeded, names: ["couleur.fond"] });

      expect(refused).toEqual({
        content: [
          {
            type: "text",
            text: "names[0] : Token encore cité : couleur.texte (paire de contraste)",
          },
        ],
        isError: true,
      });
      expect(deleted.structuredContent).toMatchObject({
        batch: { id: written.batch.id },
        proposals: [{ name: "couleur.fond", kind: "delete", status: "proposed" }],
      });
    }));

  it("à la validation d'un lot, la modification qui retire une paire apparue depuis passe avant la suppression ; sans elle, le lot est refusé", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      const { accessToken } = seeded;
      await addToken(app, { ...seeded, token: BACKGROUND });
      await addToken(app, { ...seeded, token: makeText() });
      await deleteTokens(app, { ...seeded, names: ["couleur.fond"] });
      await db.orm
        .update(schema.token)
        .set({ extensions: TEXT_ON_BACKGROUND.$extensions })
        .where(
          and(eq(schema.token.projectId, seeded.projectId), eq(schema.token.name, "couleur.texte")),
        );
      const written = await writeTokens(app, { ...seeded, tokens: [makeText()] });
      await callTool(app, {
        accessToken,
        name: "close_proposal_batch",
        args: { projectId: seeded.projectId },
      });
      const validate = (rejected: readonly string[]) =>
        app.request(`${BASE_URL}/v1/proposal-batches/${written.batch.id}/validate`, {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify({ rejected }),
        });

      const refused = await validate([written.proposals[0].id]);
      const validated = await validate([]);

      expect(refused.status).toBe(409);
      expect(InvalidBatchProblem.parse(await refused.json()).errors).toEqual([
        {
          path: expect.stringMatching(/^proposals\..+\.name$/),
          message: "Token encore cité : couleur.texte (paire de contraste)",
        },
      ]);
      expect(validated.status).toBe(200);
      expect(await tokenNamesOf(app, seeded)).toEqual(["couleur.texte"]);
    }));
});
