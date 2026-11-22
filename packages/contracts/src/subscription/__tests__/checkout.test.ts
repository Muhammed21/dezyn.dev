import { describe, expect, it } from "vitest";

import { ACTIONS, AlreadyTeamProblem, checkOutputSchema, CheckoutOutput } from "../../index.ts";

describe("sortie du checkout du plan Team (ADR 0050 §7)", () => {
  it("lit l'URL du checkout, et garde une clé ajoutée plus tard par le serveur (ADR 0023 §1)", () => {
    const later = { url: "https://sandbox.polar.sh/checkout/polar_c_1", expiresAt: "plus tard" };

    expect(CheckoutOutput.parse(later)).toEqual(later);
  });

  it.each(["pas-une-url", "ftp://polar.sh/checkout"])("refuse l'URL %s", (url) => {
    expect(CheckoutOutput.safeParse({ url }).success).toBe(false);
  });

  it("suit les conventions des sorties de l'API", () => {
    expect(checkOutputSchema("CheckoutOutput", CheckoutOutput)).toEqual([]);
  });
});

describe("problème d'un espace déjà Team", () => {
  it("lit le problème already-team", () => {
    const problem = {
      type: "https://dezyn.dev/problems/already-team",
      title: "Espace déjà au plan Team",
      status: 409,
    };

    expect(AlreadyTeamProblem.parse(problem)).toEqual(problem);
  });

  it("refuse un autre problème", () => {
    expect(
      AlreadyTeamProblem.safeParse({
        type: "https://dezyn.dev/problems/last-owner",
        title: "Dernier propriétaire",
        status: 409,
      }).success,
    ).toBe(false);
  });
});

describe("actions d'un espace", () => {
  it("permet de lancer le checkout du plan Team", () => {
    expect(ACTIONS).toContain("subscription.checkout");
  });
});
