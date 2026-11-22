import { z } from "zod";

export const CheckoutOutput = z.looseObject({
  url: z.url({ protocol: /^https?$/ }),
});

export const AlreadyTeamProblem = z.looseObject({
  type: z.literal("https://dezyn.dev/problems/already-team"),
  title: z.string(),
  status: z.literal(409),
});
