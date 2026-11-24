import { describe, expect, it } from "vitest";

import { orphanSpaceIsPurgeable, type OrphanSubscription } from "../orphan-space.ts";

const NOW = new Date("2026-11-23T10:00:00.000Z");

const ONE_MILLISECOND_BEFORE = new Date(NOW.getTime() - 1);

const ONE_MILLISECOND_AFTER = new Date(NOW.getTime() + 1);

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const orphanedBefore = (ms: number) => new Date(NOW.getTime() - ms);

const GRACE_OVER = orphanedBefore(30 * 24 * 60 * 60 * 1000);

const makeSubscription = (overrides: Partial<OrphanSubscription> = {}): OrphanSubscription => ({
  status: "canceling",
  currentPeriodEnd: ONE_MILLISECOND_AFTER,
  cancelRequested: false,
  ...overrides,
});

describe("un espace orphelin se purge après la fin de sa période payée (ADR 0051)", () => {
  it("un espace orphelin sans abonnement se purge", () => {
    expect(
      orphanSpaceIsPurgeable({ orphanedAt: GRACE_OVER, subscription: undefined, now: NOW }),
    ).toBe(true);
  });

  it("un espace orphelin dont l'abonnement est terminé se purge, même avant la date de fin annoncée", () => {
    expect(
      orphanSpaceIsPurgeable({
        orphanedAt: GRACE_OVER,
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
          orphanedAt: GRACE_OVER,
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
        orphanedAt: GRACE_OVER,
        subscription: makeSubscription({ status: "canceling", currentPeriodEnd }),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("un abonnement non terminé sans date de fin fait attendre la purge", () => {
    expect(
      orphanSpaceIsPurgeable({
        orphanedAt: GRACE_OVER,
        subscription: makeSubscription({ status: "canceling", currentPeriodEnd: undefined }),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("une résiliation encore à envoyer à Polar fait attendre la purge, même après la fin de la période", () => {
    expect(
      orphanSpaceIsPurgeable({
        orphanedAt: GRACE_OVER,
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

describe("un espace orphelin attend 7 jours avant sa purge (ADR 0056)", () => {
  it.each([
    ["exactement 7 jours", SEVEN_DAYS_MS],
    ["7 jours et une milliseconde", SEVEN_DAYS_MS + 1],
  ])("un espace orphelin sans abonnement depuis %s se purge", (_label, orphanedFor) => {
    expect(
      orphanSpaceIsPurgeable({
        orphanedAt: orphanedBefore(orphanedFor),
        subscription: undefined,
        now: NOW,
      }),
    ).toBe(true);
  });

  it.each([
    ["7 jours moins une milliseconde", SEVEN_DAYS_MS - 1],
    ["une heure", 60 * 60 * 1000],
  ])("un espace orphelin sans abonnement depuis %s attend la purge", (_label, orphanedFor) => {
    expect(
      orphanSpaceIsPurgeable({
        orphanedAt: orphanedBefore(orphanedFor),
        subscription: undefined,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("un abonnement terminé n'abrège pas le délai de grâce", () => {
    expect(
      orphanSpaceIsPurgeable({
        orphanedAt: orphanedBefore(SEVEN_DAYS_MS - 1),
        subscription: makeSubscription({
          status: "ended",
          currentPeriodEnd: ONE_MILLISECOND_BEFORE,
        }),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("un abonnement dont la période payée finit après le délai fait toujours attendre la purge", () => {
    expect(
      orphanSpaceIsPurgeable({
        orphanedAt: orphanedBefore(SEVEN_DAYS_MS),
        subscription: makeSubscription({
          status: "canceling",
          currentPeriodEnd: ONE_MILLISECOND_AFTER,
        }),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("un espace orphelin dont l'heure d'orphelinat est inconnue attend la purge", () => {
    expect(
      orphanSpaceIsPurgeable({ orphanedAt: undefined, subscription: undefined, now: NOW }),
    ).toBe(false);
  });
});
