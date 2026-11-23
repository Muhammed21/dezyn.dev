import { describe, expect, it } from "vitest";

import {
  planOfSubscription,
  type RecordedSubscription,
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

const makeRecorded = (overrides: Partial<RecordedSubscription> = {}): RecordedSubscription => ({
  ...makeSubscription(),
  storedBytesAtEnd: undefined,
  ...overrides,
});

const secondsAfter = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);

const STORED_BYTES = 3_000_000_000;

const withoutEndStorage = (subscription: SpaceSubscription): RecordedSubscription => ({
  ...subscription,
  storedBytesAtEnd: undefined,
});

const UPDATED_EVENT = "subscription.updated";

const EVENTS_OTHER_THAN_REVOKED = [
  "subscription.active",
  "subscription.past_due",
  "subscription.updated",
  "subscription.canceled",
  "subscription.uncanceled",
];

const withAndWithoutCancelAtPeriodEnd = <T extends object>(cases: readonly T[]) =>
  cases.flatMap((value) =>
    [false, true].map((cancelAtPeriodEnd) => ({ ...value, cancelAtPeriodEnd })),
  );

describe("le statut d'un abonnement selon Polar (ADR 0050 §4)", () => {
  it("un abonnement actif est actif", () => {
    expect(
      subscriptionStatusOf({ type: UPDATED_EVENT, status: "active", cancelAtPeriodEnd: false }),
    ).toBe("active");
  });

  it("un abonnement actif résilié en fin de période est en résiliation", () => {
    expect(
      subscriptionStatusOf({ type: UPDATED_EVENT, status: "active", cancelAtPeriodEnd: true }),
    ).toBe("canceling");
  });

  it.each([false, true])(
    "un abonnement en retard de paiement est en retard de paiement (résiliation : %s)",
    (cancelAtPeriodEnd) => {
      expect(
        subscriptionStatusOf({ type: UPDATED_EVENT, status: "past_due", cancelAtPeriodEnd }),
      ).toBe("past_due");
    },
  );

  it.each(
    withAndWithoutCancelAtPeriodEnd(
      ["canceled", "unpaid", "incomplete_expired"].flatMap((status) =>
        EVENTS_OTHER_THAN_REVOKED.map((type) => ({ type, status })),
      ),
    ),
  )(
    "un abonnement au statut de fin $status est terminé, quel que soit l'événement ($type, résiliation : $cancelAtPeriodEnd)",
    (event) => {
      expect(subscriptionStatusOf(event)).toBe("ended");
    },
  );

  it.each(
    withAndWithoutCancelAtPeriodEnd(
      ["active", "past_due", "canceled", "unpaid", "incomplete_expired", "un-statut-inconnu"].map(
        (status) => ({ type: "subscription.revoked", status }),
      ),
    ),
  )(
    "un abonnement révoqué par Polar est terminé, quel que soit son statut ($status, résiliation : $cancelAtPeriodEnd)",
    (event) => {
      expect(subscriptionStatusOf(event)).toBe("ended");
    },
  );

  it.each(["trialing", "incomplete", "paused", "trial_ended", "un-statut-inconnu"])(
    "le statut %s n'est pas reconnu",
    (status) => {
      expect(
        subscriptionStatusOf({ type: UPDATED_EVENT, status, cancelAtPeriodEnd: false }),
      ).toBeUndefined();
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
      subscriptionChangeOf({
        storedBytes: STORED_BYTES,
        stored: undefined,
        incoming,
        plan: "free",
      }),
    ).toEqual({
      kind: "applied",
      subscription: withoutEndStorage(incoming),
      planChange: { before: "free", after: "team" },
    });
  });

  it("un état qui ne change pas le plan s'applique sans changement de plan", () => {
    const stored = makeRecorded();
    const incoming = makeSubscription({
      modifiedAt: secondsAfter(MODIFIED_AT, 1),
      currentPeriodEnd: new Date("2027-01-22T10:00:00.000Z"),
    });

    expect(
      subscriptionChangeOf({ storedBytes: STORED_BYTES, stored, incoming, plan: "team" }),
    ).toEqual({
      kind: "applied",
      subscription: withoutEndStorage(incoming),
      planChange: undefined,
    });
  });

  it("le même état reçu deux fois ne s'applique qu'une fois", () => {
    expect(
      subscriptionChangeOf({
        storedBytes: STORED_BYTES,
        stored: makeRecorded(),
        incoming: makeSubscription(),
        plan: "team",
      }),
    ).toEqual({ kind: "stale" });
  });

  it("un état plus ancien que celui enregistré est ignoré", () => {
    const stored = makeRecorded();
    const incoming = makeSubscription({ modifiedAt: secondsAfter(MODIFIED_AT, -1) });

    expect(
      subscriptionChangeOf({ storedBytes: STORED_BYTES, stored, incoming, plan: "team" }),
    ).toEqual({ kind: "stale" });
  });

  it("un autre abonnement du même espace ne remplace pas celui enregistré, même plus récent", () => {
    const stored = makeRecorded({ id: "polar-subscription-a" });
    const incoming = makeSubscription({
      id: "polar-subscription-b",
      modifiedAt: secondsAfter(MODIFIED_AT, 60),
    });

    expect(
      subscriptionChangeOf({ storedBytes: STORED_BYTES, stored, incoming, plan: "team" }),
    ).toEqual({
      kind: "other_subscription",
      storedId: "polar-subscription-a",
    });
  });

  it("un autre abonnement plus ancien que celui enregistré est aussi un autre abonnement", () => {
    const stored = makeRecorded({ id: "polar-subscription-a" });
    const incoming = makeSubscription({
      id: "polar-subscription-b",
      modifiedAt: secondsAfter(MODIFIED_AT, -60),
    });

    expect(
      subscriptionChangeOf({ storedBytes: STORED_BYTES, stored, incoming, plan: "team" }),
    ).toEqual({
      kind: "other_subscription",
      storedId: "polar-subscription-a",
    });
  });

  it("un nouvel abonnement s'applique après un abonnement terminé, repasse l'espace en Team et n'a plus de stockage de fin", () => {
    const stored = makeRecorded({
      id: "polar-subscription-1",
      status: "ended",
      storedBytesAtEnd: STORED_BYTES,
    });
    const incoming = makeSubscription({
      id: "polar-subscription-2",
      modifiedAt: secondsAfter(MODIFIED_AT, 60),
    });

    expect(subscriptionChangeOf({ storedBytes: 100, stored, incoming, plan: "free" })).toEqual({
      kind: "applied",
      subscription: withoutEndStorage(incoming),
      planChange: { before: "free", after: "team" },
    });
  });

  it("un état plus récent d'une seconde s'applique", () => {
    const stored = makeRecorded({ status: "ended" });
    const incoming = makeSubscription({ modifiedAt: secondsAfter(MODIFIED_AT, 1) });

    expect(
      subscriptionChangeOf({ storedBytes: STORED_BYTES, stored, incoming, plan: "free" }),
    ).toEqual({
      kind: "applied",
      subscription: withoutEndStorage(incoming),
      planChange: { before: "free", after: "team" },
    });
  });
});

