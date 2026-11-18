import type { GateTrigger } from "./gate-decision.ts";

export const APPROVAL_LABEL = "review:needs-approval";

const STATE_RECOMPUTING_ACTIONS = new Set(["reopened", "ready_for_review", "unlabeled"]);

export const gateTrigger = ({
  action,
  label,
  runAttempt,
  migrationsChanged,
}: {
  readonly action: string;
  readonly label: string | undefined;
  readonly runAttempt: number;
  readonly migrationsChanged: () => boolean;
}): GateTrigger => {
  if (runAttempt > 1) return { kind: "rerun" };
  if (action === "unlabeled" && label === APPROVAL_LABEL) return { kind: "label-removed" };
  if (action === "synchronize") return { kind: "push", migrationsChanged: migrationsChanged() };
  if (STATE_RECOMPUTING_ACTIONS.has(action)) return { kind: "rerun" };
  return { kind: "opened" };
};
