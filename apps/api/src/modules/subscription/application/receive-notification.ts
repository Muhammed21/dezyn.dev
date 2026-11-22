import type { Plan, SpaceUsage } from "#modules/space/contracts/plan.ts";
import type { LogSink } from "#platform/logging.ts";
import { Uuid } from "@repo/contracts";
import { err, ok, type Result } from "@repo/result";

import {
  type PlanChange,
  type SpaceSubscription,
  subscriptionChangeOf,
  subscriptionStatusOf,
} from "../domain/subscription.ts";
import type {
  NotificationFailure,
  NotificationReader,
  SubscriptionEvent,
} from "./merchant-of-record.ts";

const HANDLED_EVENTS: ReadonlySet<string> = new Set([
  "subscription.active",
  "subscription.updated",
  "subscription.canceled",
  "subscription.uncanceled",
  "subscription.revoked",
]);

export interface SubscriptionStore {
  lockSpace(spaceId: string): Promise<Plan | undefined>;
  isUser(userId: string): Promise<boolean>;
  usageOf(spaceId: string): Promise<SpaceUsage>;
  subscriptionOf(spaceId: string): Promise<SpaceSubscription | undefined>;
  save(change: {
    readonly spaceId: string;
    readonly subscription: SpaceSubscription;
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
      readonly kind: "applied" | "stale" | "above_free_limits" | "unknown_space" | "unknown_payer";
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
    if (!(await store.isUser(subscription.payerId))) {
      return { kind: "unknown_payer" };
    }
    const change = subscriptionChangeOf({
      stored: await store.subscriptionOf(spaceId),
      incoming: subscription,
      plan,
      usage: await store.usageOf(spaceId),
    });
    if (change.kind === "stale" || change.kind === "other_subscription") {
      return change;
    }
    await store.save({ spaceId, subscription: change.subscription });
    if (change.kind === "above_free_limits") {
      return { kind: "above_free_limits" };
    }
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

const handleSubscriptionEvent = async ({
  unitOfWork,
  log,
  now,
  event,
}: {
  readonly unitOfWork: SubscriptionUnitOfWork;
  readonly log: LogSink;
  readonly now: () => Date;
  readonly event: SubscriptionEvent;
}): Promise<void> => {
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
  if (recorded.kind === "above_free_limits") {
    log({
      level: "warn",
      msg: "polar subscription ended above the free limits, freeze pending",
      ...details,
      spaceId,
    });
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
    unitOfWork,
    log,
    now,
  }: {
    readonly reader: NotificationReader;
    readonly unitOfWork: SubscriptionUnitOfWork;
    readonly log: LogSink;
    readonly now: () => Date;
  }) =>
  async (
    body: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<Result<undefined, NotificationFailure>> => {
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
    await handleSubscriptionEvent({ unitOfWork, log, now, event: value.event });
    return ok(undefined);
  };
