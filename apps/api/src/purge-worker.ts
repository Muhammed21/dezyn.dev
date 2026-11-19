import { createPostgresDatabase } from "#db";
import { historyPurge, PURGE_STATEMENT_TIMEOUT_MS } from "#modules/history/history-module.ts";
import { storageMeterOn } from "#modules/project/project-module.ts";
import { readPurgeWorkerConfig } from "#platform/api-config.ts";
import { createJsonLineSink } from "#platform/json-line-sink.ts";
import { errorDetails, type LogSink } from "#platform/logging.ts";
import { purgeExpiredIdempotencyKeys } from "#platform/postgres-idempotency.ts";
import type { Fetch } from "#platform/resend-mailer.ts";
import { workerMailerOf } from "#platform/worker-mailer.ts";
import { assertSchemaVersion, LATEST_MIGRATION } from "@repo/db";

type ExecutionContext = {
  readonly waitUntil: (promise: Promise<unknown>) => void;
};

type ScheduledController = { readonly cron: string; readonly scheduledTime: number };

type Failure = { readonly error: unknown };

const loggingFailure = async (
  log: LogSink,
  msg: string,
  purge: () => Promise<void>,
): Promise<readonly Failure[]> => {
  try {
    await purge();
    return [];
  } catch (error) {
    log({ level: "error", msg, ...errorDetails(error) });
    return [{ error }];
  }
};

export const createPurgeWorker = ({
  log,
  assertSchema,
  fetch,
}: {
  readonly log: LogSink;
  readonly assertSchema: (databaseUrl: string) => Promise<void>;
  readonly fetch: Fetch;
}) => ({
  scheduled: async (
    _controller: ScheduledController,
    bindings: unknown,
    ctx: ExecutionContext,
  ): Promise<void> => {
    const config = readPurgeWorkerConfig(bindings);
    if (!config.ok) {
      log({ level: "error", msg: "invalid configuration", issues: config.error });
      return;
    }
    try {
      await assertSchema(config.value.databaseUrl);
    } catch (error) {
      log({ level: "error", msg: "schema check failed", ...errorDetails(error) });
      return;
    }
    const db = createPostgresDatabase({
      url: config.value.databaseUrl,
      log,
      statementTimeoutMs: PURGE_STATEMENT_TIMEOUT_MS,
    });
    try {
      const historyFailures = await loggingFailure(log, "history purge failed", async () => {
        const purged = await historyPurge({
          db,
          meterOn: storageMeterOn,
          mailer: workerMailerOf({ ...config.value, fetch, log }),
          log,
        })();
        log({ level: "info", msg: "history_purge_pass", purgedSpaces: purged.length });
      });
      const keyFailures = await loggingFailure(log, "idempotency purge failed", async () => {
        const purgedKeys = await purgeExpiredIdempotencyKeys(db);
        log({ level: "info", msg: "idempotency_purge_pass", purgedKeys });
      });
      const [first] = [...historyFailures, ...keyFailures];
      if (first !== undefined) {
        throw first.error;
      }
    } finally {
      ctx.waitUntil(db.close());
    }
  },
});

export default createPurgeWorker({
  log: createJsonLineSink({ write: (line) => console.log(line.trimEnd()), now: () => new Date() }),
  assertSchema: (databaseUrl) =>
    assertSchemaVersion({ connectionString: databaseUrl, migration: LATEST_MIGRATION }),
  fetch: (url, init) => fetch(url, init),
});
