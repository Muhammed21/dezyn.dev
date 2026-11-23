import { err, ok, type Result } from "@repo/result";

export type SpaceRef = { readonly id: string; readonly name: string };

export type PaidSpace = SpaceRef & { readonly currentPeriodEnd: Date | undefined };

export interface AccountDeletionSteps<Departure> {
  lastOwnerSpaces(userId: string): Promise<readonly SpaceRef[]>;
  paidSpaces(userId: string): Promise<readonly PaidSpace[]>;
  leavePaidSpaces(leaving: {
    readonly userId: string;
    readonly at: Date;
  }): Promise<readonly Departure[]>;
  pseudonymizeHistory(userId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

export interface AccountDeletionUnitOfWork<Departure> {
  run<T>(work: (steps: AccountDeletionSteps<Departure>) => Promise<T>): Promise<T>;
}

export type AccountDeletion = {
  readonly paidSpaces: readonly PaidSpace[];
  readonly lastOwnerSpaces: readonly SpaceRef[];
};

export type AccountDeletionRefusal = {
  readonly kind: "last_owner";
  readonly spaces: readonly SpaceRef[];
};

export type AccountUseCases = {
  readonly accountDeletionOf: (userId: string) => Promise<AccountDeletion>;
  readonly deleteAccount: (userId: string) => Promise<Result<void, AccountDeletionRefusal>>;
};

export const accountDeletionOf =
  <Departure>({ unitOfWork }: { readonly unitOfWork: AccountDeletionUnitOfWork<Departure> }) =>
  (userId: string): Promise<AccountDeletion> =>
    unitOfWork.run(async (steps) => ({
      paidSpaces: await steps.paidSpaces(userId),
      lastOwnerSpaces: await steps.lastOwnerSpaces(userId),
    }));

export const deleteAccount =
  <Departure>({
    unitOfWork,
    announce,
    now,
  }: {
    readonly unitOfWork: AccountDeletionUnitOfWork<Departure>;
    readonly announce: (departures: readonly Departure[]) => Promise<void>;
    readonly now: () => Date;
  }) =>
  async (userId: string): Promise<Result<void, AccountDeletionRefusal>> => {
    const deleted = await unitOfWork.run(
      async (steps): Promise<Result<readonly Departure[], AccountDeletionRefusal>> => {
        const spaces = await steps.lastOwnerSpaces(userId);
        if (spaces.length > 0) {
          return err({ kind: "last_owner", spaces });
        }
        const departures = await steps.leavePaidSpaces({ userId, at: now() });
        await steps.pseudonymizeHistory(userId);
        await steps.deleteUser(userId);
        return ok(departures);
      },
    );
    if (!deleted.ok) {
      return deleted;
    }
    await announce(deleted.value);
    return ok(undefined);
  };
