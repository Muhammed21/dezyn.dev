import type { PostgresDatabase, PostgresTransaction } from "#db";
import type { MembershipReader } from "#modules/space/contracts/membership.ts";
import type { PolarConfig } from "#platform/api-config.ts";
import type { Clock } from "#platform/clock.ts";
import type { LogSink } from "#platform/logging.ts";
import type { Mailer } from "#platform/mailer.ts";

import type { MerchantOfRecord } from "./application/merchant-of-record.ts";
import { openPortal } from "./application/open-portal.ts";
import { payerDeletedAccount, payerLeaves } from "./application/payer-leaves.ts";
import { receiveNotification } from "./application/receive-notification.ts";
import { replayCancellations } from "./application/replay-cancellations.ts";
import { replayRefundRevocations } from "./application/revoke-refunded.ts";
import { replayRefusals } from "./application/settle-refusals.ts";
import { startCheckout } from "./application/start-checkout.ts";
import type { SubscriptionUseCases } from "./application/subscription-use-cases.ts";
import type { DepartedSubscription } from "./domain/payer-departure.ts";
import {
  polarMerchantOfRecord,
  polarNotificationReader,
  unavailableMerchantOfRecord,
  unavailableNotificationReader,
} from "./infrastructure/polar.ts";
import {
  cancelRequestOn,
  paidSubscriptionsOn,
  postgresCancelRequests,
  postgresPayerDepartures,
  postgresRefundRevocations,
  postgresRefusals,
  postgresSpacePayers,
  postgresSpacePlans,
  postgresSpaceSubscriptions,
  postgresSubscriptionUnitOfWork,
} from "./infrastructure/postgres-subscriptions.ts";

export const spaceSubscriptionsOf = postgresSpaceSubscriptions;

export { cancelRequestOn };

export type { DepartedSubscription };

export const payerAccountDeletionOn = (tx: PostgresTransaction) => ({
  paidSpaces: async (userId: string) =>
    (await paidSubscriptionsOn(tx)(userId)).map(({ spaceId, spaceName, currentPeriodEnd }) => ({
      id: spaceId,
      name: spaceName,
      currentPeriodEnd,
    })),
  leavePaidSpaces: async ({
    userId,
    at,
  }: {
    readonly userId: string;
    readonly at: Date;
  }): Promise<readonly DepartedSubscription[]> => {
    const paid = await paidSubscriptionsOn(tx)(userId);
    await Promise.all(paid.map(({ spaceId }) => cancelRequestOn(tx)({ spaceId, userId, at })));
    return paid;
  },
});

export const replayPendingPolarRequests = ({
  db,
  merchant,
  log,
  clock = () => new Date(),
}: {
  readonly db: PostgresDatabase;
  readonly merchant: MerchantOfRecord;
  readonly log: LogSink;
  readonly clock?: Clock;
}) => {
  const cancellations = replayCancellations({
    requests: postgresCancelRequests(db),
    merchant,
    log,
  });
  const refusals = replayRefusals({ refusals: postgresRefusals(db), merchant, log, now: clock });
  const revocations = replayRefundRevocations({
    revocations: postgresRefundRevocations(db),
    merchant,
    log,
    now: clock,
  });
  return async (): Promise<void> => {
    await cancellations();
    await refusals();
    await revocations();
  };
};

export type Billing = {
  readonly merchant: MerchantOfRecord;
  readonly webhookSecret: string;
};

export const polarBilling = ({
  polar,
  log,
}: {
  readonly polar: PolarConfig;
  readonly log: LogSink;
}): Billing => ({
  merchant: polarMerchantOfRecord({ ...polar, log }),
  webhookSecret: polar.webhookSecret,
});

export const subscriptionModule = ({
  db,
  memberships,
  mailer,
  webUrl,
  log,
  clock,
  billing,
}: {
  readonly db: PostgresDatabase;
  readonly memberships: MembershipReader;
  readonly mailer: Mailer;
  readonly webUrl: string;
  readonly log: LogSink;
  readonly clock: Clock;
  readonly billing: Billing | undefined;
}): SubscriptionUseCases & {
  readonly payerLeaves: ReturnType<typeof payerLeaves>;
  readonly payerDeletedAccount: ReturnType<typeof payerDeletedAccount>;
} => {
  const departures = {
    departures: postgresPayerDepartures(db),
    requests: postgresCancelRequests(db),
    merchant: billing?.merchant ?? unavailableMerchantOfRecord,
    mailer,
    log,
    webUrl,
  };
  return {
    startCheckout: startCheckout({
      memberships,
      plans: postgresSpacePlans(db),
      merchant: billing?.merchant ?? unavailableMerchantOfRecord,
      webUrl,
    }),
    openPortal: openPortal({
      memberships,
      payers: postgresSpacePayers(db),
      merchant: billing?.merchant ?? unavailableMerchantOfRecord,
      webUrl,
    }),
    receiveNotification: receiveNotification({
      reader:
        billing === undefined
          ? unavailableNotificationReader
          : polarNotificationReader({ webhookSecret: billing.webhookSecret }),
      unitOfWork: postgresSubscriptionUnitOfWork(db),
      refusals: postgresRefusals(db),
      revocations: postgresRefundRevocations(db),
      merchant: billing?.merchant ?? unavailableMerchantOfRecord,
      log,
      now: clock,
    }),
    payerLeaves: payerLeaves(departures),
    payerDeletedAccount: payerDeletedAccount(departures),
  };
};
