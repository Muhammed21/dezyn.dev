import { describe, expect, it } from "vitest";

import { type GateState, gateDecision } from "../gate-decision.ts";

const CURRENT = "a".repeat(64);
const PREVIOUS = "b".repeat(64);

const makeGateState = (overrides: Partial<GateState> = {}): GateState => ({
  hasFindings: true,
  labelPresent: false,
  approver: undefined,
  fingerprint: CURRENT,
  recordedFingerprint: CURRENT,
  ...overrides,
});

const APPROVED_BY_MAINTAINER = { approver: "mainteneur" };

describe("gateDecision", () => {
  it("laisse passer une PR sans migration non additive, sans rien écrire", () => {
    expect(
      gateDecision(
        makeGateState({ hasFindings: false, labelPresent: true, recordedFingerprint: undefined }),
      ),
    ).toEqual({ outcome: "accepted", addLabel: false, record: undefined });
  });

  it("bloque une PR non additive à son ouverture, pose le label et enregistre l'empreinte", () => {
    expect(gateDecision(makeGateState({ recordedFingerprint: undefined }))).toEqual({
      outcome: "awaiting-approval",
      addLabel: true,
      record: CURRENT,
    });
  });

  it("bloque tant que le label est posé, sans le reposer ni réécrire une empreinte à jour", () => {
    expect(gateDecision(makeGateState({ labelPresent: true, ...APPROVED_BY_MAINTAINER }))).toEqual({
      outcome: "awaiting-approval",
      addLabel: false,
      record: undefined,
    });
  });

  it("met à jour l'empreinte gardée par le label quand les migrations changent avant l'approbation", () => {
    expect(
      gateDecision(makeGateState({ labelPresent: true, recordedFingerprint: PREVIOUS })),
    ).toEqual({ outcome: "awaiting-approval", addLabel: false, record: CURRENT });
  });

  it("approuve quand le mainteneur a retiré le label et que les migrations n'ont pas changé", () => {
    expect(gateDecision(makeGateState(APPROVED_BY_MAINTAINER))).toEqual({
      outcome: "approved",
      addLabel: false,
      record: undefined,
    });
  });

  it("remet le label quand le label manque sans approbation du mainteneur", () => {
    expect(gateDecision(makeGateState())).toEqual({
      outcome: "awaiting-approval",
      addLabel: true,
      record: undefined,
    });
  });

  it("remet le label quand les migrations changent après l'approbation", () => {
    expect(
      gateDecision(makeGateState({ ...APPROVED_BY_MAINTAINER, recordedFingerprint: PREVIOUS })),
    ).toEqual({ outcome: "awaiting-approval", addLabel: true, record: CURRENT });
  });

  it("n'approuve pas sans empreinte enregistrée, même après le retrait du mainteneur", () => {
    expect(
      gateDecision(makeGateState({ ...APPROVED_BY_MAINTAINER, recordedFingerprint: undefined })),
    ).toEqual({ outcome: "awaiting-approval", addLabel: true, record: CURRENT });
  });
});
