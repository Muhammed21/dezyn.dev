import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import type { HistoryWriter } from "#modules/history/contracts/history-writer.ts";
import { fingerprintOf } from "#platform/idempotency.ts";
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

const KEY_REUSED =
  "idempotency_key_reused : cette clé d'idempotence a déjà servi avec d'autres arguments ; choisis une clé nouvelle pour une autre écriture.";

const IN_PROGRESS =
  "idempotency_in_progress : un appel avec cette clé d'idempotence est encore en cours ; réessaie dans un instant.";

const INVALID_KEY =
  "invalid_idempotency_key : idempotencyKey compte de 1 à 255 caractères ASCII imprimables.";

const refusal = (text: string) => ({ content: [{ type: "text", text }], isError: true });

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

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

const KEY_LIFETIME_MINUTES = 24 * 60;

const seedIdempotencyKey = (
  db: PostgresDatabase,
  {
    userId,
    key,
    fingerprint,
    response = null,
    createdAt,
  }: {
    readonly userId: string;
    readonly key: string;
    readonly fingerprint: string;
    readonly response?: string | null;
    readonly createdAt: Date;
  },
) =>
  db.orm.insert(schema.idempotencyKey).values({
    id: randomUUID(),
    userId,
    scope: "mcp:write_tokens",
    key,
    fingerprint,
    state: response === null ? "in_progress" : "completed",
    response,
    createdAt,
  });

const writeEntriesOf = async (
  app: App,
  { accessToken, projectId }: { accessToken: string; projectId: string },
) =>
  (await historyOf(app, { accessToken, projectId })).filter(
    ({ action }: { action: string }) => action === "mcp.write_tokens",
  );

const makeLatch = () => {
  const latch = { resolve: () => {} };
  const promise = new Promise<void>((resolve) => {
    latch.resolve = resolve;
  });
  return { promise, resolve: () => latch.resolve() };
};

const makeHistoryGate = () => {
  const reached = makeLatch();
  const released = makeLatch();
  const gate = { pending: true };
  const wrapHistoryWriter = (writer: HistoryWriter): HistoryWriter => ({
    append: async (entries) => {
      if (gate.pending && entries.some(({ action }) => action.startsWith("mcp."))) {
        gate.pending = false;
        reached.resolve();
        await released.promise;
      }
      return writer.append(entries);
    },
  });
  return { reached: reached.promise, release: released.resolve, wrapHistoryWriter };
};

