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

export type SpaceWithStorage = MySpace & { readonly storage: SpaceStorage };

export const readSpace =
  ({
    memberships,
    spaces,
  }: {
    readonly memberships: MembershipReader;
    readonly spaces: SpaceFinder;
  }) =>
  async (key: MembershipKey): Promise<Result<SpaceWithStorage, "not_found">> => {
    const membership = await memberships.activeMembership(key);
    if (membership === undefined || !can({ membership, action: "space.read" })) {
      return err("not_found");
    }
    const { storedBytes, ...space } = await spaces.find(key.spaceId);
    return ok({
      ...mySpaceOf({ ...space, role: membership.role }),
      storage: spaceStorageOf({ plan: space.plan, storedBytes }),
    });
  };
