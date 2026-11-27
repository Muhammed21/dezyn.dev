import { describe, expect, it } from "vitest";

import {
  AddedModeOutput,
  AddModeInput,
  checkOutputSchema,
  PendingProposalsProblem,
} from "../../index.ts";

const makePendingProposals = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  type: "https://dezyn.dev/problems/pending-proposals",
  title: "Propositions en attente",
  status: 400,
  ...overrides,
});

describe("le refus d'un ajout de mode par des propositions en attente (ADR 0062 §3)", () => {
  it("se reconnaît à son type", () => {
    expect(PendingProposalsProblem.parse(makePendingProposals())).toEqual(makePendingProposals());
  });

  it("ne se confond pas avec une requête invalide", () => {
    expect(
      PendingProposalsProblem.safeParse(makePendingProposals({ type: "about:blank" })).success,
    ).toBe(false);
  });
});

const makeAddedMode = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  mode: "contraste-eleve",
  copiedFrom: "clair",
  modes: ["clair", "sombre", "contraste-eleve"],
  ...overrides,
});

describe("entrée de l'ajout d'un mode (ADR 0062 §6)", () => {
  it("rogne le nom du mode, et garde le mode à copier tel quel", () => {
    expect(AddModeInput.parse({ name: "  contraste-eleve  ", copiedFrom: "clair" })).toEqual({
      name: "contraste-eleve",
      copiedFrom: "clair",
    });
  });

  it("accepte un nom de 100 caractères", () => {
    expect(AddModeInput.safeParse({ name: "a".repeat(100), copiedFrom: "clair" }).success).toBe(
      true,
    );
  });

  it.each([
    ["vide", ""],
    ["fait d'espaces", "   "],
    ["de 101 caractères", "a".repeat(101)],
  ])("refuse un nom %s", (_case, name) => {
    expect(AddModeInput.safeParse({ name, copiedFrom: "clair" }).success).toBe(false);
  });

  it("refuse un ajout sans mode à copier", () => {
    expect(AddModeInput.safeParse({ name: "contraste-eleve" }).success).toBe(false);
  });
});

describe("sortie de l'ajout d'un mode", () => {
  it("décode le mode ajouté, le mode copié et les modes du projet dans leur ordre", () => {
    expect(AddedModeOutput.parse(makeAddedMode())).toEqual(makeAddedMode());
  });

  it("garde une clé ajoutée plus tard par le serveur (ADR 0023 §1)", () => {
    const later = makeAddedMode({ position: 2 });

    expect(AddedModeOutput.parse(later)).toEqual(later);
  });

  it("refuse une sortie sans les modes du projet", () => {
    const { modes: _omitted, ...withoutModes } = makeAddedMode();

    expect(AddedModeOutput.safeParse(withoutModes).success).toBe(false);
  });

  it("respecte les conventions de sortie (ADR 0023 §4)", () => {
    expect(checkOutputSchema("AddedModeOutput", AddedModeOutput)).toEqual([]);
  });
});
