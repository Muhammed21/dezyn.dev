import { sql } from "drizzle-orm";

import type { PostgresDatabase } from "#db";

type Signal = { readonly projectId: string; readonly topics: readonly string[] };

type RecordedSignal = Signal & { readonly pending?: number };

const pendingCountOf = async (db: PostgresDatabase) => {
  const { rows } = await db.orm.execute<{ count: number }>(
    sql`select count(*)::int as count from proposal where status = 'proposed'`,
  );
  return rows[0]?.count;
};

export const makeSignalRecorder = () => {
  const state: { db?: PostgresDatabase; received: RecordedSignal[] } = { received: [] };
  return {
    state,
    signals: {
      changed: async (signal: Signal) => {
        state.received.push({
          ...signal,
          pending: state.db === undefined ? undefined : await pendingCountOf(state.db),
        });
      },
    },
    since: (mark: number) => state.received.slice(mark),
  };
};
