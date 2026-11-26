import { z } from "zod";

import { openEnum } from "@repo/contracts";

import { CONTRAST_USAGES } from "../domain/contrast-pairs.ts";

export const CheckContrastOutput = z.looseObject({
  pairs: z.array(
    z.looseObject({
      token: z.string(),
      background: z.string(),
      usage: openEnum(CONTRAST_USAGES),
      mode: z.string().nullable(),
      ratio: z.number().nullable(),
      threshold: z.number(),
      verdict: openEnum(["pass", "fail", "indeterminate"]),
      reason: openEnum(["translucent_background", "missing_value"]).optional(),
    }),
  ),
});
