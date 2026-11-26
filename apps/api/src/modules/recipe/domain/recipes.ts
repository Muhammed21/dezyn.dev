import { bilanSante } from "./bilan-sante.ts";
import type { Recipe } from "./recipe.ts";
import { releveFigma } from "./releve-figma.ts";

export const RECIPES: readonly Recipe[] = [releveFigma, bilanSante];
