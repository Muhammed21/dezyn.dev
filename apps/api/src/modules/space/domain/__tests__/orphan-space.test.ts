import { describe, expect, it } from "vitest";

import { orphanSpaceIsPurgeable, type OrphanSubscription } from "../orphan-space.ts";

const NOW = new Date("2026-11-23T10:00:00.000Z");

const ONE_MILLISECOND_BEFORE = new Date(NOW.getTime() - 1);

const ONE_MILLISECOND_AFTER = new Date(NOW.getTime() + 1);

const makeSubscription = (overrides: Partial<OrphanSubscription> = {}): OrphanSubscription => ({
  status: "canceling",
  currentPeriodEnd: ONE_MILLISECOND_AFTER,
  cancelRequested: false,
  ...overrides,
});

describe("un espace orphelin se purge après la fin de sa période payée (ADR 0051)", () => {
  it("un espace orphelin sans abonnement se purge", () => {
    expect(orphanSpaceIsPurgeable({ subscription: undefined, now: NOW })).toBe(true);
  });

  it("un espace orphelin dont l'abonnement est terminé se purge, même avant la date de fin annoncée", () => {
    expect(
      orphanSpaceIsPurgeable({
        subscription: makeSubscription({
          status: "ended",
          currentPeriodEnd: ONE_MILLISECOND_AFTER,
        }),
        now: NOW,
      }),
    ).toBe(true);
  });

  it.each(["active", "canceling", "past_due"])(
    "un abonnement %s dont la période n'est pas finie fait attendre la purge",
    (status) => {
      expect(
        orphanSpaceIsPurgeable({
          subscription: makeSubscription({ status, currentPeriodEnd: ONE_MILLISECOND_AFTER }),
          now: NOW,
        }),
      ).toBe(false);
    },
  );

  it.each([
    ["à l'instant même", NOW],
    ["une milliseconde plus tôt", ONE_MILLISECOND_BEFORE],
  ])("un abonnement non terminé dont la période a fini %s se purge", (_label, currentPeriodEnd) => {
    expect(
      orphanSpaceIsPurgeable({
        subscription: makeSubscription({ status: "canceling", currentPeriodEnd }),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("un abonnement non terminé sans date de fin fait attendre la purge", () => {
    expect(
      orphanSpaceIsPurgeable({
        subscription: makeSubscription({ status: "canceling", currentPeriodEnd: undefined }),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("une résiliation encore à envoyer à Polar fait attendre la purge, même après la fin de la période", () => {
    expect(
      orphanSpaceIsPurgeable({
        subscription: makeSubscription({
          status: "active",
          currentPeriodEnd: ONE_MILLISECOND_BEFORE,
          cancelRequested: true,
        }),
        now: NOW,
      }),
    ).toBe(false);
  });
});
