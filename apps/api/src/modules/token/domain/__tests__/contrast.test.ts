import { describe, expect, it } from "vitest";

import type { SrgbColor } from "../color.ts";
import {
  type ContrastToken,
  contrastOf,
  contrastRatio,
  judgeRatio,
  projectContrast,
} from "../contrast.ts";

const makeColor = (
  components: SrgbColor["components"],
  overrides: Partial<SrgbColor> = {},
): SrgbColor => ({ colorSpace: "srgb", components, ...overrides });

const gray = (byte: number) => makeColor([byte / 255, byte / 255, byte / 255]);

const BLACK = makeColor([0, 0, 0]);

const WHITE = makeColor([1, 1, 1]);

const makeContrastToken = (overrides: Partial<ContrastToken> = {}): ContrastToken => ({
  name: "couleur.texte",
  $type: "color",
  $value: BLACK,
  ...overrides,
});

const declaring = (contrastOn: readonly unknown[], overrides: Partial<ContrastToken> = {}) =>
  makeContrastToken({ $extensions: { "dev.dezyn": { contrastOn } }, ...overrides });

const makeBackground = (overrides: Partial<ContrastToken> = {}) =>
  makeContrastToken({ name: "couleur.fond", $value: WHITE, ...overrides });

describe("le ratio de contraste WCAG 2.x de deux couleurs opaques (ADR 0061, notes d'implémentation)", () => {
  it("vaut 21 pour du noir sur du blanc", () => {
    expect(contrastRatio({ foreground: BLACK, background: WHITE })).toBe(21);
  });

  it("vaut 1 pour une couleur sur elle-même", () => {
    expect(contrastRatio({ foreground: gray(0x77), background: gray(0x77) })).toBe(1);
  });

  it("ne dépend pas de l'ordre : la couleur la plus claire est au numérateur", () => {
    expect(contrastRatio({ foreground: WHITE, background: BLACK })).toBe(21);
  });

  it.each([
    ["#767676 sur blanc", gray(0x76), 4.542_224_959_6],
    ["#777777 sur blanc", gray(0x77), 4.478_089_453_6],
    ["#949494 sur blanc", gray(0x94), 3.033_469_825_7],
    ["#959595 sur blanc", gray(0x95), 2.995_346_135_7],
    ["bleu pur sur blanc", makeColor([0, 0, 1]), 8.592_471_358_4],
    ["rouge pur sur blanc", makeColor([1, 0, 0]), 3.998_476_770_8],
    ["vert pur sur blanc", makeColor([0, 1, 0]), 1.372_190_277_1],
  ])("rend le ratio de référence de %s", (_pair, foreground, ratio) => {
    expect(contrastRatio({ foreground, background: WHITE })).toBeCloseTo(ratio, 9);
  });

  it("linéarise une composante entre 0,03928 et 0,04045 par C / 12,92 (seuil sRGB 0,04045)", () => {
    expect(
      contrastRatio({ foreground: makeColor([0.04, 0.04, 0.04]), background: BLACK }),
    ).toBeCloseTo((0.04 / 12.92 + 0.05) / 0.05, 12);
  });

  it("linéarise une composante au-dessus de 0,04045 par la puissance 2,4", () => {
    const linear = ((0.5 + 0.055) / 1.055) ** 2.4;

    expect(
      contrastRatio({ foreground: makeColor([0.5, 0.5, 0.5]), background: BLACK }),
    ).toBeCloseTo((linear + 0.05) / 0.05, 12);
  });

  it.each([
    ["rouge", makeColor([0.5, 0, 0]), 0.2126],
    ["vert", makeColor([0, 0.5, 0]), 0.7152],
    ["bleu", makeColor([0, 0, 0.5]), 0.0722],
  ])("pondère la composante %s de la luminance relative", (_channel, foreground, weight) => {
    const linear = ((0.5 + 0.055) / 1.055) ** 2.4;

    expect(contrastRatio({ foreground, background: BLACK })).toBeCloseTo(
      (weight * linear + 0.05) / 0.05,
      12,
    );
  });
});

