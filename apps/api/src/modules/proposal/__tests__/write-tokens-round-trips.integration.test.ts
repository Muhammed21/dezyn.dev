import { describe, expect, it } from "vitest";

import { type App, callMcp, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { countRoundTrips } from "#testing/round-trips.ts";
import { makeColorToken } from "#testing/token-fixtures.ts";

const LARGE_WRITE = 20;

const MAX_EXTRA_ROUND_TRIPS = 0;

const ROUND_TRIPS_OF_A_WRITE_WITHOUT_REPLACEMENT = 29;

const makeTokens = ({ size, group }: { readonly size: number; readonly group: string }) =>
  Array.from({ length: size }, (_, index) =>
    makeColorToken({ name: `couleur.${group}.t${index}` }),
  );

const writeTokens = (
  app: App,
  {
    accessToken,
    projectId,
    tokens,
  }: { accessToken: string; projectId: string; tokens: readonly object[] },
) =>
  countRoundTrips(async () => {
    const response = await callMcp(app, {
      token: accessToken,
      method: "tools/call",
      params: { name: "write_tokens", arguments: { projectId, tokens } },
    });
    const { result } = await response.json();
    return result.structuredContent;
  });

describe("write_tokens coûte un nombre de requêtes qui ne dépend pas du nombre de tokens (#308)", () => {
  it(`écrire ${LARGE_WRITE} nouveaux tokens coûte autant de requêtes qu'en écrire un`, () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      await writeTokens(app, {
        accessToken,
        projectId,
        tokens: makeTokens({ size: 1, group: "amorce" }),
      });
      const single = await writeTokens(app, {
        accessToken,
        projectId,
        tokens: makeTokens({ size: 1, group: "seul" }),
      });

      const large = await writeTokens(app, {
        accessToken,
        projectId,
        tokens: makeTokens({ size: LARGE_WRITE, group: "grand" }),
      });

      expect(single.result.proposals).toHaveLength(1);
      expect(large.result.proposals).toHaveLength(LARGE_WRITE);
      expect(single.roundTrips).toBeGreaterThan(0);
      expect(large.roundTrips - single.roundTrips).toBeLessThanOrEqual(MAX_EXTRA_ROUND_TRIPS);
    }));

  it("une écriture qui ne remplace aucune proposition n'envoie aucune requête de remplacement", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      await writeTokens(app, {
        accessToken,
        projectId,
        tokens: makeTokens({ size: 1, group: "amorce" }),
      });

      const written = await writeTokens(app, {
        accessToken,
        projectId,
        tokens: makeTokens({ size: LARGE_WRITE, group: "nouveau" }),
      });

      expect(written.result.replaced).toEqual([]);
      expect(written.result.proposals).toHaveLength(LARGE_WRITE);
      expect(written.roundTrips).toBe(ROUND_TRIPS_OF_A_WRITE_WITHOUT_REPLACEMENT);
    }));

  it(`remplacer ${LARGE_WRITE} propositions en attente coûte autant de requêtes qu'en remplacer une`, () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const blue = { colorSpace: "srgb", components: [0.4, 0.7, 0.9] };
      const recolored = (tokens: readonly object[]) =>
        tokens.map((token) => ({ ...token, $value: blue }));
      const singleTokens = makeTokens({ size: 1, group: "seul" });
      const largeTokens = makeTokens({ size: LARGE_WRITE, group: "grand" });
      await writeTokens(app, { accessToken, projectId, tokens: singleTokens });
      await writeTokens(app, { accessToken, projectId, tokens: largeTokens });
      const single = await writeTokens(app, {
        accessToken,
        projectId,
        tokens: recolored(singleTokens),
      });

      const large = await writeTokens(app, {
        accessToken,
        projectId,
        tokens: recolored(largeTokens),
      });

      expect(single.result.replaced).toHaveLength(1);
      expect(large.result.replaced).toHaveLength(LARGE_WRITE);
      expect(large.roundTrips - single.roundTrips).toBeLessThanOrEqual(MAX_EXTRA_ROUND_TRIPS);
    }));
});
