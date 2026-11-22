import { describe, expect, it } from "vitest";

import { freezeOf, type SpaceUsage } from "../free-limits.ts";

const makeUsage = (overrides: Partial<SpaceUsage> = {}): SpaceUsage => ({
  projects: 1,
  storedBytes: 1_000_000,
  members: 1,
  ...overrides,
});

const AT_FREE_LIMITS = { projects: 3, storedBytes: 500_000_000, members: 1 } as const;

const NOT_FROZEN = { frozen: false, exceededLimits: [] } as const;

const endedFreeSpace = (usage: Partial<SpaceUsage>) =>
  freezeOf({ plan: "free", subscriptionEnded: true, usage: makeUsage(usage) });

describe("un espace Free sorti d'un abonnement est gelé au-dessus d'une limite Free (ADR 0050 §5)", () => {
  it.each([
    ["plus de 3 projets", { projects: 4 }, ["projects"]],
    ["plus de 500 Mo stockés", { storedBytes: 500_000_001 }, ["storage"]],
    ["plus d'un membre", { members: 2 }, ["members"]],
  ])("un espace avec %s est gelé, et dit la limite dépassée", (_case, usage, exceededLimits) => {
    expect(endedFreeSpace(usage)).toEqual({ frozen: true, exceededLimits });
  });

  it("un espace au-dessus de plusieurs limites est gelé, et les dit toutes", () => {
    expect(endedFreeSpace({ projects: 4, storedBytes: 3_000_000_000, members: 2 })).toEqual({
      frozen: true,
      exceededLimits: ["projects", "storage", "members"],
    });
  });

  it("un espace au-dessus de deux limites dit seulement ces deux-là", () => {
    expect(endedFreeSpace({ projects: 5, members: 3 })).toEqual({
      frozen: true,
      exceededLimits: ["projects", "members"],
    });
  });

  it("un espace pile aux limites Free (3 projets, 500 Mo, 1 membre) n'est pas gelé", () => {
    expect(endedFreeSpace(AT_FREE_LIMITS)).toEqual(NOT_FROZEN);
  });

  it("un espace sous toutes les limites Free n'est pas gelé", () => {
    expect(endedFreeSpace({})).toEqual(NOT_FROZEN);
  });
});

describe("un espace qui n'est pas Free sorti d'un abonnement ne gèle jamais (ADR 0050 §5)", () => {
  const ABOVE_EVERY_LIMIT = makeUsage({ projects: 9, storedBytes: 3_000_000_000, members: 4 });

  it("un espace Free qui n'a jamais eu d'abonnement n'est pas gelé, même au-dessus des limites", () => {
    expect(freezeOf({ plan: "free", subscriptionEnded: false, usage: ABOVE_EVERY_LIMIT })).toEqual(
      NOT_FROZEN,
    );
  });

  it.each([true, false])(
    "un espace Team n'est pas gelé, même au-dessus des limites Free (abonnement terminé : %s)",
    (subscriptionEnded) => {
      expect(freezeOf({ plan: "team", subscriptionEnded, usage: ABOVE_EVERY_LIMIT })).toEqual(
        NOT_FROZEN,
      );
    },
  );
});
