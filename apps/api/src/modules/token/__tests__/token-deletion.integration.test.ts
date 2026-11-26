import { describe, expect, it } from "vitest";

import {
  ADA,
  type App,
  BASE_URL,
  callMcp,
  GRACE,
  obtainAccessToken,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { seedModes, seedProject, seedProjectAsEditor } from "#testing/project-fixtures.ts";
import { bytesOfProjectRows, seedStoredBytes, storedBytesOf } from "#testing/project-storage.ts";
import {
  addToken,
  deleteToken,
  DELETION_CORRELATION_ID,
  historyOf,
  makeColorToken,
  PRIMARY_BLUE,
  seedFigmaState,
} from "#testing/token-fixtures.ts";
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "@repo/contracts";

const NIGHT_BLUE = { colorSpace: "srgb", components: [0.1, 0.2, 0.4] };

const tokenNamesOf = async (
  app: App,
  { accessToken, projectId }: { accessToken: string; projectId: string },
) => {
  const response = await app.request(`${BASE_URL}/v1/projects/${projectId}/tokens`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return (await response.json()).tokens.map(({ name }: { name: string }) => name);
};

const writeTokens = async (
  app: App,
  { accessToken, projectId, tokens }: { accessToken: string; projectId: string; tokens: object[] },
) => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: { name: "write_tokens", arguments: { projectId, tokens } },
  });
  const { result } = await response.json();
  return result.structuredContent;
};

describe("un membre supprime un token (ADR 0026 §3 et §4)", () => {
  it("un propriétaire supprime un token de tous ses modes avec son état Figma ; l'historique montre token.deleted et le compteur suit", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, userId, spaceId, projectId } = await seedProject(app, db);
      await seedModes(db, { projectId, modes: ["clair", "sombre"] });
      const token = {
        name: "couleur.fond.primaire",
        $type: "color",
        modes: { clair: PRIMARY_BLUE, sombre: NIGHT_BLUE },
        $description: "Fond des boutons",
      };
      const added = await (await addToken(app, { accessToken, projectId, token })).json();
      await seedFigmaState(db, { tokenId: added.id, state: "synced", declaredAt: new Date() });
      await seedStoredBytes(db, { projectId, bytes: await bytesOfProjectRows(db, projectId) });

      const response = await deleteToken(app, { accessToken, projectId, name: token.name });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ name: token.name, replaced: null });
      expect(await tokenNamesOf(app, { accessToken, projectId })).toEqual([]);
      expect((await historyOf(app, { accessToken, projectId }))[0]).toEqual({
        id: expect.any(String),
        action: "token.deleted",
        spaceId,
        projectId,
        author: { kind: "member", userId, name: ADA.name, membership: "active" },
        clientId: null,
        before: token,
        after: { replaced: null },
        occurredAt: expect.any(String),
        correlationId: DELETION_CORRELATION_ID,
      });
      expect(await storedBytesOf(db, projectId)).toBe(await bytesOfProjectRows(db, projectId));
    }));

  it("un éditeur supprime un token", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProjectAsEditor(app, db);
      await addToken(app, { accessToken, projectId });

      const response = await deleteToken(app, {
        accessToken,
        projectId,
        name: "couleur.fond.primaire",
      });

      expect(response.status).toBe(200);
      expect(await tokenNamesOf(app, { accessToken, projectId })).toEqual([]);
    }));

  it("une suppression rejouée avec la même clé d'idempotence rend la première réponse", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      await addToken(app, { accessToken, projectId });
      const remove = () =>
        app.request(`${BASE_URL}/v1/projects/${projectId}/tokens/couleur.fond.primaire`, {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${accessToken}`,
            [IDEMPOTENCY_KEY_HEADER]: "suppression-1",
          },
        });
      const first = await remove();

      const replayed = await remove();

      expect(replayed.status).toBe(200);
      expect(replayed.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe("true");
      expect(await replayed.json()).toEqual(await first.json());
    }));

  it("un non-membre reçoit 404, et le token reste", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      await addToken(app, { accessToken, projectId });
      const grace = await obtainAccessToken(app, { user: GRACE });

      const response = await deleteToken(app, {
        accessToken: grace.accessToken,
        projectId,
        name: "couleur.fond.primaire",
      });

      expect(response.status).toBe(404);
      expect(await tokenNamesOf(app, { accessToken, projectId })).toEqual([
        "couleur.fond.primaire",
      ]);
    }));

  it.each([
    ["un nom inconnu du projet", "couleur.inconnue"],
    ["un token seulement en attente de création", "couleur.proposee"],
  ])("%s répond 404", (_case, name) =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      await writeTokens(app, {
        accessToken,
        projectId,
        tokens: [makeColorToken({ name: "couleur.proposee" })],
      });

      const response = await deleteToken(app, { accessToken, projectId, name });

      expect(response.status).toBe(404);
    }),
  );

  it("la suppression remplace la proposition en attente sur ce token et la désigne", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      await addToken(app, { accessToken, projectId });
      const { batch, proposals } = await writeTokens(app, {
        accessToken,
        projectId,
        tokens: [makeColorToken({ $value: NIGHT_BLUE })],
      });

      const response = await deleteToken(app, {
        accessToken,
        projectId,
        name: "couleur.fond.primaire",
      });

      expect(await response.json()).toEqual({
        name: "couleur.fond.primaire",
        replaced: { id: proposals[0].id, batchId: batch.id },
      });
      const read = await app.request(`${BASE_URL}/v1/proposal-batches/${batch.id}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect((await read.json()).proposals).toMatchObject([{ status: "replaced" }]);
    }));
});

