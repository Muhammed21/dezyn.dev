import { describe, expect, it } from "vitest";

import { purgeLimitOf } from "../purge-limit.ts";
import type { Plan } from "../space.ts";

const makeSpace = ({
  plan = "free",
  subscriptionEnded = true,
  storedBytesAtEnd = 3_000_000_000,
  projects = 1,
  storedBytes = 3_000_000_000,
  members = 1,
}: {
  readonly plan?: Plan;
  readonly subscriptionEnded?: boolean;
  readonly storedBytesAtEnd?: number | null;
  readonly projects?: number;
  readonly storedBytes?: number;
  readonly members?: number;
} = {}) => ({
  plan,
  subscriptionEnded,
  storedBytesAtEnd,
  usage: { projects, storedBytes, members },
});

describe("un espace gelé a pour limite de purge son stockage à la fin de l'abonnement (ADR 0050 §6)", () => {
  it("un espace gelé qui avait 3 Go à la fin de son abonnement a 3 Go de limite", () => {
    expect(purgeLimitOf(makeSpace({ storedBytesAtEnd: 3_000_000_000 }))).toBe(3_000_000_000);
  });

  it.each([
    ["499 Mo enregistrés valent 500 Mo", 499_000_000, 500_000_000],
    ["un octet sous 500 Mo vaut 500 Mo", 499_999_999, 500_000_000],
    ["500 Mo enregistrés valent 500 Mo", 500_000_000, 500_000_000],
    ["un octet au-dessus de 500 Mo vaut lui-même", 500_000_001, 500_000_001],
    ["un octet sous 20 Go vaut lui-même", 19_999_999_999, 19_999_999_999],
    ["20 Go enregistrés valent 20 Go", 20_000_000_000, 20_000_000_000],
    ["un octet au-dessus de 20 Go vaut 20 Go", 20_000_000_001, 20_000_000_000],
    ["21 Go enregistrés valent 20 Go", 21_000_000_000, 20_000_000_000],
  ])("la limite est bornée entre 500 Mo et 20 Go : %s", (_case, storedBytesAtEnd, limit) => {
    expect(purgeLimitOf(makeSpace({ storedBytesAtEnd }))).toBe(limit);
  });

  it("un espace gelé par ses membres seuls, sous 500 Mo à la fin de l'abonnement, a 500 Mo de limite", () => {
    expect(
      purgeLimitOf(
        makeSpace({ storedBytesAtEnd: 100_000_000, storedBytes: 400_000_000, members: 2 }),
      ),
    ).toBe(500_000_000);
  });

  it("un espace gelé sans stockage enregistré à la fin de l'abonnement a 500 Mo de limite", () => {
    expect(purgeLimitOf(makeSpace({ storedBytesAtEnd: null }))).toBe(500_000_000);
  });
});

describe("un espace qui n'est pas gelé garde la limite de son plan (ADR 0006 §4)", () => {
  it("un espace Free qui n'a jamais payé, à 3 Go, a 500 Mo de limite", () => {
    expect(purgeLimitOf(makeSpace({ subscriptionEnded: false, storedBytesAtEnd: null }))).toBe(
      500_000_000,
    );
  });

  it("un espace Free sorti d'un abonnement, revenu sous les limites Free, a 500 Mo de limite", () => {
    expect(purgeLimitOf(makeSpace({ storedBytes: 500_000_000 }))).toBe(500_000_000);
  });

  it("un espace Team a 20 Go de limite, quel que soit son stockage enregistré", () => {
    expect(
      purgeLimitOf(
        makeSpace({ plan: "team", subscriptionEnded: false, storedBytesAtEnd: 3_000_000_000 }),
      ),
    ).toBe(20_000_000_000);
  });
});
