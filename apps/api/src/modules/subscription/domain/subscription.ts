import type { Plan } from "#modules/space/contracts/plan.ts";

export const SUBSCRIPTION_STATUSES = ["active", "canceling", "past_due", "ended"] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type SpaceSubscription = {
  readonly id: string;
  readonly payerId: string;
  readonly status: SubscriptionStatus;
  readonly currentPeriodEnd: Date | undefined;
  readonly modifiedAt: Date;
};

export type RecordedSubscription = SpaceSubscription & {
  readonly storedBytesAtEnd: number | undefined;
};

export type PlanChange = { readonly before: Plan; readonly after: Plan };

export type SubscriptionChange =
  | { readonly kind: "stale" }
  | { readonly kind: "other_subscription"; readonly storedId: string }
  | {
      readonly kind: "applied";
      readonly subscription: RecordedSubscription;
      readonly planChange: PlanChange | undefined;
    };

export const subscriptionStatusOf = ({
  status,
  cancelAtPeriodEnd,
}: {
  readonly status: string;
  readonly cancelAtPeriodEnd: boolean;
}): SubscriptionStatus | undefined => {
  if (status === "past_due") {
    return "past_due";
  }
  if (status === "canceled") {
    return "ended";
  }
  if (status !== "active") {
    return undefined;
  }
  return cancelAtPeriodEnd ? "canceling" : "active";
};

export const planOfSubscription = (status: SubscriptionStatus): Plan =>
  status === "ended" ? "free" : "team";

const storedBytesAtEndOf = ({
  stored,
  incoming,
  storedBytes,
}: {
  readonly stored: RecordedSubscription | undefined;
  readonly incoming: SpaceSubscription;
  readonly storedBytes: number;
}): number | undefined => {
  if (incoming.status !== "ended") {
    return undefined;
  }
  return stored?.id === incoming.id && stored.status === "ended"
    ? stored.storedBytesAtEnd
    : storedBytes;
};

export const subscriptionChangeOf = ({
  stored,
  incoming,
  plan,
  storedBytes,
}: {
  readonly stored: RecordedSubscription | undefined;
  readonly incoming: SpaceSubscription;
  readonly plan: Plan;
  readonly storedBytes: number;
}): SubscriptionChange => {
  if (stored !== undefined && stored.id !== incoming.id && stored.status !== "ended") {
    return { kind: "other_subscription", storedId: stored.id };
  }
  if (stored !== undefined && stored.modifiedAt.getTime() >= incoming.modifiedAt.getTime()) {
    return { kind: "stale" };
  }
  const after = planOfSubscription(incoming.status);
  return {
    kind: "applied",
    subscription: {
      ...incoming,
      storedBytesAtEnd: storedBytesAtEndOf({ stored, incoming, storedBytes }),
    },
    planChange: after === plan ? undefined : { before: plan, after },
  };
};
