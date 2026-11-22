import { err, ok, type Result } from "@repo/result";

import { can } from "../domain/can.ts";
import { type MySpace, mySpaceOf, type Plan } from "../domain/space.ts";
import { type SpaceStorage, spaceStorageOf } from "../domain/storage-limit.ts";
import type { MembershipKey, MembershipReader } from "./membership-reader.ts";

export type SpaceFinder = {
  readonly find: (spaceId: string) => Promise<{
    readonly id: string;
    readonly name: string;
    readonly plan: Plan;
    readonly storedBytes: number;
  }>;
};

export type SpaceSubscription = {
  readonly status: string;
  readonly currentPeriodEnd: Date | undefined;
  readonly payer: { readonly id: string; readonly name: string; readonly email: string };
};

export type SpaceSubscriptions = {
  readonly subscriptionOf: (spaceId: string) => Promise<SpaceSubscription | undefined>;
};

export type SubscriptionView = {
  readonly status: string;
  readonly currentPeriodEnd: Date | null;
  readonly payer: { readonly name: string; readonly email: string; readonly you: boolean };
};

export type SpaceWithStorage = MySpace & {
  readonly storage: SpaceStorage;
  readonly subscription?: SubscriptionView;
};

const subscriptionViewOf = (
  { status, currentPeriodEnd, payer: { id, ...payer } }: SpaceSubscription,
  userId: string,
): SubscriptionView => ({
  status,
  currentPeriodEnd: currentPeriodEnd ?? null,
  payer: { ...payer, you: id === userId },
});

export const readSpace =
  ({
    memberships,
    spaces,
    subscriptions,
  }: {
    readonly memberships: MembershipReader;
    readonly spaces: SpaceFinder;
    readonly subscriptions: SpaceSubscriptions;
  }) =>
  async (key: MembershipKey): Promise<Result<SpaceWithStorage, "not_found">> => {
    const membership = await memberships.activeMembership(key);
    if (membership === undefined || !can({ membership, action: "space.read" })) {
      return err("not_found");
    }
    const { storedBytes, ...space } = await spaces.find(key.spaceId);
    const read = {
      ...mySpaceOf({ ...space, role: membership.role }),
      storage: spaceStorageOf({ plan: space.plan, storedBytes }),
    };
    const subscription =
      membership.role === "owner" ? await subscriptions.subscriptionOf(key.spaceId) : undefined;
    return ok(
      subscription === undefined
        ? read
        : { ...read, subscription: subscriptionViewOf(subscription, key.userId) },
    );
  };
