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

const makeShadowLayer = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  color: makeColor({ components: [0, 0, 0], alpha: 0.25 }),
  offsetX: { value: 0, unit: "px" },
  offsetY: { value: 4, unit: "px" },
  blur: { value: 8, unit: "px" },
  spread: { value: 0, unit: "px" },
  ...overrides,
});

describe("aperçu d'une ombre", () => {
  it("donne une carte ombrée et l'ombre lisible, couleur en hex", () => {
    expect(previewOf({ type: "shadow", value: makeShadowLayer() })).toEqual({
      shape: "shadow",
      text: "0px 4px 8px 0px #00000040",
      style: { boxShadow: "0px 4px 8px 0px #00000040" },
    });
  });

  it("garde l'unité et le signe de chaque longueur", () => {
    expect(
      previewOf({
        type: "shadow",
        value: makeShadowLayer({
          offsetX: { value: -0.5, unit: "rem" },
          offsetY: { value: 1, unit: "rem" },
          blur: { value: 0.25, unit: "rem" },
          spread: { value: -2, unit: "px" },
        }),
      }),
    ).toEqual({
      shape: "shadow",
      text: "-0.5rem 1rem 0.25rem -2px #00000040",
      style: { boxShadow: "-0.5rem 1rem 0.25rem -2px #00000040" },
    });
  });

  it("marque une ombre intérieure", () => {
    expect(previewOf({ type: "shadow", value: makeShadowLayer({ inset: true }) })).toEqual({
      shape: "shadow",
      text: "inset 0px 4px 8px 0px #00000040",
      style: { boxShadow: "inset 0px 4px 8px 0px #00000040" },
    });
  });

  it("ne marque pas une ombre explicitement extérieure", () => {
    expect(previewOf({ type: "shadow", value: makeShadowLayer({ inset: false }) })).toEqual({
      shape: "shadow",
      text: "0px 4px 8px 0px #00000040",
      style: { boxShadow: "0px 4px 8px 0px #00000040" },
    });
  });

  it("superpose les couches d'une ombre multiple, dans leur ordre", () => {
    expect(
      previewOf({
        type: "shadow",
        value: [
          makeShadowLayer(),
          makeShadowLayer({ color: makeColor(), blur: { value: 2, unit: "px" }, inset: true }),
        ],
      }),
    ).toEqual({
      shape: "shadow",
      text: "0px 4px 8px 0px #00000040, inset 0px 4px 2px 0px #3366cc",
      style: { boxShadow: "0px 4px 8px 0px #00000040, inset 0px 4px 2px 0px #3366cc" },
    });
  });

  it("accepte un flou nul", () => {
    expect(
      previewOf({ type: "shadow", value: makeShadowLayer({ blur: { value: 0, unit: "px" } }) }),
    ).toEqual({
      shape: "shadow",
      text: "0px 4px 0px 0px #00000040",
      style: { boxShadow: "0px 4px 0px 0px #00000040" },
    });
  });

  it("dessine une ombre à une seule couche donnée en liste", () => {
    expect(previewOf({ type: "shadow", value: [makeShadowLayer()] })).toEqual({
      shape: "shadow",
      text: "0px 4px 8px 0px #00000040",
      style: { boxShadow: "0px 4px 8px 0px #00000040" },
    });
  });

  it.each([
    ["une liste vide", []],
    ["une couleur alias", makeShadowLayer({ color: "{couleur.ombre}" })],
    ["un décalage alias", makeShadowLayer({ offsetX: "{espace.petit}" })],
    ["un flou alias", makeShadowLayer({ blur: "{espace.petit}" })],
    ["un étalement alias", makeShadowLayer({ spread: "{espace.petit}" })],
    [
      "une couche alias dans une liste",
      [makeShadowLayer(), makeShadowLayer({ offsetY: "{espace.petit}" })],
    ],
    ["une couleur mal formée", makeShadowLayer({ color: makeColor({ components: [2, 0, 0] }) })],
    ["un flou négatif", makeShadowLayer({ blur: { value: -2, unit: "px" } })],
    ["une unité inconnue", makeShadowLayer({ blur: { value: 8, unit: "em" } })],
    ["une longueur sans nombre", makeShadowLayer({ offsetY: { value: "4", unit: "px" } })],
    ["un champ absent", makeShadowLayer({ spread: undefined })],
    ["un inset non booléen", makeShadowLayer({ inset: "oui" })],
    ["un alias", "{ombre.carte}"],
  ])("montre une ombre mal formée en JSON : %s", (_case, value) => {
    expect(previewOf({ type: "shadow", value })).toEqual({
      shape: "text",
      text: JSON.stringify(value),
    });
  });
});

const makeGradientStop = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  color: makeColor(),
  position: 0,
  ...overrides,
});

