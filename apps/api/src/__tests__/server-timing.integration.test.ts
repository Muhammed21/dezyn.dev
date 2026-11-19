import { describe, expect, it } from "vitest";

import { type App, BASE_URL, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { countRoundTrips } from "#testing/round-trips.ts";
import { addToken } from "#testing/token-fixtures.ts";

const SERVER_TIMING =
  /^db;dur=(?<db>\d+(?:\.\d+)?);desc="(?<queries>\d+) requetes", total;dur=(?<total>\d+(?:\.\d+)?)$/;

const MORE_REQUESTS_THAN_POOLED_CONNECTIONS = 15;

const serverTimingOf = (response: Response) => {
  const groups = SERVER_TIMING.exec(response.headers.get("server-timing") ?? "")?.groups;
  return {
    db: Number(groups?.db),
    queries: Number(groups?.queries),
    total: Number(groups?.total),
  };
};

const readTokens = (
  app: App,
  { accessToken, projectId }: { readonly accessToken: string; readonly projectId: string },
) =>
  app.request(`${BASE_URL}/v1/projects/${projectId}/tokens`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

const readUnknownPage = (app: App) => app.request(`${BASE_URL}/page-inconnue`);

describe("chaque réponse de l'API porte Server-Timing", () => {
  it("la lecture des tokens d'un projet annonce le temps passé en base et ses requêtes SQL", () =>
    withIdentityApp(async (app, db) => {
      const project = await seedProject(app, db);
      await addToken(app, project);

      const startedAt = performance.now();
      const { result: response, roundTrips } = await countRoundTrips(async () =>
        readTokens(app, project),
      );
      const elapsed = performance.now() - startedAt;

      const timing = serverTimingOf(response);
      expect(response.status).toBe(200);
      expect(response.headers.get("server-timing")).toMatch(SERVER_TIMING);
      expect(roundTrips).toBeGreaterThan(0);
      expect(timing.queries).toBe(roundTrips);
      expect(timing.db).toBeGreaterThan(0);
      expect(timing.total).toBeGreaterThanOrEqual(timing.db);
      expect(timing.total).toBeGreaterThan(elapsed / 2);
      expect(timing.total).toBeLessThanOrEqual(elapsed);
    }));

  it("l'ajout d'un token, écrit dans une transaction, annonce chacune de ses requêtes SQL", () =>
    withIdentityApp(async (app, db) => {
      const project = await seedProject(app, db);

      const { result: response, roundTrips } = await countRoundTrips(async () =>
        addToken(app, project),
      );

      expect(response.status).toBe(201);
      expect(roundTrips).toBeGreaterThan(0);
      expect(serverTimingOf(response).queries).toBe(roundTrips);
    }));

  it("/health annonce le temps passé par ses requêtes SQL successives", () =>
    withIdentityApp(async (app) => {
      const { result: response, roundTrips } = await countRoundTrips(async () =>
        app.request(`${BASE_URL}/health`),
      );

      const timing = serverTimingOf(response);
      expect(response.status).toBe(200);
      expect(timing.queries).toBe(roundTrips);
      expect(timing.db).toBeGreaterThan(0);
    }));

  it("une réponse qui n'interroge pas la base annonce 0 ms et 0 requête en base", () =>
    withIdentityApp(async (app) => {
      const response = await readUnknownPage(app);

      expect(response.status).toBe(404);
      expect(response.headers.get("server-timing")).toMatch(/^db;dur=0;desc="0 requetes", /);
      expect(response.headers.get("server-timing")).toMatch(/^[\x20-\x7e]+$/);
    }));

  it("une connexion n'annonce pas ses requêtes SQL, qui trahiraient si l'e-mail existe", () =>
    withIdentityApp(async (app) => {
      const response = await app.request(`${BASE_URL}/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "inconnu@exemple.fr", password: "mot-de-passe-faux" }),
      });

      expect(response.headers.get("server-timing")).toBeNull();
    }));

  it("des requêtes simultanées comptent chacune leurs propres requêtes SQL", () =>
    withIdentityApp(async (app, db) => {
      const project = await seedProject(app, db);
      await addToken(app, project);
      const alone = serverTimingOf(await readTokens(app, project));

      const [unknownPage, ...tokenReads] = await Promise.all([
        readUnknownPage(app),
        ...Array.from({ length: MORE_REQUESTS_THAN_POOLED_CONNECTIONS }, () =>
          readTokens(app, project),
        ),
      ]);

      expect(alone.queries).toBeGreaterThan(0);
      expect(serverTimingOf(unknownPage ?? new Response()).queries).toBe(0);
      expect(tokenReads.map((response) => serverTimingOf(response).queries)).toEqual(
        tokenReads.map(() => alone.queries),
      );
    }));
});
