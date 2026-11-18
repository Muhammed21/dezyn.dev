import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import type { LogRecord } from "#platform/logging.ts";
import { type App, callMcp, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { schema } from "@repo/db";

type Signal = { readonly projectId: string; readonly topics: readonly string[] };

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

const readTokensEntriesOf = async (db: PostgresDatabase, projectId: string) =>
  (
    await db.orm
      .select({ id: schema.historyEntry.id })
      .from(schema.historyEntry)
      .where(
        and(
          eq(schema.historyEntry.projectId, projectId),
          eq(schema.historyEntry.action, "mcp.read_tokens"),
        ),
      )
  ).length;

const makeHistoryRecorder = () => {
  const state: {
    db?: PostgresDatabase;
    received: (Signal & { readonly recorded?: number })[];
  } = { received: [] };
  return {
    state,
    signals: {
      signalAt: async () => undefined,
      changed: async (signal: Signal) => {
        state.received.push({
          ...signal,
          recorded:
            state.db === undefined
              ? undefined
              : await readTokensEntriesOf(state.db, signal.projectId),
        });
      },
    },
  };
};

const HISTORY = ["history"];

describe("chaque appel de l'IA sur un projet signale son historique (ADR 0046)", () => {
  it("read_tokens signale history une fois, après l'écriture de son entrée", () => {
    const recorder = makeHistoryRecorder();
    return withIdentityApp(
      async (app, db) => {
        recorder.state.db = db;
        const { accessToken, projectId } = await seedProject(app, db);

        const result = await callTool(app, {
          accessToken,
          name: "read_tokens",
          args: { projectId },
        });

        expect(result.isError).not.toBe(true);
        expect(recorder.state.received).toEqual([{ projectId, topics: HISTORY, recorded: 1 }]);
      },
      { signals: recorder.signals },
    );
  });

  it("un appel refusé par l'outil est aussi tracé, et signale history", () => {
    const recorder = makeHistoryRecorder();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);

        const result = await callTool(app, {
          accessToken,
          name: "write_tokens",
          args: { projectId, tokens: [{ name: "couleur.fond", $type: "color", $value: "rouge" }] },
        });

        expect(result.isError).toBe(true);
        expect(recorder.state.received).toEqual([{ projectId, topics: HISTORY }]);
      },
      { signals: recorder.signals },
    );
  });

  it("sans historique écrit, l'appel ne signale rien", () => {
    const recorder = makeHistoryRecorder();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const mark = recorder.state.received.length;

        const result = await callTool(app, {
          accessToken,
          name: "read_tokens",
          args: { projectId },
        });

        expect(result.isError).toBe(true);
        expect(recorder.state.received.slice(mark)).toEqual([]);
      },
      {
        signals: recorder.signals,
        wrapHistoryWriter: (writer) => ({
          append: async (entries) => {
            if (entries.some(({ action }) => action.startsWith("mcp."))) {
              throw new Error("historique indisponible");
            }
            return writer.append(entries);
          },
        }),
      },
    );
  });

  it("un signal qui échoue est journalisé, et l'outil répond comme sans signal", () => {
    const logged: LogRecord[] = [];
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);

        const result = await callTool(app, {
          accessToken,
          name: "read_tokens",
          args: { projectId },
        });

        expect(result.isError).not.toBe(true);
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
          signalAt: async () => undefined,
          changed: async () => {
            throw new Error("Durable Object injoignable");
          },
        },
      },
    );
  });
});