describe("aperçu d'un dégradé", () => {
  it("donne une bande et ses étapes lisibles, couleur en hex et position en pourcentage", () => {
    expect(
      previewOf({
        type: "gradient",
        value: [
          makeGradientStop({ color: makeColor({ components: [1, 0, 0] }), position: 0 }),
          makeGradientStop({ color: makeColor({ components: [0, 0, 1] }), position: 1 }),
        ],
      }),
    ).toEqual({
      shape: "band",
      text: "#ff0000 0%, #0000ff 100%",
      style: { backgroundImage: "linear-gradient(to right, #ff0000 0%, #0000ff 100%)" },
    });
  });

  it("arrondit une position au centième de pourcent", () => {
    expect(
      previewOf({
        type: "gradient",
        value: [
          makeGradientStop({ position: 0.07 }),
          makeGradientStop({ position: 0.33333 }),
          makeGradientStop({ position: 0.5 }),
        ],
      }),
    ).toEqual({
      shape: "band",
      text: "#3366cc 7%, #3366cc 33.33%, #3366cc 50%",
      style: {
        backgroundImage: "linear-gradient(to right, #3366cc 7%, #3366cc 33.33%, #3366cc 50%)",
      },
    });
  });

  it("garde l'alpha d'une étape transparente", () => {
    expect(
      previewOf({
        type: "gradient",
        value: [makeGradientStop({ color: makeColor({ alpha: 0 }) }), makeGradientStop()],
      }),
    ).toEqual({
      shape: "band",
      text: "#3366cc00 0%, #3366cc 0%",
      style: { backgroundImage: "linear-gradient(to right, #3366cc00 0%, #3366cc 0%)" },
    });
  });

  it("peint d'une seule couleur un dégradé à une étape, qui ne lit que cette étape", () => {
    expect(previewOf({ type: "gradient", value: [makeGradientStop({ position: 0.5 })] })).toEqual({
      shape: "band",
      text: "#3366cc 50%",
      style: { backgroundImage: "linear-gradient(to right, #3366cc 50%, #3366cc 50%)" },
    });
  });

  it.each([
    ["une liste vide", []],
    ["une étape seule hors liste", makeGradientStop()],
    ["une couleur alias", [makeGradientStop({ color: "{couleur.bleu.500}" })]],
    ["une position alias", [makeGradientStop({ position: "{nombre.moitie}" })]],
    ["une position au-delà de 1", [makeGradientStop({ position: 1.5 })]],
    ["une position négative", [makeGradientStop({ position: -0.1 })]],
    ["une couleur mal formée", [makeGradientStop({ color: makeColor({ alpha: 2 }) })]],
    ["une position absente", [makeGradientStop({ position: undefined })]],
    ["un alias", "{degrade.marque}"],
  ])("montre un dégradé mal formé en JSON : %s", (_case, value) => {
    expect(previewOf({ type: "gradient", value })).toEqual({
      shape: "text",
      text: JSON.stringify(value),
    });
  });
});

describe("aperçu d'une famille de police", () => {
  it("donne un texte d'exemple et le nom de la police", () => {
    expect(previewOf({ type: "fontFamily", value: "Inter" })).toEqual({
      shape: "sample",
      text: "Inter",
      style: { fontFamily: '"Inter"' },
    });
  });

  it("garde l'ordre des polices de repli, et ne cite pas une famille générique", () => {
    expect(
      previewOf({ type: "fontFamily", value: ["Open Sans", "Helvetica", "sans-serif"] }),
    ).toEqual({
      shape: "sample",
      text: "Open Sans, Helvetica, sans-serif",
      style: { fontFamily: '"Open Sans", "Helvetica", sans-serif' },
    });
  });

  it.each([
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-serif",
    "ui-sans-serif",
    "ui-monospace",
    "ui-rounded",
    "math",
    "emoji",
    "fangsong",
  ])("laisse la famille générique %s telle quelle", (generic) => {
    expect(previewOf({ type: "fontFamily", value: generic })).toEqual({
      shape: "sample",
      text: generic,
      style: { fontFamily: generic },
    });
  });

  it("échappe le guillemet d'un nom de police", () => {
    expect(previewOf({ type: "fontFamily", value: 'Ma "Police"' })).toEqual({
      shape: "sample",
      text: 'Ma "Police"',
      style: { fontFamily: '"Ma \\"Police\\""' },
    });
  });

  it.each(["Marque {bêta}", "{bêta} Sans"])(
    "prend pour une police le nom %s, qui contient des accolades sans être un alias",
    (name) => {
      expect(previewOf({ type: "fontFamily", value: name })).toEqual({
        shape: "sample",
        text: name,
        style: { fontFamily: JSON.stringify(name) },
      });
    },
  );

  it.each([
    ["un nom vide", ""],
    ["une liste vide", []],
    ["un nom vide dans la liste", ["Inter", ""]],
    ["un nombre", 12],
    ["un alias", "{police.base}"],
  ])("montre une famille mal formée en JSON : %s", (_case, value) => {
    expect(previewOf({ type: "fontFamily", value })).toEqual({
      shape: "text",
      text: JSON.stringify(value),
    });
  });
});

