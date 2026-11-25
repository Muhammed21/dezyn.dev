import type { Clock } from "#platform/clock.ts";
import { ok, type Result } from "@repo/result";

import type { Recipe, RecipeProject } from "../domain/recipe.ts";

export type RecipeProjectOf = (query: {
  readonly projectId: string;
  readonly userId: string;
}) => Promise<Result<RecipeProject, "not_found">>;

export const recipeInstructions =
  ({ projectOf, clock }: { readonly projectOf: RecipeProjectOf; readonly clock: Clock }) =>
  async ({
    recipe,
    projectId,
    userId,
  }: {
    readonly recipe: Recipe;
    readonly projectId: string;
    readonly userId: string;
  }): Promise<Result<string, "not_found">> => {
    const project = await projectOf({ projectId, userId });
    if (!project.ok) {
      return project;
    }
    return ok(recipe.instructionsFor({ project: project.value, today: clock() }));
  };
