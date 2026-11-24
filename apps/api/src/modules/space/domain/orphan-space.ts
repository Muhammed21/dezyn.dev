export type OrphanSubscription = {
  readonly status: string;
  readonly currentPeriodEnd: Date | undefined;
  readonly cancelRequested: boolean;
};

export type OrphanState = {
  readonly orphanedAt: Date | undefined;
  readonly subscription: OrphanSubscription | undefined;
};

export type OrphanSpace = OrphanState & { readonly spaceId: string };

export const ORPHAN_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

const gracePeriodIsOver = (orphanedAt: Date | undefined, now: Date) =>
  orphanedAt !== undefined && orphanedAt.getTime() + ORPHAN_GRACE_PERIOD_MS <= now.getTime();

const paidPeriodIsOver = ({ currentPeriodEnd, cancelRequested }: OrphanSubscription, now: Date) =>
  !cancelRequested && currentPeriodEnd !== undefined && currentPeriodEnd <= now;

const subscriptionLetsGo = (subscription: OrphanSubscription | undefined, now: Date) =>
  subscription === undefined ||
  subscription.status === "ended" ||
  paidPeriodIsOver(subscription, now);

export const orphanSpaceIsPurgeable = ({
  orphanedAt,
  subscription,
  now,
}: OrphanState & { readonly now: Date }): boolean =>
  gracePeriodIsOver(orphanedAt, now) && subscriptionLetsGo(subscription, now);
