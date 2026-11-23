import { freezeOf, type SpaceUsage } from "./free-limits.ts";
import type { Plan } from "./space.ts";
import { storageLimitOf } from "./storage-limit.ts";

export type PurgeLimitInput = {
  readonly plan: Plan;
  readonly subscriptionEnded: boolean;
  readonly storedBytesAtEnd: number | null;
  readonly usage: SpaceUsage;
};

const withinPlanLimits = (storedBytes: number) =>
  Math.min(Math.max(storedBytes, storageLimitOf("free")), storageLimitOf("team"));

export const purgeLimitOf = ({
  plan,
  subscriptionEnded,
  storedBytesAtEnd,
  usage,
}: PurgeLimitInput): number =>
  freezeOf({ plan, subscriptionEnded, usage }).frozen
    ? withinPlanLimits(storedBytesAtEnd ?? 0)
    : storageLimitOf(plan);
