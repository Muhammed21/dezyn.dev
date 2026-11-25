import { describe, expect, it } from "vitest";

import type { EvalScenario } from "../scenario.ts";
import { settingsOf } from "../settings.ts";

const makeScenario = (overrides: Partial<EvalScenario> = {}): EvalScenario => ({
  recipe: "releve_figma",
  name: "premier-releve",
  figmaFiles: [],
  agentMustCallTools: true,
  seed: async () => undefined,
  check: () => [],
  ...overrides,
});

const SCENARIOS = [
  makeScenario(),
  makeScenario({ name: "semaine-sans-changement" }),
  makeScenario({ recipe: "autre_recette", name: "premier-passage" }),
];

const WITH_KEY = { ANTHROPIC_API_KEY: "cle-de-test" };

describe("les réglages de l'évaluation des recettes (ADR 0059 §3)", () => {
  it("refuse de se lancer sans clé d'API Anthropic, en disant comment la fournir", () => {
    const settings = settingsOf({ env: {}, args: [], scenarios: SCENARIOS });

    expect(settings).toEqual({
      ok: false,
      error: expect.stringContaining("ANTHROPIC_API_KEY"),
    });
  });

  it("tient une clé vide pour absente", () => {
    expect(
      settingsOf({ env: { ANTHROPIC_API_KEY: " " }, args: [], scenarios: SCENARIOS }),
    ).toMatchObject({ ok: false });
  });

  it("joue chaque scénario de chaque recette 3 fois, avec le modèle par défaut", () => {
    expect(settingsOf({ env: WITH_KEY, args: [], scenarios: SCENARIOS })).toEqual({
      ok: true,
      value: { model: "claude-opus-5-5", runs: 3, scenarios: SCENARIOS, verbose: false },
    });
  });

  it("prend le modèle de DEZYN_EVAL_MODEL", () => {
    const env = { ...WITH_KEY, DEZYN_EVAL_MODEL: "claude-sonnet-5-5" };

    expect(settingsOf({ env, args: [], scenarios: SCENARIOS })).toMatchObject({
      value: { model: "claude-sonnet-5-5" },
    });
  });

  it("ne garde que les scénarios d'une recette, et d'un scénario, quand ils sont nommés", () => {
    const byRecipe = settingsOf({
      env: WITH_KEY,
      args: ["--recipe", "releve_figma"],
      scenarios: SCENARIOS,
    });
    const byScenario = settingsOf({
      env: WITH_KEY,
      args: ["--recipe", "releve_figma", "--scenario", "semaine-sans-changement"],
      scenarios: SCENARIOS,
    });

    expect(byRecipe).toMatchObject({ value: { scenarios: [SCENARIOS[0], SCENARIOS[1]] } });
    expect(byScenario).toMatchObject({ value: { scenarios: [SCENARIOS[1]] } });
  });

  it("détaille chaque session d'agent avec --verbose", () => {
    expect(
      settingsOf({
        env: WITH_KEY,
        args: ["--verbose", "--scenario", "premier-releve"],
        scenarios: SCENARIOS,
      }),
    ).toMatchObject({ value: { verbose: true, scenarios: [SCENARIOS[0]] } });
  });

  it("refuse un filtre qui ne garde aucun scénario", () => {
    expect(
      settingsOf({ env: WITH_KEY, args: ["--recipe", "inconnue"], scenarios: SCENARIOS }),
    ).toEqual({ ok: false, error: "Aucun scénario ne correspond à --recipe inconnue" });
  });
});
