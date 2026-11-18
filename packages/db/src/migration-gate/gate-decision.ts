export type GateTrigger =
  | { readonly kind: "opened" }
  | { readonly kind: "label-removed" }
  | { readonly kind: "rerun" }
  | { readonly kind: "push"; readonly migrationsChanged: boolean };

export type GateDecision = {
  readonly outcome: "accepted" | "approved" | "awaiting-approval";
  readonly addLabel: boolean;
};

const keepsApproval = (trigger: GateTrigger): boolean =>
  trigger.kind === "push" ? !trigger.migrationsChanged : trigger.kind !== "opened";

export const gateDecision = ({
  hasFindings,
  labelPresent,
  trigger,
}: {
  readonly hasFindings: boolean;
  readonly labelPresent: boolean;
  readonly trigger: GateTrigger;
}): GateDecision => {
  if (!hasFindings) return { outcome: "accepted", addLabel: false };
  if (labelPresent) return { outcome: "awaiting-approval", addLabel: false };
  if (keepsApproval(trigger)) return { outcome: "approved", addLabel: false };
  return { outcome: "awaiting-approval", addLabel: true };
};
