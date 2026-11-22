import { describe, expect, it } from "vitest";

import {
  planOfSubscription,
  type SpaceSubscription,
  subscriptionChangeOf,
  subscriptionStatusOf,
} from "../subscription.ts";

const MODIFIED_AT = new Date("2026-11-22T10:00:00.000Z");

const makeSubscription = (overrides: Partial<SpaceSubscription> = {}): SpaceSubscription => ({
  id: "polar-subscription-1",
  payerId: "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
  status: "active",
  currentPeriodEnd: new Date("2026-12-22T10:00:00.000Z"),
  modifiedAt: MODIFIED_AT,
  ...overrides,
});

const secondsAfter = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);

describe("le statut d'un abonnement selon Polar (ADR 0050 §4)", () => {
  it("un abonnement actif est actif", () => {
    expect(subscriptionStatusOf({ status: "active", cancelAtPeriodEnd: false })).toBe("active");
  });

  it("un abonnement actif résilié en fin de période est en résiliation", () => {
    expect(subscriptionStatusOf({ status: "active", cancelAtPeriodEnd: true })).toBe("canceling");
  });

  it.each(["trialing", "incomplete", "paused", "un-statut-inconnu"])(
    "le statut %s n'est pas reconnu",
    (status) => {
      expect(subscriptionStatusOf({ status, cancelAtPeriodEnd: false })).toBeUndefined();
    },
  );
});

describe("le plan d'un espace selon son abonnement (ADR 0050 §3)", () => {
  it.each(["active", "canceling", "past_due"] as const)(
    "un abonnement %s donne le plan Team",
    (status) => {
      expect(planOfSubscription(status)).toBe("team");
    },
  );

  it("un abonnement terminé donne le plan Free", () => {
    expect(planOfSubscription("ended")).toBe("free");
  });
});

describe("appliquer l'état d'un abonnement reçu de Polar (ADR 0050 §4)", () => {
  it("le premier état reçu s'applique et fait passer un espace Free en Team", () => {
    const incoming = makeSubscription();

    expect(subscriptionChangeOf({ stored: undefined, incoming, plan: "free" })).toEqual({
      kind: "applied",
      subscription: incoming,
      planChange: { before: "free", after: "team" },
    });
  });

  it("un état qui ne change pas le plan s'applique sans changement de plan", () => {
    const stored = makeSubscription();
    const incoming = makeSubscription({
      modifiedAt: secondsAfter(MODIFIED_AT, 1),
      currentPeriodEnd: new Date("2027-01-22T10:00:00.000Z"),
    });

    expect(subscriptionChangeOf({ stored, incoming, plan: "team" })).toEqual({
      kind: "applied",
      subscription: incoming,
      planChange: undefined,
    });
  });

  it("le même état reçu deux fois ne s'applique qu'une fois", () => {
    const stored = makeSubscription();

    expect(subscriptionChangeOf({ stored, incoming: stored, plan: "team" })).toEqual({
      kind: "stale",
    });
  });

  it("un état plus ancien que celui enregistré est ignoré", () => {
    const stored = makeSubscription();
    const incoming = makeSubscription({ modifiedAt: secondsAfter(MODIFIED_AT, -1) });

    expect(subscriptionChangeOf({ stored, incoming, plan: "team" })).toEqual({ kind: "stale" });
  });

  it("un état plus récent d'une seconde s'applique", () => {
    const stored = makeSubscription({ status: "ended" });
    const incoming = makeSubscription({ modifiedAt: secondsAfter(MODIFIED_AT, 1) });

    expect(subscriptionChangeOf({ stored, incoming, plan: "free" })).toEqual({
      kind: "applied",
      subscription: incoming,
      planChange: { before: "free", after: "team" },
    });
  });
});
