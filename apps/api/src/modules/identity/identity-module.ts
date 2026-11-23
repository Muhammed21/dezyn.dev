import type { PostgresDatabase, PostgresTransaction } from "#db";
import type { Clock } from "#platform/clock.ts";

import {
  type AccountDeletionSteps,
  accountDeletionOf,
  type AccountUseCases,
  deleteAccount,
} from "./application/delete-account.ts";
import { deleteUserOn } from "./infrastructure/postgres-users.ts";

export const accountModule = <Departure>({
  db,
  stepsOn,
  announce,
  clock,
}: {
  readonly db: PostgresDatabase;
  readonly stepsOn: (
    tx: PostgresTransaction,
  ) => Omit<AccountDeletionSteps<Departure>, "deleteUser">;
  readonly announce: (departures: readonly Departure[]) => Promise<void>;
  readonly clock: Clock;
}): AccountUseCases => {
  const unitOfWork = {
    run: <T>(work: (steps: AccountDeletionSteps<Departure>) => Promise<T>) =>
      db.orm.transaction((tx) => work({ ...stepsOn(tx), deleteUser: deleteUserOn(tx) })),
  };
  return {
    accountDeletionOf: accountDeletionOf({ unitOfWork }),
    deleteAccount: deleteAccount({ unitOfWork, announce, now: clock }),
  };
};
