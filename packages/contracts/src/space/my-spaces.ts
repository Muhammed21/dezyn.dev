import { z } from "zod";

import { openEnum, Uuid } from "../conventions/schemas.ts";

export const PLANS = ["free", "team"] as const;

export const ROLES = ["owner", "editor"] as const;

export const ACTIONS = [
  "space.read",
  "project.create",
  "member.invite",
  "member.leave",
  "member.manage",
  "token.create",
  "token.declareFigmaState",
  "proposal.review",
  "subscription.checkout",
] as const;

export const FREE_LIMITS = ["projects", "storage", "members"] as const;

const SUBSCRIPTION_STATUSES = ["active", "canceling", "past_due", "ended"] as const;

const SpaceSubscriptionOutput = z.looseObject({
  status: openEnum(SUBSCRIPTION_STATUSES),
  currentPeriodEnd: z.iso.datetime().nullable(),
  payer: z.looseObject({
    name: z.string(),
    email: z.string(),
    you: z.boolean(),
    left: z.boolean(),
  }),
});

export const MySpaceOutput = z.looseObject({
  id: Uuid,
  name: z.string(),
  plan: openEnum(PLANS),
  role: openEnum(ROLES),
  allowedActions: z.array(openEnum(ACTIONS)),
});

export const SpaceOutput = MySpaceOutput.extend({
  storage: z.looseObject({
    usedBytes: z.int().nonnegative(),
    limitBytes: z.int().nonnegative(),
    alertReached: z.boolean(),
  }),
  subscription: SpaceSubscriptionOutput.optional(),
  frozen: z.boolean(),
  exceededFreeLimits: z.array(openEnum(FREE_LIMITS)),
});

export const MySpacesOutput = z.looseObject({
  spaces: z.array(MySpaceOutput),
});
