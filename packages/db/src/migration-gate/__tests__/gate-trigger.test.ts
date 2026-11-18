import { describe, expect, it } from "vitest";

import { gateTrigger } from "../gate-trigger.ts";

const FIRST_ATTEMPT = { runAttempt: 1 };
const MIGRATIONS_CHANGED = () => true;
const MIGRATIONS_KEPT = () => false;

describe("gateTrigger", () => {
  it("traite l'ouverture de la PR comme une première analyse", () => {
    expect(
      gateTrigger({
        ...FIRST_ATTEMPT,
        action: "opened",
        label: undefined,
        migrationsChanged: MIGRATIONS_CHANGED,
      }),
    ).toEqual({ kind: "opened" });
  });

  it("reconnaît le retrait du label d'approbation", () => {
    expect(
      gateTrigger({
        ...FIRST_ATTEMPT,
        action: "unlabeled",
        label: "review:needs-approval",
        migrationsChanged: MIGRATIONS_CHANGED,
      }),
    ).toEqual({ kind: "label-removed" });
  });

  it("ne prend pas la pose du label d'approbation pour une approbation", () => {
    expect(
      gateTrigger({
        ...FIRST_ATTEMPT,
        action: "labeled",
        label: "review:needs-approval",
        migrationsChanged: MIGRATIONS_CHANGED,
      }),
    ).toEqual({ kind: "opened" });
  });

  it("recalcule l'état depuis le label quand un autre label est retiré", () => {
    expect(
      gateTrigger({
        ...FIRST_ATTEMPT,
        action: "unlabeled",
        label: "review:stale",
        migrationsChanged: MIGRATIONS_CHANGED,
      }),
    ).toEqual({ kind: "rerun" });
  });

  it.each(["reopened", "ready_for_review"])(
    "recalcule l'état depuis le label sur « %s », sans perdre une approbation",
    (action) => {
      expect(
        gateTrigger({
          ...FIRST_ATTEMPT,
          action,
          label: undefined,
          migrationsChanged: MIGRATIONS_CHANGED,
        }),
      ).toEqual({ kind: "rerun" });
    },
  );

  it.each([
    { migrationsChanged: MIGRATIONS_CHANGED, expected: true },
    { migrationsChanged: MIGRATIONS_KEPT, expected: false },
  ])("dit d'un push s'il change les migrations ($expected)", ({ migrationsChanged, expected }) => {
    expect(
      gateTrigger({ ...FIRST_ATTEMPT, action: "synchronize", label: undefined, migrationsChanged }),
    ).toEqual({ kind: "push", migrationsChanged: expected });
  });

  it("reconnaît une relance du job, quel que soit l'événement d'origine", () => {
    expect(
      gateTrigger({
        runAttempt: 2,
        action: "synchronize",
        label: undefined,
        migrationsChanged: MIGRATIONS_CHANGED,
      }),
    ).toEqual({ kind: "rerun" });
  });
});