describe("la fin d'un abonnement rend l'espace Free et enregistre son stockage (ADR 0050 §5, §6)", () => {
  const revoked = makeSubscription({ status: "ended", modifiedAt: secondsAfter(MODIFIED_AT, 60) });

  it("une révocation rend l'espace Free, même au-dessus des limites Free, et enregistre son stockage", () => {
    expect(
      subscriptionChangeOf({
        stored: makeRecorded(),
        incoming: revoked,
        plan: "team",
        storedBytes: STORED_BYTES,
      }),
    ).toEqual({
      kind: "applied",
      subscription: { ...revoked, storedBytesAtEnd: STORED_BYTES },
      planChange: { before: "team", after: "free" },
    });
  });

  it("un abonnement terminé dès son premier état enregistre aussi le stockage", () => {
    expect(
      subscriptionChangeOf({ stored: undefined, incoming: revoked, plan: "free", storedBytes: 0 }),
    ).toEqual({
      kind: "applied",
      subscription: { ...revoked, storedBytesAtEnd: 0 },
      planChange: undefined,
    });
  });

  it("un nouvel état d'un abonnement déjà terminé garde le stockage enregistré à sa fin", () => {
    const later = makeSubscription({ status: "ended", modifiedAt: secondsAfter(MODIFIED_AT, 120) });

    expect(
      subscriptionChangeOf({
        stored: makeRecorded({ ...revoked, storedBytesAtEnd: STORED_BYTES }),
        incoming: later,
        plan: "free",
        storedBytes: 100,
      }),
    ).toEqual({
      kind: "applied",
      subscription: { ...later, storedBytesAtEnd: STORED_BYTES },
      planChange: undefined,
    });
  });

  it("la fin d'un nouvel abonnement, après un abonnement terminé, enregistre le stockage à sa fin", () => {
    const next = makeSubscription({
      id: "polar-subscription-2",
      status: "ended",
      modifiedAt: secondsAfter(MODIFIED_AT, 120),
    });

    expect(
      subscriptionChangeOf({
        stored: makeRecorded({ ...revoked, storedBytesAtEnd: STORED_BYTES }),
        incoming: next,
        plan: "team",
        storedBytes: 100,
      }),
    ).toEqual({
      kind: "applied",
      subscription: { ...next, storedBytesAtEnd: 100 },
      planChange: { before: "team", after: "free" },
    });
  });
});

