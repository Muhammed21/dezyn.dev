import { describe, expect, it } from "vitest";

import { type FakeFigmaFile, localVariablesOf } from "../fake-figma.ts";

const BLUE = { r: 0.2, g: 0.4, b: 0.8, a: 1 };

const NIGHT = { r: 0.1, g: 0.1, b: 0.2, a: 1 };

const makeFigmaFile = (overrides: Partial<FakeFigmaFile> = {}): FakeFigmaFile => ({
  key: "aB3dE5fG7hI9jK1lM3nO5p",
  collections: [
    {
      name: "Couleurs",
      modes: ["Clair"],
      variables: [{ name: "couleur/fond/primaire", valuesByMode: { Clair: BLUE } }],
    },
  ],
  ...overrides,
});

describe("le faux Figma rend les variables locales d'un fichier comme l'API REST des variables", () => {
  it("rend chaque collection avec ses modes, et chaque variable avec sa valeur par mode", () => {
    expect(localVariablesOf(makeFigmaFile())).toEqual({
      meta: {
        variableCollections: {
          "VariableCollectionId:1:0": {
            id: "VariableCollectionId:1:0",
            name: "Couleurs",
            modes: [{ modeId: "1:1", name: "Clair" }],
            defaultModeId: "1:1",
            variableIds: ["VariableID:1:1"],
          },
        },
        variables: {
          "VariableID:1:1": {
            id: "VariableID:1:1",
            name: "couleur/fond/primaire",
            variableCollectionId: "VariableCollectionId:1:0",
            resolvedType: "COLOR",
            valuesByMode: { "1:1": BLUE },
          },
        },
      },
    });
  });

  it("rend un alias par l'identifiant de la variable visée, et une valeur par mode de la collection", () => {
    const file = makeFigmaFile({
      collections: [
        {
          name: "Couleurs",
          modes: ["Clair", "Sombre"],
          variables: [
            { name: "couleur/bleu/500", valuesByMode: { Clair: BLUE, Sombre: NIGHT } },
            {
              name: "couleur/fond/primaire",
              valuesByMode: {
                Clair: { alias: "couleur/bleu/500" },
                Sombre: { alias: "couleur/bleu/500" },
              },
            },
          ],
        },
      ],
    });

    expect(localVariablesOf(file).meta.variables["VariableID:1:2"]).toEqual({
      id: "VariableID:1:2",
      name: "couleur/fond/primaire",
      variableCollectionId: "VariableCollectionId:1:0",
      resolvedType: "COLOR",
      valuesByMode: {
        "1:1": { type: "VARIABLE_ALIAS", id: "VariableID:1:1" },
        "1:2": { type: "VARIABLE_ALIAS", id: "VariableID:1:1" },
      },
    });
  });

  it("numérote les collections dans l'ordre du fichier", () => {
    const file = makeFigmaFile({
      collections: [
        { name: "Couleurs", modes: ["Clair"], variables: [] },
        {
          name: "Espacements",
          modes: ["Défaut"],
          variables: [{ name: "espace/petit", valuesByMode: { Défaut: 4 } }],
        },
      ],
    });

    expect(localVariablesOf(file).meta.variables["VariableID:2:1"]).toMatchObject({
      name: "espace/petit",
      variableCollectionId: "VariableCollectionId:2:0",
      resolvedType: "FLOAT",
      valuesByMode: { "2:1": 4 },
    });
  });
});
