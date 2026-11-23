import { z } from "zod";

import { Uuid } from "../conventions/schemas.ts";

const SpaceRef = z.looseObject({ id: Uuid, name: z.string() });

export const AccountDeletionOutput = z.looseObject({
  paidSpaces: z.array(SpaceRef.extend({ currentPeriodEnd: z.iso.datetime().nullable() })),
  lastOwnerSpaces: z.array(SpaceRef),
});
