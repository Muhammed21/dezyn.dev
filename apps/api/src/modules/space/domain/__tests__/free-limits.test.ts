import { describe, expect, it } from "vitest";

import { exceedsFreeLimits, type SpaceUsage } from "../free-limits.ts";

const makeUsage = (overrides: Partial<SpaceUsage> = {}): SpaceUsage => ({
  projects: 1,
  storedBytes: 1_000_000,
  members: 1,
  ...overrides,
});

describe("un espace au-dessus d'une limite Free (ADR 0050 §5)", () => {
  it("un espace sous toutes les limites Free ne les dépasse pas", () => {
    expect(exceedsFreeLimits(makeUsage())).toBe(false);
  });

  it("un espace pile aux limites Free (3 projets, 500 Mo, 1 membre) ne les dépasse pas", () => {
    expect(
      exceedsFreeLimits(makeUsage({ projects: 3, storedBytes: 500_000_000, members: 1 })),
    ).toBe(false);
  });

  it.each([
    ["plus de 3 projets", { projects: 4 }],
    ["plus de 500 Mo stockés", { storedBytes: 500_000_001 }],
    ["plus d'un membre", { members: 2 }],
  ])("un espace avec %s dépasse les limites Free", (_case, usage) => {
    expect(exceedsFreeLimits(makeUsage(usage))).toBe(true);
  });
});
