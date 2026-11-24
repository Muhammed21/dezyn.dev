import { bigint, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { identityUser } from "./identity.ts";
import { space } from "./space.ts";

const at = (name: string) => timestamp(name, { withTimezone: true });

export const spaceSubscription = pgTable("space_subscription", {
  spaceId: uuid("space_id")
    .primaryKey()
    .references(() => space.id),
  polarSubscriptionId: text("polar_subscription_id").notNull(),
  payerId: uuid("payer_id").references(() => identityUser.id, { onDelete: "set null" }),
  status: text("status").notNull(),
  currentPeriodEnd: at("current_period_end"),
  polarModifiedAt: at("polar_modified_at").notNull(),
  storedBytesAtEnd: bigint("stored_bytes_at_end", { mode: "number" }),
  cancelRequestedAt: at("cancel_requested_at"),
});

export const spaceRefusedSubscription = pgTable("space_refused_subscription", {
  polarSubscriptionId: text("polar_subscription_id").primaryKey(),
  spaceId: uuid("space_id").notNull(),
  payerId: uuid("payer_id").references(() => identityUser.id, { onDelete: "set null" }),
  receivedAt: at("received_at").notNull(),
  revokedAt: at("revoked_at"),
  refundedAt: at("refunded_at"),
  settlingSince: at("settling_since"),
});

export const spaceRefundRevocation = pgTable("space_refund_revocation", {
  polarSubscriptionId: text("polar_subscription_id").primaryKey(),
  spaceId: uuid("space_id").notNull(),
  polarOrderId: text("polar_order_id").notNull(),
  receivedAt: at("received_at").notNull(),
  revokedAt: at("revoked_at"),
  settlingSince: at("settling_since"),
});

export const spacePlanChange = pgTable(
  "space_plan_change",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => space.id),
    polarSubscriptionId: text("polar_subscription_id").notNull(),
    polarEvent: text("polar_event").notNull(),
    planBefore: text("plan_before").notNull(),
    planAfter: text("plan_after").notNull(),
    changedAt: at("changed_at").notNull(),
  },
  (table) => [index("space_plan_change_space_id_idx").on(table.spaceId)],
);
