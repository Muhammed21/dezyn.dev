export type GateState = {
  readonly hasFindings: boolean;
  readonly labelPresent: boolean;
  readonly approver: string | undefined;
  readonly fingerprint: string;
  readonly recordedFingerprint: string | undefined;
};

export type GateDecision = {
  readonly outcome: "accepted" | "approved" | "awaiting-approval";
  readonly addLabel: boolean;
  readonly record: string | undefined;
};

export const gateDecision = ({
  hasFindings,
  labelPresent,
  approver,
  fingerprint,
  recordedFingerprint,
}: GateState): GateDecision => {
  if (!hasFindings) return { outcome: "accepted", addLabel: false, record: undefined };
  const record = recordedFingerprint === fingerprint ? undefined : fingerprint;
  if (labelPresent) return { outcome: "awaiting-approval", addLabel: false, record };
  if (approver !== undefined && record === undefined) {
    return { outcome: "approved", addLabel: false, record };
  }
  return { outcome: "awaiting-approval", addLabel: true, record };
};
