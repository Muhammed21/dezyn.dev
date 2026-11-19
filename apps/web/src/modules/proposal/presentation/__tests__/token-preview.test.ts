import { describe, expect, it } from "vitest";

import { previewOf } from "../token-preview.ts";

const makeColor = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  colorSpace: "srgb",
  components: [0.2, 0.4, 0.8],
  ...overrides,
});

describe("aperçu d'une couleur srgb", () => {
  it("donne une pastille et le hex de ses composantes", () => {
    expect(previewOf({ type: "color", value: makeColor({ components: [0.2, 0.4, 0.8] }) })).toEqual(
      {
        shape: "swatch",
        text: "#3366cc",
        style: { backgroundColor: "#3366cc" },
      },
    );
  });

  it("arrondit chaque composante à l'octet le plus proche, aux deux bornes", () => {
    expect(previewOf({ type: "color", value: makeColor({ components: [0, 0.5, 1] }) })).toEqual({
      shape: "swatch",
      text: "#0080ff",
      style: { backgroundColor: "#0080ff" },
    });
  });

  it("omet l'alpha quand il vaut 1", () => {
    expect(previewOf({ type: "color", value: makeColor({ alpha: 1 }) })).toEqual({
      shape: "swatch",
      text: "#3366cc",
      style: { backgroundColor: "#3366cc" },
    });
  });

  it("ajoute l'alpha au hex quand il vaut 0", () => {
    expect(previewOf({ type: "color", value: makeColor({ alpha: 0 }) })).toEqual({
      shape: "swatch",
      text: "#3366cc00",
      style: { backgroundColor: "#3366cc00" },
    });
  });

  it("ajoute un alpha intermédiaire au hex", () => {
    expect(previewOf({ type: "color", value: makeColor({ alpha: 0.5 }) })).toEqual({
      shape: "swatch",
      text: "#3366cc80",
      style: { backgroundColor: "#3366cc80" },
    });
  });
});

describe("aperçu en texte brut", () => {
  it.each([
    ["un autre espace de couleur", makeColor({ colorSpace: "display-p3" })],
    ["une composante hors de [0, 1]", makeColor({ components: [1.2, 0.4, 0.8] })],
    ["une composante négative", makeColor({ components: [-0.1, 0.4, 0.8] })],
    ["une composante « none »", makeColor({ components: ["none", 0.4, 0.8] })],
    ["deux composantes", makeColor({ components: [0.2, 0.4] })],
    ["quatre composantes", makeColor({ components: [0.2, 0.4, 0.8, 1] })],
    ["un alpha hors de [0, 1]", makeColor({ alpha: 1.5 })],
    ["un alpha négatif", makeColor({ alpha: -0.5 })],
    ["un alias", "{couleur.bleu.500}"],
    ["null", null],
  ])("montre une couleur mal formée en JSON : %s", (_case, value) => {
    expect(previewOf({ type: "color", value })).toEqual({
      shape: "text",
      text: JSON.stringify(value),
    });
  });

  it.each([
    ["un type sans aperçu", "number"],
    ["un type ajouté plus tard par le serveur", "spacing"],
    ["un nom hérité d'Object", "constructor"],
    ["un type absent", undefined],
  ])("montre la valeur en JSON pour %s", (_case, type) => {
    expect(previewOf({ type, value: makeColor() })).toEqual({
      shape: "text",
      text: JSON.stringify(makeColor()),
    });
  });

  it("montre un texte vide pour une valeur absente", () => {
    expect(previewOf({ type: "color", value: undefined })).toEqual({ shape: "text", text: "" });
  });
});
