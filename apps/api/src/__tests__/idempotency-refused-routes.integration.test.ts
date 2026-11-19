import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CONSENT_PATH, LOGIN_PATH } from "#modules/identity/presentation/pages.ts";
import { type App, BASE_URL, makeClientIp, withIdentityApp } from "#testing/authorization-flow.ts";
import { makeOutbox, seedSpaceWithInvitedEditor } from "#testing/space-fixtures.ts";
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "@repo/contracts";

const INVALID_KEY = "a".repeat(256);

const memberWrite = (
  app: App,
  {
    accessToken,
    method,
    path,
    body,
    idempotencyKey,
  }: {
    readonly accessToken: string;
    readonly method: "PATCH" | "DELETE";
    readonly path: string;
    readonly body?: object;
    readonly idempotencyKey: string;
  },
) =>
  app.request(`${BASE_URL}/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Seeded = Awaited<ReturnType<typeof seedSpaceWithInvitedEditor>>;

const MEMBER_WRITES = [
  {
    name: "un changement de rôle",
    status: 200,
    request: ({ ada, grace, spaceId }: Seeded) => ({
      accessToken: ada.accessToken,
      method: "PATCH" as const,
      path: `/spaces/${spaceId}/members/${grace.userId}`,
      body: { role: "owner" },
    }),
  },
  {
    name: "le retrait d'un membre",
    status: 204,
    request: ({ ada, grace, spaceId }: Seeded) => ({
      accessToken: ada.accessToken,
      method: "DELETE" as const,
      path: `/spaces/${spaceId}/members/${grace.userId}`,
    }),
  },
  {
    name: "un départ",
    status: 204,
    request: ({ grace, spaceId }: Seeded) => ({
      accessToken: grace.accessToken,
      method: "DELETE" as const,
      path: `/spaces/${spaceId}/members/me`,
    }),
  },
];

describe("les changements de rôle et les départs n'acceptent pas d'Idempotency-Key : l'en-tête est ignoré", () => {
  it.each(MEMBER_WRITES)(
    "$name avec une clé invalide s'exécute comme sans clé, sans refus 400",
    ({ status, request }) => {
      const outbox = makeOutbox();
      return withIdentityApp(
        async (app, db) => {
          const seeded = await seedSpaceWithInvitedEditor(app, db, outbox);

          const response = await memberWrite(app, {
            ...request(seeded),
            idempotencyKey: INVALID_KEY,
          });

          expect(response.status).toBe(status);
          expect(response.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
        },
        { mailer: outbox.mailer },
      );
    },
  );

  it("un départ renvoyé avec la même clé s'exécute de nouveau : 404, comme sans clé, au lieu d'un rejeu du 204", () => {
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { grace, spaceId } = await seedSpaceWithInvitedEditor(app, db, outbox);
        const request = {
          accessToken: grace.accessToken,
          method: "DELETE" as const,
          path: `/spaces/${spaceId}/members/me`,
          idempotencyKey: randomUUID(),
        };
        await memberWrite(app, request);

        const retried = await memberWrite(app, request);

        expect(retried.status).toBe(404);
        expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
      },
      { mailer: outbox.mailer },
    );
  });
});

const sendPage = (
  app: App,
  { method, path, idempotencyKey }: { method: string; path: string; idempotencyKey?: string },
) =>
  app.request(`${BASE_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: BASE_URL,
      ...(idempotencyKey === undefined ? {} : { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey }),
    },
    ...(method === "POST" ? { body: "" } : {}),
  });

const outcomeOf = (response: Response) => ({
  status: response.status,
  contentType: response.headers.get("content-type"),
  replayed: response.headers.get(IDEMPOTENCY_REPLAYED_HEADER),
});

describe("les pages d'autorisation OAuth et les routes de better-auth ignorent l'Idempotency-Key", () => {
  it.each([
    ["GET", LOGIN_PATH],
    ["POST", LOGIN_PATH],
    ["GET", CONSENT_PATH],
    ["POST", CONSENT_PATH],
  ])("%s %s répond avec une clé invalide comme sans clé", (method, path) =>
    withIdentityApp(async (app) => {
      const withoutKey = await sendPage(app, { method, path });

      const withKey = await sendPage(app, { method, path, idempotencyKey: INVALID_KEY });

      expect(outcomeOf(withKey)).toEqual(outcomeOf(withoutKey));
    }),
  );

  it("l'inscription de better-auth avec une clé invalide crée le compte, sans refus 400", () =>
    withIdentityApp(async (app) => {
      const response = await app.request(`${BASE_URL}/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: BASE_URL,
          "x-forwarded-for": makeClientIp(),
          [IDEMPOTENCY_KEY_HEADER]: INVALID_KEY,
        },
        body: JSON.stringify({
          name: "Ada Lovelace",
          email: "ada@dezyn.test",
          password: "un-mot-de-passe-solide",
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
    }));
});
