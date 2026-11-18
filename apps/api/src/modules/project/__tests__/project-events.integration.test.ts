import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import {
  ADA,
  type App,
  BASE_URL,
  GRACE,
  makeClientIp,
  signUp,
  WEB_URL,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { personalSpaceOf } from "#testing/space-fixtures.ts";

const signInCookie = async (app: App, { ip, user }: { ip: string; user: typeof ADA }) => {
  const response = await app.request(`${BASE_URL}/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL, "x-forwarded-for": ip },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  const [pair = ""] = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
  return pair;
};

const signedIn = async (app: App, user: typeof ADA) => {
  const ip = makeClientIp();
  const userId = await signUp(app, ip, user);
  return { userId, cookie: await signInCookie(app, { ip, user }) };
};

const seedWebProject = async (app: App, db: PostgresDatabase) => {
  const { userId, cookie } = await signedIn(app, ADA);
  const response = await app.request(
    `${BASE_URL}/v1/spaces/${await personalSpaceOf(db, userId)}/projects`,
    {
      method: "POST",
      headers: { cookie, origin: WEB_URL, "content-type": "application/json" },
      body: JSON.stringify({ name: "Projet suivi en direct" }),
    },
  );
  const { id } = await response.json();
  return { cookie, projectId: id };
};

const WEBSOCKET_UPGRADE = { upgrade: "websocket" };

const subscribe = (
  app: App,
  { projectId, headers }: { projectId: string; headers: Record<string, string> },
) => app.request(`${BASE_URL}/v1/projects/${projectId}/events`, { headers });

const recordChannel = () => {
  const connected: string[] = [];
  return {
    connected,
    channel: {
      connect: async ({ projectId }: { projectId: string; request: Request }) => {
        connected.push(projectId);
        return new Response("abonné", { status: 200 });
      },
    },
  };
};

describe("un membre s'abonne aux signaux d'un projet par WebSocket (ADR 0046)", () => {
  it("la poignée de main d'un membre depuis l'app web est transmise au canal de son projet", () => {
    const { connected, channel } = recordChannel();
    return withIdentityApp(
      async (app, db) => {
        const { cookie, projectId } = await seedWebProject(app, db);

        const response = await subscribe(app, {
          projectId,
          headers: { cookie, origin: WEB_URL, ...WEBSOCKET_UPGRADE },
        });

        expect(await response.text()).toBe("abonné");
        expect(connected).toEqual([projectId]);
      },
      { channel },
    );
  });

  it("un membre d'un autre espace reçoit 404, sans toucher au canal", () => {
    const { connected, channel } = recordChannel();
    return withIdentityApp(
      async (app, db) => {
        const { projectId } = await seedWebProject(app, db);
        const { cookie } = await signedIn(app, GRACE);

        const response = await subscribe(app, {
          projectId,
          headers: { cookie, origin: WEB_URL, ...WEBSOCKET_UPGRADE },
        });

        expect(response.status).toBe(404);
        expect(connected).toEqual([]);
      },
      { channel },
    );
  });

  it("un projet inconnu ou un identifiant qui n'est pas un UUID répond 404", () => {
    const { connected, channel } = recordChannel();
    return withIdentityApp(
      async (app, db) => {
        const { cookie } = await seedWebProject(app, db);
        const headers = { cookie, origin: WEB_URL, ...WEBSOCKET_UPGRADE };

        const unknown = await subscribe(app, { projectId: randomUUID(), headers });
        const malformed = await subscribe(app, { projectId: "pas-un-uuid", headers });

        expect([unknown.status, malformed.status]).toEqual([404, 404]);
        expect(connected).toEqual([]);
      },
      { channel },
    );
  });

  it("une poignée de main venue d'une autre origine, ou sans origine, reçoit 403", () => {
    const { connected, channel } = recordChannel();
    return withIdentityApp(
      async (app, db) => {
        const { cookie, projectId } = await seedWebProject(app, db);

        const foreign = await subscribe(app, {
          projectId,
          headers: { cookie, origin: "https://evil.dezyn.dev", ...WEBSOCKET_UPGRADE },
        });
        const missing = await subscribe(app, {
          projectId,
          headers: { cookie, ...WEBSOCKET_UPGRADE },
        });

        expect([foreign.status, missing.status]).toEqual([403, 403]);
        expect(connected).toEqual([]);
      },
      { channel },
    );
  });

  it("sans cookie de session, la poignée de main reçoit 401", () => {
    const { connected, channel } = recordChannel();
    return withIdentityApp(
      async (app, db) => {
        const { projectId } = await seedWebProject(app, db);

        const response = await subscribe(app, {
          projectId,
          headers: { origin: WEB_URL, ...WEBSOCKET_UPGRADE },
        });

        expect(response.status).toBe(401);
        expect(connected).toEqual([]);
      },
      { channel },
    );
  });

  it("une requête sans Upgrade: websocket reçoit 426, sans toucher au canal", () => {
    const { connected, channel } = recordChannel();
    return withIdentityApp(
      async (app, db) => {
        const { cookie, projectId } = await seedWebProject(app, db);

        const response = await subscribe(app, {
          projectId,
          headers: { cookie, origin: WEB_URL },
        });

        expect(response.status).toBe(426);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
        expect(await response.json()).toMatchObject({
          type: "about:blank",
          title: "Mise à niveau WebSocket attendue",
          status: 426,
        });
        expect(connected).toEqual([]);
      },
      { channel },
    );
  });

  it("sans canal, comme avec l'API Node locale, l'abonnement répond 503", () =>
    withIdentityApp(async (app, db) => {
      const { cookie, projectId } = await seedWebProject(app, db);

      const response = await subscribe(app, {
        projectId,
        headers: { cookie, origin: WEB_URL, ...WEBSOCKET_UPGRADE },
      });

      expect(response.status).toBe(503);
      expect(response.headers.get("content-type")).toBe("application/problem+json");
      expect(await response.json()).toEqual({
        type: "about:blank",
        title: "Temps réel indisponible",
        status: 503,
      });
    }));
});