const closeMembership = (
  db: PostgresDatabase,
  { spaceId, userId }: { readonly spaceId: string; readonly userId: string },
) =>
  db.orm
    .update(schema.spaceMember)
    .set({ closedAt: new Date(), closedReason: "removed" })
    .where(
      and(
        eq(schema.spaceMember.spaceId, spaceId),
        eq(schema.spaceMember.userId, userId),
        isNull(schema.spaceMember.closedAt),
      ),
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

  it("ne crée aucune proposition et ne signale que l'entrée d'historique du rejeu", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const tokens = [makeColorToken({ name: "couleur.fond" })];
        const args = { projectId, tokens, idempotencyKey: randomUUID() };
        const first = await writeTokens(app, { accessToken, args });
        const signalsAfterFirst = recorder.received.length;
        const scheduledAfterFirst = recorder.scheduled.length;

        await writeTokens(app, { accessToken, args });

        const batch = await batchOf(app, {
          accessToken,
          batchId: first.structuredContent.batch.id,
        });
        expect(batch.proposals).toHaveLength(1);
        expect(recorder.since(signalsAfterFirst)).toEqual([{ projectId, topics: ["history"] }]);
        expect(recorder.scheduled).toHaveLength(scheduledAfterFirst);
      },
      { signals: recorder.signals },
    );
  });

  it("laisse dans l'historique une entrée marquée comme rejeu", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const tokens = [makeColorToken({ name: "couleur.fond" })];
      const args = { projectId, tokens, idempotencyKey: randomUUID() };
      await writeTokens(app, { accessToken, args });

      await writeTokens(app, { accessToken, args });

      const entries = await writeEntriesOf(app, { accessToken, projectId });
      expect(entries.map(({ after }: { after: unknown }) => after)).toEqual([
        { outcome: "replayed", input: { tokens } },
        { outcome: "success", input: { tokens } },
      ]);
    }));

  it("refuse le rejeu à un membre retiré de l'espace depuis son premier appel", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId, spaceId, userId } = await seedProjectAsEditor(app, db);
      const args = {
        projectId,
        tokens: [makeColorToken({ name: "couleur.fond" })],
        idempotencyKey: randomUUID(),
      };
      await writeTokens(app, { accessToken, args });
      await closeMembership(db, { spaceId, userId });

      const retried = await writeTokens(app, { accessToken, args });

      expect(retried).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "Projet introuvable" }],
      });
    }));

  it("rejoue un refus des tokens, qui n'est pas une erreur serveur", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const tokens = [{ name: "couleur.fond", $type: "color" }];
      const args = { projectId, tokens, idempotencyKey: randomUUID() };
      const first = await writeTokens(app, { accessToken, args });

      const retried = await writeTokens(app, { accessToken, args });

      expect(first.isError).toBe(true);
      expect(retried).toEqual(first);
      const entries = await writeEntriesOf(app, { accessToken, projectId });
      expect(entries.map(({ after }: { after: unknown }) => after)).toEqual([
        { outcome: "replayed", input: { tokens } },
        { outcome: "error", input: { tokens } },
      ]);
    }));

  it("ne mémorise pas un historique indisponible : la relance s'exécute, puis se rejoue", () => {
    const history = { failures: 1 };
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const tokens = [makeColorToken({ name: "couleur.fond" })];
        const args = { projectId, tokens, idempotencyKey: randomUUID() };
        const first = await writeTokens(app, { accessToken, args });

        const retried = await writeTokens(app, { accessToken, args });
        const replayed = await writeTokens(app, { accessToken, args });

        expect(first.content).toEqual([{ type: "text", text: "Historique indisponible" }]);
        expect(retried.structuredContent.unchanged).toEqual(["couleur.fond"]);
        expect(replayed).toEqual(retried);
        const entries = await writeEntriesOf(app, { accessToken, projectId });
        expect(entries.map(({ after }: { after: unknown }) => after)).toEqual([
          { outcome: "replayed", input: { tokens } },
          { outcome: "success", input: { tokens } },
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

  it("libère la clé d'un appel qui lève une exception : la relance s'exécute, puis se rejoue", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const args = {
        projectId,
        tokens: [makeColorToken({ name: "couleur.fond" })],
        idempotencyKey: randomUUID(),
      };
      const first = await db.orm.transaction(async (tx) => {
        await tx
          .select()
          .from(schema.project)
          .where(eq(schema.project.id, projectId))
          .for("update");
        return writeTokens(app, { accessToken, args });
      });

      const retried = await writeTokens(app, { accessToken, args });
      const replayed = await writeTokens(app, { accessToken, args });

      expect(first.isError).toBe(true);
      expect(retried.structuredContent.proposals).toHaveLength(1);
      expect(replayed).toEqual(retried);
    }));

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

  it.each(["write_tokens", "open_proposal_batch", "close_proposal_batch", "declare_figma_states"])(
    "annonce idempotencyKey comme un argument optionnel de %s, et dit quand le réutiliser",
    (toolName) =>
      withIdentityApp(async (app, db) => {
        const { accessToken } = await seedProject(app, db);

        const response = await callMcp(app, { token: accessToken, method: "tools/list" });

        const { result } = await response.json();
        const tool = result.tools.find(({ name }: { name: string }) => name === toolName);
        expect(tool.inputSchema.properties.idempotencyKey).toMatchObject({
          type: "string",
          description: IDEMPOTENCY_KEY_DESCRIPTION,
        });
        expect(tool.inputSchema.required).not.toContain("idempotencyKey");
      }),
  );

  it("n'annonce idempotencyKey sur aucun outil de lecture", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken } = await seedProject(app, db);

      const response = await callMcp(app, { token: accessToken, method: "tools/list" });

      const { result } = await response.json();
      const keyed = result.tools
        .filter(
          ({ inputSchema }: { inputSchema: { properties?: Record<string, unknown> } }) =>
            inputSchema.properties?.idempotencyKey !== undefined,
        )
        .map(({ name }: { name: string }) => name)
        .toSorted();
      expect(keyed).toEqual([
        "close_proposal_batch",
        "declare_figma_states",
        "open_proposal_batch",
        "write_tokens",
      ]);
    }));
});

