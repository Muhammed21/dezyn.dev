import { describe, expect, it } from "vitest";

import { createPostgresDatabase } from "#db";
import { PURGE_STATEMENT_TIMEOUT_MS } from "#modules/history/history-module.ts";
import type { LogSink } from "#platform/logging.ts";

import { runManualPurge } from "../manual-purge.ts";

const UNREACHABLE_DATABASE_URL = "postgresql://history_maintainer@127.0.0.1:1/dezyn";

const silentLog: LogSink = () => undefined;

const makeEnv = (overrides: Readonly<Record<string, string | undefined>> = {}) => ({
  DATABASE_URL_HISTORY_MAINTAINER: UNREACHABLE_DATABASE_URL,
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  MAIL_FROM: "dezyn <no-reply@dezyn.test>",
  ...overrides,
});

type OpenedDatabase = Parameters<typeof createPostgresDatabase>[0];

const makeSensedDatabases = () => {
  const opened: OpenedDatabase[] = [];
  const closed: string[] = [];
  const openDatabase = (options: OpenedDatabase) => {
    opened.push(options);
    const db = createPostgresDatabase(options);
    return {
      ...db,
      close: async () => {
        closed.push(options.url);
        await db.close();
      },
    };
  };
  return { opened, closed, openDatabase };
};

describe("la purge manuelle", () => {
  it("s'arrête sur la liste des problèmes de configuration, sans ouvrir la base", async () => {
    const { opened, openDatabase } = makeSensedDatabases();
    const printed: string[] = [];

    await expect(
      runManualPurge({
        env: makeEnv({
          DATABASE_URL_HISTORY_MAINTAINER: undefined,
          SMTP_HOST: undefined,
          SMTP_PORT: "pas un port",
        }),
        log: silentLog,
        openDatabase,
        print: (output) => printed.push(output),
      }),
    ).rejects.toThrow(
      new Error(
        [
          "Configuration invalide, voir .env.example :",
          "- DATABASE_URL_HISTORY_MAINTAINER : manquante",
          "- SMTP_HOST : manquante",
          "- SMTP_PORT : port entre 1 et 65535 attendu",
        ].join("\n"),
      ),
    );
    expect(opened).toEqual([]);
    expect(printed).toEqual([]);
  });

  it("ouvre la base du mainteneur d'historique avec le timeout de la purge", async () => {
    const { opened, openDatabase } = makeSensedDatabases();

    await runManualPurge({
      env: makeEnv(),
      log: silentLog,
      openDatabase,
      print: () => undefined,
    }).catch(() => undefined);

    expect(opened).toEqual([
      {
        url: UNREACHABLE_DATABASE_URL,
        log: silentLog,
        statementTimeoutMs: PURGE_STATEMENT_TIMEOUT_MS,
      },
    ]);
  });

  it("ferme la base et n'affiche rien quand la purge échoue", async () => {
    const { closed, openDatabase } = makeSensedDatabases();
    const printed: string[] = [];

    await expect(
      runManualPurge({
        env: makeEnv(),
        log: silentLog,
        openDatabase,
        print: (output) => printed.push(output),
      }),
    ).rejects.toThrow("Failed query");
    expect(closed).toEqual([UNREACHABLE_DATABASE_URL]);
    expect(printed).toEqual([]);
  });
});
