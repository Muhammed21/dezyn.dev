import type { TokenValue } from "../domain/proposal.ts";

export type ModeChange = "changed" | "unchanged" | "added" | "removed";

export type ModeRow = {
  readonly mode: string;
  readonly validated: TokenValue | undefined;
  readonly proposed: TokenValue | undefined;
  readonly change: ModeChange;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const modesOf = (token: TokenValue | undefined): ReadonlyMap<string, unknown> | undefined => {
  const modes = token?.modes;
  return isRecord(modes) ? new Map(Object.entries(modes)) : undefined;
};

const validatedIn = (
  validated: TokenValue | undefined,
  mode: string,
): { readonly $type: unknown; readonly $value: unknown } | undefined => {
  if (validated === undefined) {
    return undefined;
  }
  const modes = modesOf(validated);
  if (modes === undefined) {
    return { $type: validated.$type, $value: validated.$value };
  }
  return modes.has(mode) ? { $type: validated.$type, $value: modes.get(mode) } : undefined;
};

const changeOf = (
  validated: TokenValue | undefined,
  before: TokenValue | undefined,
  after: unknown,
): ModeChange => {
  if (before === undefined) {
    return validated === undefined ? "changed" : "added";
  }
  return sameValue(before.$value, after) ? "unchanged" : "changed";
};

const sameValue = (before: unknown, after: unknown) =>
  JSON.stringify(before) === JSON.stringify(after);

const simpleProposedRows = (
  validated: TokenValue | undefined,
  validatedModes: ReadonlyMap<string, unknown>,
  proposed: TokenValue,
): readonly ModeRow[] =>
  [...validatedModes].map(([mode, before]) => ({
    mode,
    validated: { $type: validated?.$type, $value: before },
    proposed: { $type: proposed.$type, $value: proposed.$value },
    change: sameValue(before, proposed.$value) ? "unchanged" : "changed",
  }));

export const modeRows = ({
  validated,
  proposed,
}: {
  readonly validated: TokenValue | undefined;
  readonly proposed: TokenValue;
}): readonly ModeRow[] | undefined => {
  const proposedModes = modesOf(proposed);
  if (proposedModes === undefined) {
    const validatedModes = modesOf(validated);
    return validatedModes === undefined
      ? undefined
      : simpleProposedRows(validated, validatedModes, proposed);
  }
  const kept = [...proposedModes].map(([mode, after]): ModeRow => {
    const before = validatedIn(validated, mode);
    return {
      mode,
      validated: before,
      proposed: { $type: proposed.$type, $value: after },
      change: changeOf(validated, before, after),
    };
  });
  const removed = [...(modesOf(validated) ?? [])]
    .filter(([mode]) => !proposedModes.has(mode))
    .map(([mode, before]): ModeRow => ({
      mode,
      validated: { $type: validated?.$type, $value: before },
      proposed: undefined,
      change: "removed",
    }));
  return [...kept, ...removed];
};
