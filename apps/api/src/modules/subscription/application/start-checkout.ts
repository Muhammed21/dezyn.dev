import { can, type MembershipReader } from "#modules/space/contracts/membership.ts";
import type { Plan } from "#modules/space/contracts/plan.ts";
import { err, type Result } from "@repo/result";

import type { Checkout, MerchantOfRecord } from "./merchant-of-record.ts";

export type SpacePlans = { readonly planOf: (spaceId: string) => Promise<Plan> };

export type CheckoutFailure = "not_found" | "forbidden" | "already_team" | "unavailable";

export const startCheckout =
  ({
    memberships,
    plans,
    merchant,
    webUrl,
  }: {
    readonly memberships: MembershipReader;
    readonly plans: SpacePlans;
    readonly merchant: MerchantOfRecord;
    readonly webUrl: string;
  }) =>
  async ({
    spaceId,
    userId,
  }: {
    readonly spaceId: string;
    readonly userId: string;
  }): Promise<Result<Checkout, CheckoutFailure>> => {
    const membership = await memberships.activeMembership({ spaceId, userId });
    if (membership === undefined) {
      return err("not_found");
    }
    if (!can({ membership, action: "subscription.checkout" })) {
      return err("forbidden");
    }
    if ((await plans.planOf(spaceId)) === "team") {
      return err("already_team");
    }
    return merchant.createCheckout({
      spaceId,
      payerId: userId,
      successUrl: `${webUrl}/espaces/${spaceId}/plan?checkout={CHECKOUT_ID}`,
    });
  };
