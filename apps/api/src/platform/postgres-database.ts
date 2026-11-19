import { AsyncLocalStorage } from "node:async_hooks";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";

import type { Database } from "./database.ts";
import { errorDetails, type LogSink } from "./logging.ts";

const CONNECTION_TIMEOUT_MS = 2_000;
const STATEMENT_TIMEOUT_MS = 2_000;
const LOCK_TIMEOUT_MS = 1_000;
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 5_000;

type QueryTally = { queries: number; running: number; busySince: number; durationMs: number };

type Tallies = AsyncLocalStorage<QueryTally>;

const tallied = (tallies: Tallies, run: () => unknown): unknown => {
  const tally = tallies.getStore();
  if (tally === undefined) {
    return run();
  }
  tally.queries += 1;
  tally.running += 1;
  tally.busySince = tally.running === 1 ? performance.now() : tally.busySince;
  const result = run();
  const settle = () => {
    tally.running -= 1;
    tally.durationMs += tally.running === 0 ? performance.now() - tally.busySince : 0;
  };
  void Promise.resolve(result).then(settle, settle);
  return result;
};

const talliedQuery =
  (tallies: Tallies, target: Pool | PoolClient) =>
  (...args: unknown[]) =>
    tallied(tallies, () => Reflect.apply(target.query, target, args));

const talliedClient = (tallies: Tallies, client: PoolClient): PoolClient =>
  new Proxy(client, {
    get: (target, key) =>
      key === "query" ? talliedQuery(tallies, target) : Reflect.get(target, key),
  });

const talliedPool = (tallies: Tallies, pool: Pool): Pool =>
  new Proxy(pool, {
    get: (target, key) => {
      if (key === "query") {
        return talliedQuery(tallies, target);
      }
      if (key === "connect") {
        return async () => talliedClient(tallies, await target.connect());
      }
      return Reflect.get(target, key);
    },
  });

export type PostgresDatabase = Database & {
  readonly orm: NodePgDatabase;
  readonly close: () => Promise<void>;
};

export type PostgresTransaction = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];

export const createPostgresDatabase = ({
  url,
  log = () => undefined,
}: {
  readonly url: string;
  readonly log?: LogSink;
}): PostgresDatabase => {
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    lock_timeout: LOCK_TIMEOUT_MS,
    idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });
  const connectionLost = (error: Error) => {
    if (!pool.ending) {
      log({ level: "error", msg: "postgres connection lost", ...errorDetails(error) });
    }
  };
  pool.on("error", () => undefined);
  pool.on("connect", (client) => client.on("error", connectionLost));
  const tallies: Tallies = new AsyncLocalStorage();
  const tallying = talliedPool(tallies, pool);

  return {
    orm: drizzle(tallying),
    ping: async () => {
      await tallying.query("SELECT 1");
    },
    timeQueries: async (run) => {
      const tally = { queries: 0, running: 0, busySince: 0, durationMs: 0 };
      await tallies.run(tally, run);
      return { queries: tally.queries, durationMs: tally.durationMs };
    },
    close: () => pool.end(),
  };
};
