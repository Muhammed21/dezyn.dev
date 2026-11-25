import { describe, expect, it } from "vitest";

import { checkOutputSchema, FigmaFileInput, figmaFileOf, ProjectOutput } from "../../index.ts";

const FIGMA_KEY = "aB3dE5fG7hI9jK1lM3nO5p";

describe("le fichier Figma d'un projet se lit dans son lien (ADR 0059 §4)", () => {
  it.each([
    ["un lien de design", `https://www.figma.com/design/${FIGMA_KEY}/Design-system`],
    ["un ancien lien de fichier", `https://www.figma.com/file/${FIGMA_KEY}/Design-system`],
    ["un lien sans www", `https://figma.com/design/${FIGMA_KEY}`],
    [
      "un lien vers un nœud",
      `https://www.figma.com/design/${FIGMA_KEY}/Design-system?node-id=1-2&t=abc`,
    ],
  ])("extrait la clé d'%s", (_case, url) => {
    expect(figmaFileOf(url)).toEqual({ url, key: FIGMA_KEY });
  });

  it("garde le lien sans les espaces qui l'entourent", () => {
    expect(figmaFileOf(`  https://www.figma.com/design/${FIGMA_KEY}  `)).toEqual({
      url: `https://www.figma.com/design/${FIGMA_KEY}`,
      key: FIGMA_KEY,
    });
  });

  it.each([
    ["un texte qui n'est pas un lien", "mon design system"],
    ["un lien vers un autre site", `https://www.example.com/design/${FIGMA_KEY}`],
    ["un site qui imite Figma", `https://figma.com.example.com/design/${FIGMA_KEY}`],
    ["un lien sans HTTPS", `http://www.figma.com/design/${FIGMA_KEY}`],
    ["un prototype", `https://www.figma.com/proto/${FIGMA_KEY}/Design-system`],
    ["un tableau FigJam", `https://www.figma.com/board/${FIGMA_KEY}/Atelier`],
    ["un lien sans clé", "https://www.figma.com/design/"],
    ["une clé qui n'est pas alphanumérique", "https://www.figma.com/design/ab-cd/Design-system"],
    ["la page d'accueil de Figma", "https://www.figma.com/"],
    ["un lien de plus de 2048 caractères", `https://www.figma.com/design/${"a".repeat(2048)}`],
  ])("refuse %s", (_case, url) => {
    expect(figmaFileOf(url)).toBeUndefined();
  });
});

describe("entrée du fichier Figma d'un projet", () => {
  it("accepte le lien d'un fichier Figma", () => {
    const url = `https://www.figma.com/design/${FIGMA_KEY}/Design-system`;

    expect(FigmaFileInput.parse({ url })).toEqual({ url });
  });

  it("accepte l'absence de lien, qui retire le fichier Figma", () => {
    expect(FigmaFileInput.parse({ url: null })).toEqual({ url: null });
  });

  it("refuse un lien qui n'est pas un fichier Figma, avec un message", () => {
    const parsed = FigmaFileInput.safeParse({ url: "https://www.example.com/" });

    expect(parsed.error?.issues).toEqual([
      expect.objectContaining({ path: ["url"], message: "Lien de fichier Figma attendu" }),
    ]);
  });
});

const makeReadProject = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: "0b6f3c2a-8d4e-4f1a-9c7b-5e2d1a0f9b8c",
  spaceId: "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
  name: "Site vitrine",
  createdAt: "2026-11-11T18:00:00.000Z",
  historyPurgedAt: null,
  figmaFile: null,
  ...overrides,
});

describe("sortie de la lecture d'un projet", () => {
  it("rend le lien et la clé du fichier Figma", () => {
    const read = makeReadProject({
      figmaFile: { url: `https://www.figma.com/design/${FIGMA_KEY}`, key: FIGMA_KEY },
    });

    expect(ProjectOutput.parse(read)).toEqual(read);
  });

  it("respecte les conventions de sortie (ADR 0023 §4)", () => {
    expect(checkOutputSchema("ProjectOutput", ProjectOutput)).toEqual([]);
  });
});
