import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { type App, BASE_URL, callMcp, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProjectAsEditor } from "#testing/project-fixtures.ts";
import { closeMembership } from "#testing/space-fixtures.ts";
import { historyOf, makeColorToken } from "#testing/token-fixtures.ts";
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "@repo/contracts";

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
  return result.structuredContent;
};

const seedClosedBatch = async (
  app: App,
  { accessToken, projectId }: { accessToken: string; projectId: string },
) => {
  const written = await callTool(app, {
    accessToken,
    name: "write_tokens",
    args: { projectId, tokens: [makeColorToken()] },
  });
  await callTool(app, { accessToken, name: "close_proposal_batch", args: { projectId } });
  return { batchId: String(written.batch.id), proposalId: String(written.proposals[0].id) };
};

const DECISIONS = [
  [
    "la validation d'une proposition",
    ({ proposalId }: Seeded) => `/proposals/${proposalId}/validate`,
  ],
  ["le rejet d'une proposition", ({ proposalId }: Seeded) => `/proposals/${proposalId}/reject`],
  ["la validation d'un lot", ({ batchId }: Seeded) => `/proposal-batches/${batchId}/validate`],
] as const;

type Seeded = { readonly batchId: string; readonly proposalId: string };

const decideWithKey = (
  app: App,
  {
    accessToken,
    path,
    idempotencyKey,
  }: { readonly accessToken: string; readonly path: string; readonly idempotencyKey?: string },
) =>
  app.request(`${BASE_URL}/v1${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(idempotencyKey === undefined ? {} : { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey }),
    },
    body: JSON.stringify({}),
  });

const withoutCorrelation = async (response: Response) => {
  const { correlationId: _correlationId, ...body } = await response.json();
  return { status: response.status, body };
};

describe("une décision de relecture renvoyée avec la même Idempotency-Key rejoue la première réponse", () => {
  it.each(DECISIONS)(
    "%s renvoyée rejoue le 200 au lieu d'un refus, sans nouvelle entrée d'historique",
    (_, pathOf) =>
      withIdentityApp(async (app, db) => {
        const { accessToken, projectId } = await seedProjectAsEditor(app, db);
        const path = pathOf(await seedClosedBatch(app, { accessToken, projectId }));
        const request = { accessToken, path, idempotencyKey: randomUUID() };
        const first = await decideWithKey(app, request);
        const firstBody = await first.json();
        const historyAfterFirst = await historyOf(app, { accessToken, projectId });

        const retried = await decideWithKey(app, request);

        expect(first.status).toBe(200);
        expect(retried.status).toBe(200);
        expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe("true");
        expect(await retried.json()).toEqual(firstBody);
        expect(await historyOf(app, { accessToken, projectId })).toEqual(historyAfterFirst);
      }),
  );

  it.each(DECISIONS)(
    "%s n'est pas rejouée à un membre retiré de l'espace : il reçoit la réponse d'un envoi sans clé",
    (_, pathOf) =>
      withIdentityApp(async (app, db) => {
        const { accessToken, projectId, spaceId, userId } = await seedProjectAsEditor(app, db);
        const path = pathOf(await seedClosedBatch(app, { accessToken, projectId }));
        const request = { accessToken, path, idempotencyKey: randomUUID() };
        await decideWithKey(app, request);
        await closeMembership(db, { spaceId, userId });
        const withoutKey = await decideWithKey(app, { accessToken, path });

        const retried = await decideWithKey(app, request);

        expect(retried.status).toBe(404);
        expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
        expect(await withoutCorrelation(retried)).toEqual(await withoutCorrelation(withoutKey));
      }),
  );
});
