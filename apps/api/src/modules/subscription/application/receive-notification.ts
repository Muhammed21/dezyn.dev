import type { Plan } from "#modules/space/contracts/plan.ts";
import type { LogSink } from "#platform/logging.ts";
import { Uuid } from "@repo/contracts";
import { err, ok, type Result } from "@repo/result";

import {
  type PlanChange,
  type RecordedSubscription,
  type SpaceSubscription,
  subscriptionChangeOf,
  subscriptionStatusOf,
} from "../domain/subscription.ts";
import type {
  MerchantOfRecord,
  NotificationFailure,
  NotificationReader,
  SubscriptionEvent,
} from "./merchant-of-record.ts";
import { type Refusals, SETTLED_REFUSAL, settleRefusal } from "./settle-refusals.ts";

const HANDLED_EVENTS: ReadonlySet<string> = new Set([
  "subscription.active",
  "subscription.past_due",
  "subscription.updated",
  "subscription.canceled",
  "subscription.uncanceled",
  "subscription.revoked",
]);

export interface SubscriptionStore {
  lockSpace(spaceId: string): Promise<Plan | undefined>;
  isUser(userId: string): Promise<boolean>;
  isOpenOwner(membership: { readonly spaceId: string; readonly userId: string }): Promise<boolean>;
  isRefused(subscriptionId: string): Promise<boolean>;
  refuse(refusal: {
    readonly subscriptionId: string;
    readonly spaceId: string;
    readonly payerId: string | undefined;
    readonly at: Date;
  }): Promise<void>;
  storedBytesOf(spaceId: string): Promise<number>;
  subscriptionOf(spaceId: string): Promise<RecordedSubscription | undefined>;
  save(change: {
    readonly spaceId: string;
    readonly subscription: RecordedSubscription;
  }): Promise<void>;
  changePlan(change: {
    readonly spaceId: string;
    readonly subscriptionId: string;
    readonly event: string;
    readonly planChange: PlanChange;
    readonly at: Date;
  }): Promise<void>;
}

export interface SubscriptionUnitOfWork {
  run<T>(work: (store: SubscriptionStore) => Promise<T>): Promise<T>;
}

type Recorded =
  | {
      readonly kind: "applied" | "stale" | "unknown_space" | "unknown_payer" | "payer_not_owner";
    }
  | { readonly kind: "other_subscription"; readonly storedId: string };

const recordEvent = ({
  unitOfWork,
  event,
  spaceId,
  subscription,
  now,
}: {
  readonly unitOfWork: SubscriptionUnitOfWork;
  readonly event: SubscriptionEvent;
  readonly spaceId: string;
  readonly subscription: SpaceSubscription;
  readonly now: () => Date;
}): Promise<Recorded> =>
  unitOfWork.run(async (store) => {
    const plan = await store.lockSpace(spaceId);
    if (plan === undefined) {
      return { kind: "unknown_space" };
    }
    const payerId =
      subscription.payerId !== undefined && (await store.isUser(subscription.payerId))
        ? subscription.payerId
        : undefined;
    const change = subscriptionChangeOf({
      stored: await store.subscriptionOf(spaceId),
      incoming: { ...subscription, payerId },
      payerIsOwner:
        payerId !== undefined && (await store.isOpenOwner({ spaceId, userId: payerId })),
      refused: await store.isRefused(subscription.id),
      plan,
      storedBytes: await store.storedBytesOf(spaceId),
    });
    if (change.kind === "payer_not_owner") {
      await store.refuse({ subscriptionId: subscription.id, spaceId, payerId, at: now() });
    }
    if (change.kind !== "applied") {
      return change;
    }
    await store.save({ spaceId, subscription: change.subscription });
    if (change.planChange !== undefined) {
      await store.changePlan({
        spaceId,
        subscriptionId: subscription.id,
        event: event.type,
        planChange: change.planChange,
        at: now(),
      });
    }
    return { kind: "applied" };
  });

type NotificationDependencies = {
  readonly unitOfWork: SubscriptionUnitOfWork;
  readonly refusals: Refusals;
  readonly merchant: MerchantOfRecord;
  readonly log: LogSink;
  readonly now: () => Date;
};

const DEFERRED_REFUSAL =
  "polar subscription paid by a user who is not an owner of the space: revocation or refund left to the replay";

const settleNewRefusal = async ({
  dependencies,
  details,
}: {
  readonly dependencies: NotificationDependencies;
  readonly details: {
    readonly event: string;
    readonly subscriptionId: string;
    readonly spaceId: string;
    readonly payerId: string | undefined;
  };
}): Promise<void> => {
  const settlement = await settleRefusal(dependencies)({
    spaceId: details.spaceId,
    subscriptionId: details.subscriptionId,
  });
  const msg = {
    busy: "polar event for a refused subscription",
    settled: SETTLED_REFUSAL,
    pending: DEFERRED_REFUSAL,
  }[settlement.kind];
  dependencies.log({ level: settlement.kind === "busy" ? "info" : "warn", msg, ...details });
};

const handleSubscriptionEvent = async ({
  dependencies,
  event,
}: {
  readonly dependencies: NotificationDependencies;
  readonly event: SubscriptionEvent;
}): Promise<void> => {
  const { unitOfWork, log, now } = dependencies;
  const details = { event: event.type, subscriptionId: event.subscriptionId };
  const status = subscriptionStatusOf(event);
  if (status === undefined) {
    log({
      level: "warn",
      msg: "polar subscription status unknown",
      ...details,
      status: event.status,
    });
    return;
  }
  const spaceId = Uuid.safeParse(event.spaceId).data;
  if (spaceId === undefined) {
    log({
      level: "warn",
      msg: "polar event for an unknown space",
      ...details,
      spaceId: event.spaceId,
    });
    return;
  }
  const payerId = Uuid.safeParse(event.payerId).data;
  const recorded: Recorded =
    payerId === undefined
      ? { kind: "unknown_payer" }
      : await recordEvent({
          unitOfWork,
          event,
          spaceId,
          subscription: {
            id: event.subscriptionId,
            payerId,
            status,
            currentPeriodEnd: event.currentPeriodEnd,
            modifiedAt: event.modifiedAt,
          },
          now,
        });
  if (recorded.kind === "unknown_space") {
    log({ level: "warn", msg: "polar event for an unknown space", ...details, spaceId });
  }
  if (recorded.kind === "unknown_payer") {
    log({ level: "warn", msg: "polar event for an unknown payer", ...details, spaceId });
  }
  if (recorded.kind === "payer_not_owner") {
    await settleNewRefusal({ dependencies, details: { ...details, spaceId, payerId } });
  }
  if (recorded.kind === "other_subscription") {
    log({
      level: "warn",
      msg: "polar event for another subscription of the space",
      ...details,
      spaceId,
      storedSubscriptionId: recorded.storedId,
    });
  }
};

export const receiveNotification =
  ({
    reader,
    ...dependencies
  }: NotificationDependencies & { readonly reader: NotificationReader }) =>
  async (
    body: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<Result<undefined, NotificationFailure>> => {
    const { log } = dependencies;
    const notification = await reader.read(body, headers);
    if (!notification.ok) {
      return err(notification.error);
    }
    const { value } = notification;
    if (value.kind === "other" || !HANDLED_EVENTS.has(value.event.type)) {
      log({
        level: "info",
        msg: "polar event ignored",
        event: value.kind === "other" ? value.type : value.event.type,
      });
      return ok(undefined);
    }
    await handleSubscriptionEvent({ dependencies, event: value.event });
    return ok(undefined);
  };
