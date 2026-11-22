import { describe, expect, it } from "vitest";

import { SpaceOutput } from "../../index.ts";

const makeSpace = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
  name: "Studio Ada",
  plan: "team",
  role: "owner",
  allowedActions: ["space.read"],
  storage: { usedBytes: 0, limitBytes: 20_000_000_000, alertReached: false },
  ...overrides,
});

describe("abonnement d'un espace lu par ses propriétaires (ADR 0050 §3, spec #343)", () => {
  it("lit le retard de paiement de l'abonnement", () => {
    const read = makeSpace({ subscription: { status: "past_due" } });

    expect(SpaceOutput.parse(read)).toEqual(read);
  });

  it("lit un espace sans abonnement, tel que le lit un éditeur", () => {
    const read = makeSpace();

    expect(SpaceOutput.parse(read)).toEqual(read);
  });

  it("garde un statut et une clé ajoutés plus tard par le serveur (ADR 0023 §1, §2)", () => {
    const later = makeSpace({ subscription: { status: "paused", payer: "Ada" } });

    expect(SpaceOutput.parse(later)).toEqual(later);
  });

  it("refuse un abonnement sans statut", () => {
    expect(SpaceOutput.safeParse(makeSpace({ subscription: {} })).success).toBe(false);
  });
});
