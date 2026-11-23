import { eq } from "drizzle-orm";

import type { PostgresTransaction } from "#db";
import { schema } from "@repo/db";

export const deleteUserOn =
  (tx: PostgresTransaction) =>
  async (userId: string): Promise<void> => {
    await tx.delete(schema.identityUser).where(eq(schema.identityUser.id, userId));
  };
