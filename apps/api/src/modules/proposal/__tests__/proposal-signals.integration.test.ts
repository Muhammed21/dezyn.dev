import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import type { LogRecord } from "#platform/logging.ts";
import { type App, callMcp, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { addToken, makeColorToken } from "#testing/token-fixtures.ts";

type Signal = { readonly projectId: string; readonly topics: readonly string[] };

const writeTokens = async (
  app: App,
  {
    accessToken,
    projectId,
    tokens,
  }: { accessToken: string; projectId: string; tokens: readonly unknown[] },
) => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: { name: "write_tokens", arguments: { projectId, tokens } },
  });
  const { result } = await response.json();
  return result;
};

const proposalCountOf = async (db: PostgresDatabase) => {
  const { rows } = await db.orm.execute<{ count: number }>(
    sql`select count(*)::int as count from proposal`,
  );
  return rows[0]?.count;
};

const recordSignals = () => {
  const state: { db?: PostgresDatabase; received: (Signal & { proposals?: number })[] } = {
    received: [],
  };
  return {
    state,
    signals: {
      changed: async (signal: Signal) => {
        state.received.push({
          ...signal,
          proposals: state.db === undefined ? undefined : await proposalCountOf(state.db),
        });
      },
    },
  };
};

describe("une écriture de l'IA signale les propositions de son projet (ADR 0046)", () => {
  it("un write_tokens réussi signale proposals une fois pour son projet, après le commit", () => {
    const { state, signals } = recordSignals();
    return withIdentityApp(
      async (app, db) => {
        state.db = db;
        const { accessToken, projectId } = await seedProject(app, db);

        await writeTokens(app, {
          accessToken,
          projectId,
          tokens: [
            makeColorToken({ name: "couleur.fond" }),
            makeColorToken({ name: "couleur.bord" }),
          ],
        });

        expect(state.received).toEqual([{ projectId, topics: ["proposals"], proposals: 2 }]);
      },
      { signals },
    );
  });

  it("un write_tokens refusé ne signale rien", () => {
    const { state, signals } = recordSignals();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);

        const result = await writeTokens(app, {
          accessToken,
          projectId,
          tokens: [
            makeColorToken({ name: "couleur.fond" }),
            makeColorToken({ name: "couleur.fond.clair" }),
          ],
        });

        expect(result.isError).toBe(true);
        expect(state.received).toEqual([]);
      },
      { signals },
    );
  });

  it("un write_tokens dont chaque token est déjà en attente à l'identique ne signale rien", () => {
    const { state, signals } = recordSignals();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const tokens = [makeColorToken({ name: "couleur.fond" })];
        await writeTokens(app, { accessToken, projectId, tokens });

        const result = await writeTokens(app, { accessToken, projectId, tokens });

        expect(result.structuredContent.unchanged).toEqual(["couleur.fond"]);
        expect(state.received).toHaveLength(1);
      },
      { signals },
    );
  });

  it("revenir à la valeur validée retire la proposition en attente, et le signale", () => {
    const { state, signals } = recordSignals();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        await addToken(app, { accessToken, projectId, token: makeColorToken() });
        const nightBlue = { colorSpace: "srgb", components: [0.1, 0.2, 0.4] };
        await writeTokens(app, {
          accessToken,
          projectId,
          tokens: [makeColorToken({ $value: nightBlue })],
        });

        const result = await writeTokens(app, {
          accessToken,
          projectId,
          tokens: [makeColorToken()],
        });

        expect(result.structuredContent).toMatchObject({
          proposals: [],
          unchanged: ["couleur.fond.primaire"],
          replaced: [expect.objectContaining({ name: "couleur.fond.primaire" })],
        });
        expect(state.received).toHaveLength(2);
      },
      { signals },
    );
  });

  it("sans adapter de signaux, comme avec l'API Node locale, write_tokens ne journalise aucune erreur", () => {
    const logged: LogRecord[] = [];
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);

        await writeTokens(app, {
          accessToken,
          projectId,
          tokens: [makeColorToken({ name: "couleur.fond" })],
        });

        expect(logged.filter(({ level }) => level === "error")).toEqual([]);
      },
      { log: (record) => logged.push(record) },
    );
  });

  it("un signal qui échoue est journalisé et ne change pas la réponse de write_tokens", () => {
    const logged: LogRecord[] = [];
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);

        const result = await writeTokens(app, {
          accessToken,
          projectId,
          tokens: [makeColorToken({ name: "couleur.fond" })],
        });

        expect(result.structuredContent.proposals).toHaveLength(1);
        expect(logged).toContainEqual(
          expect.objectContaining({
            level: "error",
            msg: "project signal failed",
            projectId,
            error: "Durable Object injoignable",
          }),
        );
      },
      {
        log: (record) => logged.push(record),
        signals: {
          changed: async () => {
            throw new Error("Durable Object injoignable");
          },
        },
      },
    );
  });
});
