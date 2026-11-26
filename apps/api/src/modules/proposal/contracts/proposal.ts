import { z } from "zod";

import { openEnum, Uuid } from "@repo/contracts";

export const WrittenTokensOutput = z.looseObject({
  batch: z.looseObject({ id: Uuid, state: openEnum(["open"]) }).nullable(),
  proposals: z.array(
    z.looseObject({
      id: Uuid,
      name: z.string(),
      kind: openEnum(["create", "update", "delete"]),
      status: openEnum(["proposed"]),
      duplicates: z.array(z.string()).optional(),
    }),
  ),
  unchanged: z.array(z.string()),
  replaced: z.array(z.looseObject({ id: Uuid, name: z.string(), batchId: Uuid })),
});

const BatchOutput = z.looseObject({
  id: Uuid,
  state: openEnum(["open", "closed"]),
  intent: z.string().nullable(),
  recipe: z.string().optional(),
});

export const OpenedBatchOutput = z.looseObject({
  batch: BatchOutput,
  closed: z.looseObject({ id: Uuid }).nullable(),
});

export const ClosedBatchOutput = z.looseObject({ batch: BatchOutput.nullable() });
