import type { MerchantOfRecord } from "#modules/subscription/application/merchant-of-record.ts";
import { err, ok } from "@repo/result";

export const WEBHOOK_KEY = Buffer.from("cle-de-signature-des-webhooks-de-test");

export const WEBHOOK_SECRET = `whsec_${WEBHOOK_KEY.toString("base64")}`;

export type RequestedCheckout = Parameters<MerchantOfRecord["createCheckout"]>[0];

export type RequestedPortal = Parameters<MerchantOfRecord["createPortal"]>[0];

export type RequestedCancellation = Parameters<MerchantOfRecord["cancelAtPeriodEnd"]>[0];

export type RequestedRevocation = Parameters<MerchantOfRecord["revokeNow"]>[0];

export type RequestedRefund = Parameters<MerchantOfRecord["refundAll"]>[0];

export const makeMerchantOfRecord = ({
  available = true,
  revokeAvailable = available,
  refundAvailable = available,
}: {
  readonly available?: boolean;
  readonly revokeAvailable?: boolean;
  readonly refundAvailable?: boolean;
} = {}) => {
  const checkouts: RequestedCheckout[] = [];
  const portals: RequestedPortal[] = [];
  const cancellations: RequestedCancellation[] = [];
  const revocations: RequestedRevocation[] = [];
  const refunds: RequestedRefund[] = [];
  const merchant: MerchantOfRecord = {
    createCheckout: async (checkout) => {
      checkouts.push(checkout);
      return available
        ? ok({ url: `https://sandbox.polar.sh/checkout/polar_c_test?space=${checkout.spaceId}` })
        : err("unavailable");
    },
    createPortal: async (portal) => {
      portals.push(portal);
      return available
        ? ok({ url: `https://sandbox.polar.sh/dezyn/portal?customer=${portal.payerId}` })
        : err("unavailable");
    },
    cancelAtPeriodEnd: async (cancellation) => {
      cancellations.push(cancellation);
      return available ? ok(undefined) : err("unavailable");
    },
    revokeNow: async (revocation) => {
      revocations.push(revocation);
      return revokeAvailable ? ok(undefined) : err("unavailable");
    },
    refundAll: async (refund) => {
      refunds.push(refund);
      return refundAvailable ? ok(undefined) : err("unavailable");
    },
  };
  return { checkouts, portals, cancellations, revocations, refunds, merchant };
};
