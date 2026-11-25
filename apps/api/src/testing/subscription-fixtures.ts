import { createHmac, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { PostgresDatabase } from "#db";
import { schema } from "@repo/db";

import { type App, BASE_URL } from "./authorization-flow.ts";
import { WEBHOOK_KEY } from "./merchant-of-record.ts";

export { makeMerchantOfRecord, WEBHOOK_SECRET } from "./merchant-of-record.ts";

export const PERIOD_END = new Date("2026-12-22T10:00:00.000Z");

export const MODIFIED_AT = new Date("2026-11-22T10:00:00.000Z");

export const makeSubscriptionEvent = ({
  type = "subscription.active",
  spaceId,
  payerId,
  subscriptionId = "0d3f6a2b-7c1e-4b8a-9f2d-5e6a7b8c9d0e",
  status = "active",
  cancelAtPeriodEnd = false,
  currentPeriodEnd = PERIOD_END,
  modifiedAt = MODIFIED_AT,
}: {
  readonly type?: string;
  readonly spaceId: string | undefined;
  readonly payerId: string | null;
  readonly subscriptionId?: string;
  readonly status?: string;
  readonly cancelAtPeriodEnd?: boolean;
  readonly currentPeriodEnd?: Date;
  readonly modifiedAt?: Date;
}) => ({
  type,
  timestamp: modifiedAt.toISOString(),
  data: {
    id: subscriptionId,
    created_at: "2026-11-22T09:59:00.000Z",
    modified_at: modifiedAt.toISOString(),
    amount: 3499,
    currency: "eur",
    recurring_interval: "month",
    recurring_interval_count: 1,
    status,
    current_period_start: "2026-11-22T10:00:00.000Z",
    current_period_end: currentPeriodEnd.toISOString(),
    trial_start: null,
    trial_end: null,
    cancel_at_period_end: cancelAtPeriodEnd,
    canceled_at: null,
    started_at: "2026-11-22T10:00:00.000Z",
    ends_at: null,
    ended_at: null,
    customer_id: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    product_id: "5c4b3a29-1807-4f6e-9d5c-4b3a29180706",
    discount_id: null,
    checkout_id: "2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b",
    customer_cancellation_reason: null,
    customer_cancellation_comment: null,
    metadata: spaceId === undefined ? {} : { referenceId: spaceId },
    custom_field_data: {},
    customer: {
      id: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      created_at: "2026-11-22T09:59:00.000Z",
      modified_at: null,
      metadata: {},
      external_id: payerId,
      email: "ada@dezyn.test",
      email_verified: true,
      name: "Ada Lovelace",
      billing_address: null,
      tax_id: null,
      organization_id: "8b9c0d1e-2f3a-4b4c-8d5e-6f7a8b9c0d1e",
      deleted_at: null,
      avatar_url: "",
    },
    product: {
      id: "5c4b3a29-1807-4f6e-9d5c-4b3a29180706",
      name: "Team",
      is_recurring: true,
      is_archived: false,
    },
    discount: null,
    prices: [],
    meters: [],
  },
});

export const FULL_REFUND = { status: "refunded", refundedAmount: 3499 } as const;

export const PARTIAL_REFUND = { status: "partially_refunded", refundedAmount: 1000 } as const;

export const makeOrderEvent = ({
  type = "order.refunded",
  spaceId,
  subscriptionId = "0d3f6a2b-7c1e-4b8a-9f2d-5e6a7b8c9d0e",
  orderId = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
  status = FULL_REFUND.status,
  refundedAmount = FULL_REFUND.refundedAmount,
  modifiedAt = MODIFIED_AT,
}: {
  readonly type?: string;
  readonly spaceId: string;
  readonly subscriptionId?: string | null;
  readonly orderId?: string;
  readonly status?: string;
  readonly refundedAmount?: number;
  readonly modifiedAt?: Date;
}) => ({
  type,
  timestamp: modifiedAt.toISOString(),
  data: {
    id: orderId,
    created_at: "2026-11-22T10:00:00.000Z",
    modified_at: modifiedAt.toISOString(),
    status,
    paid: true,
    subtotal_amount: 3499,
    discount_amount: 0,
    net_amount: 3499,
    tax_amount: 700,
    total_amount: 4199,
    applied_balance_amount: 0,
    due_amount: 0,
    refunded_amount: refundedAmount,
    refunded_tax_amount: Math.round((refundedAmount * 700) / 3499),
    currency: "eur",
    billing_reason: subscriptionId === null ? "purchase" : "subscription_create",
    billing_name: "Ada Lovelace",
    billing_address: null,
    invoice_number: "DEZYN-0001",
    is_invoice_generated: true,
    receipt_number: null,
    seats: null,
    units: null,
    customer_id: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    product_id: "5c4b3a29-1807-4f6e-9d5c-4b3a29180706",
    discount_id: null,
    subscription_id: subscriptionId,
    checkout_id: "2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b",
    metadata: {},
    custom_field_data: {},
    platform_fee_amount: 0,
    platform_fee_currency: null,
    customer: {
      id: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      created_at: "2026-11-22T09:59:00.000Z",
      modified_at: null,
      metadata: {},
      external_id: null,
      email: "ada@dezyn.test",
      email_verified: true,
      type: "individual",
      name: "Ada Lovelace",
      billing_name: null,
      billing_address: null,
      tax_id: null,
      organization_id: "8b9c0d1e-2f3a-4b4c-8d5e-6f7a8b9c0d1e",
      deleted_at: null,
      first_user_event_at: null,
      avatar_url: null,
    },
    product: null,
    discount: null,
    subscription:
      subscriptionId === null
        ? null
        : {
            metadata: { referenceId: spaceId },
            created_at: "2026-11-22T09:59:00.000Z",
            modified_at: modifiedAt.toISOString(),
            id: subscriptionId,
            amount: 3499,
            currency: "eur",
            recurring_interval: "month",
            recurring_interval_count: 1,
            status: "active",
            current_period_start: "2026-11-22T10:00:00.000Z",
            current_period_end: PERIOD_END.toISOString(),
            cancel_at_period_end: false,
            canceled_at: null,
            started_at: "2026-11-22T10:00:00.000Z",
            ends_at: null,
            ended_at: null,
            customer_id: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
            product_id: "5c4b3a29-1807-4f6e-9d5c-4b3a29180706",
            discount_id: null,
            checkout_id: "2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b",
            customer_cancellation_reason: null,
            customer_cancellation_comment: null,
          },
    items: [],
    description: "Team",
    refundable_amount: 3499 - refundedAmount,
    refundable_tax_amount: 700 - Math.round((refundedAmount * 700) / 3499),
  },
});

export const makeRefundEvent = ({
  type,
  status,
  orderId = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
  subscriptionId = "0d3f6a2b-7c1e-4b8a-9f2d-5e6a7b8c9d0e",
}: {
  readonly type: "refund.created" | "refund.updated";
  readonly status: "pending" | "succeeded" | "failed" | "canceled";
  readonly orderId?: string;
  readonly subscriptionId?: string;
}) => ({
  type,
  timestamp: MODIFIED_AT.toISOString(),
  data: {
    created_at: "2026-11-22T11:00:00.000Z",
    modified_at: MODIFIED_AT.toISOString(),
    id: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a",
    metadata: {},
    status,
    reason: "customer_request",
    amount: 3499,
    tax_amount: 700,
    currency: "eur",
    organization_id: "8b9c0d1e-2f3a-4b4c-8d5e-6f7a8b9c0d1e",
    order_id: orderId,
    subscription_id: subscriptionId,
    customer_id: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    revoke_benefits: false,
    dispute: null,
  },
});

export const signedHeaders = ({
  body,
  key = WEBHOOK_KEY,
  sentAt = new Date(),
}: {
  readonly body: string;
  readonly key?: Buffer;
  readonly sentAt?: Date;
}) => {
  const id = `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(sentAt.getTime() / 1000));
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return {
    "content-type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  };
};

export const postPolarWebhook = (
  app: App,
  {
    event,
    key,
    sentAt,
  }: { readonly event: unknown; readonly key?: Buffer; readonly sentAt?: Date },
) => {
  const body = JSON.stringify(event);
  return app.request(`${BASE_URL}/webhooks/polar`, {
    method: "POST",
    headers: signedHeaders({ body, key, sentAt }),
    body,
  });
};

export const seedSubscription = async (
  db: PostgresDatabase,
  {
    spaceId,
    payerId,
    modifiedAt = MODIFIED_AT,
    currentPeriodEnd = PERIOD_END,
    status = "active",
    cancelRequestedAt = null,
  }: {
    readonly spaceId: string;
    readonly payerId: string;
    readonly modifiedAt?: Date;
    readonly currentPeriodEnd?: Date;
    readonly status?: "active" | "canceling" | "past_due";
    readonly cancelRequestedAt?: Date | null;
  },
) => {
  await db.orm.insert(schema.spaceSubscription).values({
    spaceId,
    polarSubscriptionId: "0d3f6a2b-7c1e-4b8a-9f2d-5e6a7b8c9d0e",
    payerId,
    status,
    currentPeriodEnd,
    polarModifiedAt: modifiedAt,
    cancelRequestedAt,
  });
  await db.orm.update(schema.space).set({ plan: "team" }).where(eq(schema.space.id, spaceId));
};

export const seedEndedSubscription = async (
  db: PostgresDatabase,
  { spaceId, payerId }: { readonly spaceId: string; readonly payerId: string },
) => {
  await db.orm.insert(schema.spaceSubscription).values({
    spaceId,
    polarSubscriptionId: "0d3f6a2b-7c1e-4b8a-9f2d-5e6a7b8c9d0e",
    payerId,
    status: "ended",
    currentPeriodEnd: PERIOD_END,
    polarModifiedAt: MODIFIED_AT,
  });
  await db.orm.update(schema.space).set({ plan: "free" }).where(eq(schema.space.id, spaceId));
};

export const subscriptionOf = async (db: PostgresDatabase, spaceId: string) => {
  const [row] = await db.orm
    .select()
    .from(schema.spaceSubscription)
    .where(eq(schema.spaceSubscription.spaceId, spaceId));
  return row;
};

export const planChangesOf = (db: PostgresDatabase, spaceId: string) =>
  db.orm
    .select({
      polarSubscriptionId: schema.spacePlanChange.polarSubscriptionId,
      polarEvent: schema.spacePlanChange.polarEvent,
      planBefore: schema.spacePlanChange.planBefore,
      planAfter: schema.spacePlanChange.planAfter,
    })
    .from(schema.spacePlanChange)
    .where(eq(schema.spacePlanChange.spaceId, spaceId));

export const seedMember = (
  db: PostgresDatabase,
  {
    spaceId,
    userId,
    role,
    closedAt = null,
  }: {
    readonly spaceId: string;
    readonly userId: string;
    readonly role: "owner" | "editor";
    readonly closedAt?: Date | null;
  },
) =>
  db.orm.insert(schema.spaceMember).values({
    id: randomUUID(),
    spaceId,
    userId,
    role,
    joinedAt: new Date(),
    closedAt,
    closedReason: closedAt === null ? null : "left",
  });

export const refusedSubscriptionsOf = (db: PostgresDatabase, spaceId: string) =>
  db.orm
    .select()
    .from(schema.spaceRefusedSubscription)
    .where(eq(schema.spaceRefusedSubscription.spaceId, spaceId));

export const seedRefusedSubscription = (
  db: PostgresDatabase,
  {
    spaceId,
    payerId,
    settlingSince = null,
  }: {
    readonly spaceId: string;
    readonly payerId: string;
    readonly settlingSince?: Date | null;
  },
) =>
  db.orm.insert(schema.spaceRefusedSubscription).values({
    polarSubscriptionId: "0d3f6a2b-7c1e-4b8a-9f2d-5e6a7b8c9d0e",
    spaceId,
    payerId,
    receivedAt: MODIFIED_AT,
    settlingSince,
  });

export const refundRevocationsOf = (db: PostgresDatabase, spaceId: string) =>
  db.orm
    .select()
    .from(schema.spaceRefundRevocation)
    .where(eq(schema.spaceRefundRevocation.spaceId, spaceId));

export const seedRefundRevocation = (
  db: PostgresDatabase,
  { spaceId, settlingSince }: { readonly spaceId: string; readonly settlingSince: Date | null },
) =>
  db.orm.insert(schema.spaceRefundRevocation).values({
    polarSubscriptionId: "0d3f6a2b-7c1e-4b8a-9f2d-5e6a7b8c9d0e",
    spaceId,
    polarOrderId: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
    receivedAt: MODIFIED_AT,
    settlingSince,
  });
