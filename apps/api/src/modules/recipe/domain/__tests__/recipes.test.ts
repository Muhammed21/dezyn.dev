import { describe, expect, it } from "vitest";

import { RECIPES } from "../recipes.ts";

describe("le registre des recettes (ADR 0059 §1)", () => {
  it("sert le relevé Figma", () => {
    expect(RECIPES.map(({ name }) => name)).toContain("releve_figma");
  });

  it("sert le bilan de santé", () => {
    expect(RECIPES.map(({ name }) => name)).toContain("bilan_sante");
  });

  it("donne à chaque recette un nom unique, en minuscules et soulignés", () => {
    const names = RECIPES.map(({ name }) => name);

    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => !/^[a-z][a-z0-9_]*$/.test(name))).toEqual([]);
  });
});
