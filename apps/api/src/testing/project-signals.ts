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

export const makeProposalSignalRecorder = () => {
  const state: { db?: PostgresDatabase; received: RecordedSignal[] } = { received: [] };
  return {
    state,
    signals: {
      signalAt: async () => undefined,
      changed: async (signal: Signal) => {
        if (!signal.topics.includes("proposals")) {
          return;
        }
        state.received.push({
          projectId: signal.projectId,
          topics: ["proposals"],
          pending: state.db === undefined ? undefined : await pendingCountOf(state.db),
        });
      },
    },
    since: (mark: number) => state.received.slice(mark),
  };
};

type ScheduledSignal = Signal & { readonly key: string; readonly at: Date };

export const makeAllSignalsRecorder = () => {
  const received: Signal[] = [];
  const scheduled: ScheduledSignal[] = [];
  return {
    received,
    scheduled,
    signals: {
      changed: async (signal: Signal) => {
        received.push(signal);
      },
      signalAt: async (signal: ScheduledSignal) => {
        scheduled.push(signal);
      },
    },
    since: (mark: number) => received.slice(mark),
  };
};
