import { type Action, can } from "../domain/can.ts";
import type { MembershipKey, MembershipReader } from "./membership-reader.ts";

export type SpaceAccess = (
  request: MembershipKey & { readonly action: Action },
) => Promise<boolean>;

export const spaceAccess =
  ({ memberships }: { readonly memberships: MembershipReader }): SpaceAccess =>
  async ({ spaceId, userId, action }) =>
    can({ membership: await memberships.activeMembership({ spaceId, userId }), action });
