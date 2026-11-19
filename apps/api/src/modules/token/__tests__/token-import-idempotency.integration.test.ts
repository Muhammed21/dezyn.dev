import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { type App, BASE_URL, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProjectAsEditor } from "#testing/project-fixtures.ts";
import { closeMembership } from "#testing/space-fixtures.ts";
import { historyOf, PRIMARY_BLUE } from "#testing/token-fixtures.ts";
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "@repo/contracts";

const makeDocument = () => ({
  couleur: { fond: { $type: "color", $value: PRIMARY_BLUE } },
});

const importWithKey = (
  app: App,
  {
    accessToken,
    projectId,
    idempotencyKey,
  }: { readonly accessToken: string; readonly projectId: string; readonly idempotencyKey?: string },
) =>
  app.request(`${BASE_URL}/v1/projects/${projectId}/tokens/import`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(idempotencyKey === undefined ? {} : { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey }),
    },
    body: JSON.stringify(makeDocument()),
  });

const withoutCorrelation = async (response: Response) => {
  const { correlationId: _correlationId, ...body } = await response.json();
  return { status: response.status, body };
};

describe("un import renvoyé avec la même Idempotency-Key rend le même résultat", () => {
  it("rejoue le 201 du premier import au lieu d'un refus pour des noms déjà pris, sans réécrire l'historique", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProjectAsEditor(app, db);
      const request = { accessToken, projectId, idempotencyKey: randomUUID() };
      const first = await importWithKey(app, request);
      const firstBody = await first.json();
      const historyAfterFirst = await historyOf(app, { accessToken, projectId });

      const retried = await importWithKey(app, request);

      expect(first.status).toBe(201);
      expect(retried.status).toBe(201);
      expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe("true");
      expect(await retried.json()).toEqual(firstBody);
      expect(await historyOf(app, { accessToken, projectId })).toEqual(historyAfterFirst);
    }));

  it("ne rejoue pas l'import à un membre retiré de l'espace : il reçoit la réponse d'un envoi sans clé", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId, spaceId, userId } = await seedProjectAsEditor(app, db);
      const request = { accessToken, projectId, idempotencyKey: randomUUID() };
      await importWithKey(app, request);
      await closeMembership(db, { spaceId, userId });
      const withoutKey = await importWithKey(app, { accessToken, projectId });

      const retried = await importWithKey(app, request);

      expect(retried.status).toBe(404);
      expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
      expect(await withoutCorrelation(retried)).toEqual(await withoutCorrelation(withoutKey));
    }));
});
