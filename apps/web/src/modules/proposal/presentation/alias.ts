import { err, flatMap, map, ok, type Result } from "@repo/result";

import type { Preview } from "./preview.ts";
import { previewOf } from "./token-preview.ts";

export type AliasValues = ReadonlyMap<string, unknown>;

type Resolution<T> = Result<T, "unknown">;

const ALIAS = /^\{([^{}]+)\}$/;

const aliasOf = (value: unknown) =>
  typeof value === "string" ? ALIAS.exec(value)?.[1] : undefined;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const childrenOf = (value: unknown): readonly unknown[] =>
  isRecord(value) ? Object.values(value) : [];

const referencesOf = (value: unknown): readonly string[] => {
  const name = aliasOf(value);
  return name === undefined ? childrenOf(value).flatMap(referencesOf) : [name];
};

const all = <T>(resolutions: readonly Resolution<T>[]): Resolution<readonly T[]> =>
  resolutions.reduce<Resolution<readonly T[]>>(
    (resolved, next) => flatMap(resolved, (values) => map(next, (value) => [...values, value])),
    ok([]),
  );

const resolved = ({
  value,
  values,
  seen,
}: {
  readonly value: unknown;
  readonly values: AliasValues;
  readonly seen: readonly string[];
}): Resolution<unknown> => {
  const name = aliasOf(value);
  if (name !== undefined) {
    const target = values.get(name);
    return target === undefined || seen.includes(name)
      ? err("unknown")
      : resolved({ value: target, values, seen: [...seen, name] });
  }
  if (Array.isArray(value)) {
    return all(value.map((item) => resolved({ value: item, values, seen })));
  }
  if (isRecord(value)) {
    return map(
      all(
        Object.entries(value).map(([key, field]) =>
          map(
            resolved({ value: field, values, seen }),
            (fieldValue): readonly [string, unknown] => [key, fieldValue],
          ),
        ),
      ),
      Object.fromEntries,
    );
  }
  return ok(value);
};

const UNKNOWN: Preview = { shape: "text", text: "Valeur inconnue" };

export const aliasPreviewOf = ({
  type,
  value,
  values,
}: {
  readonly type: unknown;
  readonly value: unknown;
  readonly values: AliasValues;
}): { readonly preview: Preview; readonly references: readonly string[] } => {
  const references = [...new Set(referencesOf(value))];
  const resolution = resolved({ value, values, seen: [] });
  return {
    references,
    preview: resolution.ok ? previewOf({ type, value: resolution.value }) : UNKNOWN,
  };
};
