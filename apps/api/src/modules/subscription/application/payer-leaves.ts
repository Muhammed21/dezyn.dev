import type { LogSink } from "#platform/logging.ts";
import type { Mailer } from "#platform/mailer.ts";

import {
  type DepartedSubscription,
  type PayerDeparture,
  payerDepartureOf,
  type PayerDepartureReason,
} from "../domain/payer-departure.ts";
import type { MerchantOfRecord } from "./merchant-of-record.ts";
import { type CancelRequests, sendCancellation } from "./replay-cancellations.ts";

export interface PayerDepartures {
  subscriptionOf(spaceId: string): Promise<DepartedSubscription | undefined>;
  openOwnerEmailsOf(spaceId: string): Promise<readonly string[]>;
}

type DepartureDependencies = {
  readonly departures: PayerDepartures;
  readonly requests: CancelRequests;
  readonly merchant: MerchantOfRecord;
  readonly mailer: Mailer;
  readonly log: LogSink;
  readonly webUrl: string;
};

const announceDeparture =
  ({ departures, requests, merchant, mailer, log }: DepartureDependencies) =>
  async ({
    spaceId,
    departure,
  }: {
    readonly spaceId: string;
    readonly departure: PayerDeparture;
  }): Promise<void> => {
    if (departure.cancel) {
      await sendCancellation({ requests, merchant, log })({
        spaceId,
        subscriptionId: departure.subscriptionId,
      });
    }
    const owners = await departures.openOwnerEmailsOf(spaceId);
    await Promise.all(
      owners.map(async (to) => {
        const sent = await mailer.send({ to, ...departure.notice });
        if (!sent.ok) {
          log({
            level: "error",
            msg: "payer_departure_notice_unsent",
            spaceId,
            to,
            error: sent.error,
          });
        }
      }),
    );
  };

export const payerLeaves =
  (dependencies: DepartureDependencies) =>
  async ({
    spaceId,
    userId,
    reason,
  }: {
    readonly spaceId: string;
    readonly userId: string;
    readonly reason: Exclude<PayerDepartureReason, "account_deleted">;
  }): Promise<void> => {
    const departure = payerDepartureOf({
      subscription: await dependencies.departures.subscriptionOf(spaceId),
      leaverId: userId,
      webUrl: dependencies.webUrl,
      reason,
    });
    if (departure !== undefined) {
      await announceDeparture(dependencies)({ spaceId, departure });
    }
  };

export const payerDeletedAccount =
  (dependencies: DepartureDependencies) =>
  async (subscriptions: readonly DepartedSubscription[]): Promise<void> => {
    await Promise.all(
      subscriptions.map(async (subscription) => {
        const departure = payerDepartureOf({
          subscription,
          leaverId: subscription.payerId,
          webUrl: dependencies.webUrl,
          reason: "account_deleted",
        });
        if (departure !== undefined) {
          await announceDeparture(dependencies)({ spaceId: subscription.spaceId, departure });
        }
      }),
    );
  };
