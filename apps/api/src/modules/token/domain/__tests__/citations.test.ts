import { describe, expect, it } from "vitest";

import { type Citation, citationMessage } from "../citations.ts";

const makeCitation = (overrides: Partial<Citation> = {}): Citation => ({
  cited: "couleur.bleu.500",
  citing: "couleur.fond",
  via: "alias",
  ...overrides,
});

describe("un token encore cité ne se supprime pas, et le refus nomme ceux qui le citent (ADR 0026 §2)", () => {
  it("nomme un token qui le cite par alias", () => {
    expect(citationMessage([makeCitation({ citing: "couleur.a", via: "alias" })])).toBe(
      "Token encore cité : couleur.a (alias)",
    );
  });

  it("nomme un token qui le cite par un champ (ADR 0029)", () => {
    expect(citationMessage([makeCitation({ citing: "ombre.carte", via: "field" })])).toBe(
      "Token encore cité : ombre.carte (champ)",
    );
  });

  it("nomme un token qui le cite dans une paire de contraste (ADR 0061 §3)", () => {
    expect(citationMessage([makeCitation({ citing: "couleur.texte", via: "contrastOn" })])).toBe(
      "Token encore cité : couleur.texte (paire de contraste)",
    );
  });

  it("nomme chaque token qui le cite, par ordre de nom", () => {
    expect(
      citationMessage([
        makeCitation({ citing: "couleur.b", via: "field" }),
        makeCitation({ citing: "couleur.a", via: "alias" }),
      ]),
    ).toBe("Token encore cité : couleur.a (alias), couleur.b (champ)");
  });

  it("nomme une fois un token qui le cite de la même façon dans plusieurs modes", () => {
    expect(
      citationMessage([
        makeCitation({ citing: "couleur.a", via: "alias" }),
        makeCitation({ citing: "couleur.a", via: "alias" }),
      ]),
    ).toBe("Token encore cité : couleur.a (alias)");
  });

  it("nomme les deux façons d'un token qui le cite par alias et par champ", () => {
    expect(
      citationMessage([
        makeCitation({ citing: "couleur.a", via: "field" }),
        makeCitation({ citing: "couleur.a", via: "alias" }),
      ]),
    ).toBe("Token encore cité : couleur.a (alias), couleur.a (champ)");
  });
});
