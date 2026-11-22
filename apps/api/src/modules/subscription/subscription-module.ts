import type { PostgresDatabase } from "#db";
import type { MembershipReader } from "#modules/space/contracts/membership.ts";
import type { PolarConfig } from "#platform/api-config.ts";
import type { Clock } from "#platform/clock.ts";
import type { LogSink } from "#platform/logging.ts";

import type { MerchantOfRecord } from "./application/merchant-of-record.ts";
import { openPortal } from "./application/open-portal.ts";
import { receiveNotification } from "./application/receive-notification.ts";
import { startCheckout } from "./application/start-checkout.ts";
import type { SubscriptionUseCases } from "./application/subscription-use-cases.ts";
import {
  polarMerchantOfRecord,
  polarNotificationReader,
  unavailableMerchantOfRecord,
  unavailableNotificationReader,
} from "./infrastructure/polar.ts";
import {
  postgresSpacePayers,
  postgresSpacePlans,
  postgresSpaceSubscriptions,
  postgresSubscriptionUnitOfWork,
} from "./infrastructure/postgres-subscriptions.ts";

export const spaceSubscriptionsOf = postgresSpaceSubscriptions;

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
  webUrl,
  log,
  clock,
  billing,
}: {
  readonly db: PostgresDatabase;
  readonly memberships: MembershipReader;
  readonly webUrl: string;
  readonly log: LogSink;
  readonly clock: Clock;
  readonly billing: Billing | undefined;
}): SubscriptionUseCases => ({
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
    log,
    now: clock,
  }),
});
