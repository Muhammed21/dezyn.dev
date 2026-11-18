import { describe, expect, it } from "vitest";

import { gateDecision } from "../gate-decision.ts";

const OPENED = { kind: "opened" } as const;
const LABEL_REMOVED = { kind: "label-removed" } as const;
const RERUN = { kind: "rerun" } as const;
const PUSH_CHANGING_MIGRATIONS = { kind: "push", migrationsChanged: true } as const;
const PUSH_KEEPING_MIGRATIONS = { kind: "push", migrationsChanged: false } as const;

describe("gateDecision", () => {
  it("laisse passer une PR sans migration non additive", () => {
    expect(gateDecision({ hasFindings: false, labelPresent: false, trigger: OPENED })).toEqual({
      outcome: "accepted",
      addLabel: false,
    });
  });

  it("bloque une PR non additive à son ouverture et pose le label", () => {
    expect(gateDecision({ hasFindings: true, labelPresent: false, trigger: OPENED })).toEqual({
      outcome: "awaiting-approval",
      addLabel: true,
    });
  });

  it.each([LABEL_REMOVED, RERUN, PUSH_KEEPING_MIGRATIONS, PUSH_CHANGING_MIGRATIONS, OPENED])(
    "bloque tant que le label est posé, sans le reposer (%o)",
    (trigger) => {
      expect(gateDecision({ hasFindings: true, labelPresent: true, trigger })).toEqual({
        outcome: "awaiting-approval",
        addLabel: false,
      });
    },
  );

  it.each([LABEL_REMOVED, RERUN, PUSH_KEEPING_MIGRATIONS])(
    "tient pour approuvée une PR non additive dont le label a été retiré (%o)",
    (trigger) => {
      expect(gateDecision({ hasFindings: true, labelPresent: false, trigger })).toEqual({
        outcome: "approved",
        addLabel: false,
      });
    },
  );

  it("repose le label quand un push change les migrations d'une PR approuvée", () => {
    expect(
      gateDecision({ hasFindings: true, labelPresent: false, trigger: PUSH_CHANGING_MIGRATIONS }),
    ).toEqual({ outcome: "awaiting-approval", addLabel: true });
  });
});
