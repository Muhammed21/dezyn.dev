import type { LogSink } from "#platform/logging.ts";

import type { MerchantOfRecord, RefusalRequest } from "./merchant-of-record.ts";

export const POLAR_CALL_LEASE_MS = 5 * 60 * 1000;

export type RefusalProgress = { readonly revoked: boolean; readonly refunded: boolean };

export interface Refusals {
  pending(): Promise<readonly RefusalRequest[]>;
  claim(claim: {
    readonly subscriptionId: string;
    readonly at: Date;
    readonly staleBefore: Date;
  }): Promise<RefusalProgress | undefined>;
  release(release: {
    readonly subscriptionId: string;
    readonly revokedAt: Date | undefined;
    readonly refundedAt: Date | undefined;
  }): Promise<void>;
}

export type Settlement =
  | { readonly kind: "busy" }
  | ({ readonly kind: "settled" | "pending" } & RefusalProgress);

export const SETTLED_REFUSAL =
  "polar subscription paid by a user who is not an owner of the space: revoked and refunded";

const doneAt = async ({
  done,
  act,
  at,
}: {
  readonly done: boolean;
  readonly act: () => Promise<{ readonly ok: boolean }>;
  readonly at: Date;
}) => (done || !(await act()).ok ? undefined : at);

export const settleRefusal =
  ({
    refusals,
    merchant,
    now,
  }: {
    readonly refusals: Refusals;
    readonly merchant: MerchantOfRecord;
    readonly now: () => Date;
  }) =>
  async (request: RefusalRequest): Promise<Settlement> => {
    const at = now();
    const claimed = await refusals.claim({
      subscriptionId: request.subscriptionId,
      at,
      staleBefore: new Date(at.getTime() - POLAR_CALL_LEASE_MS),
    });
    if (claimed === undefined) {
      return { kind: "busy" };
    }
    const revokedAt = await doneAt({
      done: claimed.revoked,
      act: () => merchant.revokeNow(request),
      at,
    });
    const refundedAt = await doneAt({
      done: claimed.refunded,
      act: () => merchant.refundAll(request),
      at,
    });
    await refusals.release({ subscriptionId: request.subscriptionId, revokedAt, refundedAt });
    const revoked = claimed.revoked || revokedAt !== undefined;
    const refunded = claimed.refunded || refundedAt !== undefined;
    return { kind: revoked && refunded ? "settled" : "pending", revoked, refunded };
  };

export const replayRefusals =
  (dependencies: {
    readonly refusals: Refusals;
    readonly merchant: MerchantOfRecord;
    readonly log: LogSink;
    readonly now: () => Date;
  }) =>
  async (): Promise<void> => {
    const settle = settleRefusal(dependencies);
    const pending = await dependencies.refusals.pending();
    const settlements = await Promise.all(
      pending.map(async (request) => {
        const settlement = await settle(request);
        if (settlement.kind === "settled") {
          dependencies.log({ level: "warn", msg: SETTLED_REFUSAL, ...request });
        }
        if (settlement.kind === "pending") {
          dependencies.log({
            level: "error",
            msg: "refused polar subscription: revoke and refund it by hand in Polar",
            ...request,
            revoked: settlement.revoked,
            refunded: settlement.refunded,
          });
        }
        return settlement.kind;
      }),
    );
    const settled = settlements.filter((kind) => kind === "settled").length;
    dependencies.log({
      level: "info",
      msg: "polar_refusal_replay_pass",
      settled,
      pending: pending.length - settled,
    });
  };
