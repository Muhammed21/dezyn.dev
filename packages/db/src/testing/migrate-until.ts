import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as applyMigrations } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import type { Journal } from "../schema-version/latest-migration.ts";

const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));

const writeMigrationsUntil = async (journal: Journal, tag: string): Promise<string> => {
  const last = journal.entries.findIndex((entry) => entry.tag === tag);
  if (last === -1) {
    throw new Error(`Migration inconnue : ${tag}`);
  }
  const kept = journal.entries.slice(0, last + 1);
  const folder = await mkdtemp(join(tmpdir(), "dezyn-migrations-"));
  await mkdir(join(folder, "meta"));
  await writeFile(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: kept }),
  );
  await Promise.all(
    kept.map((entry) =>
      copyFile(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`)),
    ),
  );
  return folder;
};

export const migrateUntil = async ({
  connectionString,
  tag,
}: {
  readonly connectionString: string;
  readonly tag: string;
}): Promise<void> => {
  const folder = await writeMigrationsUntil(
    JSON.parse(await readFile(join(MIGRATIONS, "meta", "_journal.json"), "utf8")),
    tag,
  );
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await applyMigrations(drizzle(client), { migrationsFolder: folder });
  } finally {
    await client.end();
    await rm(folder, { recursive: true, force: true });
  }
};