describe("un abonnement dont le payeur a supprimé son compte reste suivi (ADR 0050 §3)", () => {
  const WITHOUT_PAYER = { payerId: undefined };

  it("une résiliation reçue après la suppression du payeur s'applique, sans payeur", () => {
    const incoming = makeSubscription({
      ...WITHOUT_PAYER,
      status: "canceling",
      modifiedAt: secondsAfter(MODIFIED_AT, 60),
    });

    expect(
      subscriptionChangeOf({
        stored: makeRecorded(WITHOUT_PAYER),
        incoming,
        plan: "team",
        storedBytes: STORED_BYTES,
      }),
    ).toEqual({
      kind: "applied",
      subscription: withoutEndStorage(incoming),
      planChange: undefined,
    });
  });

  it("une révocation reçue après la suppression du payeur rend l'espace Free", () => {
    const incoming = makeSubscription({
      ...WITHOUT_PAYER,
      status: "ended",
      modifiedAt: secondsAfter(MODIFIED_AT, 60),
    });

    expect(
      subscriptionChangeOf({
        stored: makeRecorded(WITHOUT_PAYER),
        incoming,
        plan: "team",
        storedBytes: STORED_BYTES,
      }),
    ).toEqual({
      kind: "applied",
      subscription: { ...incoming, storedBytesAtEnd: STORED_BYTES },
      planChange: { before: "team", after: "free" },
    });
  });

  it("un premier état dont le payeur n'existe pas est refusé", () => {
    expect(
      subscriptionChangeOf({
        stored: undefined,
        incoming: makeSubscription(WITHOUT_PAYER),
        plan: "free",
        storedBytes: STORED_BYTES,
      }),
    ).toEqual({ kind: "unknown_payer" });
  });

  it("un nouvel abonnement dont le payeur n'existe pas ne remplace pas un abonnement terminé", () => {
    expect(
      subscriptionChangeOf({
        stored: makeRecorded({ ...WITHOUT_PAYER, id: "polar-subscription-0", status: "ended" }),
        incoming: makeSubscription({ ...WITHOUT_PAYER, modifiedAt: secondsAfter(MODIFIED_AT, 60) }),
        plan: "free",
        storedBytes: STORED_BYTES,
      }),
    ).toEqual({ kind: "unknown_payer" });
  });
});
