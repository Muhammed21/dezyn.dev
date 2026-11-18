import { describe, expect, it } from "vitest";

import { type App, BASE_URL, callMcp, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { countRoundTrips } from "#testing/round-trips.ts";
import { makeColorToken } from "#testing/token-fixtures.ts";
import { ProposalBatchOutput } from "@repo/contracts";

const LARGE_BATCH = 67;

const callTool = async (
  app: App,
  { token, name, args }: { token: string; name: string; args: object },
) => {
  const response = await callMcp(app, {
    token,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const { result } = await response.json();
  return result.structuredContent;
};

const SKY_BLUE = { colorSpace: "srgb", components: [0.4, 0.7, 0.9] };

const seedClosedBatch = async (
  app: App,
  {
    accessToken,
    projectId,
    size,
    group,
    $value,
  }: { accessToken: string; projectId: string; size: number; group: string; $value?: object },
) => {
  const tokens = Array.from({ length: size }, (_, index) =>
    makeColorToken({
      name: `couleur.${group}.t${index}`,
      ...($value === undefined ? {} : { $value }),
    }),
  );
  const { batch } = await callTool(app, {
    token: accessToken,
    name: "write_tokens",
    args: { projectId, tokens },
  });
  await callTool(app, { token: accessToken, name: "close_proposal_batch", args: { projectId } });
  const response = await app.request(`${BASE_URL}/v1/proposal-batches/${batch.id}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return ProposalBatchOutput.parse(await response.json());
};

const validate = (
  app: App,
  {
    accessToken,
    batch,
    rejected,
  }: { accessToken: string; batch: { id: string }; rejected: readonly string[] },
) =>
  countRoundTrips(async () =>
    app.request(`${BASE_URL}/v1/proposal-batches/${batch.id}/validate`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ rejected }),
    }),
  );

const rejectAll = (
  app: App,
  {
    accessToken,
    batch,
  }: { accessToken: string; batch: { id: string; proposals: readonly { id: string }[] } },
) => validate(app, { accessToken, batch, rejected: batch.proposals.map(({ id }) => id) });

const validateAll = (
  app: App,
  { accessToken, batch }: { accessToken: string; batch: { id: string } },
) => validate(app, { accessToken, batch, rejected: [] });

describe("valider un lot coûte un nombre de requêtes qui ne dépend pas de sa taille (#258)", () => {
  it(`rejeter les ${LARGE_BATCH} propositions d'un lot coûte autant de requêtes qu'en rejeter une`, () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const single = await seedClosedBatch(app, { accessToken, projectId, size: 1, group: "seul" });
      const singleRejection = await rejectAll(app, { accessToken, batch: single });
      const large = await seedClosedBatch(app, {
        accessToken,
        projectId,
        size: LARGE_BATCH,
        group: "grand",
      });

      const largeRejection = await rejectAll(app, { accessToken, batch: large });

      expect(singleRejection.result.status).toBe(200);
      expect(largeRejection.result.status).toBe(200);
      expect(singleRejection.roundTrips).toBeGreaterThan(0);
      expect(largeRejection.roundTrips).toBe(singleRejection.roundTrips);
    }));

  it(`valider les ${LARGE_BATCH} créations d'un lot coûte autant de requêtes qu'en valider une`, () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const single = await seedClosedBatch(app, { accessToken, projectId, size: 1, group: "seul" });
      const singleValidation = await validateAll(app, { accessToken, batch: single });
      const large = await seedClosedBatch(app, {
        accessToken,
        projectId,
        size: LARGE_BATCH,
        group: "grand",
      });

      const largeValidation = await validateAll(app, { accessToken, batch: large });

      expect(singleValidation.result.status).toBe(200);
      expect(largeValidation.result.status).toBe(200);
      expect(singleValidation.roundTrips).toBeGreaterThan(0);
      expect(largeValidation.roundTrips).toBe(singleValidation.roundTrips);
    }));

  it(`valider les ${LARGE_BATCH} modifications d'un lot coûte autant de requêtes qu'en valider une`, () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const seedModifiedBatch = async ({ size, group }: { size: number; group: string }) => {
        const created = await seedClosedBatch(app, { accessToken, projectId, size, group });
        await validateAll(app, { accessToken, batch: created });
        return seedClosedBatch(app, { accessToken, projectId, size, group, $value: SKY_BLUE });
      };
      const single = await seedModifiedBatch({ size: 1, group: "seul" });
      const singleValidation = await validateAll(app, { accessToken, batch: single });
      const large = await seedModifiedBatch({ size: LARGE_BATCH, group: "grand" });

      const largeValidation = await validateAll(app, { accessToken, batch: large });

      expect(large.proposals.map(({ kind }) => kind)).toEqual(Array(LARGE_BATCH).fill("update"));
      expect(singleValidation.result.status).toBe(200);
      expect(largeValidation.result.status).toBe(200);
      expect(singleValidation.roundTrips).toBeGreaterThan(0);
      expect(largeValidation.roundTrips).toBe(singleValidation.roundTrips);
    }));
});
