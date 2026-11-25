import { describe, expect, it } from "vitest";

import { earliestAllowedAuthTime, sessionEndCutsChains } from "../refresh-chain.ts";

const NOW = new Date("2026-11-25T12:00:00.000Z");
const DAY_MS = 86_400_000;

const millisecondsFromNow = (milliseconds: number) => new Date(NOW.getTime() + milliseconds);

describe("fin d'une session web et chaînes autorisées depuis elle (ADR 0060 §4)", () => {
  it("la fin d'une session encore valide coupe ses chaînes", () => {
    expect(sessionEndCutsChains({ expiresAt: millisecondsFromNow(1), now: NOW })).toBe(true);
  });

  it("la disparition d'une session expirée à l'instant ne coupe rien", () => {
    expect(sessionEndCutsChains({ expiresAt: NOW, now: NOW })).toBe(false);
  });

  it("la disparition d'une session expirée depuis longtemps ne coupe rien", () => {
    expect(sessionEndCutsChains({ expiresAt: millisecondsFromNow(-8 * DAY_MS), now: NOW })).toBe(
      false,
    );
  });
});

describe("heure d'authentification la plus ancienne qu'une chaîne admet (ADR 0018 §4)", () => {
  it("vaut 180 jours avant maintenant", () => {
    expect(earliestAllowedAuthTime(NOW)).toEqual(millisecondsFromNow(-180 * DAY_MS));
  });
});
