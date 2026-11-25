import { describe, expect, it } from "vitest";

import { withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";

import { type Observation, observeProject } from "../observation.ts";
import { RECIPE_SCENARIOS } from "../recipe-scenarios.ts";
import { scenarioFixtureOf } from "../scenario-fixture.ts";

const afterSeeding = (name: string, assert: (observed: Observation) => void) =>
  withIdentityApp(async (app, db) => {
    const scenario = RECIPE_SCENARIOS.find((candidate) => candidate.name === name);
    const member = await seedProject(app, db);
    await scenario?.seed(scenarioFixtureOf({ app, db, member }));
    assert(await observeProject(db, member.projectId));
  });

describe("chaque scénario d'évaluation prépare son projet par l'API et le MCP de dezyn", () => {
  it.each(RECIPE_SCENARIOS.map((scenario) => [`${scenario.recipe}/${scenario.name}`, scenario]))(
    "%s se prépare sans erreur, avec des tokens validés",
    (_, scenario) =>
      withIdentityApp(async (app, db) => {
        const member = await seedProject(app, db);

        await scenario.seed(scenarioFixtureOf({ app, db, member }));
        const observed = await observeProject(db, member.projectId);

        expect(observed.tokens.length).toBeGreaterThan(0);
      }),
  );

  it("le relevé sans changement part d'états Figma déjà déclarés", () =>
    afterSeeding("semaine-sans-changement", (observed) => {
      expect(observed.tokens.map(({ figmaState }) => figmaState)).toEqual(["synced", "synced"]);
    }));

  it("le relevé sans fichier Figma part d'un projet sans fichier Figma", () =>
    afterSeeding("fichier-figma-non-renseigne", (observed) => {
      expect(observed.figmaFile).toBeNull();
    }));
});