describe("un token encore cité ne se supprime pas (ADR 0026 §2, ADR 0029)", () => {
  it("répond 409 en nommant les tokens qui le citent par alias et par champ, puis accepte une fois les citations retirées", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const tokens = [
        { name: "taille.corps", $type: "dimension", $value: { value: 16, unit: "px" } },
        { name: "taille.titre", $type: "dimension", $value: "{taille.corps}" },
        {
          name: "texte.corps",
          $type: "typography",
          $value: {
            fontFamily: "Inter",
            fontSize: "{taille.corps}",
            fontWeight: 400,
            lineHeight: 1.5,
            letterSpacing: { value: 0, unit: "px" },
          },
        },
      ];
      for (const token of tokens) {
        await addToken(app, { accessToken, projectId, token });
      }

      const refused = await deleteToken(app, { accessToken, projectId, name: "taille.corps" });

      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({
        type: "about:blank",
        title: "Suppression impossible",
        status: 409,
        errors: [
          {
            path: "name",
            message: "Token encore cité : taille.titre (alias), texte.corps (champ)",
          },
        ],
      });
      await deleteToken(app, { accessToken, projectId, name: "taille.titre" });
      await deleteToken(app, { accessToken, projectId, name: "texte.corps" });
      expect(
        (await deleteToken(app, { accessToken, projectId, name: "taille.corps" })).status,
      ).toBe(200);
      expect(await tokenNamesOf(app, { accessToken, projectId })).toEqual([]);
    }));
});

describe("un fond cité dans une paire de contraste ne se supprime pas (ADR 0061 §3)", () => {
  it("répond 409 en nommant le token qui le cite dans une paire, puis accepte une fois ce token supprimé", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      await addToken(app, {
        accessToken,
        projectId,
        token: makeColorToken({ name: "couleur.fond" }),
      });
      await addToken(app, {
        accessToken,
        projectId,
        token: makeColorToken({
          name: "couleur.texte",
          $value: NIGHT_BLUE,
          $extensions: { "dev.dezyn": { contrastOn: [{ on: "{couleur.fond}", usage: "ui" }] } },
        }),
      });

      const refused = await deleteToken(app, { accessToken, projectId, name: "couleur.fond" });

      expect(refused.status).toBe(409);
      expect((await refused.json()).errors).toEqual([
        { path: "name", message: "Token encore cité : couleur.texte (paire de contraste)" },
      ]);
      await deleteToken(app, { accessToken, projectId, name: "couleur.texte" });
      expect(
        (await deleteToken(app, { accessToken, projectId, name: "couleur.fond" })).status,
      ).toBe(200);
    }));
});
