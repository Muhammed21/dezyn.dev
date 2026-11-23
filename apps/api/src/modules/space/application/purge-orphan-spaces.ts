import { errorDetails, type LogSink } from "#platform/logging.ts";

import {
  type OrphanSpace,
  orphanSpaceIsPurgeable,
  type OrphanState,
} from "../domain/orphan-space.ts";

export type OrphanPurgeStep = "continued" | "purged" | "skipped";

export type OrphanPurgePass = {
  readonly purgedSpaces: number;
  readonly waitingSpaces: number;
};

export interface OrphanSpaces {
  list(): Promise<readonly OrphanSpace[]>;
}

export interface OrphanPurgeUnitOfWork {
  step(input: {
    readonly spaceId: string;
    readonly purgeable: (orphan: OrphanState) => boolean;
  }): Promise<OrphanPurgeStep>;
}

export const purgeOrphanSpaces =
  ({
    orphans,
    unitOfWork,
    now,
    budgetMs,
    log,
  }: {
    readonly orphans: OrphanSpaces;
    readonly unitOfWork: OrphanPurgeUnitOfWork;
    readonly now: () => Date;
    readonly budgetMs: number;
    readonly log: LogSink;
  }) =>
  async (): Promise<OrphanPurgePass> => {
    const startedAt = now();
    const withinBudget = () => now().getTime() - startedAt.getTime() < budgetMs;
    const purgeable = ({ orphanedAt, subscription }: OrphanState) =>
      orphanSpaceIsPurgeable({ orphanedAt, subscription, now: startedAt });
    const purgeSpace = async (spaceId: string): Promise<boolean> => {
      if (!withinBudget()) {
        return false;
      }
      const step = await unitOfWork.step({ spaceId, purgeable });
      return step === "continued" ? purgeSpace(spaceId) : step === "purged";
    };
    const listed = await orphans.list();
    const toPurge = listed.filter(purgeable);
    const outcome = await toPurge.reduce<
      Promise<{ readonly purgedSpaces: number; readonly failures: readonly unknown[] }>
    >(
      async (previous, { spaceId }) => {
        const { purgedSpaces, failures } = await previous;
        try {
          return { purgedSpaces: purgedSpaces + ((await purgeSpace(spaceId)) ? 1 : 0), failures };
        } catch (error) {
          log({
            level: "error",
            msg: "orphan space purge step failed",
            spaceId,
            ...errorDetails(error),
          });
          return { purgedSpaces, failures: [...failures, error] };
        }
      },
      Promise.resolve({ purgedSpaces: 0, failures: [] }),
    );
    const [firstFailure] = outcome.failures;
    if (firstFailure !== undefined) {
      throw firstFailure;
    }
    return { purgedSpaces: outcome.purgedSpaces, waitingSpaces: listed.length - toPurge.length };
  };
