import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { identityUser } from "./identity.ts";

export const idempotencyKey = pgTable(
  "idempotency_key",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => identityUser.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    state: text("state").notNull(),
    response: text("response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("idempotency_key_scope_key").on(table.userId, table.scope, table.key)],
);
