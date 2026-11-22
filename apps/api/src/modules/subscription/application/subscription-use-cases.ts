import type { receiveNotification } from "./receive-notification.ts";
import type { startCheckout } from "./start-checkout.ts";

export type SubscriptionUseCases = {
  readonly startCheckout: ReturnType<typeof startCheckout>;
  readonly receiveNotification: ReturnType<typeof receiveNotification>;
};
