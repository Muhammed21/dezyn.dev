import { BILAN_SANTE_SCENARIOS } from "./bilan-sante-scenarios.ts";
import { RELEVE_FIGMA_SCENARIOS } from "./releve-figma-scenarios.ts";
import type { EvalScenario } from "./scenario.ts";

export const RECIPE_SCENARIOS: readonly EvalScenario[] = [
  ...RELEVE_FIGMA_SCENARIOS,
  ...BILAN_SANTE_SCENARIOS,
];
