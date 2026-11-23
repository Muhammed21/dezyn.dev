import { describe, expect, it } from "vitest";

import type { LogRecord } from "#platform/logging.ts";
import type { Fetch } from "#platform/resend-mailer.ts";

import { createWorker } from "../worker.ts";

const noOutgoingCall: Fetch = () => Promise.reject(new Error("aucun appel sortant attendu"));

const makeContext = () => ({ waitUntil: () => undefined });

const HYPERDRIVE_URL = "postgresql://app@127.0.0.1:1/dezyn";

const makeBindings = () => ({
  HYPERDRIVE: { connectionString: HYPERDRIVE_URL },
  BETTER_AUTH_SECRET: "secret-de-test-de-32-caracteres-au-moins",
  BETTER_AUTH_URL: "https://api.dezyn.dev",
  WEB_URL: "https://dezyn.dev",
});

const UNKNOWN_ROUTE = "https://api.dezyn.dev/route-inconnue";

const SCHEMA_BEHIND = new Error("Schéma en retard : la migration 0042_x n'est pas appliquée.");

const succeeding = () => async () => undefined;

describe("le Worker", () => {
  it("répond 500 au format problème et nomme chaque binding en cause quand sa configuration est invalide", async () => {
    const logged: LogRecord[] = [];
    const worker = createWorker({
      fetch: noOutgoingCall,
      log: (record) => logged.push(record),
      assertSchema: succeeding(),
    });

    const response = await worker.fetch(
      new Request("https://api.dezyn.dev/health"),
      { BETTER_AUTH_URL: "https://api.dezyn.dev", WEB_URL: "pas une url" },
      makeContext(),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(await response.json()).toEqual({
      type: "about:blank",
      title: "Erreur interne",
      status: 500,
      instance: "/health",
    });
    expect(logged).toEqual([
      {
        level: "error",
        msg: "invalid configuration",
        issues: [
          "BETTER_AUTH_SECRET : manquante",
          "WEB_URL : URL http(s) attendue",
          "HYPERDRIVE : manquante, comme DATABASE_URL",
        ],
      },
    ]);
  });

  it("répond 503 et journalise la migration manquante quand le schéma est en retard", async () => {
    const logged: LogRecord[] = [];
    const worker = createWorker({
      fetch: noOutgoingCall,
      log: (record) => logged.push(record),
      assertSchema: async () => {
        throw SCHEMA_BEHIND;
      },
    });

    const response = await worker.fetch(new Request(UNKNOWN_ROUTE), makeBindings(), makeContext());

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(await response.json()).toEqual({
      type: "about:blank",
      title: "Service indisponible",
      status: 503,
      instance: "/route-inconnue",
    });
    expect(logged).toEqual([
      expect.objectContaining({
        level: "error",
        msg: "schema check failed",
        error: SCHEMA_BEHIND.message,
      }),
    ]);
  });

  it("journalise aussi une vérification qui lève autre chose qu'une Error", async () => {
    const logged: LogRecord[] = [];
    const worker = createWorker({
      fetch: noOutgoingCall,
      log: (record) => logged.push(record),
      assertSchema: () => Promise.reject("base injoignable"),
    });

    const response = await worker.fetch(new Request(UNKNOWN_ROUTE), makeBindings(), makeContext());

    expect(response.status).toBe(503);
    expect(logged).toEqual([
      { level: "error", msg: "schema check failed", error: "base injoignable" },
    ]);
  });
});

const CRON = { cron: "*/15 * * * *", scheduledTime: 0 };

const makePolarBindings = () => ({
  ...makeBindings(),
  POLAR_ACCESS_TOKEN: "polar_oat_test",
  POLAR_WEBHOOK_SECRET: "whsec_test",
  POLAR_TEAM_PRODUCT_ID: "5b0c1d2e-3f4a-4b5c-8d6e-7f8a9b0c1d2e",
  POLAR_SERVER: "sandbox",
});

describe("la tâche planifiée du Worker rejoue les résiliations en attente", () => {
  it("journalise une configuration invalide sans toucher la base", async () => {
    const logged: LogRecord[] = [];
    const checked: string[] = [];
    const worker = createWorker({
      fetch: noOutgoingCall,
      log: (record) => logged.push(record),
      assertSchema: async (databaseUrl) => {
        checked.push(databaseUrl);
      },
    });

    await worker.scheduled(CRON, { WEB_URL: "pas une url" }, makeContext());

    expect(checked).toEqual([]);
    expect(logged).toEqual([
      expect.objectContaining({ level: "error", msg: "invalid configuration" }),
    ]);
  });

  it("ne fait rien sans Polar configuré", async () => {
    const logged: LogRecord[] = [];
    const checked: string[] = [];
    const worker = createWorker({
      fetch: noOutgoingCall,
      log: (record) => logged.push(record),
      assertSchema: async (databaseUrl) => {
        checked.push(databaseUrl);
      },
    });

    await worker.scheduled(CRON, makeBindings(), makeContext());

    expect(checked).toEqual([]);
    expect(logged).toEqual([{ level: "info", msg: "polar_cancellation_replay_skipped" }]);
  });

  it("journalise un schéma en retard sans rejouer", async () => {
    const logged: LogRecord[] = [];
    const worker = createWorker({
      fetch: noOutgoingCall,
      log: (record) => logged.push(record),
      assertSchema: async () => {
        throw SCHEMA_BEHIND;
      },
    });

    await worker.scheduled(CRON, makePolarBindings(), makeContext());

    expect(logged).toEqual([
      expect.objectContaining({
        level: "error",
        msg: "schema check failed",
        error: SCHEMA_BEHIND.message,
      }),
    ]);
  });
});