describe("une clé d'idempotence mal employée est refusée sans rien écrire", () => {
  it("refuse la même clé portée par d'autres arguments, sans écrire la seconde proposition", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const idempotencyKey = randomUUID();
      const fond = [makeColorToken({ name: "couleur.fond" })];
      const bord = [makeColorToken({ name: "couleur.bord" })];
      const first = await writeTokens(app, {
        accessToken,
        args: { projectId, tokens: fond, idempotencyKey },
      });

      const other = await writeTokens(app, {
        accessToken,
        args: { projectId, tokens: bord, idempotencyKey },
      });

      expect(other).toEqual(refusal(KEY_REUSED));
      const batch = await batchOf(app, {
        accessToken,
        batchId: first.structuredContent.batch.id,
      });
      expect(batch.proposals.map(({ name }: { name: string }) => name)).toEqual(["couleur.fond"]);
      const entries = await writeEntriesOf(app, { accessToken, projectId });
      expect(entries.map(({ after }: { after: unknown }) => after)).toEqual([
        { outcome: "error", input: { tokens: bord } },
        { outcome: "success", input: { tokens: fond } },
      ]);
    }));

  it("refuse la même clé quand une liste des arguments devient un objet aux mêmes indices", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const idempotencyKey = randomUUID();
      await writeTokens(app, {
        accessToken,
        args: {
          projectId,
          tokens: [makeColorToken({ $extensions: { "com.figma": { modes: ["clair"] } } })],
          idempotencyKey,
        },
      });

      const other = await writeTokens(app, {
        accessToken,
        args: {
          projectId,
          tokens: [makeColorToken({ $extensions: { "com.figma": { modes: { 0: "clair" } } } })],
          idempotencyKey,
        },
      });

      expect(other).toEqual(refusal(KEY_REUSED));
    }));

  it("refuse un appel qui arrive pendant le premier avec la même clé, puis rejoue le premier", () => {
    const gate = makeHistoryGate();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const args = {
          projectId,
          tokens: [makeColorToken({ name: "couleur.fond" })],
          idempotencyKey: randomUUID(),
        };
        const pending = writeTokens(app, { accessToken, args });
        await gate.reached;

        const concurrent = await writeTokens(app, { accessToken, args });
        gate.release();
        const first = await pending;
        const retried = await writeTokens(app, { accessToken, args });

        expect(concurrent).toEqual(refusal(IN_PROGRESS));
        expect(retried).toEqual(first);
        const batch = await batchOf(app, {
          accessToken,
          batchId: first.structuredContent.batch.id,
        });
        expect(batch.proposals).toHaveLength(1);
        const entries = await writeEntriesOf(app, { accessToken, projectId });
        expect(entries.map(({ after }: { after: { outcome: string } }) => after.outcome)).toEqual([
          "replayed",
          "error",
          "success",
        ]);
      },
      { wrapHistoryWriter: gate.wrapHistoryWriter },
    );
  });

  it.each([
    ["vide", ""],
    ["de 256 caractères", "a".repeat(256)],
    ["hors ASCII", "clé"],
    ["avec un retour à la ligne", "ligne\nsuivante"],
    ["avec un caractère de contrôle sous l'espace", "unité\u001f"],
    ["avec le caractère DEL", "effacer\u007f"],
  ])("refuse une clé %s sans ouvrir de lot, et journalise l'appel en échec", (_, idempotencyKey) =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const tokens = [makeColorToken()];
      const args = { projectId, tokens, idempotencyKey };

      const refused = await writeTokens(app, { accessToken, args });

      expect(refused).toEqual(refusal(INVALID_KEY));
      expect(await batchesOf(app, { accessToken, projectId })).toEqual([]);
      const entries = await writeEntriesOf(app, { accessToken, projectId });
      expect(entries.map(({ after }: { after: unknown }) => after)).toEqual([
        { outcome: "error", input: { tokens } },
      ]);
    }),
  );

  it("répond qu'un projet hors d'accès est introuvable avant de juger la clé", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken } = await seedProject(app, db);
      const args = { projectId: randomUUID(), tokens: [makeColorToken()], idempotencyKey: "" };

      const refused = await writeTokens(app, { accessToken, args });

      expect(refused).toEqual(refusal("Projet introuvable"));
    }));

  it("reprend une réservation restée en cours au-delà de la durée maximale d'un appel", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId, userId } = await seedProject(app, db);
      const args = { projectId, tokens: [makeColorToken()], idempotencyKey: randomUUID() };
      await seedIdempotencyKey(db, {
        userId,
        key: args.idempotencyKey,
        fingerprint: "appel abandonné",
        createdAt: minutesAgo(6),
      });

      const retried = await writeTokens(app, { accessToken, args });
      const replayed = await writeTokens(app, { accessToken, args });

      expect(retried.structuredContent.proposals).toHaveLength(1);
      expect(replayed).toEqual(retried);
    }));

  it("refuse un appel qui arrive pendant la reprise d'une réservation abandonnée", () => {
    const gate = makeHistoryGate();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId, userId } = await seedProject(app, db);
        const args = { projectId, tokens: [makeColorToken()], idempotencyKey: randomUUID() };
        await seedIdempotencyKey(db, {
          userId,
          key: args.idempotencyKey,
          fingerprint: "appel abandonné",
          createdAt: minutesAgo(6),
        });
        const pending = writeTokens(app, { accessToken, args });
        await gate.reached;

        const concurrent = await writeTokens(app, { accessToken, args });
        gate.release();
        const takenOver = await pending;

        expect(concurrent).toEqual(refusal(IN_PROGRESS));
        expect(takenOver.structuredContent.proposals).toHaveLength(1);
      },
      { wrapHistoryWriter: gate.wrapHistoryWriter },
    );
  });

  it("date une réservation à l'heure de la base, même si l'horloge de l'app retarde", () => {
    const gate = makeHistoryGate();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const args = { projectId, tokens: [makeColorToken()], idempotencyKey: randomUUID() };
        const pending = writeTokens(app, { accessToken, args });
        await gate.reached;

        const concurrent = await writeTokens(app, { accessToken, args });
        gate.release();
        const first = await pending;

        expect(concurrent).toEqual(refusal(IN_PROGRESS));
        expect(first.structuredContent.proposals).toHaveLength(1);
      },
      { wrapHistoryWriter: gate.wrapHistoryWriter, clock: () => minutesAgo(60) },
    );
  });

  it("refuse encore une réservation en cours plus jeune que la durée maximale d'un appel", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId, userId } = await seedProject(app, db);
      const args = { projectId, tokens: [makeColorToken()], idempotencyKey: randomUUID() };
      const { idempotencyKey, ...fingerprinted } = args;
      await seedIdempotencyKey(db, {
        userId,
        key: idempotencyKey,
        fingerprint: fingerprintOf(fingerprinted),
        createdAt: minutesAgo(4),
      });

      const refused = await writeTokens(app, { accessToken, args });

      expect(refused).toEqual(refusal(IN_PROGRESS));
      expect(await batchesOf(app, { accessToken, projectId })).toEqual([]);
    }));

  it("rejoue une réponse mémorisée même au-delà de la durée maximale d'un appel", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId, userId } = await seedProject(app, db);
      const args = { projectId, tokens: [makeColorToken()], idempotencyKey: randomUUID() };
      const { idempotencyKey, ...fingerprinted } = args;
      const memorized = refusal("première réponse");
      await seedIdempotencyKey(db, {
        userId,
        key: idempotencyKey,
        fingerprint: fingerprintOf(fingerprinted),
        response: JSON.stringify(memorized),
        createdAt: minutesAgo(6),
      });

      const replayed = await writeTokens(app, { accessToken, args });

      expect(replayed).toEqual(memorized);
      expect(await batchesOf(app, { accessToken, projectId })).toEqual([]);
    }));

  it.each([
    ["de 255 caractères", "a".repeat(255)],
    ["d'un caractère", "k"],
    ["aux bornes de l'ASCII imprimable", " ~"],
  ])("accepte une clé %s et rejoue son premier appel", (_, idempotencyKey) =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const args = { projectId, tokens: [makeColorToken()], idempotencyKey };
      const first = await writeTokens(app, { accessToken, args });

      const retried = await writeTokens(app, { accessToken, args });

      expect(first.structuredContent.proposals).toHaveLength(1);
      expect(retried).toEqual(first);
    }),
  );
});

