import { z } from "zod";

export const SpaceFrozenProblem = z.looseObject({
  type: z.literal("https://dezyn.dev/problems/space-frozen"),
  title: z.string(),
  status: z.literal(403),
});
