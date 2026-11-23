import { describe, expect, it } from "vitest";

import { err, ok } from "@repo/result";

import type { PasswordRefusal } from "../auth.ts";
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
  const owned = [...lastOwnerSpaces];
  const committed: string[] = [];
  const announced: Departure[][] = [];
  const steps: AccountDeletionSteps<Departure> = {
    lastOwnerSpaces: async (userId) => (userId === USER_ID ? [...owned] : []),
    paidSpaces: async (userId) => (userId === USER_ID ? paidSpaces : []),
    leavePaidSpaces: async ({ userId, at }) => {
      done.push(`leavePaidSpaces ${userId} ${at.toISOString()}`);
      return paidSpaces.map(({ id }) => ({ spaceId: id }));
    },
    orphanSpaces: async ({ userId, at }) => {
      done.push(`orphanSpaces ${userId} ${at.toISOString()}`);
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
    becomeLastOwnerOf: (space: SpaceRef) => {
      owned.push(space);
    },
    announce: async (departures: readonly Departure[]) => {
      announced.push([...departures]);
    },
  };
};

const makePasswordCheck = (outcome: PasswordRefusal | "accepted" = "accepted") => {
  const checks: string[] = [];
  return {
    checks,
    checkPassword: async () => {
      checks.push("vérification");
      return outcome === "accepted" ? ok(undefined) : err(outcome);
    },
  };
};

const deletionOf = (checkPassword = makePasswordCheck().checkPassword) => ({
  userId: USER_ID,
  checkPassword,
});

describe("la suppression d'un compte (ADR 0011 §5, ADR 0015, ADR 0050 §3)", () => {
  it("quitte les espaces payés, laisse orphelins les espaces dont il était le seul membre, pseudonymise l'historique puis supprime l'utilisateur", async () => {
    const account = makeAccount();

    const deleted = await deleteAccount({ ...account, now: () => NOW })(deletionOf());

    expect(deleted).toEqual(ok(undefined));
    expect(account.committed).toEqual([
      `leavePaidSpaces ${USER_ID} ${NOW.toISOString()}`,
      `orphanSpaces ${USER_ID} ${NOW.toISOString()}`,
      `pseudonymizeHistory ${USER_ID}`,
      `deleteUser ${USER_ID}`,
    ]);
  });

  it("annonce le départ du payeur de chaque espace payé, une fois la suppression faite", async () => {
    const account = makeAccount({ paidSpaces: [makePaidSpace()] });

    await deleteAccount({ ...account, now: () => NOW })(deletionOf());

    expect(account.announced).toEqual([[{ spaceId: STUDIO.id }]]);
  });

  it("le dernier propriétaire d'un espace ne supprime rien et voit les espaces à transmettre", async () => {
    const account = makeAccount({ lastOwnerSpaces: [STUDIO], paidSpaces: [makePaidSpace()] });

    const deleted = await deleteAccount({ ...account, now: () => NOW })(deletionOf());

    expect(deleted).toEqual(err({ kind: "last_owner", spaces: [STUDIO] }));
    expect(account.committed).toEqual([]);
    expect(account.announced).toEqual([]);
  });

  it.each(["wrong_password", "too_many_attempts", "unavailable"] as const)(
    "un mot de passe refusé (%s) ne supprime rien et n'annonce rien",
    async (refusal) => {
      const account = makeAccount({ paidSpaces: [makePaidSpace()] });

      const deleted = await deleteAccount({ ...account, now: () => NOW })(
        deletionOf(makePasswordCheck(refusal).checkPassword),
      );

      expect(deleted).toEqual(err({ kind: refusal }));
      expect(account.committed).toEqual([]);
      expect(account.announced).toEqual([]);
    },
  );

  it("vérifie le mot de passe une fois avant de supprimer", async () => {
    const account = makeAccount();
    const password = makePasswordCheck();

    await deleteAccount({ ...account, now: () => NOW })(deletionOf(password.checkPassword));

    expect(password.checks).toEqual(["vérification"]);
  });

  it("le dernier propriétaire est refusé avant toute vérification du mot de passe, qui ne se révèle donc pas", async () => {
    const account = makeAccount({ lastOwnerSpaces: [STUDIO] });
    const password = makePasswordCheck("wrong_password");

    const deleted = await deleteAccount({ ...account, now: () => NOW })(
      deletionOf(password.checkPassword),
    );

    expect(deleted).toEqual(err({ kind: "last_owner", spaces: [STUDIO] }));
    expect(password.checks).toEqual([]);
  });

  it("un compte devenu dernier propriétaire pendant la vérification du mot de passe ne supprime rien", async () => {
    const account = makeAccount();
    const checkPassword = async () => {
      account.becomeLastOwnerOf(STUDIO);
      return ok(undefined);
    };

    const deleted = await deleteAccount({ ...account, now: () => NOW })(deletionOf(checkPassword));

    expect(deleted).toEqual(err({ kind: "last_owner", spaces: [STUDIO] }));
    expect(account.committed).toEqual([]);
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
