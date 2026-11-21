import { describe, expect, it } from "vitest";

import { spaceStorageOf, storageAlertReached } from "../storage-limit.ts";

describe("un espace est alerté à 80 % de sa limite de stockage (ADR 0006 §4, ADR 0032 §4)", () => {
  it("un espace Free à 400 000 000 octets, 80 % de 500 Mo, est alerté", () => {
    expect(storageAlertReached({ plan: "free", storedBytes: 400_000_000 })).toBe(true);
  });

  it("un espace Free à un octet sous 80 % n'est pas alerté", () => {
    expect(storageAlertReached({ plan: "free", storedBytes: 399_999_999 })).toBe(false);
  });

  it("un espace Free au-delà de sa limite est alerté", () => {
    expect(storageAlertReached({ plan: "free", storedBytes: 600_000_000 })).toBe(true);
  });

  it("un espace Team à 16 000 000 000 octets, 80 % de 20 Go, est alerté", () => {
    expect(storageAlertReached({ plan: "team", storedBytes: 16_000_000_000 })).toBe(true);
  });

  it("un espace Team à un octet sous 80 % n'est pas alerté, même au-delà de la limite Free", () => {
    expect(storageAlertReached({ plan: "team", storedBytes: 15_999_999_999 })).toBe(false);
  });
});

describe("le stockage d'un espace se lit avec la limite de son plan (ADR 0032 §1)", () => {
  it("un espace Free à 80 % de 500 Mo rend son stockage, sa limite et l'alerte atteinte", () => {
    expect(spaceStorageOf({ plan: "free", storedBytes: 400_000_000 })).toEqual({
      usedBytes: 400_000_000,
      limitBytes: 500_000_000,
      alertReached: true,
    });
  });

  it("un espace Team à un octet sous 80 % rend sa limite de 20 Go, sans alerte", () => {
    expect(spaceStorageOf({ plan: "team", storedBytes: 15_999_999_999 })).toEqual({
      usedBytes: 15_999_999_999,
      limitBytes: 20_000_000_000,
      alertReached: false,
    });
  });
});
