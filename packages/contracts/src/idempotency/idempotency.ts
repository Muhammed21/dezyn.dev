import { z } from "zod";

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

export const IDEMPOTENCY_REPLAYED_HEADER = "Idempotency-Replayed";

export const InvalidIdempotencyKeyProblem = z.looseObject({
  type: z.literal("https://dezyn.dev/problems/invalid-idempotency-key"),
  title: z.string(),
  status: z.literal(400),
});

export const IdempotencyInProgressProblem = z.looseObject({
  type: z.literal("https://dezyn.dev/problems/idempotency-in-progress"),
  title: z.string(),
  status: z.literal(409),
});

export const IdempotencyKeyReusedProblem = z.looseObject({
  type: z.literal("https://dezyn.dev/problems/idempotency-key-reused"),
  title: z.string(),
  status: z.literal(422),
});
