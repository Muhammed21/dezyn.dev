import { FREE_PROJECT_LIMIT } from "./project-limit.ts";
import type { Plan } from "./space.ts";
import { storageLimitOf } from "./storage-limit.ts";

export const FREE_MEMBER_LIMIT = 1;

export const FREE_LIMITS = ["projects", "storage", "members"] as const;

export type FreeLimit = (typeof FREE_LIMITS)[number];

export type SpaceUsage = {
  readonly projects: number;
  readonly storedBytes: number;
  readonly members: number;
};

export type Freeze = {
  readonly frozen: boolean;
  readonly exceededLimits: readonly FreeLimit[];
};

const EXCEEDS: Readonly<Record<FreeLimit, (usage: SpaceUsage) => boolean>> = {
  projects: ({ projects }) => projects > FREE_PROJECT_LIMIT,
  storage: ({ storedBytes }) => storedBytes > storageLimitOf("free"),
  members: ({ members }) => members > FREE_MEMBER_LIMIT,
};

const NOT_FROZEN: Freeze = { frozen: false, exceededLimits: [] };

export const freezeOf = ({
  plan,
  subscriptionEnded,
  usage,
}: {
  readonly plan: Plan;
  readonly subscriptionEnded: boolean;
  readonly usage: SpaceUsage;
}): Freeze => {
  if (plan !== "free" || !subscriptionEnded) {
    return NOT_FROZEN;
  }
  const exceededLimits = FREE_LIMITS.filter((limit) => EXCEEDS[limit](usage));
  return { frozen: exceededLimits.length > 0, exceededLimits };
};
