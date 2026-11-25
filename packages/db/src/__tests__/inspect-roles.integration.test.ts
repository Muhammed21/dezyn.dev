import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { inspectRoles } from "../inspect-roles.ts";
import { migrate } from "../migrate.ts";
import { asAdminOn, onClient, urlOf } from "../testing/clients.ts";
import { withThrowawayDatabase } from "../testing/throwaway-database.ts";
import { READ_ONLY_REFUSAL, seedWriteOnRead } from "../testing/write-on-read.ts";

const ROLES = ["migrator", "app", "history_maintainer"];

const seedUser = (connectionString: string) =>
  onClient(connectionString, (client) =>
    client.query('INSERT INTO "identity_user" ("id", "name", "email") VALUES ($1, $2, $3)', [
      randomUUID(),
      "Ada Lovelace",
      "ada@dezyn.test",
    ]),
  );

describe("inspectRoles", () => {
  it("décrit une base saine : aucun rôle privilégié, tout à migrator, l'historique en ajout seul", () =>
    withThrowawayDatabase(async ({ migratorUrl, appUrl }) => {
      await migrate({ connectionString: migratorUrl });
      await seedUser(appUrl);

      const report = await inspectRoles({ connectionString: migratorUrl, roles: ROLES });

      expect(report.privileged).toEqual([]);
      expect(report.foreign).toEqual([]);
      expect(report.history).toEqual(["INSERT"]);
      expect(report.rows["public.identity_user"]).toBe(1);
      expect(report.rows["public.space"]).toBe(0);
      expect(report.rows["drizzle.__drizzle_migrations"]).toBeGreaterThan(0);
    }));

  it("nomme les rôles privilégiés", () =>
    withThrowawayDatabase(async ({ migratorUrl }) => {
      await migrate({ connectionString: migratorUrl });
      const superuser = urlOf("DATABASE_URL_ADMIN").username;

      const report = await inspectRoles({
        connectionString: migratorUrl,
        roles: [...ROLES, superuser],
      });

      expect(report.privileged).toEqual([superuser]);
    }));

  it("nomme les objets de public et de drizzle qui n'appartiennent pas à migrator", () =>
    withThrowawayDatabase(async ({ migratorUrl }) => {
      await migrate({ connectionString: migratorUrl });
      await asAdminOn(migratorUrl, "CREATE SEQUENCE public.hors_de_portee");
      await asAdminOn(migratorUrl, "CREATE SEQUENCE drizzle.hors_de_portee");
      await asAdminOn(migratorUrl, "CREATE SCHEMA ailleurs");
      await asAdminOn(migratorUrl, "CREATE SEQUENCE ailleurs.hors_de_portee");

      const report = await inspectRoles({ connectionString: migratorUrl, roles: ROLES });

      expect(report.foreign).toEqual(["drizzle.hors_de_portee", "public.hors_de_portee"]);
    }));

  it("compte les lignes d'une table que app ne lit pas : migrator lit tout le schéma qu'il possède, app ne suffit pas", () =>
    withThrowawayDatabase(async ({ migratorUrl }) => {
      await migrate({ connectionString: migratorUrl });
      await seedUser(migratorUrl);
      await asAdminOn(migratorUrl, 'REVOKE SELECT ON "identity_user" FROM app');

      const report = await inspectRoles({ connectionString: migratorUrl, roles: ROLES });

      expect(report.rows["public.identity_user"]).toBe(1);
    }));

  it("lit dans une transaction où PostgreSQL refuse toute écriture, même permise à migrator", async () => {
    const writeDuringRead = withThrowawayDatabase(async ({ migratorUrl }) => {
      await migrate({ connectionString: migratorUrl });
      await seedUser(migratorUrl);
      await seedWriteOnRead({
        databaseUrl: migratorUrl,
        readTable: "identity_user",
        reader: "migrator",
        write: `INSERT INTO space (id, name, plan, created_at) VALUES (gen_random_uuid(), 'Atelier', 'free', now())`,
      });
      return inspectRoles({ connectionString: migratorUrl, roles: ROLES });
    });

    await expect(writeDuringRead).rejects.toThrow(READ_ONLY_REFUSAL);
  });
});
