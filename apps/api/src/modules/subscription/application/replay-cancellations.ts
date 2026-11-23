import type { LogSink } from "#platform/logging.ts";

import type { CancellationRequest, MerchantOfRecord } from "./merchant-of-record.ts";

export interface CancelRequests {
  pending(): Promise<readonly CancellationRequest[]>;
  sent(spaceId: string): Promise<void>;
}

export const sendCancellation =
  ({
    requests,
    merchant,
    log,
  }: {
    readonly requests: CancelRequests;
    readonly merchant: MerchantOfRecord;
    readonly log: LogSink;
  }) =>
  async (request: CancellationRequest): Promise<boolean> => {
    const canceled = await merchant.cancelAtPeriodEnd(request);
    if (!canceled.ok) {
      log({
        level: "error",
        msg: "payer departure: cancel the subscription at period end by hand in Polar",
        ...request,
      });
      return false;
    }
    await requests.sent(request.spaceId);
    return true;
  };

export const replayCancellations =
  (dependencies: {
    readonly requests: CancelRequests;
    readonly merchant: MerchantOfRecord;
    readonly log: LogSink;
  }) =>
  async (): Promise<void> => {
    const send = sendCancellation(dependencies);
    const pending = await dependencies.requests.pending();
    const sent = await Promise.all(pending.map(send));
    const replayed = sent.filter(Boolean).length;
    dependencies.log({
      level: "info",
      msg: "polar_cancellation_replay_pass",
      replayed,
      pending: pending.length - replayed,
    });
  };
