import { describe, expect, it } from "vitest";

import { LATEST_MIGRATION } from "../../generated/latest-migration.ts";
import { migrate } from "../../migrate.ts";
import { assertSchemaVersion } from "../../schema-version/assert-schema-version.ts";
import { onClient, urlOf } from "../clients.ts";
import { createMigratedDatabase, withThrowawayDatabase } from "../throwaway-database.ts";

const CATALOG = `
  SELECT 'column' AS kind, table_schema || '.' || table_name || '.' || column_name || ' ' || data_type AS entry
    FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  UNION ALL
  SELECT 'grant', grantee || ' ' || privilege_type || ' ' || table_schema || '.' || table_name
    FROM information_schema.table_privileges WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  UNION ALL
  SELECT 'routine', routine_schema || '.' || routine_name
    FROM information_schema.routines WHERE routine_schema NOT IN ('pg_catalog', 'information_schema')
  UNION ALL
  SELECT 'policy', schemaname || '.' || tablename || '.' || policyname || ' ' || roles::text
    FROM pg_policies
  UNION ALL
  SELECT 'default acl', defaclrole::regrole::text || ' ' || defaclobjtype::text || ' ' || defaclacl::text
    FROM pg_default_acl
  UNION ALL
  SELECT 'migration', hash || ' ' || created_at FROM drizzle.__drizzle_migrations
  ORDER BY 1, 2`;

const catalogOf = (url: string) =>
  onClient(
    url,
    async (client) => (await client.query<{ kind: string; entry: string }>(CATALOG)).rows,
  );

const countOn = (url: string, sql: string) =>
  onClient(url, async (client) => Number((await client.query<{ n: string }>(sql)).rows[0]?.n));

const databaseExists = (url: string, name: string) =>
  countOn(url, `SELECT count(*) AS n FROM pg_database WHERE datname = '${name}'`);

describe("createMigratedDatabase clone une base modèle migrée une seule fois", () => {
  it("rend une base au schéma, aux droits et aux migrations d'une base migrée de zéro", async () => {
    const clone = await createMigratedDatabase();
    try {
      await withThrowawayDatabase(async (fresh) => {
        await migrate({ connectionString: fresh.migratorUrl });

        expect(await catalogOf(clone.migratorUrl)).toEqual(await catalogOf(fresh.migratorUrl));
      });
    } finally {
      await clone.drop();
    }
  });

  it("isole chaque clone : une écriture dans l'un n'apparaît ni dans l'autre ni dans le modèle suivant", async () => {
    const [first, second] = await Promise.all([createMigratedDatabase(), createMigratedDatabase()]);
    try {
      await onClient(first.appUrl, (client) =>
        client.query(
          `INSERT INTO identity_user (id, name, email) VALUES (gen_random_uuid(), 'Isolé', 'isole@dezyn.test')`,
        ),
      );
      const third = await createMigratedDatabase();
      try {
        expect(await countOn(first.appUrl, `SELECT count(*) AS n FROM identity_user`)).toBe(1);
        expect(await countOn(second.appUrl, `SELECT count(*) AS n FROM identity_user`)).toBe(0);
        expect(await countOn(third.appUrl, `SELECT count(*) AS n FROM identity_user`)).toBe(0);
      } finally {
        await third.drop();
      }
    } finally {
      await Promise.all([first.drop(), second.drop()]);
    }
  });

  it("ouvre le clone à app et history_maintainer, et drop le supprime", async () => {
    const clone = await createMigratedDatabase();
    const name = new URL(clone.migratorUrl).pathname.slice(1);

    expect(await countOn(clone.appUrl, "SELECT 1 AS n")).toBe(1);
    expect(await countOn(clone.maintainerUrl, "SELECT 1 AS n")).toBe(1);

    await clone.drop();

    expect(await databaseExists(urlOf("DATABASE_URL_MIGRATOR").toString(), name)).toBe(0);
  });

  it("rend des clones à jour sous des créations simultanées", async () => {
    const clones = await Promise.all(Array.from({ length: 6 }, () => createMigratedDatabase()));
    try {
      await Promise.all(
        clones.map((clone) =>
          expect(
            assertSchemaVersion({ connectionString: clone.appUrl, migration: LATEST_MIGRATION }),
          ).resolves.toBeUndefined(),
        ),
      );
    } finally {
      await Promise.all(clones.map((clone) => clone.drop()));
    }
  });
});
