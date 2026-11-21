import type { Plan } from "./space.ts";

const STORAGE_LIMITS: Readonly<Record<Plan, number>> = {
  free: 500_000_000,
  team: 20_000_000_000,
};

export const storageLimitOf = (plan: Plan): number => STORAGE_LIMITS[plan];

export const storageAlertReached = ({
  plan,
  storedBytes,
}: {
  readonly plan: Plan;
  readonly storedBytes: number;
}): boolean => storedBytes * 5 >= storageLimitOf(plan) * 4;

export type SpaceStorage = {
  readonly usedBytes: number;
  readonly limitBytes: number;
  readonly alertReached: boolean;
};

export const spaceStorageOf = ({
  plan,
  storedBytes,
}: {
  readonly plan: Plan;
  readonly storedBytes: number;
}): SpaceStorage => ({
  usedBytes: storedBytes,
  limitBytes: storageLimitOf(plan),
  alertReached: storageAlertReached({ plan, storedBytes }),
});