describe("aperçu d'une graisse de police", () => {
  it.each([
    [1, 1],
    [600, 600],
    [1000, 1000],
  ])("donne un texte d'exemple et la graisse numérique %s", (weight, cssWeight) => {
    expect(previewOf({ type: "fontWeight", value: weight })).toEqual({
      shape: "sample",
      text: String(weight),
      style: { fontWeight: cssWeight },
    });
  });

  it.each([
    ["thin", 100],
    ["hairline", 100],
    ["extra-light", 200],
    ["ultra-light", 200],
    ["light", 300],
    ["normal", 400],
    ["regular", 400],
    ["book", 400],
    ["medium", 500],
    ["semi-bold", 600],
    ["demi-bold", 600],
    ["bold", 700],
    ["extra-bold", 800],
    ["ultra-bold", 800],
    ["black", 900],
    ["heavy", 900],
    ["extra-black", 950],
    ["ultra-black", 950],
  ])(
    "dessine le mot-clé %s avec la graisse %s, et le garde comme valeur lisible",
    (keyword, cssWeight) => {
      expect(previewOf({ type: "fontWeight", value: keyword })).toEqual({
        shape: "sample",
        text: keyword,
        style: { fontWeight: cssWeight },
      });
    },
  );

  it.each([
    ["une graisse sous 1", 0.5],
    ["une graisse au-delà de 1000", 1001],
    ["un mot-clé inconnu", "gras"],
    ["un mot hérité d'Object", "constructor"],
    ["un alias", "{graisse.forte}"],
  ])("montre une graisse mal formée en JSON : %s", (_case, value) => {
    expect(previewOf({ type: "fontWeight", value })).toEqual({
      shape: "text",
      text: JSON.stringify(value),
    });
  });
});

const makeTypography = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  fontFamily: "Inter",
  fontSize: { value: 16, unit: "px" },
  fontWeight: 600,
  lineHeight: 1.5,
  letterSpacing: { value: 0, unit: "px" },
  ...overrides,
});

describe("aperçu d'une typographie", () => {
  it("donne un texte d'exemple dans sa police, sa taille, sa graisse et son interlignage", () => {
    expect(previewOf({ type: "typography", value: makeTypography() })).toEqual({
      shape: "sample",
      text: "Inter · 16px · 600 · interligne 1.5 · espacement 0px",
      style: {
        fontFamily: '"Inter"',
        fontSize: "16px",
        fontWeight: 600,
        lineHeight: 1.5,
        letterSpacing: "0px",
      },
    });
  });

  it("accepte une taille nulle", () => {
    expect(
      previewOf({
        type: "typography",
        value: makeTypography({ fontSize: { value: 0, unit: "px" } }),
      }),
    ).toEqual({
      shape: "sample",
      text: "Inter · 0px · 600 · interligne 1.5 · espacement 0px",
      style: {
        fontFamily: '"Inter"',
        fontSize: "0px",
        fontWeight: 600,
        lineHeight: 1.5,
        letterSpacing: "0px",
      },
    });
  });

  it("accepte des polices de repli, une graisse en mot-clé et des longueurs en rem", () => {
    expect(
      previewOf({
        type: "typography",
        value: makeTypography({
          fontFamily: ["Inter", "sans-serif"],
          fontSize: { value: 1.25, unit: "rem" },
          fontWeight: "bold",
          lineHeight: 1.2,
          letterSpacing: { value: -0.02, unit: "rem" },
        }),
      }),
    ).toEqual({
      shape: "sample",
      text: "Inter, sans-serif · 1.25rem · bold · interligne 1.2 · espacement -0.02rem",
      style: {
        fontFamily: '"Inter", sans-serif',
        fontSize: "1.25rem",
        fontWeight: 700,
        lineHeight: 1.2,
        letterSpacing: "-0.02rem",
      },
    });
  });

  it.each([
    ["une police alias", makeTypography({ fontFamily: "{police.base}" })],
    ["une taille alias", makeTypography({ fontSize: "{taille.corps}" })],
    ["une graisse alias", makeTypography({ fontWeight: "{graisse.forte}" })],
    ["un interlignage alias", makeTypography({ lineHeight: "{nombre.interligne}" })],
    ["un espacement alias", makeTypography({ letterSpacing: "{espace.lettres}" })],
    ["une police vide", makeTypography({ fontFamily: "" })],
    ["une graisse hors bornes", makeTypography({ fontWeight: 0 })],
    ["une taille sans unité", makeTypography({ fontSize: 16 })],
    ["une taille négative", makeTypography({ fontSize: { value: -2, unit: "px" } })],
    ["un interlignage en texte", makeTypography({ lineHeight: "1.5" })],
    ["un champ absent", makeTypography({ letterSpacing: undefined })],
    ["un alias", "{typo.corps}"],
  ])("montre une typographie mal formée en JSON : %s", (_case, value) => {
    expect(previewOf({ type: "typography", value })).toEqual({
      shape: "text",
      text: JSON.stringify(value),
    });
  });
});
