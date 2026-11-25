import type { Clock } from "#platform/clock.ts";

import { type RecipeProjectOf, recipeInstructions } from "./application/recipe-instructions.ts";
import type { RecipeUseCases } from "./application/recipe-use-cases.ts";
import { RECIPES } from "./domain/recipes.ts";

export const recipeModule = ({
  projectOf,
  clock,
}: {
  readonly projectOf: RecipeProjectOf;
  readonly clock: Clock;
}): RecipeUseCases => ({
  recipes: RECIPES,
  instructionsOf: recipeInstructions({ projectOf, clock }),
});
