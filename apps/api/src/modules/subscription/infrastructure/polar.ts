import { createPolarCore, webhooks } from "@polar-sh/sdk/2027-01";
import { createCheckouts } from "@polar-sh/sdk/2027-01/services/checkouts";
import { createCustomerSessions } from "@polar-sh/sdk/2027-01/services/customer_sessions";
import { updateSubscriptions } from "@polar-sh/sdk/2027-01/services/subscriptions";
import { z } from "zod";

import { errorDetails, type LogSink } from "#platform/logging.ts";
import { err, ok, type Result } from "@repo/result";

import type {
  MerchantNotification,
  MerchantOfRecord,
  NotificationFailure,
  NotificationReader,
} from "../application/merchant-of-record.ts";

export type PolarServer = "sandbox" | "production";

const PolarSubscriptionEvent = z.object({
  type: z.string().startsWith("subscription."),
  data: z.object({
    id: z.string(),
    status: z.string(),
    cancel_at_period_end: z.boolean(),
    current_period_end: z.iso.datetime({ offset: true }).nullable(),
    created_at: z.iso.datetime({ offset: true }),
    modified_at: z.iso.datetime({ offset: true }).nullable(),
    metadata: z.record(z.string(), z.unknown()),
    customer: z.object({ external_id: z.string().nullable() }),
  }),
});

const SubscriptionType = z.object({ type: z.string().startsWith("subscription.") });

const notificationOf = (payload: unknown): Result<MerchantNotification, NotificationFailure> => {
  if (!SubscriptionType.safeParse(payload).success) {
    return ok({ kind: "other", type: z.object({ type: z.string() }).parse(payload).type });
  }
  const parsed = PolarSubscriptionEvent.safeParse(payload);
  if (!parsed.success) {
    return err("malformed");
  }
  const { type, data } = parsed.data;
  const referenceId = data.metadata["referenceId"];
  return ok({
    kind: "subscription",
    event: {
      type,
      spaceId: typeof referenceId === "string" ? referenceId : undefined,
      payerId: data.customer.external_id ?? undefined,
      subscriptionId: data.id,
      status: data.status,
      cancelAtPeriodEnd: data.cancel_at_period_end,
      currentPeriodEnd:
        data.current_period_end === null ? undefined : new Date(data.current_period_end),
      modifiedAt: new Date(data.modified_at ?? data.created_at),
    },
  });
};

export const polarNotificationReader = ({
  webhookSecret,
}: {
  readonly webhookSecret: string;
}): NotificationReader => ({
  read: async (body, headers) => {
    try {
      return notificationOf(await webhooks.validateEvent(body, { ...headers }, webhookSecret));
    } catch (error) {
      if (error instanceof webhooks.PolarWebhookUnknownTypeError) {
        return ok({ kind: "other", type: error.eventType ?? "" });
      }
      if (error instanceof webhooks.PolarWebhookVerificationError) {
        return err("invalid_signature");
      }
      return err("malformed");
    }
  },
});

export const polarMerchantOfRecord = ({
  accessToken,
  server,
  teamProductId,
  log,
  baseUrl,
}: {
  readonly accessToken: string;
  readonly server: PolarServer;
  readonly teamProductId: string;
  readonly log: LogSink;
  readonly baseUrl?: string;
}): MerchantOfRecord => {
  const client = createPolarCore({
    accessToken,
    environment: server,
    ...(baseUrl === undefined ? {} : { baseUrl }),
  });
  return {
    createCheckout: async ({ spaceId, payerId, successUrl }) => {
      try {
        const checkout = await createCheckouts(client)({
          products: [teamProductId],
          external_customer_id: payerId,
          metadata: { referenceId: spaceId },
          success_url: successUrl,
        });
        return ok({ url: checkout.url });
      } catch (error) {
        log({ level: "error", msg: "polar checkout failed", spaceId, ...errorDetails(error) });
        return err("unavailable");
      }
    },
    createPortal: async ({ spaceId, payerId, returnUrl }) => {
      try {
        const session = await createCustomerSessions(client)({
          external_customer_id: payerId,
          return_url: returnUrl,
        });
        return ok({ url: session.customer_portal_url });
      } catch (error) {
        log({
          level: "error",
          msg: "polar customer portal failed",
          spaceId,
          ...errorDetails(error),
        });
        return err("unavailable");
      }
    },
    cancelAtPeriodEnd: async ({ spaceId, subscriptionId }) => {
      try {
        await updateSubscriptions(client)(subscriptionId, { cancel_at_period_end: true });
        return ok(undefined);
      } catch (error) {
        log({
          level: "error",
          msg: "polar cancel at period end failed",
          spaceId,
          subscriptionId,
          ...errorDetails(error),
        });
        return err("unavailable");
      }
    },
  };
};

export const unavailableMerchantOfRecord: MerchantOfRecord = {
  createCheckout: async () => err("unavailable"),
  createPortal: async () => err("unavailable"),
  cancelAtPeriodEnd: async () => err("unavailable"),
};

export const unavailableNotificationReader: NotificationReader = {
  read: async () => err("unavailable"),
};
