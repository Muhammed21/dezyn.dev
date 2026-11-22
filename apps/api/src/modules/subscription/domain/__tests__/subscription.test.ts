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

const UNDER_FREE_LIMITS = { projects: 3, storedBytes: 500_000_000, members: 1 } as const;

const ABOVE_FREE_LIMITS = { projects: 4, storedBytes: 500_000_000, members: 1 } as const;

describe("le statut d'un abonnement selon Polar (ADR 0050 §4)", () => {
  it("un abonnement actif est actif", () => {
    expect(subscriptionStatusOf({ status: "active", cancelAtPeriodEnd: false })).toBe("active");
  });

  it("un abonnement actif résilié en fin de période est en résiliation", () => {
    expect(subscriptionStatusOf({ status: "active", cancelAtPeriodEnd: true })).toBe("canceling");
  });

  it.each([false, true])(
    "un abonnement annulé par Polar est terminé, résiliation en fin de période ou non (%s)",
    (cancelAtPeriodEnd) => {
      expect(subscriptionStatusOf({ status: "canceled", cancelAtPeriodEnd })).toBe("ended");
    },
  );

  it.each([false, true])(
    "un abonnement en retard de paiement est en retard de paiement (résiliation : %s)",
    (cancelAtPeriodEnd) => {
      expect(subscriptionStatusOf({ status: "past_due", cancelAtPeriodEnd })).toBe("past_due");
    },
  );

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

    expect(
      subscriptionChangeOf({ usage: UNDER_FREE_LIMITS, stored: undefined, incoming, plan: "free" }),
    ).toEqual({
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

    expect(
      subscriptionChangeOf({ usage: UNDER_FREE_LIMITS, stored, incoming, plan: "team" }),
    ).toEqual({
      kind: "applied",
      subscription: incoming,
      planChange: undefined,
    });
  });

  it("le même état reçu deux fois ne s'applique qu'une fois", () => {
    const stored = makeSubscription();

    expect(
      subscriptionChangeOf({ usage: UNDER_FREE_LIMITS, stored, incoming: stored, plan: "team" }),
    ).toEqual({
      kind: "stale",
    });
  });

  it("un état plus ancien que celui enregistré est ignoré", () => {
    const stored = makeSubscription();
    const incoming = makeSubscription({ modifiedAt: secondsAfter(MODIFIED_AT, -1) });

    expect(
      subscriptionChangeOf({ usage: UNDER_FREE_LIMITS, stored, incoming, plan: "team" }),
    ).toEqual({ kind: "stale" });
  });

  it("un autre abonnement du même espace ne remplace pas celui enregistré, même plus récent", () => {
    const stored = makeSubscription({ id: "polar-subscription-a" });
    const incoming = makeSubscription({
      id: "polar-subscription-b",
      modifiedAt: secondsAfter(MODIFIED_AT, 60),
    });

    expect(
      subscriptionChangeOf({ usage: UNDER_FREE_LIMITS, stored, incoming, plan: "team" }),
    ).toEqual({
      kind: "other_subscription",
      storedId: "polar-subscription-a",
    });
  });

  it("un autre abonnement plus ancien que celui enregistré est aussi un autre abonnement", () => {
    const stored = makeSubscription({ id: "polar-subscription-a" });
    const incoming = makeSubscription({
      id: "polar-subscription-b",
      modifiedAt: secondsAfter(MODIFIED_AT, -60),
    });

    expect(
      subscriptionChangeOf({ usage: UNDER_FREE_LIMITS, stored, incoming, plan: "team" }),
    ).toEqual({
      kind: "other_subscription",
      storedId: "polar-subscription-a",
    });
  });

  it("un nouvel abonnement s'applique après un abonnement terminé, et repasse l'espace en Team", () => {
    const stored = makeSubscription({ id: "polar-subscription-1", status: "ended" });
    const incoming = makeSubscription({
      id: "polar-subscription-2",
      modifiedAt: secondsAfter(MODIFIED_AT, 60),
    });

    expect(
      subscriptionChangeOf({ usage: UNDER_FREE_LIMITS, stored, incoming, plan: "free" }),
    ).toEqual({
      kind: "applied",
      subscription: incoming,
      planChange: { before: "free", after: "team" },
    });
  });

  it("un état plus récent d'une seconde s'applique", () => {
    const stored = makeSubscription({ status: "ended" });
    const incoming = makeSubscription({ modifiedAt: secondsAfter(MODIFIED_AT, 1) });

    expect(
      subscriptionChangeOf({ usage: UNDER_FREE_LIMITS, stored, incoming, plan: "free" }),
    ).toEqual({
      kind: "applied",
      subscription: incoming,
      planChange: { before: "free", after: "team" },
    });
  });
});

describe("un abonnement terminé d'un espace au-dessus des limites Free (ADR 0050 §5, en attendant le gel)", () => {
  const revoked = makeSubscription({ status: "ended", modifiedAt: secondsAfter(MODIFIED_AT, 60) });

  it("un espace sous les limites Free redevient Free", () => {
    expect(
      subscriptionChangeOf({
        stored: makeSubscription(),
        incoming: revoked,
        plan: "team",
        usage: UNDER_FREE_LIMITS,
      }),
    ).toEqual({
      kind: "applied",
      subscription: revoked,
      planChange: { before: "team", after: "free" },
    });
  });

  it("un espace au-dessus d'une limite Free garde le plan Team, avec l'abonnement terminé", () => {
    expect(
      subscriptionChangeOf({
        stored: makeSubscription(),
        incoming: revoked,
        plan: "team",
        usage: ABOVE_FREE_LIMITS,
      }),
    ).toEqual({ kind: "above_free_limits", subscription: revoked });
  });

  it("un abonnement actif d'un espace au-dessus des limites Free s'applique comme avant", () => {
    const incoming = makeSubscription({ modifiedAt: secondsAfter(MODIFIED_AT, 60) });

    expect(
      subscriptionChangeOf({
        stored: makeSubscription(),
        incoming,
        plan: "team",
        usage: ABOVE_FREE_LIMITS,
      }),
    ).toEqual({ kind: "applied", subscription: incoming, planChange: undefined });
  });

  it("un abonnement terminé d'un espace déjà Free s'applique sans changement de plan", () => {
    expect(
      subscriptionChangeOf({
        stored: makeSubscription({ status: "ended" }),
        incoming: revoked,
        plan: "free",
        usage: ABOVE_FREE_LIMITS,
      }),
    ).toEqual({ kind: "applied", subscription: revoked, planChange: undefined });
  });
});
