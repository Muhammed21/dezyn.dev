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
  }: { readonly spaceId: string; readonly userId: string; readonly role: "owner" | "editor" },
) =>
  db.orm
    .insert(schema.spaceMember)
    .values({ id: randomUUID(), spaceId, userId, role, joinedAt: new Date() });
