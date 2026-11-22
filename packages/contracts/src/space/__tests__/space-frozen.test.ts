import { describe, expect, it } from "vitest";

import { checkOutputSchema, SpaceFrozenProblem } from "../../index.ts";

const makeSpaceFrozen = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  type: "https://dezyn.dev/problems/space-frozen",
  title: "Espace gelé",
  status: 403,
  ...overrides,
});

describe("refus « espace gelé » d'un éditeur (ADR 0050 §5)", () => {
  it("lit le refus", () => {
    expect(SpaceFrozenProblem.parse(makeSpaceFrozen())).toEqual(makeSpaceFrozen());
  });

  it("garde une clé ajoutée plus tard par le serveur (ADR 0023)", () => {
    const later = makeSpaceFrozen({ instance: "/v1/spaces" });

    expect(SpaceFrozenProblem.parse(later)).toEqual(later);
  });

  it.each([
    ["d'un autre type", { type: "https://dezyn.dev/problems/plan-required" }],
    ["d'un autre statut", { status: 409 }],
  ])("refuse un problème %s", (_case, overrides) => {
    expect(SpaceFrozenProblem.safeParse(makeSpaceFrozen(overrides)).success).toBe(false);
  });

  it("SpaceFrozenProblem respecte les conventions de sortie (ADR 0023 §4)", () => {
    expect(checkOutputSchema("SpaceFrozenProblem", SpaceFrozenProblem)).toEqual([]);
  });
});
