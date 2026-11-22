import { ProblemError } from "#platform/problem.ts";

import { freezeOf, type SpaceUsage } from "../domain/free-limits.ts";
import type { Plan } from "../domain/space.ts";
import type { MembershipReader } from "./membership-reader.ts";

export type FreezeFacts = {
  readonly plan: Plan;
  readonly subscriptionEnded: boolean;
  readonly usage: SpaceUsage;
};

export interface SpaceFreezes {
  freezeFactsOf(spaceId: string): Promise<FreezeFacts>;
}

export const SPACE_FROZEN = {
  type: "https://dezyn.dev/problems/space-frozen",
  title: "Espace gelé",
  status: 403,
} as const;

const spaceFrozen = () =>
  new ProblemError({
    problem: SPACE_FROZEN,
    message:
      "space_frozen : cet espace est gelé ; l'accès des éditeurs est suspendu jusqu'à son retour au plan Team.",
  });

export const guardFrozenSpaces = ({
  memberships,
  freezes,
}: {
  readonly memberships: MembershipReader;
  readonly freezes: SpaceFreezes;
}): MembershipReader => ({
  activeMembership: async (key) => {
    const membership = await memberships.activeMembership(key);
    if (membership?.role !== "editor") {
      return membership;
    }
    if (freezeOf(await freezes.freezeFactsOf(key.spaceId)).frozen) {
      throw spaceFrozen();
    }
    return membership;
  },
});
