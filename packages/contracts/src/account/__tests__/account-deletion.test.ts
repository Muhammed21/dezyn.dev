import { describe, expect, it } from "vitest";

import { AccountDeletionOutput, checkOutputSchema, LastOwnerProblem } from "../../index.ts";

const SPACE_ID = "0b8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";

const makeDeletion = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  paidSpaces: [{ id: SPACE_ID, name: "Studio Ada", currentPeriodEnd: "2026-12-22T10:00:00.000Z" }],
  lastOwnerSpaces: [{ id: SPACE_ID, name: "Studio Ada" }],
  ...overrides,
});

describe("sortie de la suppression d'un compte, lue avant de confirmer", () => {
  it("lit les espaces payés, avec leur fin de période, et les espaces sans autre propriétaire", () => {
    const read = makeDeletion();

    expect(AccountDeletionOutput.parse(read)).toEqual(read);
  });

  it("lit un espace payé sans fin de période connue", () => {
    const read = makeDeletion({
      paidSpaces: [{ id: SPACE_ID, name: "Studio Ada", currentPeriodEnd: null }],
    });

    expect(AccountDeletionOutput.parse(read)).toEqual(read);
  });

  it("garde une clé ajoutée plus tard par le serveur (ADR 0023 §1)", () => {
    const later = makeDeletion({ ownedProjects: 3 });

    expect(AccountDeletionOutput.parse(later)).toEqual(later);
  });

  it.each([
    ["sans espaces payés", { paidSpaces: undefined }],
    ["sans espaces sans autre propriétaire", { lastOwnerSpaces: undefined }],
    [
      "une fin de période qui n'est pas une date",
      { paidSpaces: [{ id: SPACE_ID, name: "Studio Ada", currentPeriodEnd: "bientôt" }] },
    ],
    ["un espace sans identifiant", { lastOwnerSpaces: [{ name: "Studio Ada" }] }],
  ])("refuse une sortie %s", (_case, overrides) => {
    expect(AccountDeletionOutput.safeParse(makeDeletion(overrides)).success).toBe(false);
  });

  it("respecte les conventions des contrats de sortie", () => {
    expect(checkOutputSchema("AccountDeletionOutput", AccountDeletionOutput)).toEqual([]);
  });
});

describe("le refus du dernier propriétaire nomme ses espaces", () => {
  it("lit les espaces dont le compte est le dernier propriétaire", () => {
    const problem = {
      type: "https://dezyn.dev/problems/last-owner",
      title: "Dernier propriétaire d'un espace",
      status: 409,
      spaces: [{ id: SPACE_ID, name: "Studio Ada" }],
    };

    expect(LastOwnerProblem.parse(problem)).toEqual(problem);
  });
});
