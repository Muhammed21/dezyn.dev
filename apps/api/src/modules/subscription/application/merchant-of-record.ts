import type { Result } from "@repo/result";

export type CheckoutRequest = {
  readonly spaceId: string;
  readonly payerId: string;
  readonly successUrl: string;
};

export type Checkout = { readonly url: string };

export type PortalRequest = {
  readonly spaceId: string;
  readonly payerId: string;
  readonly returnUrl: string;
};

export type Portal = { readonly url: string };

export type CancellationRequest = {
  readonly spaceId: string;
  readonly subscriptionId: string;
};

export interface MerchantOfRecord {
  createCheckout(request: CheckoutRequest): Promise<Result<Checkout, "unavailable">>;
  createPortal(request: PortalRequest): Promise<Result<Portal, "unavailable">>;
  cancelAtPeriodEnd(request: CancellationRequest): Promise<Result<undefined, "unavailable">>;
}

export type SubscriptionEvent = {
  readonly type: string;
  readonly spaceId: string | undefined;
  readonly payerId: string | undefined;
  readonly subscriptionId: string;
  readonly status: string;
  readonly cancelAtPeriodEnd: boolean;
  readonly currentPeriodEnd: Date | undefined;
  readonly modifiedAt: Date;
};

export type MerchantNotification =
  | { readonly kind: "subscription"; readonly event: SubscriptionEvent }
  | { readonly kind: "other"; readonly type: string };

export type NotificationFailure = "invalid_signature" | "malformed" | "unavailable";

export interface NotificationReader {
  read(
    body: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<Result<MerchantNotification, NotificationFailure>>;
}
