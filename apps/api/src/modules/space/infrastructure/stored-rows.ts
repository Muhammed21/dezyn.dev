import { z } from "zod";

import { SUBSCRIPTION_STATUSES } from "#modules/subscription/contracts/subscription-status.ts";

import { PLANS, ROLES } from "../domain/space.ts";

const StoredPlan = z.enum(PLANS);

const StoredRole = z.enum(ROLES);

export const StoredSpace = z.object({ id: z.string(), name: z.string(), plan: StoredPlan });

export const StoredSpaceWithStorage = StoredSpace.extend({
  storedBytes: z.coerce.number(),
  subscriptionStatus: z
    .enum(SUBSCRIPTION_STATUSES)
    .nullable()
    .transform((status) => status ?? undefined),
});

export const StoredSpaceWithRole = StoredSpace.extend({ role: StoredRole });

export const StoredMembership = z.object({
  spaceId: z.string(),
  userId: z.string(),
  role: StoredRole,
});

export const StoredMember = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: StoredRole,
});
