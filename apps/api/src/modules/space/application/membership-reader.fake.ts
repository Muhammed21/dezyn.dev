import type { Membership } from "../domain/can.ts";
import type { MembershipReader } from "./membership-reader.ts";

export type MembershipRecord = Membership & { readonly closedAt?: Date | null };

export const inMemoryMembershipReader = (
  memberships: readonly MembershipRecord[],
): MembershipReader => ({
  activeMembership: async ({ spaceId, userId }) => {
    const found = memberships.find(
      (membership) =>
        membership.spaceId === spaceId &&
        membership.userId === userId &&
        membership.closedAt == null,
    );
    return found === undefined
      ? undefined
      : { spaceId: found.spaceId, userId: found.userId, role: found.role };
  },
});
