import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import {
  type App,
  BASE_URL,
  obtainAccessToken,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { demoteToEditor, personalSpaceOf } from "#testing/space-fixtures.ts";
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "@repo/contracts";

const createProjectWithKey = (
  app: App,
  {
    accessToken,
    spaceId,
    idempotencyKey,
  }: { readonly accessToken: string; readonly spaceId: string; readonly idempotencyKey?: string },
) =>
  app.request(`${BASE_URL}/v1/spaces/${spaceId}/projects`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(idempotencyKey === undefined ? {} : { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey }),
    },
    body: JSON.stringify({ name: "Site vitrine" }),
  });

const projectsOf = async (
  app: App,
  { accessToken, spaceId }: { readonly accessToken: string; readonly spaceId: string },
) => {
  const response = await app.request(`${BASE_URL}/v1/spaces/${spaceId}/projects`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const { projects } = await response.json();
  return projects;
};

const seedOwner = async (app: App, db: PostgresDatabase) => {
  const owner = await obtainAccessToken(app);
  return { ...owner, spaceId: await personalSpaceOf(db, owner.userId) };
};

const withoutCorrelation = async (response: Response) => {
  const { correlationId: _correlationId, ...body } = await response.json();
  return { status: response.status, body };
};

describe("une création de projet renvoyée avec la même Idempotency-Key ne crée qu'un projet", () => {
  it("rejoue le 201 et le corps du premier envoi, signalés par Idempotency-Replayed", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, spaceId } = await seedOwner(app, db);
      const request = { accessToken, spaceId, idempotencyKey: randomUUID() };
      const first = await createProjectWithKey(app, request);
      const firstBody = await first.json();

      const retried = await createProjectWithKey(app, request);

      expect(first.status).toBe(201);
      expect(retried.status).toBe(201);
      expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe("true");
      expect(await retried.json()).toEqual(firstBody);
      expect(await projectsOf(app, { accessToken, spaceId })).toHaveLength(1);
    }));

  it("ne rejoue pas la création à un membre qui ne peut plus créer de projet : il reçoit la réponse d'un envoi sans clé", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, spaceId, userId } = await seedOwner(app, db);
      const request = { accessToken, spaceId, idempotencyKey: randomUUID() };
      await createProjectWithKey(app, request);
      await demoteToEditor(db, { spaceId, userId });
      const withoutKey = await createProjectWithKey(app, { accessToken, spaceId });

      const retried = await createProjectWithKey(app, request);

      expect(retried.status).toBe(403);
      expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
      expect(await withoutCorrelation(retried)).toEqual(await withoutCorrelation(withoutKey));
    }));
});
