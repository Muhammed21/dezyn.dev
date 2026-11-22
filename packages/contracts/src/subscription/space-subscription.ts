import { z } from "zod";

import { openEnum } from "../conventions/schemas.ts";

export const SUBSCRIPTION_STATUSES = ["active", "canceling", "past_due", "ended"] as const;

export const SpaceSubscriptionOutput = z.looseObject({
  status: openEnum(SUBSCRIPTION_STATUSES),
});
