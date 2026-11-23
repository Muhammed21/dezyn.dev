import { z } from "zod";

import { Uuid } from "../conventions/schemas.ts";

const SpaceRef = z.looseObject({ id: Uuid, name: z.string() });

export const AccountDeletionOutput = z.looseObject({
  paidSpaces: z.array(SpaceRef.extend({ currentPeriodEnd: z.iso.datetime().nullable() })),
  lastOwnerSpaces: z.array(SpaceRef),
});

export const AccountDeletionInput = z.object({ password: z.string().min(1) });

export const WrongPasswordProblem = z.looseObject({
  type: z.literal("https://dezyn.dev/problems/wrong-password"),
  title: z.string(),
  status: z.literal(403),
});
