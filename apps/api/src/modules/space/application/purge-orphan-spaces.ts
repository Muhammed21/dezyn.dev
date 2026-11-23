import {
  type OrphanSpace,
  orphanSpaceIsPurgeable,
  type OrphanSubscription,
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
    readonly purgeable: (subscription: OrphanSubscription | undefined) => boolean;
  }): Promise<OrphanPurgeStep>;
}

export const purgeOrphanSpaces =
  ({
    orphans,
    unitOfWork,
    now,
    budgetMs,
  }: {
    readonly orphans: OrphanSpaces;
    readonly unitOfWork: OrphanPurgeUnitOfWork;
    readonly now: () => Date;
    readonly budgetMs: number;
  }) =>
  async (): Promise<OrphanPurgePass> => {
    const startedAt = now();
    const withinBudget = () => now().getTime() - startedAt.getTime() < budgetMs;
    const purgeable = (subscription: OrphanSubscription | undefined) =>
      orphanSpaceIsPurgeable({ subscription, now: startedAt });
    const purgeSpace = async (spaceId: string): Promise<boolean> => {
      if (!withinBudget()) {
        return false;
      }
      const step = await unitOfWork.step({ spaceId, purgeable });
      return step === "continued" ? purgeSpace(spaceId) : step === "purged";
    };
    const listed = await orphans.list();
    const toPurge = listed.filter(({ subscription }) => purgeable(subscription));
    const purgedSpaces = await toPurge.reduce<Promise<number>>(
      async (previous, { spaceId }) => (await previous) + ((await purgeSpace(spaceId)) ? 1 : 0),
      Promise.resolve(0),
    );
    return { purgedSpaces, waitingSpaces: listed.length - toPurge.length };
  };
