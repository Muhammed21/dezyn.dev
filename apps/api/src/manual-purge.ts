import type { createPostgresDatabase } from "#db";
import { historyPurge, PURGE_STATEMENT_TIMEOUT_MS } from "#modules/history/history-module.ts";
import { storageMeterOn } from "#modules/project/project-module.ts";
import { orphanSpacePurge } from "#modules/space/space-module.ts";
import { readPurgeConfig } from "#platform/api-config.ts";
import type { LogSink } from "#platform/logging.ts";
import { purgeExpiredIdempotencyKeys } from "#platform/postgres-idempotency.ts";
import { createSmtpMailer } from "#platform/smtp-mailer.ts";

export const runManualPurge = async ({
  env,
  log,
  openDatabase,
  print,
}: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: LogSink;
  readonly openDatabase: typeof createPostgresDatabase;
  readonly print: (output: string) => void;
}): Promise<void> => {
  const config = readPurgeConfig(env);
  if (!config.ok) {
    throw new Error(
      [
        "Configuration invalide, voir .env.example :",
        ...config.error.map((issue) => `- ${issue}`),
      ].join("\n"),
    );
  }
  const mailer = createSmtpMailer({ ...config.value.smtp, log });
  const db = openDatabase({
    url: config.value.databaseUrl,
    log,
    statementTimeoutMs: PURGE_STATEMENT_TIMEOUT_MS,
  });
  try {
    const purged = await historyPurge({ db, meterOn: storageMeterOn, mailer, log })();
    const purgedKeys = await purgeExpiredIdempotencyKeys(db);
    const orphans = await orphanSpacePurge({ db })();
    print(JSON.stringify({ purged, purgedKeys, orphans }, null, 2));
  } finally {
    await db.close();
  }
};