describe("un premier plan translucide est composé sur son fond (source-over, sRGB non linéarisé)", () => {
  it("un blanc à 50 % sur du noir se juge comme le gris à 0,5 qu'il donne", () => {
    expect(
      contrastRatio({ foreground: makeColor([1, 1, 1], { alpha: 0.5 }), background: BLACK }),
    ).toBe(contrastRatio({ foreground: makeColor([0.5, 0.5, 0.5]), background: BLACK }));
  });

  it("compose chaque composante par α·Cpremier + (1 − α)·Cfond", () => {
    const foreground = makeColor([0.9, 0.2, 0.6], { alpha: 0.25 });
    const background = makeColor([0.1, 0.8, 0.4]);
    const composed = makeColor([
      0.25 * 0.9 + 0.75 * 0.1,
      0.25 * 0.2 + 0.75 * 0.8,
      0.25 * 0.6 + 0.75 * 0.4,
    ]);

    expect(contrastRatio({ foreground, background })).toBeCloseTo(
      contrastRatio({ foreground: composed, background }),
      12,
    );
  });

  it("un premier plan entièrement transparent se confond avec son fond", () => {
    expect(
      contrastRatio({ foreground: makeColor([0, 0, 0], { alpha: 0 }), background: WHITE }),
    ).toBe(1);
  });

  it("un alpha de 1 ne change rien", () => {
    expect(
      contrastRatio({ foreground: makeColor([0, 0, 0], { alpha: 1 }), background: WHITE }),
    ).toBe(21);
  });
});

describe("le verdict d'une paire se juge contre le seuil de son usage (ADR 0061 §4)", () => {
  it.each([
    ["text", 4.5],
    ["large-text", 3],
    ["ui", 3],
  ] as const)("l'usage %s a le seuil %d:1", (usage, threshold) => {
    expect(contrastOf({ foreground: BLACK, background: WHITE, usage }).threshold).toBe(threshold);
  });

  it.each([
    ["text", 4.5, "pass"],
    ["text", 4.499_999, "fail"],
    ["large-text", 3, "pass"],
    ["large-text", 2.999_999, "fail"],
    ["ui", 3, "pass"],
    ["ui", 2.999_999, "fail"],
  ] as const)("l'usage %s au ratio %d donne %s", (usage, ratio, verdict) => {
    expect(judgeRatio({ ratio, usage }).verdict).toBe(verdict);
  });

  it("#767676 passe et #777777 échoue en texte sur blanc", () => {
    expect(contrastOf({ foreground: gray(0x76), background: WHITE, usage: "text" })).toEqual({
      ratio: 4.54,
      threshold: 4.5,
      verdict: "pass",
    });
    expect(contrastOf({ foreground: gray(0x77), background: WHITE, usage: "text" })).toEqual({
      ratio: 4.47,
      threshold: 4.5,
      verdict: "fail",
    });
  });

  it("#949494 passe et #959595 échoue en élément d'interface sur blanc", () => {
    expect(contrastOf({ foreground: gray(0x94), background: WHITE, usage: "ui" }).verdict).toBe(
      "pass",
    );
    expect(contrastOf({ foreground: gray(0x95), background: WHITE, usage: "ui" })).toEqual({
      ratio: 2.99,
      threshold: 3,
      verdict: "fail",
    });
  });

  it("rend le ratio tronqué au centième, jamais arrondi vers le seuil", () => {
    expect(judgeRatio({ ratio: 4.499_999, usage: "text" })).toEqual({
      ratio: 4.49,
      threshold: 4.5,
      verdict: "fail",
    });
  });

  it("rend 21 pour du noir sur du blanc", () => {
    expect(contrastOf({ foreground: BLACK, background: WHITE, usage: "text" }).ratio).toBe(21);
  });

  it("un fond translucide donne indeterminate, sans ratio, avec sa raison", () => {
    expect(
      contrastOf({
        foreground: BLACK,
        background: makeColor([1, 1, 1], { alpha: 0.99 }),
        usage: "text",
      }),
    ).toEqual({
      ratio: null,
      threshold: 4.5,
      verdict: "indeterminate",
      reason: "translucent_background",
    });
  });

  it("un fond d'alpha 1 se juge", () => {
    expect(
      contrastOf({
        foreground: BLACK,
        background: makeColor([1, 1, 1], { alpha: 1 }),
        usage: "text",
      }).verdict,
    ).toBe("pass");
  });

  it("un fond translucide l'emporte sur un premier plan translucide", () => {
    expect(
      contrastOf({
        foreground: makeColor([0, 0, 0], { alpha: 0.5 }),
        background: makeColor([1, 1, 1], { alpha: 0.5 }),
        usage: "ui",
      }),
    ).toMatchObject({ verdict: "indeterminate", reason: "translucent_background" });
  });
});

