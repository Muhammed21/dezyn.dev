import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export type FigmaColor = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
};

export type FakeFigmaValue = FigmaColor | number | { readonly alias: string };

export type FakeFigmaVariable = {
  readonly name: string;
  readonly valuesByMode: Readonly<Record<string, FakeFigmaValue>>;
};

export type FakeFigmaCollection = {
  readonly name: string;
  readonly modes: readonly string[];
  readonly variables: readonly FakeFigmaVariable[];
};

export type FakeFigmaFile = {
  readonly key: string;
  readonly collections: readonly FakeFigmaCollection[];
};

type Located = {
  readonly variable: FakeFigmaVariable;
  readonly id: string;
  readonly collectionId: string;
  readonly modeIds: Readonly<Record<string, string>>;
};

const isAlias = (value: FakeFigmaValue): value is { readonly alias: string } =>
  typeof value === "object" && "alias" in value;

const locate = (file: FakeFigmaFile): readonly Located[] =>
  file.collections.flatMap((collection, collectionIndex) => {
    const number = collectionIndex + 1;
    const modeIds = Object.fromEntries(
      collection.modes.map((mode, modeIndex) => [mode, `${number}:${modeIndex + 1}`]),
    );
    return collection.variables.map((variable, variableIndex) => ({
      variable,
      id: `VariableID:${number}:${variableIndex + 1}`,
      collectionId: `VariableCollectionId:${number}:0`,
      modeIds,
    }));
  });

const resolvedTypeOf = (
  value: FakeFigmaValue | undefined,
  byName: ReadonlyMap<string, Located>,
): string => {
  if (value === undefined) {
    return "COLOR";
  }
  if (isAlias(value)) {
    return resolvedTypeOf(
      Object.values(byName.get(value.alias)?.variable.valuesByMode ?? {})[0],
      byName,
    );
  }
  return typeof value === "number" ? "FLOAT" : "COLOR";
};

export const localVariablesOf = (file: FakeFigmaFile) => {
  const located = locate(file);
  const byName = new Map(located.map((entry) => [entry.variable.name, entry]));
  const valueOf = (value: FakeFigmaValue) =>
    isAlias(value) ? { type: "VARIABLE_ALIAS", id: byName.get(value.alias)?.id ?? "" } : value;
  return {
    meta: {
      variableCollections: Object.fromEntries(
        file.collections.map((collection, collectionIndex) => {
          const id = `VariableCollectionId:${collectionIndex + 1}:0`;
          const modes = collection.modes.map((name, modeIndex) => ({
            modeId: `${collectionIndex + 1}:${modeIndex + 1}`,
            name,
          }));
          return [
            id,
            {
              id,
              name: collection.name,
              modes,
              defaultModeId: modes[0]?.modeId ?? "",
              variableIds: located
                .filter(({ collectionId }) => collectionId === id)
                .map(({ id: variableId }) => variableId),
            },
          ];
        }),
      ),
      variables: Object.fromEntries(
        located.map(({ variable, id, collectionId, modeIds }) => [
          id,
          {
            id,
            name: variable.name,
            variableCollectionId: collectionId,
            resolvedType: resolvedTypeOf(Object.values(variable.valuesByMode)[0], byName),
            valuesByMode: Object.fromEntries(
              Object.entries(variable.valuesByMode).map(([mode, value]) => [
                modeIds[mode] ?? mode,
                valueOf(value),
              ]),
            ),
          },
        ]),
      ),
    },
  };
};

export const fakeFigmaServer = (files: readonly FakeFigmaFile[]): McpServer => {
  const server = new McpServer({ name: "figma", version: "0.0.0" });
  server.registerTool(
    "get_local_variables",
    {
      description:
        "Rend toutes les variables locales d'un fichier Figma, comme GET /v1/files/:file_key/variables/local de l'API REST des variables : leurs collections, leurs modes, leurs valeurs par mode (couleurs en r, g, b, a de 0 à 1) et leurs alias (VARIABLE_ALIAS).",
      inputSchema: { fileKey: z.string() },
    },
    async ({ fileKey }) => {
      const file = files.find(({ key }) => key === fileKey);
      if (file === undefined) {
        return { content: [{ type: "text", text: "Fichier Figma introuvable" }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(localVariablesOf(file)) }] };
    },
  );
  return server;
};
