import { FREE_PROJECT_LIMIT } from "./project-limit.ts";
import { storageLimitOf } from "./storage-limit.ts";

export const FREE_MEMBER_LIMIT = 1;

export type SpaceUsage = {
  readonly projects: number;
  readonly storedBytes: number;
  readonly members: number;
};

export const exceedsFreeLimits = ({ projects, storedBytes, members }: SpaceUsage): boolean =>
  projects > FREE_PROJECT_LIMIT ||
  storedBytes > storageLimitOf("free") ||
  members > FREE_MEMBER_LIMIT;
