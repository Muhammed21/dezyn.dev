import type { LogSink } from "#platform/logging.ts";

import type { MerchantOfRecord, OrderRefund } from "./merchant-of-record.ts";
import { POLAR_CALL_LEASE_MS } from "./settle-refusals.ts";

export type RevocationRequest = {
  readonly spaceId: string;
  readonly subscriptionId: string;
  readonly orderId: string;
};

export interface RefundRevocations {
  record(refund: {
    readonly subscriptionId: string;
    readonly orderId: string;
    readonly at: Date;
  }): Promise<RevocationRequest | undefined>;
  pending(): Promise<readonly RevocationRequest[]>;
  claim(claim: {
    readonly subscriptionId: string;
    readonly at: Date;
    readonly staleBefore: Date;
  }): Promise<boolean>;
  release(release: {
    readonly subscriptionId: string;
    readonly revokedAt: Date | undefined;
  }): Promise<void>;
}

type RevocationDependencies = {
  readonly revocations: RefundRevocations;
  readonly merchant: MerchantOfRecord;
  readonly log: LogSink;
  readonly now: () => Date;
};

const FULLY_REFUNDED = "refunded";

const REVOKED = "polar order fully refunded: subscription revoked";

const revoke =
  ({ revocations, merchant }: RevocationDependencies) =>
  async ({ request, at }: { readonly request: RevocationRequest; readonly at: Date }) => {
    const revoked = await merchant.revokeNow({
      spaceId: request.spaceId,
      subscriptionId: request.subscriptionId,
    });
    await revocations.release({
      subscriptionId: request.subscriptionId,
      revokedAt: revoked.ok ? at : undefined,
    });
    return revoked.ok;
  };

export const revokeRefundedSubscription =
  (dependencies: RevocationDependencies) =>
  async (refund: OrderRefund): Promise<void> => {
    const { revocations, log, now } = dependencies;
    if (refund.orderStatus !== FULLY_REFUNDED || refund.subscriptionId === undefined) {
      log({ level: "info", msg: "polar refund that keeps the subscription", ...refund });
      return;
    }
    const at = now();
    const request = await revocations.record({
      subscriptionId: refund.subscriptionId,
      orderId: refund.orderId,
      at,
    });
    if (request === undefined) {
      log({
        level: "info",
        msg: "polar order fully refunded: no subscription of a space to revoke",
        orderId: refund.orderId,
        subscriptionId: refund.subscriptionId,
      });
      return;
    }
    const revoked = await revoke(dependencies)({ request, at });
    log({
      level: "warn",
      msg: revoked ? REVOKED : "polar order fully refunded: revocation left to the replay",
      ...request,
    });
  };

export const replayRefundRevocations =
  (dependencies: RevocationDependencies) => async (): Promise<void> => {
    const { revocations, log, now } = dependencies;
    const pending = await revocations.pending();
    const outcomes = await Promise.all(
      pending.map(async (request) => {
        const at = now();
        const claimed = await revocations.claim({
          subscriptionId: request.subscriptionId,
          at,
          staleBefore: new Date(at.getTime() - POLAR_CALL_LEASE_MS),
        });
        if (!claimed) {
          return false;
        }
        const revoked = await revoke(dependencies)({ request, at });
        log(
          revoked
            ? { level: "warn", msg: REVOKED, ...request }
            : {
                level: "error",
                msg: "fully refunded polar order: revoke the subscription by hand in Polar",
                ...request,
              },
        );
        return revoked;
      }),
    );
    const revoked = outcomes.filter(Boolean).length;
    log({
      level: "info",
      msg: "polar_refund_revocation_replay_pass",
      revoked,
      pending: pending.length - revoked,
    });
  };