describe("une clé d'idempotence est oubliée au bout de 24 heures", () => {
  it("rejoue encore une réponse mémorisée depuis un peu moins de 24 heures", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId, userId } = await seedProject(app, db);
      const args = { projectId, tokens: [makeColorToken()], idempotencyKey: randomUUID() };
      const { idempotencyKey, ...fingerprinted } = args;
      const memorized = refusal("première réponse");
      await seedIdempotencyKey(db, {
        userId,
        key: idempotencyKey,
        fingerprint: fingerprintOf(fingerprinted),
        response: JSON.stringify(memorized),
        createdAt: minutesAgo(KEY_LIFETIME_MINUTES - 1),
      });

      const replayed = await writeTokens(app, { accessToken, args });

      expect(replayed).toEqual(memorized);
      expect(await batchesOf(app, { accessToken, projectId })).toEqual([]);
    }));

  it("oublie une réponse mémorisée depuis plus de 24 heures : la relance s'exécute, puis se rejoue", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId, userId } = await seedProject(app, db);
      const args = { projectId, tokens: [makeColorToken()], idempotencyKey: randomUUID() };
      const { idempotencyKey, ...fingerprinted } = args;
      await seedIdempotencyKey(db, {
        userId,
        key: idempotencyKey,
        fingerprint: fingerprintOf(fingerprinted),
        response: JSON.stringify(refusal("première réponse")),
        createdAt: minutesAgo(KEY_LIFETIME_MINUTES + 1),
      });

      const executed = await writeTokens(app, { accessToken, args });
      const replayed = await writeTokens(app, { accessToken, args });

      expect(executed.structuredContent.proposals).toHaveLength(1);
      expect(replayed).toEqual(executed);
      expect(await batchesOf(app, { accessToken, projectId })).toHaveLength(1);
    }));

  it("traite comme nouvelle une clé de plus de 24 heures reprise avec d'autres arguments, puis la rejoue", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId, userId } = await seedProject(app, db);
      const args = { projectId, tokens: [makeColorToken()], idempotencyKey: randomUUID() };
      await seedIdempotencyKey(db, {
        userId,
        key: args.idempotencyKey,
        fingerprint: "arguments d'une écriture d'hier",
        response: JSON.stringify(refusal("première réponse")),
        createdAt: minutesAgo(KEY_LIFETIME_MINUTES + 1),
      });

      const executed = await writeTokens(app, { accessToken, args });
      const replayed = await writeTokens(app, { accessToken, args });

      expect(executed.structuredContent.proposals).toHaveLength(1);
      expect(replayed).toEqual(executed);
    }));

  it("refuse un appel qui arrive pendant la reprise d'une clé de plus de 24 heures", () => {
    const gate = makeHistoryGate();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId, userId } = await seedProject(app, db);
        const args = { projectId, tokens: [makeColorToken()], idempotencyKey: randomUUID() };
        const { idempotencyKey, ...fingerprinted } = args;
        await seedIdempotencyKey(db, {
          userId,
          key: idempotencyKey,
          fingerprint: fingerprintOf(fingerprinted),
          response: JSON.stringify(refusal("première réponse")),
          createdAt: minutesAgo(KEY_LIFETIME_MINUTES + 1),
        });
        const pending = writeTokens(app, { accessToken, args });
        await gate.reached;

        const concurrent = await writeTokens(app, { accessToken, args });
        gate.release();
        const takenOver = await pending;

        expect(concurrent).toEqual(refusal(IN_PROGRESS));
        expect(takenOver.structuredContent.proposals).toHaveLength(1);
      },
      { wrapHistoryWriter: gate.wrapHistoryWriter },
    );
  });
});
