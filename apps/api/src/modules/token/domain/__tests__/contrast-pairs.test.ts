import { describe, expect, it } from "vitest";

import { contrastBackgrounds, contrastPairRefusals } from "../contrast-pairs.ts";

const makeDeclaringToken = (
  overrides: {
    readonly name?: string;
    readonly $type?: string;
    readonly $extensions?: Readonly<Record<string, unknown>>;
  } = {},
) => ({ name: "couleur.texte", $type: "color", ...overrides });

const declaring = (dezyn: unknown, overrides: { readonly $type?: string } = {}) =>
  makeDeclaringToken({ ...overrides, $extensions: { "dev.dezyn": dezyn } });

describe("une paire de contraste se déclare sous dev.dezyn.contrastOn (ADR 0061 §1)", () => {
  it("accepte une référence et un objet { on, usage } pour chacun des trois usages", () => {
    expect(
      contrastPairRefusals(
        declaring({
          contrastOn: [
            "{couleur.fond}",
            { on: "{couleur.surface}", usage: "text" },
            { on: "{couleur.carte}", usage: "large-text" },
            { on: "{couleur.bordure}", usage: "ui" },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("accepte un objet sans usage", () => {
    expect(contrastPairRefusals(declaring({ contrastOn: [{ on: "{couleur.fond}" }] }))).toEqual([]);
  });

  it("ignore un token sans dev.dezyn, et les autres extensions (ADR 0030 §2)", () => {
    expect(
      contrastPairRefusals(makeDeclaringToken({ $extensions: { "com.figma": { contrastOn: 1 } } })),
    ).toEqual([]);
    expect(contrastPairRefusals(makeDeclaringToken())).toEqual([]);
  });

  it("accepte dev.dezyn sans contrastOn", () => {
    expect(contrastPairRefusals(declaring({}))).toEqual([]);
  });
});

describe("dezyn refuse une déclaration mal formée (ADR 0061 §2)", () => {
  it.each([
    ["une chaîne", "{couleur.fond}"],
    ["une liste", []],
    ["nul", null],
  ])("dev.dezyn qui est %s", (_case, dezyn) => {
    expect(contrastPairRefusals(declaring(dezyn))).toEqual([
      { path: [], refusal: "malformed_extension" },
    ]);
  });

  it("toute autre propriété sous dev.dezyn", () => {
    expect(contrastPairRefusals(declaring({ contrastOn: [], seuil: 7 }))).toEqual([
      { path: ["seuil"], refusal: "unknown_property" },
    ]);
  });

  it("un contrastOn qui n'est pas une liste", () => {
    expect(contrastPairRefusals(declaring({ contrastOn: "{couleur.fond}" }))).toEqual([
      { path: ["contrastOn"], refusal: "malformed_contrast_on" },
    ]);
  });

  it.each([
    ["une référence sans accolades", "couleur.fond"],
    ["un nombre", 3],
    ["un objet sans on", { usage: "ui" }],
  ])("une entrée qui est %s", (_case, entry) => {
    expect(contrastPairRefusals(declaring({ contrastOn: [entry] }))).toEqual([
      { path: ["contrastOn", 0], refusal: "malformed_entry" },
    ]);
  });

  it("un on qui n'est pas une référence", () => {
    expect(
      contrastPairRefusals(declaring({ contrastOn: [{ on: "couleur.fond", usage: "ui" }] })),
    ).toEqual([{ path: ["contrastOn", 0, "on"], refusal: "malformed_reference" }]);
  });

  it("une autre propriété dans une entrée", () => {
    expect(
      contrastPairRefusals(declaring({ contrastOn: [{ on: "{couleur.fond}", ratio: 4.5 }] })),
    ).toEqual([{ path: ["contrastOn", 0, "ratio"], refusal: "unknown_entry_property" }]);
  });

  it.each(["AAA", "texte", ""])("l'usage inconnu « %s »", (usage) => {
    expect(
      contrastPairRefusals(declaring({ contrastOn: [{ on: "{couleur.fond}", usage }] })),
    ).toEqual([{ path: ["contrastOn", 0, "usage"], refusal: "unknown_usage" }]);
  });

  it("un contrastOn sur un token qui n'est pas une couleur", () => {
    expect(
      contrastPairRefusals(declaring({ contrastOn: ["{couleur.fond}"] }, { $type: "dimension" })),
    ).toEqual([{ path: ["contrastOn"], refusal: "not_a_color" }]);
  });

  it("une entrée qui cite le token lui-même, en référence comme en objet", () => {
    expect(
      contrastPairRefusals(
        declaring({ contrastOn: ["{couleur.texte}", { on: "{couleur.texte}", usage: "ui" }] }),
      ),
    ).toEqual([
      { path: ["contrastOn", 0], refusal: "self_reference" },
      { path: ["contrastOn", 1], refusal: "self_reference" },
    ]);
  });

  it("deux entrées qui citent le même fond, même avec des usages différents", () => {
    expect(
      contrastPairRefusals(
        declaring({
          contrastOn: ["{couleur.fond}", "{couleur.carte}", { on: "{couleur.fond}", usage: "ui" }],
        }),
      ),
    ).toEqual([{ path: ["contrastOn", 2], refusal: "duplicate_background" }]);
  });

  it("nomme chaque entrée refusée", () => {
    expect(
      contrastPairRefusals(
        declaring({ contrastOn: ["{couleur.fond}", 3, { on: "{x}", usage: 1 }] }),
      ),
    ).toEqual([
      { path: ["contrastOn", 1], refusal: "malformed_entry" },
      { path: ["contrastOn", 2, "usage"], refusal: "unknown_usage" },
    ]);
  });
});

describe("les fonds cités par un token", () => {
  it("rendent le nom du fond de chaque entrée bien formée, avec sa place", () => {
    expect(
      contrastBackgrounds({
        "dev.dezyn": {
          contrastOn: ["{couleur.fond}", 3, { on: "{couleur.surface}", usage: "ui" }, { on: 1 }],
        },
      }),
    ).toEqual([
      { index: 0, name: "couleur.fond" },
      { index: 2, name: "couleur.surface" },
    ]);
  });

  it.each([
    ["sans extensions", undefined],
    ["sans dev.dezyn", { "com.figma": { contrastOn: ["{couleur.fond}"] } }],
    ["avec un contrastOn qui n'est pas une liste", { "dev.dezyn": { contrastOn: "{a}" } }],
    ["avec un dev.dezyn qui n'est pas un objet", { "dev.dezyn": "{a}" }],
  ])("sont absents %s", (_case, extensions) => {
    expect(contrastBackgrounds(extensions)).toEqual([]);
  });
});
