type Mode = { readonly id: string; readonly name: string };

export type ModeAdditionRefusal =
  | "no_modes"
  | "pending_proposals"
  | "name_taken"
  | "unknown_source";

export const modeAdditionOf = <M extends Mode>({
  modes,
  pendingNames,
  name,
  copiedFrom,
}: {
  readonly modes: readonly M[];
  readonly pendingNames: readonly string[];
  readonly name: string;
  readonly copiedFrom: string;
}): { readonly source: M } | { readonly refusal: ModeAdditionRefusal } => {
  if (modes.length === 0) {
    return { refusal: "no_modes" };
  }
  if (pendingNames.length > 0) {
    return { refusal: "pending_proposals" };
  }
  if (modes.some((mode) => mode.name === name)) {
    return { refusal: "name_taken" };
  }
  const source = modes.find((mode) => mode.name === copiedFrom);
  return source === undefined ? { refusal: "unknown_source" } : { source };
};
