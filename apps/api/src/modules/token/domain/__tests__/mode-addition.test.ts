import { describe, expect, it } from "vitest";

import { modeAdditionOf } from "../mode-addition.ts";

const LIGHT = { id: "3b1f6c2a-8d4e-4f1a-9c7b-5e2d1a0f9b8c", name: "clair" };
const DARK = { id: "7c2e9a1b-4f3d-4e8a-9f10-2c5d6e7f8a9b", name: "sombre" };

const makeAddition = (overrides: Partial<Parameters<typeof modeAdditionOf>[0]> = {}) => ({
  modes: [LIGHT, DARK],
  pendingNames: [],
  name: "contraste-eleve",
  copiedFrom: "sombre",
  ...overrides,
});

describe("un membre ajoute un mode à un projet à modes (ADR 0062)", () => {
  it("copie le mode choisi parmi ceux du projet", () => {
    expect(modeAdditionOf(makeAddition({ copiedFrom: "sombre" }))).toEqual({ source: DARK });
  });

  it("refuse un projet sans modes, même sans proposition en attente (§5)", () => {
    expect(modeAdditionOf(makeAddition({ modes: [], copiedFrom: "clair" }))).toEqual({
      refusal: "no_modes",
    });
  });

  it("refuse un projet qui a une proposition en attente (§3)", () => {
    expect(modeAdditionOf(makeAddition({ pendingNames: ["couleur.fond"] }))).toEqual({
      refusal: "pending_proposals",
    });
  });

  it("refuse un nom déjà pris par un mode du projet (§6)", () => {
    expect(modeAdditionOf(makeAddition({ name: "clair" }))).toEqual({ refusal: "name_taken" });
  });

  it("refuse un mode à copier qui n'est pas un mode du projet (§6)", () => {
    expect(modeAdditionOf(makeAddition({ copiedFrom: "contraste" }))).toEqual({
      refusal: "unknown_source",
    });
  });

  it("refuse un projet sans modes avant de regarder ses propositions en attente", () => {
    expect(modeAdditionOf(makeAddition({ modes: [], pendingNames: ["couleur.fond"] }))).toEqual({
      refusal: "no_modes",
    });
  });
});
