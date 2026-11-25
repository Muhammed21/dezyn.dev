import type { Recipe } from "../domain/recipe.ts";
import type { recipeInstructions } from "./recipe-instructions.ts";

export type RecipeUseCases = {
  readonly recipes: readonly Recipe[];
  readonly instructionsOf: ReturnType<typeof recipeInstructions>;
};
