import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import { migrate } from "../migrate.ts";
import { urlOf } from "./clients.ts";

export { migrateUntil } from "./migrate-until.ts";

const onDatabase = (url: URL, database: string): string => {
  const copy = new URL(url);
  copy.pathname = `/${database}`;
  return copy.toString();
};

const asMigratorQuery = async <T>(run: (client: Client) => Promise<T>): Promise<T> => {
  const client = new Client({ connectionString: urlOf("DATABASE_URL_MIGRATOR").toString() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
};

const asMigrator = (run: (client: Client) => Promise<void>): Promise<void> => asMigratorQuery(run);

const RETRY_TIMEOUT_MS = 5_000;
const RETRY_MS = 20;
const INSUFFICIENT_PRIVILEGE = "42501";
const OBJECT_IN_USE = "55006";
const DUPLICATE_DATABASE = "42P04";

const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

const retryWhile = async (
  code: string,
  run: () => Promise<unknown>,
  deadline: number = Date.now() + RETRY_TIMEOUT_MS,
): Promise<void> => {
  try {
    await run();
  } catch (error) {
    if (!hasCode(error, code) || Date.now() >= deadline) {
      throw error;
    }
    await sleep(RETRY_MS);
    await retryWhile(code, run, deadline);
  }
};

const dropOnceAppBackendsLeave = (client: Client, database: string): Promise<void> =>
  retryWhile(INSUFFICIENT_PRIVILEGE, () => client.query(`DROP DATABASE ${database} WITH (FORCE)`));

const shortId = () => randomUUID().replaceAll("-", "").slice(0, 12);

export type ThrowawayDatabase = {
  readonly migratorUrl: string;
  readonly appUrl: string;
  readonly maintainerUrl: string;
  readonly drop: () => Promise<void>;
};

const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));

const migrationsDigest = async (): Promise<string> => {
  const files = (await readdir(MIGRATIONS)).filter((file) => file.endsWith(".sql")).toSorted();
  const contents = await Promise.all(
    [join("meta", "_journal.json"), ...files].map(async (file) => [
      file,
      await readFile(join(MIGRATIONS, file), "utf8"),
    ]),
  );
  return createHash("sha256").update(JSON.stringify(contents)).digest("hex").slice(0, 16);
};

const publishTemplate = async (template: string): Promise<void> => {
  const building = `${template}_${shortId().slice(0, 8)}`;
  await asMigrator((client) => client.query(`CREATE DATABASE ${building}`).then(() => undefined));
  try {
    await migrate({ connectionString: onDatabase(urlOf("DATABASE_URL_MIGRATOR"), building) });
    await asMigrator(async (client) => {
      await retryWhile(OBJECT_IN_USE, () =>
        client.query(`ALTER DATABASE ${building} WITH ALLOW_CONNECTIONS false`),
      );
      await retryWhile(OBJECT_IN_USE, () =>
        client.query(`ALTER DATABASE ${building} RENAME TO ${template}`),
      );
    });
  } catch (error) {
    await asMigrator((client) => dropOnceAppBackendsLeave(client, building));
    if (!hasCode(error, DUPLICATE_DATABASE)) {
      throw error;
    }
  }
};

const ensureTemplate = async (): Promise<string> => {
  const template = `dezyn_template_${await migrationsDigest()}`;
  const exists = await asMigratorQuery(
    async (client) =>
      (await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [template])).rowCount ===
      1,
  );
  if (!exists) {
    await publishTemplate(template);
  }
  return template;
};

const templates = new Map<"migrated", Promise<string>>();

const migratedTemplate = (): Promise<string> => {
  const pending = templates.get("migrated") ?? ensureTemplate();
  templates.set("migrated", pending);
  pending.catch(() => templates.delete("migrated"));
  return pending;
};

const createDatabase = async (template?: string): Promise<ThrowawayDatabase> => {
  const database = `dezyn_test_${shortId()}`;
  await asMigrator(async (client) => {
    await client.query(
      template === undefined
        ? `CREATE DATABASE ${database}`
        : `CREATE DATABASE ${database} TEMPLATE ${template}`,
    );
    await client.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO app`);
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO history_maintainer`);
  });

  return {
    migratorUrl: onDatabase(urlOf("DATABASE_URL_MIGRATOR"), database),
    appUrl: onDatabase(urlOf("DATABASE_URL"), database),
    maintainerUrl: onDatabase(urlOf("DATABASE_URL_HISTORY_MAINTAINER"), database),
    drop: () => asMigrator((client) => dropOnceAppBackendsLeave(client, database)),
  };
};

export const createThrowawayDatabase = (): Promise<ThrowawayDatabase> => createDatabase();

export const createMigratedDatabase = async (): Promise<ThrowawayDatabase> =>
  createDatabase(await migratedTemplate());

export const withThrowawayDatabase = async <T>(
  run: (database: ThrowawayDatabase) => Promise<T>,
): Promise<T> => {
  const database = await createThrowawayDatabase();
  try {
    return await run(database);
  } finally {
    await database.drop();
  }
};