describe("le contraste d'un projet couvre chaque paire déclarée dans chaque mode (ADR 0061 §4)", () => {
  it("rend une liste vide pour un projet sans paire", () => {
    expect(projectContrast({ modes: [], tokens: [makeContrastToken(), makeBackground()] })).toEqual(
      [],
    );
  });

  it("juge une paire en référence simple comme un texte, sans mode pour un projet sans modes", () => {
    expect(
      projectContrast({
        modes: [],
        tokens: [
          declaring(["{couleur.fond}"], { $value: BLACK }),
          makeBackground({ $value: WHITE }),
        ],
      }),
    ).toEqual([
      {
        token: "couleur.texte",
        background: "couleur.fond",
        usage: "text",
        mode: null,
        ratio: 21,
        threshold: 4.5,
        verdict: "pass",
      },
    ]);
  });

  it("juge chaque paire avec l'usage qu'elle déclare, dans l'ordre de déclaration", () => {
    const pairs = projectContrast({
      modes: [],
      tokens: [
        declaring([
          { on: "{couleur.fond}", usage: "large-text" },
          { on: "{couleur.surface}", usage: "ui" },
          { on: "{couleur.carte}" },
        ]),
        makeBackground(),
        makeBackground({ name: "couleur.surface" }),
        makeBackground({ name: "couleur.carte" }),
      ],
    });

    expect(pairs.map(({ background, usage, threshold }) => [background, usage, threshold])).toEqual(
      [
        ["couleur.fond", "large-text", 3],
        ["couleur.surface", "ui", 3],
        ["couleur.carte", "text", 4.5],
      ],
    );
  });

  it("juge chaque paire dans chaque mode du projet, avec la valeur de ce mode", () => {
    const pairs = projectContrast({
      modes: ["clair", "sombre"],
      tokens: [
        declaring(["{couleur.fond}"], {
          $value: undefined,
          modes: { clair: BLACK, sombre: gray(0x77) },
        }),
        makeBackground({ $value: undefined, modes: { clair: WHITE, sombre: WHITE } }),
      ],
    });

    expect(pairs.map(({ mode, ratio, verdict }) => [mode, ratio, verdict])).toEqual([
      ["clair", 21, "pass"],
      ["sombre", 4.47, "fail"],
    ]);
  });

  it("une valeur unique vaut dans chaque mode du projet", () => {
    const pairs = projectContrast({
      modes: ["clair", "sombre"],
      tokens: [
        declaring(["{couleur.fond}"], { $value: gray(0x77) }),
        makeBackground({ $value: undefined, modes: { clair: WHITE, sombre: gray(0x77) } }),
      ],
    });

    expect(pairs.map(({ mode, ratio }) => [mode, ratio])).toEqual([
      ["clair", 4.47],
      ["sombre", 1],
    ]);
  });

  it("résout les alias du premier plan et du fond, en chaîne et mode par mode", () => {
    const pairs = projectContrast({
      modes: ["clair", "sombre"],
      tokens: [
        declaring(["{couleur.fond}"], {
          $value: undefined,
          modes: { clair: "{couleur.encre}", sombre: "{couleur.papier}" },
        }),
        makeBackground({
          $value: undefined,
          modes: { clair: "{couleur.blanc}", sombre: "{couleur.noir}" },
        }),
        makeContrastToken({ name: "couleur.encre", $value: "{couleur.noir}" }),
        makeContrastToken({ name: "couleur.papier", $value: "{couleur.blanc}" }),
        makeContrastToken({ name: "couleur.noir", $value: BLACK }),
        makeContrastToken({ name: "couleur.blanc", $value: WHITE }),
      ],
    });

    expect(pairs.map(({ mode, ratio }) => [mode, ratio])).toEqual([
      ["clair", 21],
      ["sombre", 21],
    ]);
  });

  it("compose un premier plan translucide sur le fond de la paire", () => {
    const [pair] = projectContrast({
      modes: [],
      tokens: [
        declaring(["{couleur.fond}"], { $value: makeColor([1, 1, 1], { alpha: 0.5 }) }),
        makeBackground({ $value: BLACK }),
      ],
    });

    expect(pair?.ratio).toBe(5.28);
  });

  it("un fond translucide donne indeterminate avec sa raison", () => {
    const [pair] = projectContrast({
      modes: [],
      tokens: [
        declaring(["{couleur.fond}"]),
        makeBackground({ $value: makeColor([1, 1, 1], { alpha: 0.5 }) }),
      ],
    });

    expect(pair).toMatchObject({
      ratio: null,
      verdict: "indeterminate",
      reason: "translucent_background",
    });
  });

  it("une couleur sans valeur dans un mode donne indeterminate dans ce mode seulement", () => {
    const pairs = projectContrast({
      modes: ["clair", "sombre"],
      tokens: [
        declaring(["{couleur.fond}"], { $value: undefined, modes: { clair: BLACK } }),
        makeBackground(),
      ],
    });

    expect(pairs).toEqual([
      expect.objectContaining({ mode: "clair", ratio: 21, verdict: "pass" }),
      expect.objectContaining({
        mode: "sombre",
        ratio: null,
        verdict: "indeterminate",
        reason: "missing_value",
      }),
    ]);
  });

  it.each([
    ["un fond absent des tokens", [declaring(["{couleur.fond}"])]],
    [
      "un alias vers un token absent",
      [declaring(["{couleur.fond}"]), makeBackground({ $value: "{couleur.disparue}" })],
    ],
    [
      "une boucle d'alias",
      [
        declaring(["{couleur.fond}"], { $value: "{couleur.boucle}" }),
        makeBackground(),
        makeContrastToken({ name: "couleur.boucle", $value: "{couleur.texte}" }),
      ],
    ],
    [
      "une valeur sans espace de couleur",
      [declaring(["{couleur.fond}"]), makeBackground({ $value: { components: [1, 1, 1] } })],
    ],
    [
      "une valeur dans un autre espace que srgb",
      [
        declaring(["{couleur.fond}"]),
        makeBackground({ $value: { colorSpace: "display-p3", components: [1, 1, 1] } }),
      ],
    ],
    [
      "une valeur à deux composantes",
      [
        declaring(["{couleur.fond}"]),
        makeBackground({ $value: { colorSpace: "srgb", components: [1, 1] } }),
      ],
    ],
    [
      "une composante qui n'est pas un nombre",
      [
        declaring(["{couleur.fond}"]),
        makeBackground({ $value: { colorSpace: "srgb", components: [1, "1", 1] } }),
      ],
    ],
    [
      "des composantes qui ne sont pas une liste",
      [
        declaring(["{couleur.fond}"]),
        makeBackground({ $value: { colorSpace: "srgb", components: { length: 3 } } }),
      ],
    ],
    ["une valeur nulle", [declaring(["{couleur.fond}"]), makeBackground({ $value: null })]],
    [
      "une valeur en texte libre",
      [declaring(["{couleur.fond}"]), makeBackground({ $value: "#ffffff" })],
    ],
  ])("%s donne indeterminate faute de valeur", (_case, tokens) => {
    expect(projectContrast({ modes: [], tokens })).toEqual([
      expect.objectContaining({
        ratio: null,
        threshold: 4.5,
        verdict: "indeterminate",
        reason: "missing_value",
      }),
    ]);
  });

  it("ignore les paires d'un token qui n'est pas une couleur", () => {
    expect(
      projectContrast({
        modes: [],
        tokens: [declaring(["{couleur.fond}"], { $type: "dimension" }), makeBackground()],
      }),
    ).toEqual([]);
  });

  it("rend les paires de chaque token déclarant, dans l'ordre des tokens", () => {
    const pairs = projectContrast({
      modes: [],
      tokens: [
        declaring(["{couleur.fond}"], { name: "couleur.bordure" }),
        makeBackground(),
        declaring(["{couleur.fond}"]),
      ],
    });

    expect(pairs.map(({ token }) => token)).toEqual(["couleur.bordure", "couleur.texte"]);
  });
});
