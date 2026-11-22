import { describe, expect, it } from "vitest";

import { clientProblem } from "#platform/problem.ts";

import type { Membership } from "../../domain/can.ts";
import { guardFrozenSpaces, type FreezeFacts } from "../frozen-space-guard.ts";
import { inMemoryMembershipReader } from "../membership-reader.fake.ts";

const SPACE_ID = "6d1f0c2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
const ADA = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";
const GRACE = "9b8a7f6e-5d4c-4b3a-8f2e-1d0c9b8a7f6e";

const OWNER_ADA: Membership = { spaceId: SPACE_ID, userId: ADA, role: "owner" };
const EDITOR_GRACE: Membership = { spaceId: SPACE_ID, userId: GRACE, role: "editor" };

const makeFacts = (overrides: Partial<FreezeFacts> = {}): FreezeFacts => ({
  plan: "free",
  subscriptionEnded: true,
  usage: { projects: 1, storedBytes: 0, members: 2 },
  ...overrides,
});

const FROZEN_FACTS = makeFacts({ usage: { projects: 1, storedBytes: 0, members: 2 } });

const guarded = (facts: FreezeFacts) => {
  const asked: string[] = [];
  const memberships = guardFrozenSpaces({
    memberships: inMemoryMembershipReader([OWNER_ADA, EDITOR_GRACE]),
    freezes: {
      freezeFactsOf: async (spaceId) => {
        asked.push(spaceId);
        return facts;
      },
    },
  });
  return { memberships, asked };
};

const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  return error instanceof Error ? { message: error.message, problem: clientProblem(error) } : error;
};

describe("un éditeur d'un espace gelé est suspendu (ADR 0050 §5)", () => {
  it("refuse l'éditeur d'un espace gelé par le problème space-frozen (403)", async () => {
    const { memberships } = guarded(FROZEN_FACTS);

    expect(
      await refusalOf(memberships.activeMembership({ spaceId: SPACE_ID, userId: GRACE })),
    ).toEqual({
      message:
        "space_frozen : cet espace est gelé ; l'accès des éditeurs est suspendu jusqu'à son retour au plan Team.",
      problem: {
        type: "https://dezyn.dev/problems/space-frozen",
        title: "Espace gelé",
        status: 403,
      },
    });
  });

  it("garde le propriétaire d'un espace gelé, sans lire le gel", async () => {
    const { memberships, asked } = guarded(FROZEN_FACTS);

    expect(await memberships.activeMembership({ spaceId: SPACE_ID, userId: ADA })).toEqual(
      OWNER_ADA,
    );
    expect(asked).toEqual([]);
  });

  it.each([
    ["Team", makeFacts({ plan: "team" })],
    [
      "revenu sous toutes les limites Free",
      makeFacts({ usage: { projects: 3, storedBytes: 0, members: 1 } }),
    ],
    ["Free sans abonnement passé", makeFacts({ subscriptionEnded: false })],
  ])("garde l'éditeur d'un espace %s, qui n'est pas gelé", async (_case, facts) => {
    const { memberships, asked } = guarded(facts);

    expect(await memberships.activeMembership({ spaceId: SPACE_ID, userId: GRACE })).toEqual(
      EDITOR_GRACE,
    );
    expect(asked).toEqual([SPACE_ID]);
  });

  it("ne trouve toujours pas un non-membre, sans lire le gel", async () => {
    const { memberships, asked } = guarded(FROZEN_FACTS);

    expect(
      await memberships.activeMembership({
        spaceId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
        userId: GRACE,
      }),
    ).toBeUndefined();
    expect(asked).toEqual([]);
  });
});
