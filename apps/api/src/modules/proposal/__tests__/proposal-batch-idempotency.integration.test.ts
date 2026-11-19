import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { type App, BASE_URL, callMcp, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { makeAllSignalsRecorder } from "#testing/project-signals.ts";
import { historyOf, makeColorToken } from "#testing/token-fixtures.ts";

const INTENTION = "Import du Figma Healthcare";

const KEY_REUSED =
  "idempotency_key_reused : cette clé d'idempotence a déjà servi avec d'autres arguments ; choisis une clé nouvelle pour une autre écriture.";

const INVALID_KEY =
  "invalid_idempotency_key : idempotencyKey compte de 1 à 255 caractères ASCII imprimables.";

const refusal = (text: string) => ({ content: [{ type: "text", text }], isError: true });

const callTool = async (
  app: App,
  {
    accessToken,
    name,
    args,
  }: { accessToken: string; name: string; args: Readonly<Record<string, unknown>> },
) => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const { result } = await response.json();
  return result;
};

const openBatch = (
  app: App,
  { accessToken, args }: { accessToken: string; args: Readonly<Record<string, unknown>> },
) => callTool(app, { accessToken, name: "open_proposal_batch", args });

const closeBatch = (
  app: App,
  { accessToken, args }: { accessToken: string; args: Readonly<Record<string, unknown>> },
) => callTool(app, { accessToken, name: "close_proposal_batch", args });

const batchesOf = async (
  app: App,
  { accessToken, projectId }: { accessToken: string; projectId: string },
) => {
  const response = await app.request(`${BASE_URL}/v1/projects/${projectId}/proposal-batches`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const { batches } = await response.json();
  return batches;
};

const entriesOf = async (
  app: App,
  { accessToken, projectId, tool }: { accessToken: string; projectId: string; tool: string },
) =>
  (await historyOf(app, { accessToken, projectId }))
    .filter(({ action }: { action: string }) => action === `mcp.${tool}`)
    .map(({ after }: { after: unknown }) => after);

describe("open_proposal_batch relancé avec la même clé d'idempotence rejoue son premier résultat", () => {
  it("rend le même lot, toujours ouvert avec son intention, sans en ouvrir un autre", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const args = { projectId, intent: INTENTION, idempotencyKey: randomUUID() };
      const first = await openBatch(app, { accessToken, args });

      const retried = await openBatch(app, { accessToken, args });

      expect(retried).toEqual(first);
      expect(await batchesOf(app, { accessToken, projectId })).toEqual([
        expect.objectContaining({
          id: first.structuredContent.batch.id,
          state: "open",
          intent: INTENTION,
        }),
      ]);
    }));

  it("laisse une seule entrée de succès dans l'historique, puis une entrée marquée comme rejeu", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const args = { projectId, intent: INTENTION, idempotencyKey: randomUUID() };
      await openBatch(app, { accessToken, args });

      await openBatch(app, { accessToken, args });

      expect(await entriesOf(app, { accessToken, projectId, tool: "open_proposal_batch" })).toEqual(
        [
          { outcome: "replayed", input: { intent: INTENTION } },
          { outcome: "success", input: { intent: INTENTION } },
        ],
      );
    }));

  it("ne signale au rejeu que son entrée d'historique, sans relancer l'échéance du lot", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const args = { projectId, intent: INTENTION, idempotencyKey: randomUUID() };
        await openBatch(app, { accessToken, args });
        const signalsAfterFirst = recorder.received.length;
        const scheduledAfterFirst = recorder.scheduled.length;

        await openBatch(app, { accessToken, args });

        expect(recorder.since(signalsAfterFirst)).toEqual([{ projectId, topics: ["history"] }]);
        expect(recorder.scheduled).toHaveLength(scheduledAfterFirst);
      },
      { signals: recorder.signals },
    );
  });

  it("rejoue un refus de l'intention, qui n'est pas une erreur serveur", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const args = { projectId, intent: " ", idempotencyKey: randomUUID() };
      const first = await openBatch(app, { accessToken, args });

      const retried = await openBatch(app, { accessToken, args });

      expect(first).toEqual(refusal("intent : Intention requise"));
      expect(retried).toEqual(first);
      expect(await entriesOf(app, { accessToken, projectId, tool: "open_proposal_batch" })).toEqual(
        [
          { outcome: "replayed", input: { intent: " " } },
          { outcome: "error", input: { intent: " " } },
        ],
      );
    }));

  it("ne mémorise pas un historique indisponible : la relance s'exécute, puis se rejoue", () => {
    const history = { failures: 1 };
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const args = { projectId, intent: INTENTION, idempotencyKey: randomUUID() };
        const first = await openBatch(app, { accessToken, args });

        const retried = await openBatch(app, { accessToken, args });
        const replayed = await openBatch(app, { accessToken, args });

        expect(first).toEqual(refusal("Historique indisponible"));
        expect(retried.structuredContent.batch).toMatchObject({ state: "open", intent: INTENTION });
        expect(replayed).toEqual(retried);
        expect(
          await entriesOf(app, { accessToken, projectId, tool: "open_proposal_batch" }),
        ).toEqual([
          { outcome: "replayed", input: { intent: INTENTION } },
          { outcome: "success", input: { intent: INTENTION } },
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

  it("refuse la même clé portée par une autre intention, sans ouvrir de second lot", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const idempotencyKey = randomUUID();
      const first = await openBatch(app, {
        accessToken,
        args: { projectId, intent: INTENTION, idempotencyKey },
      });

      const other = await openBatch(app, {
        accessToken,
        args: { projectId, intent: "Refonte des couleurs", idempotencyKey },
      });

      expect(other).toEqual(refusal(KEY_REUSED));
      expect(await batchesOf(app, { accessToken, projectId })).toEqual([
        expect.objectContaining({ id: first.structuredContent.batch.id, state: "open" }),
      ]);
      expect(await entriesOf(app, { accessToken, projectId, tool: "open_proposal_batch" })).toEqual(
        [
          { outcome: "error", input: { intent: "Refonte des couleurs" } },
          { outcome: "success", input: { intent: INTENTION } },
        ],
      );
    }));

  it("refuse une clé invalide sans ouvrir de lot, et journalise l'appel en échec", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);

      const refused = await openBatch(app, {
        accessToken,
        args: { projectId, intent: INTENTION, idempotencyKey: "" },
      });

      expect(refused).toEqual(refusal(INVALID_KEY));
      expect(await batchesOf(app, { accessToken, projectId })).toEqual([]);
      expect(await entriesOf(app, { accessToken, projectId, tool: "open_proposal_batch" })).toEqual(
        [{ outcome: "error", input: { intent: INTENTION } }],
      );
    }));

  it("répond qu'un projet hors d'accès est introuvable avant de juger la clé", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken } = await seedProject(app, db);

      const refused = await openBatch(app, {
        accessToken,
        args: { projectId: randomUUID(), intent: INTENTION, idempotencyKey: "" },
      });

      expect(refused).toEqual(refusal("Projet introuvable"));
    }));

  it("traite comme une nouvelle requête la même clé envoyée d'abord à write_tokens", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const idempotencyKey = randomUUID();
      const written = await callTool(app, {
        accessToken,
        name: "write_tokens",
        args: { projectId, tokens: [makeColorToken()], idempotencyKey },
      });

      const opened = await openBatch(app, {
        accessToken,
        args: { projectId, intent: INTENTION, idempotencyKey },
      });

      expect(opened.structuredContent).toEqual({
        batch: { id: expect.any(String), state: "open", intent: INTENTION },
        closed: { id: written.structuredContent.batch.id },
      });
    }));
});

