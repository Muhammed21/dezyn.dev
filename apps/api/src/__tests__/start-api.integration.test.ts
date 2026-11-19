import { connect } from "node:net";

import { afterAll, describe, expect, it } from "vitest";

import { LATEST_MIGRATION, migrate } from "@repo/db";
import { createThrowawayDatabase, withThrowawayDatabase } from "@repo/db/testing";

import { type RunningApi, startApi } from "../start-api.ts";

const CONFIG = {
  authSecret: "secret-de-test-de-32-caracteres-au-moins",
  baseURL: "http://127.0.0.1:3000",
  trustedIpHeader: "x-forwarded-for",
  smtp: { host: "127.0.0.1", port: 1025, from: "dezyn <no-reply@dezyn.test>" },
  webUrl: "http://127.0.0.1:5173",
};

describe("startApi", () => {
  it("refuse de démarrer sur un schéma en retard, en nommant la migration manquante", () =>
    withThrowawayDatabase(async ({ appUrl }) => {
      await expect(
        startApi({
          databaseUrl: appUrl,
          migration: LATEST_MIGRATION,
          port: 0,
          log: () => undefined,
          ...CONFIG,
        }),
      ).rejects.toThrow(
        `Schéma en retard : la migration ${LATEST_MIGRATION.tag} n'est pas appliquée`,
      );
    }));

  it("démarre sur un schéma à jour et répond à la sonde de santé", () =>
    withThrowawayDatabase(async ({ migratorUrl, appUrl }) => {
      await migrate({ connectionString: migratorUrl });

      const api = await startApi({
        databaseUrl: appUrl,
        migration: LATEST_MIGRATION,
        port: 0,
        log: () => undefined,
        ...CONFIG,
      });
      try {
        const response = await fetch(new URL("/health", api.url));

        expect(response.status).toBe(200);
      } finally {
        await api.close();
      }
    }));

  it("n'écoute plus une fois arrêtée", () =>
    withThrowawayDatabase(async ({ migratorUrl, appUrl }) => {
      await migrate({ connectionString: migratorUrl });
      const api = await startApi({
        databaseUrl: appUrl,
        migration: LATEST_MIGRATION,
        port: 0,
        log: () => undefined,
        ...CONFIG,
      });

      await api.close();

      await expect(fetch(new URL("/health", api.url))).rejects.toThrow("fetch failed");
    }));
});

const replyTo = (api: RunningApi, request: string) => {
  const { port } = new URL(api.url);
  return new Promise<string>((done, fail) => {
    const socket = connect({ host: "127.0.0.1", port: Number(port) }, () => {
      socket.write(request);
    });
    socket.setEncoding("utf8");
    socket.once("data", (data: string) => {
      socket.destroy();
      done(data);
    });
    socket.once("error", fail);
  });
};

// Ces tests attendent le délai du serveur (10 ou 30 s, plus une seconde de vérification). La base
// est créée et supprimée hors du test : DROP DATABASE attend un checkpoint de tout le cluster, dont
// la durée dépend des autres suites qui partagent le PostgreSQL (jusqu'à 11,7 s observées), et ne
// doit pas entamer la marge de 10 s laissée au démarrage et à l'arrêt de l'API.
const migrated = await createThrowawayDatabase();
await migrate({ connectionString: migrated.migratorUrl });

const startOnMigratedSchema = () =>
  startApi({
    databaseUrl: migrated.appUrl,
    migration: LATEST_MIGRATION,
    port: 0,
    log: () => undefined,
    ...CONFIG,
  });

describe("startApi ferme une connexion trop lente", () => {
  afterAll(() => migrated.drop());

  it("ferme en 408 une connexion dont les en-têtes n'arrivent pas en entier en 10 s", async () => {
    const api = await startOnMigratedSchema();
    try {
      const startedAt = Date.now();

      const reply = await replyTo(api, "GET /health HTTP/1.1\r\nhost: 127.0.0.1\r\n");

      expect(reply).toMatch(/^HTTP\/1\.1 408 /);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(10_000);
    } finally {
      await api.close();
    }
  }, 20_000);

  it("ferme en 408 une requête dont le corps n'arrive pas en entier en 30 s", async () => {
    const api = await startOnMigratedSchema();
    try {
      const startedAt = Date.now();

      const reply = await replyTo(
        api,
        [
          "POST /auth/sign-in/email HTTP/1.1",
          "host: 127.0.0.1",
          "content-type: application/json",
          "content-length: 10",
          "",
          "{",
        ].join("\r\n"),
      );

      expect(reply).toMatch(/^HTTP\/1\.1 408 /);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(30_000);
    } finally {
      await api.close();
    }
  }, 40_000);
});
