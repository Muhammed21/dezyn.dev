import { createPostgresDatabase } from "#db";
import { historyPurge, PURGE_STATEMENT_TIMEOUT_MS } from "#modules/history/history-module.ts";
import { storageMeterOn } from "#modules/project/project-module.ts";
import { readPurgeConfig } from "#platform/api-config.ts";
import { createJsonLineSink } from "#platform/json-line-sink.ts";
import { purgeExpiredIdempotencyKeys } from "#platform/postgres-idempotency.ts";
import { createSmtpMailer } from "#platform/smtp-mailer.ts";

const config = readPurgeConfig(process.env);
if (!config.ok) {
  throw new Error(
    [
      "Configuration invalide, voir .env.example :",
      ...config.error.map((issue) => `- ${issue}`),
    ].join("\n"),
  );
}

const log = createJsonLineSink({
  write: (line) => process.stderr.write(line),
  now: () => new Date(),
});
const mailer = createSmtpMailer({ ...config.value.smtp, log });
const db = createPostgresDatabase({
  url: config.value.databaseUrl,
  log,
  statementTimeoutMs: PURGE_STATEMENT_TIMEOUT_MS,
});
try {
  const purged = await historyPurge({ db, meterOn: storageMeterOn, mailer, log })();
  const purgedKeys = await purgeExpiredIdempotencyKeys(db);
  console.log(JSON.stringify({ purged, purgedKeys }, null, 2));
} finally {
  await db.close();
}
