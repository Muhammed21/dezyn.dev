import type { Plan } from "#modules/space/contracts/plan.ts";

export const SUBSCRIPTION_STATUSES = ["active", "canceling", "past_due", "ended"] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type SpaceSubscription = {
  readonly id: string;
  readonly payerId: string | undefined;
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
  | { readonly kind: "unknown_payer" }
  | { readonly kind: "payer_not_owner" }
  | { readonly kind: "other_subscription"; readonly storedId: string }
  | {
      readonly kind: "applied";
      readonly subscription: RecordedSubscription;
      readonly planChange: PlanChange | undefined;
    };

const POLAR_ENDED_STATUSES: ReadonlySet<string> = new Set([
  "canceled",
  "unpaid",
  "incomplete_expired",
]);

export const subscriptionStatusOf = ({
  type,
  status,
  cancelAtPeriodEnd,
}: {
  readonly type: string;
  readonly status: string;
  readonly cancelAtPeriodEnd: boolean;
}): SubscriptionStatus | undefined => {
  if (type === "subscription.revoked" || POLAR_ENDED_STATUSES.has(status)) {
    return "ended";
  }
  if (status === "past_due") {
    return "past_due";
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
  payerIsOwner,
  refused,
  plan,
  storedBytes,
}: {
  readonly stored: RecordedSubscription | undefined;
  readonly incoming: SpaceSubscription;
  readonly payerIsOwner: boolean;
  readonly refused: boolean;
  readonly plan: Plan;
  readonly storedBytes: number;
}): SubscriptionChange => {
  if (incoming.payerId === undefined && stored?.id !== incoming.id) {
    return { kind: "unknown_payer" };
  }
  if (stored !== undefined && stored.id !== incoming.id && stored.status !== "ended") {
    return { kind: "other_subscription", storedId: stored.id };
  }
  if ((refused || !payerIsOwner) && stored?.id !== incoming.id) {
    return { kind: "payer_not_owner" };
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
