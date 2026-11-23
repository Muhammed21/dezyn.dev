import type { MerchantOfRecord } from "#modules/subscription/application/merchant-of-record.ts";
import { err, ok } from "@repo/result";

export const WEBHOOK_KEY = Buffer.from("cle-de-signature-des-webhooks-de-test");

export const WEBHOOK_SECRET = `whsec_${WEBHOOK_KEY.toString("base64")}`;

export type RequestedCheckout = Parameters<MerchantOfRecord["createCheckout"]>[0];

export type RequestedPortal = Parameters<MerchantOfRecord["createPortal"]>[0];

export type RequestedCancellation = Parameters<MerchantOfRecord["cancelAtPeriodEnd"]>[0];

export const makeMerchantOfRecord = ({
  available = true,
}: { readonly available?: boolean } = {}) => {
  const checkouts: RequestedCheckout[] = [];
  const portals: RequestedPortal[] = [];
  const cancellations: RequestedCancellation[] = [];
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
  };
  return { checkouts, portals, cancellations, merchant };
};
