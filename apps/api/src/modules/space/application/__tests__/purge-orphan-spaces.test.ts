import { describe, expect, it } from "vitest";

import type { LogRecord, LogSink } from "#platform/logging.ts";

import type { OrphanSpace, OrphanSubscription } from "../../domain/orphan-space.ts";
import {
  type OrphanPurgeStep,
  type OrphanPurgeUnitOfWork,
  purgeOrphanSpaces,
} from "../purge-orphan-spaces.ts";

const STARTED_AT = new Date("2026-11-23T10:00:00.000Z");

const BUDGET_MS = 30_000;

const PERIOD_ENDED_AT_PASS_START: OrphanSubscription = {
  status: "canceling",
  currentPeriodEnd: STARTED_AT,
  cancelRequested: false,
};

const PERIOD_RUNNING: OrphanSubscription = {
  status: "canceling",
  currentPeriodEnd: new Date(STARTED_AT.getTime() + 1),
  cancelRequested: false,
};

const makeOrphan = (spaceId: string, subscription?: OrphanSubscription): OrphanSpace => ({
  spaceId,
  subscription,
});

const steppingClock = (stepMs: number) => {
  const ticks = { count: 0 };
  return () => {
    const at = new Date(STARTED_AT.getTime() + ticks.count * stepMs);
    ticks.count += 1;
    return at;
  };
};

type PlannedStep = OrphanPurgeStep | Error;

const makeUnitOfWork = (stepsBySpace: Readonly<Record<string, readonly PlannedStep[]>>) => {
  const calls: string[] = [];
  const unitOfWork: OrphanPurgeUnitOfWork = {
    step: async ({ spaceId }) => {
      const taken = calls.filter((called) => called === spaceId).length;
      calls.push(spaceId);
      const planned = stepsBySpace[spaceId]?.[taken] ?? "purged";
      if (planned instanceof Error) {
        throw planned;
      }
      return planned;
    },
  };
  return { calls, unitOfWork };
};

const passOf = ({
  orphans,
  unitOfWork,
  now = () => STARTED_AT,
  log = () => undefined,
}: {
  readonly orphans: readonly OrphanSpace[];
  readonly unitOfWork: OrphanPurgeUnitOfWork;
  readonly now?: () => Date;
  readonly log?: LogSink;
}) =>
  purgeOrphanSpaces({
    orphans: { list: async () => orphans },
    unitOfWork,
    now,
    budgetMs: BUDGET_MS,
    log,
  })();

describe("un passage de la purge des espaces orphelins (ADR 0051)", () => {
  it("purge chaque espace orphelin purgeable jusqu'au bout, et compte ceux qui attendent la fin de leur période", async () => {
    const { calls, unitOfWork } = makeUnitOfWork({
      sansAbonnement: ["continued", "continued", "purged"],
      periodeFinie: ["purged"],
    });

    const pass = await passOf({
      orphans: [
        makeOrphan("sansAbonnement"),
        makeOrphan("periodeEnCours", PERIOD_RUNNING),
        makeOrphan("periodeFinie", PERIOD_ENDED_AT_PASS_START),
      ],
      unitOfWork,
    });

    expect(pass).toEqual({ purgedSpaces: 2, waitingSpaces: 1 });
    expect(calls).toEqual(["sansAbonnement", "sansAbonnement", "sansAbonnement", "periodeFinie"]);
  });

  it("ne compte pas un espace sauté, et passe au suivant", async () => {
    const { calls, unitOfWork } = makeUnitOfWork({ saute: ["skipped"], purge: ["purged"] });

    const pass = await passOf({
      orphans: [makeOrphan("saute"), makeOrphan("purge")],
      unitOfWork,
    });

    expect(pass).toEqual({ purgedSpaces: 1, waitingSpaces: 0 });
    expect(calls).toEqual(["saute", "purge"]);
  });

  it("relit l'abonnement dans la transaction avec la même règle, à l'heure du début du passage", async () => {
    const decisions: boolean[] = [];
    const unitOfWork: OrphanPurgeUnitOfWork = {
      step: async ({ purgeable }) => {
        decisions.push(purgeable(PERIOD_ENDED_AT_PASS_START), purgeable(PERIOD_RUNNING));
        return "purged";
      },
    };

    await passOf({ orphans: [makeOrphan("espace")], unitOfWork, now: steppingClock(1_000) });

    expect(decisions).toEqual([true, false]);
  });

  it("s'arrête quand le budget du passage est écoulé, et le passage suivant reprend", async () => {
    const { calls, unitOfWork } = makeUnitOfWork({
      premier: ["continued", "continued", "continued", "purged"],
    });

    const pass = await passOf({
      orphans: [makeOrphan("premier"), makeOrphan("second")],
      unitOfWork,
      now: steppingClock(BUDGET_MS / 2),
    });

    expect(pass).toEqual({ purgedSpaces: 0, waitingSpaces: 0 });
    expect(calls).toEqual(["premier"]);
  });

  it("ne fait aucune étape quand le budget est écoulé dès la première", async () => {
    const { calls, unitOfWork } = makeUnitOfWork({ premier: ["purged"] });

    const pass = await passOf({
      orphans: [makeOrphan("premier")],
      unitOfWork,
      now: steppingClock(BUDGET_MS),
    });

    expect(pass).toEqual({ purgedSpaces: 0, waitingSpaces: 0 });
    expect(calls).toEqual([]);
  });

  it("fait encore une étape tant que le budget n'est pas tout à fait écoulé", async () => {
    const { calls, unitOfWork } = makeUnitOfWork({ premier: ["purged"] });

    const pass = await passOf({
      orphans: [makeOrphan("premier")],
      unitOfWork,
      now: steppingClock(BUDGET_MS - 1),
    });

    expect(pass).toEqual({ purgedSpaces: 1, waitingSpaces: 0 });
    expect(calls).toEqual(["premier"]);
  });
});

describe("un espace dont la purge échoue ne bloque pas les suivants", () => {
  it("journalise l'échec de l'espace, purge les suivants, puis relève le premier échec", async () => {
    const timeout = new Error("canceling statement due to statement timeout");
    const { calls, unitOfWork } = makeUnitOfWork({
      gros: ["continued", timeout],
      suivant: ["purged"],
      dernier: [new Error("connexion perdue")],
    });
    const records: LogRecord[] = [];

    await expect(
      passOf({
        orphans: [makeOrphan("gros"), makeOrphan("suivant"), makeOrphan("dernier")],
        unitOfWork,
        log: (record) => records.push(record),
      }),
    ).rejects.toBe(timeout);
    expect(calls).toEqual(["gros", "gros", "suivant", "dernier"]);
    expect(records).toEqual([
      {
        level: "error",
        msg: "orphan space purge step failed",
        spaceId: "gros",
        error: "canceling statement due to statement timeout",
        stack: timeout.stack,
      },
      expect.objectContaining({
        level: "error",
        msg: "orphan space purge step failed",
        spaceId: "dernier",
        error: "connexion perdue",
      }),
    ]);
  });

  it("un passage sans échec ne journalise rien", async () => {
    const { unitOfWork } = makeUnitOfWork({ premier: ["purged"] });
    const records: LogRecord[] = [];

    await passOf({
      orphans: [makeOrphan("premier")],
      unitOfWork,
      log: (record) => records.push(record),
    });

    expect(records).toEqual([]);
  });
});
