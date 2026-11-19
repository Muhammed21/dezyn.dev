import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { rejectedStatements } from "../rejected-statements.ts";

const MIGRATIONS = new URL("../../../migrations/", import.meta.url);

const readMigration = (file: string): string => readFileSync(new URL(file, MIGRATIONS), "utf8");

const NON_ADDITIVE_MIGRATIONS = [
  "0005_history.sql",
  "0011_proposal_position.sql",
  "0020_history_entry_stored_size.sql",
];

const additiveMigrations = readdirSync(MIGRATIONS).filter(
  (file) => file.endsWith(".sql") && !NON_ADDITIVE_MIGRATIONS.includes(file),
);

describe("rejectedStatements sur les migrations du dépôt", () => {
  it.each(additiveMigrations)("accepte %s, purement additive", (file) => {
    expect(rejectedStatements(readMigration(file))).toEqual([]);
  });

  it("refuse le REVOKE de 0005_history.sql et rien d'autre", () => {
    expect(rejectedStatements(readMigration("0005_history.sql"))).toEqual([
      `REVOKE UPDATE, DELETE, TRUNCATE ON "history_entry" FROM app`,
    ]);
  });

  it("refuse le remplissage et la contrainte de 0011_proposal_position.sql, pas l'ajout de la colonne", () => {
    expect(rejectedStatements(readMigration("0011_proposal_position.sql"))).toEqual([
      `UPDATE "proposal" SET "position" = "ordered"."rank" FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS "rank" FROM "proposal") AS "ordered" WHERE "proposal"."id" = "ordered"."id"`,
      `ALTER TABLE "proposal" ALTER COLUMN "position" SET NOT NULL`,
      `ALTER TABLE "proposal" ALTER COLUMN "position" ADD GENERATED ALWAYS AS IDENTITY (sequence name "proposal_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1)`,
      `SELECT setval('"proposal_position_seq"', coalesce(max("position"), 0) + 1, false) FROM "proposal"`,
    ]);
  });

  it("refuse les fonctions, le trigger, le remplissage et la contrainte de 0020_history_entry_stored_size.sql, pas l'ajout de la colonne", () => {
    expect(rejectedStatements(readMigration("0020_history_entry_stored_size.sql"))).toEqual([
      expect.stringMatching(/^CREATE FUNCTION history_entry_json_length\(value jsonb\)/),
      expect.stringMatching(/^CREATE FUNCTION history_entry_stored_size\(entry "history_entry"\)/),
      "CREATE FUNCTION history_entry_fill_stored_size() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.stored_size := history_entry_stored_size(NEW)",
      "RETURN NEW",
      "END",
      "$$",
      `CREATE TRIGGER history_entry_fill_stored_size BEFORE INSERT ON "history_entry" FOR EACH ROW WHEN (NEW.stored_size IS NULL) EXECUTE FUNCTION history_entry_fill_stored_size()`,
      `UPDATE "history_entry" SET "stored_size" = history_entry_stored_size("history_entry")`,
      `ALTER TABLE "history_entry" ALTER COLUMN "stored_size" SET NOT NULL`,
    ]);
  });

  it("refuse la suppression d'une colonne ajoutée à 0014_identity_rate_limit.sql", () => {
    const sql = `${readMigration("0014_identity_rate_limit.sql")}--> statement-breakpoint\nALTER TABLE "identity_user" DROP COLUMN "image";`;

    expect(rejectedStatements(sql)).toEqual([`ALTER TABLE "identity_user" DROP COLUMN "image"`]);
  });
});
