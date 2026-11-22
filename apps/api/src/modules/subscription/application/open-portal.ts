import type { MembershipReader } from "#modules/space/contracts/membership.ts";
import { err, type Result } from "@repo/result";

import type { MerchantOfRecord, Portal } from "./merchant-of-record.ts";

export type SpacePayers = {
  readonly payerOf: (spaceId: string) => Promise<string | undefined>;
};

export type PortalFailure = "not_found" | "forbidden" | "unavailable";

export const openPortal =
  ({
    memberships,
    payers,
    merchant,
    webUrl,
  }: {
    readonly memberships: MembershipReader;
    readonly payers: SpacePayers;
    readonly merchant: MerchantOfRecord;
    readonly webUrl: string;
  }) =>
  async ({
    spaceId,
    userId,
  }: {
    readonly spaceId: string;
    readonly userId: string;
  }): Promise<Result<Portal, PortalFailure>> => {
    const membership = await memberships.activeMembership({ spaceId, userId });
    if (membership === undefined) {
      return err("not_found");
    }
    if (membership.role !== "owner" || (await payers.payerOf(spaceId)) !== userId) {
      return err("forbidden");
    }
    return merchant.createPortal({
      spaceId,
      payerId: userId,
      returnUrl: `${webUrl}/espaces/${spaceId}/plan`,
    });
  };
