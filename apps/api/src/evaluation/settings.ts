import { parseArgs } from "node:util";

import { err, ok, type Result } from "@repo/result";

import type { EvalScenario } from "./scenario.ts";

const DEFAULT_MODEL = "claude-opus-5-5";

const RUNS_PER_SCENARIO = 3;

export const MISSING_KEY_MESSAGE =
  "ANTHROPIC_API_KEY manquante : l'évaluation fait suivre chaque recette à une vraie IA. Lance-la avec ta clé dans l'environnement, par exemple ANTHROPIC_API_KEY=… pnpm eval. Rien n'a été lancé.";

export type Settings = {
  readonly model: string;
  readonly runs: number;
  readonly scenarios: readonly EvalScenario[];
  readonly verbose: boolean;
};

const filterOf = ({
  recipe,
  scenario,
}: {
  readonly recipe?: string;
  readonly scenario?: string;
}): string =>
  [
    recipe === undefined ? undefined : `--recipe ${recipe}`,
    scenario === undefined ? undefined : `--scenario ${scenario}`,
  ]
    .filter((part) => part !== undefined)
    .join(" ");

export const settingsOf = ({
  env,
  args,
  scenarios,
}: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly args: readonly string[];
  readonly scenarios: readonly EvalScenario[];
}): Result<Settings, string> => {
  if ((env.ANTHROPIC_API_KEY ?? "").trim() === "") {
    return err(MISSING_KEY_MESSAGE);
  }
  const { values } = parseArgs({
    args: [...args],
    options: {
      recipe: { type: "string" },
      scenario: { type: "string" },
      verbose: { type: "boolean", default: false },
    },
  });
  const selected = scenarios.filter(
    ({ recipe, name }) =>
      (values.recipe === undefined || recipe === values.recipe) &&
      (values.scenario === undefined || name === values.scenario),
  );
  if (selected.length === 0) {
    return err(`Aucun scénario ne correspond à ${filterOf(values)}`);
  }
  return ok({
    model: env.DEZYN_EVAL_MODEL ?? DEFAULT_MODEL,
    runs: RUNS_PER_SCENARIO,
    scenarios: selected,
    verbose: values.verbose,
  });
};