describe("close_proposal_batch relancé avec la même clé d'idempotence rejoue son premier résultat", () => {
  it("rend le lot fermé la première fois, sans fermer le lot ouvert depuis", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      await openBatch(app, { accessToken, args: { projectId, intent: INTENTION } });
      const args = { projectId, idempotencyKey: randomUUID() };
      const first = await closeBatch(app, { accessToken, args });
      const reopened = await openBatch(app, {
        accessToken,
        args: { projectId, intent: "Refonte des couleurs" },
      });

      const retried = await closeBatch(app, { accessToken, args });

      expect(first.structuredContent.batch).toMatchObject({ state: "closed", intent: INTENTION });
      expect(retried).toEqual(first);
      expect(await batchesOf(app, { accessToken, projectId })).toContainEqual(
        expect.objectContaining({ id: reopened.structuredContent.batch.id, state: "open" }),
      );
    }));

  it("laisse une seule entrée de succès dans l'historique, puis une entrée marquée comme rejeu", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      await openBatch(app, { accessToken, args: { projectId, intent: INTENTION } });
      const args = { projectId, idempotencyKey: randomUUID() };
      await closeBatch(app, { accessToken, args });

      await closeBatch(app, { accessToken, args });

      expect(
        await entriesOf(app, { accessToken, projectId, tool: "close_proposal_batch" }),
      ).toEqual([
        { outcome: "replayed", input: {} },
        { outcome: "success", input: {} },
      ]);
    }));

  it("refuse une clé invalide sans fermer le lot ouvert, et journalise l'appel en échec", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const opened = await openBatch(app, { accessToken, args: { projectId, intent: INTENTION } });

      const refused = await closeBatch(app, {
        accessToken,
        args: { projectId, idempotencyKey: "a".repeat(256) },
      });

      expect(refused).toEqual(refusal(INVALID_KEY));
      expect(await batchesOf(app, { accessToken, projectId })).toEqual([
        expect.objectContaining({ id: opened.structuredContent.batch.id, state: "open" }),
      ]);
      expect(
        await entriesOf(app, { accessToken, projectId, tool: "close_proposal_batch" }),
      ).toEqual([{ outcome: "error", input: {} }]);
    }));
});
