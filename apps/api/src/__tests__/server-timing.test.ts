import { describe, expect, it } from "vitest";

import { makeApp, makeDatabase } from "#testing/make-app.ts";

const makeTimedDatabase = () =>
  makeDatabase({
    timeQueries: async (run) => {
      await run();
      return { queries: 3, durationMs: 1.25 };
    },
  });

describe("Server-Timing ne part que sur réglage explicite", () => {
  it("sans réglage, aucune réponse ne porte Server-Timing", async () => {
    const { app } = makeApp({ db: makeTimedDatabase() });

    const response = await app.request("/page-inconnue");

    expect(response.status).toBe(404);
    expect(response.headers.get("server-timing")).toBeNull();
  });

  it("réglage désactivé, aucune réponse ne porte Server-Timing", async () => {
    const { app } = makeApp({ db: makeTimedDatabase(), serverTiming: false });

    const response = await app.request("/page-inconnue");

    expect(response.headers.get("server-timing")).toBeNull();
  });

  it("réglage activé, la réponse annonce ses requêtes SQL et son temps en base", async () => {
    const { app } = makeApp({ db: makeTimedDatabase(), serverTiming: true });

    const response = await app.request("/page-inconnue");

    expect(response.status).toBe(404);
    expect(response.headers.get("server-timing")).toMatch(
      /^db;dur=1\.3;desc="3 requetes", total;dur=/,
    );
  });
});
