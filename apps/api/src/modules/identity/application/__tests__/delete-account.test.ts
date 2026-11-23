import { describe, expect, it } from "vitest";

import { err, ok } from "@repo/result";

import {
  type AccountDeletionSteps,
  type AccountDeletionUnitOfWork,
  accountDeletionOf,
  deleteAccount,
  type PaidSpace,
  type SpaceRef,
} from "../delete-account.ts";

const USER_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";

const NOW = new Date("2026-11-23T10:00:00.000Z");

const STUDIO = { id: "6d1f0c2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f", name: "Studio Ada" };

const makePaidSpace = (overrides: Partial<PaidSpace> = {}): PaidSpace => ({
  ...STUDIO,
  currentPeriodEnd: new Date("2026-12-22T10:00:00.000Z"),
  ...overrides,
});

type Departure = { readonly spaceId: string };

const makeAccount = ({
  lastOwnerSpaces = [],
  paidSpaces = [],
}: {
  readonly lastOwnerSpaces?: readonly SpaceRef[];
  readonly paidSpaces?: readonly PaidSpace[];
} = {}) => {
  const done: string[] = [];
  const committed: string[] = [];
  const announced: Departure[][] = [];
  const steps: AccountDeletionSteps<Departure> = {
    lastOwnerSpaces: async (userId) => (userId === USER_ID ? lastOwnerSpaces : []),
    paidSpaces: async (userId) => (userId === USER_ID ? paidSpaces : []),
    leavePaidSpaces: async ({ userId, at }) => {
      done.push(`leavePaidSpaces ${userId} ${at.toISOString()}`);
      return paidSpaces.map(({ id }) => ({ spaceId: id }));
    },
    pseudonymizeHistory: async (userId) => {
      done.push(`pseudonymizeHistory ${userId}`);
    },
    deleteUser: async (userId) => {
      done.push(`deleteUser ${userId}`);
    },
  };
  const unitOfWork: AccountDeletionUnitOfWork<Departure> = {
    run: async (work) => {
      const result = await work(steps);
      committed.push(...done);
      return result;
    },
  };
  return {
    committed,
    announced,
    unitOfWork,
    announce: async (departures: readonly Departure[]) => {
      announced.push([...departures]);
    },
  };
};

describe("la suppression d'un compte (ADR 0011 §5, ADR 0015, ADR 0050 §3)", () => {
  it("quitte les espaces payés, pseudonymise l'historique puis supprime l'utilisateur", async () => {
    const account = makeAccount();

    const deleted = await deleteAccount({ ...account, now: () => NOW })(USER_ID);

    expect(deleted).toEqual(ok(undefined));
    expect(account.committed).toEqual([
      `leavePaidSpaces ${USER_ID} ${NOW.toISOString()}`,
      `pseudonymizeHistory ${USER_ID}`,
      `deleteUser ${USER_ID}`,
    ]);
  });

  it("annonce le départ du payeur de chaque espace payé, une fois la suppression faite", async () => {
    const account = makeAccount({ paidSpaces: [makePaidSpace()] });

    await deleteAccount({ ...account, now: () => NOW })(USER_ID);

    expect(account.announced).toEqual([[{ spaceId: STUDIO.id }]]);
  });

  it("le dernier propriétaire d'un espace ne supprime rien et voit les espaces à transmettre", async () => {
    const account = makeAccount({ lastOwnerSpaces: [STUDIO], paidSpaces: [makePaidSpace()] });

    const deleted = await deleteAccount({ ...account, now: () => NOW })(USER_ID);

    expect(deleted).toEqual(err({ kind: "last_owner", spaces: [STUDIO] }));
    expect(account.committed).toEqual([]);
    expect(account.announced).toEqual([]);
  });
});

describe("ce que la suppression d'un compte annonce avant confirmation", () => {
  it("nomme les espaces payés et ceux dont le compte est le dernier propriétaire", async () => {
    const paid = makePaidSpace({ currentPeriodEnd: undefined });
    const account = makeAccount({ lastOwnerSpaces: [STUDIO], paidSpaces: [paid] });

    expect(await accountDeletionOf(account)(USER_ID)).toEqual({
      paidSpaces: [paid],
      lastOwnerSpaces: [STUDIO],
    });
    expect(account.committed).toEqual([]);
  });
});
