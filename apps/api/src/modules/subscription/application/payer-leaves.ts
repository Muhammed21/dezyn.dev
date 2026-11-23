import type { LogSink } from "#platform/logging.ts";
import type { Mailer } from "#platform/mailer.ts";

import { type DepartedSubscription, payerDepartureOf } from "../domain/payer-departure.ts";
import type { MerchantOfRecord } from "./merchant-of-record.ts";
import { type CancelRequests, sendCancellation } from "./replay-cancellations.ts";

export interface PayerDepartures {
  subscriptionOf(spaceId: string): Promise<DepartedSubscription | undefined>;
  openOwnerEmailsOf(spaceId: string): Promise<readonly string[]>;
}

export const payerLeaves =
  ({
    departures,
    requests,
    merchant,
    mailer,
    log,
    webUrl,
  }: {
    readonly departures: PayerDepartures;
    readonly requests: CancelRequests;
    readonly merchant: MerchantOfRecord;
    readonly mailer: Mailer;
    readonly log: LogSink;
    readonly webUrl: string;
  }) =>
  async ({
    spaceId,
    userId,
  }: {
    readonly spaceId: string;
    readonly userId: string;
  }): Promise<void> => {
    const departure = payerDepartureOf({
      subscription: await departures.subscriptionOf(spaceId),
      leaverId: userId,
      webUrl,
    });
    if (departure === undefined) {
      return;
    }
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
