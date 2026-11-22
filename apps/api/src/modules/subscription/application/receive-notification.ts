import type { Plan } from "#modules/space/contracts/plan.ts";
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

const HANDLED_EVENTS: Readonly<Record<string, (event: SubscriptionEvent) => boolean>> = {
  "subscription.active": () => true,
  "subscription.past_due": () => true,
  "subscription.updated": (event) => event.status === "past_due",
};

const isHandled = (event: SubscriptionEvent) => HANDLED_EVENTS[event.type]?.(event) === true;

export interface SubscriptionStore {
  lockSpace(spaceId: string): Promise<Plan | undefined>;
  isUser(userId: string): Promise<boolean>;
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

type Recorded = "applied" | "stale" | "unknown_space" | "unknown_payer";

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
      return "unknown_space";
    }
    if (!(await store.isUser(subscription.payerId))) {
      return "unknown_payer";
    }
    const change = subscriptionChangeOf({
      stored: await store.subscriptionOf(spaceId),
      incoming: subscription,
      plan,
    });
    if (change.kind === "stale") {
      return "stale";
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
    return "applied";
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
  const recorded =
    payerId === undefined
      ? "unknown_payer"
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
  if (recorded === "unknown_space") {
    log({ level: "warn", msg: "polar event for an unknown space", ...details, spaceId });
  }
  if (recorded === "unknown_payer") {
    log({ level: "warn", msg: "polar event for an unknown payer", ...details, spaceId });
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
    if (value.kind === "other" || !isHandled(value.event)) {
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
