import { describe, expect, it } from "vitest";

import { TokenDefinitionInput } from "../token-definition.ts";

describe("un nombre non fini est refusé en nommant le champ (ADR 0028 §1)", () => {
  it.each([[Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY], [Number.NaN]])(
    "%s",
    ($value) => {
      const parsed = TokenDefinitionInput.safeParse({
        name: "calque.haut",
        $type: "number",
        $value,
      });

      expect(parsed.error?.issues).toMatchObject([{ path: ["$value"] }]);
    },
  );
});

const makeContrastDeclaration = (dezyn: unknown, overrides: Record<string, unknown> = {}) => ({
  name: "couleur.texte",
  $type: "color",
  $value: { colorSpace: "srgb", components: [0.1, 0.1, 0.1] },
  $extensions: { "dev.dezyn": dezyn },
  ...overrides,
});

const issuesOf = (candidate: unknown) =>
  TokenDefinitionInput.safeParse(candidate).error?.issues.map(({ path, message }) => ({
    path: path.map(String).join("."),
    message,
  }));

describe("dezyn valide la clé dev.dezyn de $extensions (ADR 0061 §2)", () => {
  it("accepte des paires bien formées, et garde les autres extensions telles quelles", () => {
    const candidate = makeContrastDeclaration(undefined, {
      $extensions: {
        "dev.dezyn": { contrastOn: ["{couleur.fond}", { on: "{couleur.bordure}", usage: "ui" }] },
        "com.figma": { anything: [1, "deux"] },
      },
    });

    expect(TokenDefinitionInput.parse(candidate)).toEqual(candidate);
  });

  it.each([
    [
      { contrastOn: [], seuil: 7 },
      "$extensions.dev.dezyn.seuil",
      "Seul contrastOn est défini sous dev.dezyn",
    ],
    ["{couleur.fond}", "$extensions.dev.dezyn", "Objet attendu sous dev.dezyn"],
    [
      { contrastOn: "{couleur.fond}" },
      "$extensions.dev.dezyn.contrastOn",
      "Liste de paires attendue",
    ],
    [
      { contrastOn: ["couleur.fond"] },
      "$extensions.dev.dezyn.contrastOn.0",
      "Paire attendue en référence {nom.du.token} ou en objet { on, usage }",
    ],
    [
      { contrastOn: [{ on: "couleur.fond" }] },
      "$extensions.dev.dezyn.contrastOn.0.on",
      "Référence attendue au format {nom.du.token}",
    ],
    [
      { contrastOn: [{ on: "{couleur.fond}", ratio: 3 }] },
      "$extensions.dev.dezyn.contrastOn.0.ratio",
      "Propriété inconnue dans une paire de contraste",
    ],
    [
      { contrastOn: [{ on: "{couleur.fond}", usage: "AAA" }] },
      "$extensions.dev.dezyn.contrastOn.0.usage",
      "Usage attendu : text, large-text ou ui",
    ],
    [
      { contrastOn: ["{couleur.texte}"] },
      "$extensions.dev.dezyn.contrastOn.0",
      "Une paire ne cite pas le token qui la déclare",
    ],
    [
      { contrastOn: ["{couleur.fond}", { on: "{couleur.fond}", usage: "ui" }] },
      "$extensions.dev.dezyn.contrastOn.1",
      "Fond déjà cité par une autre paire",
    ],
  ])("refuse %j en nommant le champ", (dezyn, path, message) => {
    expect(issuesOf(makeContrastDeclaration(dezyn))).toEqual([{ path, message }]);
  });

  it("refuse un contrastOn sur un token qui n'est pas une couleur", () => {
    expect(
      issuesOf(
        makeContrastDeclaration(
          { contrastOn: ["{couleur.fond}"] },
          { name: "espace.petit", $type: "dimension", $value: { value: 4, unit: "px" } },
        ),
      ),
    ).toEqual([
      {
        path: "$extensions.dev.dezyn.contrastOn",
        message: "Seul un token de couleur déclare des paires de contraste",
      },
    ]);
  });
});
