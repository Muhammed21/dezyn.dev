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
import { seedProject, seedProjectAsEditor } from "#testing/project-fixtures.ts";
import { makeAllSignalsRecorder } from "#testing/project-signals.ts";
import { historyOf, makeColorToken } from "#testing/token-fixtures.ts";
import { schema } from "@repo/db";

const IDEMPOTENCY_KEY_DESCRIPTION =
  "Choisis une clé nouvelle par écriture voulue ; réutilise la même seulement pour relancer un appel resté sans réponse.";

const NIGHT_BLUE = { colorSpace: "srgb", components: [0.1, 0.2, 0.4] };

const writeTokens = async (
  app: App,
  { accessToken, args }: { accessToken: string; args: Readonly<Record<string, unknown>> },
) => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: { name: "write_tokens", arguments: args },
  });
  const { result } = await response.json();
  return result;
};

const batchOf = async (
  app: App,
  { accessToken, batchId }: { accessToken: string; batchId: string },
) => {
  const response = await app.request(`${BASE_URL}/v1/proposal-batches/${batchId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return response.json();
};

const writeEntriesOf = async (
  app: App,
  { accessToken, projectId }: { accessToken: string; projectId: string },
) =>
  (await historyOf(app, { accessToken, projectId })).filter(
    ({ action }: { action: string }) => action === "mcp.write_tokens",
  );

describe("write_tokens relancé avec la même clé d'idempotence rejoue son premier résultat", () => {
  it("rend les mêmes propositions, le même lot et les mêmes identifiants que le premier appel", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const args = {
        projectId,
        tokens: [makeColorToken({ name: "couleur.fond" })],
        idempotencyKey: randomUUID(),
      };
      const first = await writeTokens(app, { accessToken, args });

      const retried = await writeTokens(app, { accessToken, args });

      expect(first.structuredContent.proposals).toHaveLength(1);
      expect(retried).toEqual(first);
    }));

  it("ne crée aucune proposition, n'ajoute aucune entrée d'historique et n'envoie aucun signal", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const args = {
          projectId,
          tokens: [makeColorToken({ name: "couleur.fond" })],
          idempotencyKey: randomUUID(),
        };
        const first = await writeTokens(app, { accessToken, args });
        const signalsAfterFirst = recorder.received.length;
        const scheduledAfterFirst = recorder.scheduled.length;

        await writeTokens(app, { accessToken, args });

        const batch = await batchOf(app, {
          accessToken,
          batchId: first.structuredContent.batch.id,
        });
        expect(batch.proposals).toHaveLength(1);
        expect(await writeEntriesOf(app, { accessToken, projectId })).toHaveLength(1);
        expect(recorder.since(signalsAfterFirst)).toEqual([]);
        expect(recorder.scheduled).toHaveLength(scheduledAfterFirst);
      },
      { signals: recorder.signals },
    );
  });

  it("ne réécrit pas une proposition remplacée entre-temps par un autre appel", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const args = { projectId, tokens: [makeColorToken()], idempotencyKey: randomUUID() };
      const first = await writeTokens(app, { accessToken, args });
      const replacing = await writeTokens(app, {
        accessToken,
        args: { projectId, tokens: [makeColorToken({ $value: NIGHT_BLUE })] },
      });

      const retried = await writeTokens(app, { accessToken, args });

      expect(retried).toEqual(first);
      const batch = await batchOf(app, {
        accessToken,
        batchId: replacing.structuredContent.batch.id,
      });
      expect(
        batch.proposals
          .filter(({ status }: { status: string }) => status === "proposed")
          .map(({ id }: { id: string }) => id),
      ).toEqual(replacing.structuredContent.proposals.map(({ id }: { id: string }) => id));
    }));

  it("rejoue aussi des arguments identiques écrits dans un autre ordre de clés", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const idempotencyKey = randomUUID();
      const first = await writeTokens(app, {
        accessToken,
        args: {
          projectId,
          tokens: [{ name: "couleur.fond", $type: "color", $value: NIGHT_BLUE }],
          idempotencyKey,
        },
      });

      const retried = await writeTokens(app, {
        accessToken,
        args: {
          idempotencyKey,
          tokens: [
            {
              $value: { components: [0.1, 0.2, 0.4], colorSpace: "srgb" },
              $type: "color",
              name: "couleur.fond",
            },
          ],
          projectId,
        },
      });

      expect(retried).toEqual(first);
    }));

  it("rejoue des arguments qui portent null", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const args = {
        projectId,
        tokens: [makeColorToken({ $extensions: { "com.figma": { variableId: null } } })],
        idempotencyKey: randomUUID(),
      };
      const first = await writeTokens(app, { accessToken, args });

      const retried = await writeTokens(app, { accessToken, args });

      expect(first.structuredContent.proposals).toHaveLength(1);
      expect(retried).toEqual(first);
    }));

  it("rejoue à chaque clé le résultat de son propre premier appel", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const fond = {
        projectId,
        tokens: [makeColorToken({ name: "couleur.fond" })],
        idempotencyKey: randomUUID(),
      };
      const bord = {
        projectId,
        tokens: [makeColorToken({ name: "couleur.bord" })],
        idempotencyKey: randomUUID(),
      };
      const firstFond = await writeTokens(app, { accessToken, args: fond });
      const firstBord = await writeTokens(app, { accessToken, args: bord });

      const retriedFond = await writeTokens(app, { accessToken, args: fond });
      const retriedBord = await writeTokens(app, { accessToken, args: bord });

      expect(retriedFond).toEqual(firstFond);
      expect(retriedBord).toEqual(firstBord);
    }));

  it("ne rejoue pas la même clé portée par d'autres arguments", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const idempotencyKey = randomUUID();
      await writeTokens(app, {
        accessToken,
        args: { projectId, tokens: [makeColorToken({ name: "couleur.fond" })], idempotencyKey },
      });

      const other = await writeTokens(app, {
        accessToken,
        args: { projectId, tokens: [makeColorToken({ name: "couleur.bord" })], idempotencyKey },
      });

      expect(other.structuredContent.proposals.map(({ name }: { name: string }) => name)).toEqual([
        "couleur.bord",
      ]);
    }));

  it("ne rejoue pas pour un autre membre le résultat obtenu avec la même clé", () =>
    withIdentityApp(async (app, db) => {
      const ada = await seedProjectAsEditor(app, db);
      const grace = await obtainAccessToken(app, { user: GRACE });
      await db.orm.insert(schema.spaceMember).values({
        id: randomUUID(),
        spaceId: ada.spaceId,
        userId: grace.userId,
        role: "editor",
        joinedAt: new Date(),
      });
      const args = {
        projectId: ada.projectId,
        tokens: [makeColorToken({ name: "couleur.fond" })],
        idempotencyKey: randomUUID(),
      };
      await writeTokens(app, { accessToken: ada.accessToken, args });

      const graceCall = await writeTokens(app, { accessToken: grace.accessToken, args });

      expect(graceCall.structuredContent).toMatchObject({
        proposals: [],
        unchanged: ["couleur.fond"],
      });
    }));

  it("annonce idempotencyKey comme un argument optionnel de write_tokens, et dit quand le réutiliser", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken } = await seedProject(app, db);

      const response = await callMcp(app, { token: accessToken, method: "tools/list" });

      const { result } = await response.json();
      const tool = result.tools.find(({ name }: { name: string }) => name === "write_tokens");
      expect(tool.inputSchema.properties.idempotencyKey).toMatchObject({
        type: "string",
        description: IDEMPOTENCY_KEY_DESCRIPTION,
      });
      expect(tool.inputSchema.required).not.toContain("idempotencyKey");
    }));
});
