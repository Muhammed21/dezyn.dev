export type OrphanSubscription = {
  readonly status: string;
  readonly currentPeriodEnd: Date | undefined;
  readonly cancelRequested: boolean;
};

export type OrphanSpace = {
  readonly spaceId: string;
  readonly subscription: OrphanSubscription | undefined;
};

const paidPeriodIsOver = ({ currentPeriodEnd, cancelRequested }: OrphanSubscription, now: Date) =>
  !cancelRequested && currentPeriodEnd !== undefined && currentPeriodEnd <= now;

export const orphanSpaceIsPurgeable = ({
  subscription,
  now,
}: {
  readonly subscription: OrphanSubscription | undefined;
  readonly now: Date;
}): boolean =>
  subscription === undefined ||
  subscription.status === "ended" ||
  paidPeriodIsOver(subscription, now);
