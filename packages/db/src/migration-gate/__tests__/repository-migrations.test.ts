import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { rejectedStatements } from "../rejected-statements.ts";

const MIGRATIONS = new URL("../../../migrations/", import.meta.url);

const readMigration = (file: string): string => readFileSync(new URL(file, MIGRATIONS), "utf8");

const ELEVATED_PRIVILEGE_MIGRATIONS: Readonly<Record<string, readonly string[]>> = {
  "0001_identity.sql": [
    `GRANT SELECT, INSERT, UPDATE, DELETE ON "identity_user", "identity_session", "identity_account", "identity_verification" TO app`,
  ],
  "0002_oauth.sql": [
    `GRANT SELECT, INSERT, UPDATE, DELETE ON "identity_jwks", "identity_oauth_access_token", "identity_oauth_client", "identity_oauth_client_assertion", "identity_oauth_client_resource", "identity_oauth_consent", "identity_oauth_refresh_token", "identity_oauth_resource" TO app`,
  ],
  "0003_space.sql": [`GRANT SELECT, INSERT, UPDATE ON "space", "space_member" TO app`],
  "0004_space_invitation.sql": [`GRANT SELECT, INSERT, UPDATE ON "space_invitation" TO app`],
  "0006_history_maintainer.sql": [`GRANT SELECT, DELETE ON "history_entry" TO history_maintainer`],
  "0008_proposal.sql": [
    `GRANT UPDATE ("status") ON "proposal" TO app`,
    `GRANT UPDATE ("state", "last_written_at") ON "proposal_batch" TO app`,
    `GRANT UPDATE ("description") ON "token" TO app`,
    `GRANT DELETE ON "token_value" TO app`,
  ],
  "0009_token_figma_state.sql": [
    `GRANT SELECT, INSERT, UPDATE ("state", "figma_variables", "rejected_value", "declared_at", "user_id", "client_id", "proposal_id") ON "token_figma_state" TO app`,
  ],
  "0012_token_extensions.sql": [`GRANT UPDATE ("extensions") ON "token" TO app`],
  "0013_storage_meter.sql": [`GRANT UPDATE ("stored_bytes") ON "project" TO app`],
  "0014_identity_rate_limit.sql": [
    `GRANT SELECT, INSERT, UPDATE, DELETE ON "identity_rate_limit" TO app`,
  ],
  "0015_history_purge.sql": [
    `GRANT UPDATE ("stored_bytes", "history_purged_before", "history_purged_at") ON "project" TO history_maintainer`,
  ],
  "0017_idempotency_key.sql": [`GRANT SELECT, INSERT, UPDATE ON "idempotency_key" TO app`],
  "0018_idempotency_key_release.sql": [`GRANT DELETE ON "idempotency_key" TO app`],
  "0019_idempotency_key_purge.sql": [
    `GRANT SELECT ("created_at"), DELETE ON "idempotency_key" TO history_maintainer`,
  ],
  "0022_space_subscription.sql": [`GRANT SELECT, INSERT, UPDATE ON "space_subscription" TO app`],
  "0027_orphan_space_purge.sql": [
    `GRANT SELECT ("current_period_end", "cancel_requested_at"), DELETE ON "space_subscription" TO history_maintainer`,
    `GRANT DELETE ON "space", "space_member", "project" TO history_maintainer`,
    `GRANT SELECT ("space_id"), DELETE ON "space_invitation", "space_plan_change", "history_author" TO history_maintainer`,
    `GRANT SELECT ("id", "project_id"), DELETE ON "token", "modifier" TO history_maintainer`,
    `GRANT SELECT ("token_id"), DELETE ON "token_value", "token_figma_state" TO history_maintainer`,
    `GRANT SELECT ("modifier_id"), DELETE ON "mode" TO history_maintainer`,
    `GRANT SELECT ("project_id"), DELETE ON "proposal", "proposal_batch" TO history_maintainer`,
  ],
  "0028_orphan_space_invitations.sql": [`GRANT DELETE ON "space_invitation" TO app`],
  "0029_space_refused_subscription.sql": [
    `GRANT SELECT, INSERT, UPDATE ("revoked_at", "refunded_at", "settling_since") ON "space_refused_subscription" TO app`,
  ],
};

const NON_ADDITIVE_MIGRATIONS = [
  "0005_history.sql",
  "0011_proposal_position.sql",
  "0020_history_entry_stored_size.sql",
  "0021_history_entry_stored_size_trigger_removal.sql",
  "0026_account_deletion.sql",
  ...Object.keys(ELEVATED_PRIVILEGE_MIGRATIONS),
];

const additiveMigrations = readdirSync(MIGRATIONS).filter(
  (file) => file.endsWith(".sql") && !NON_ADDITIVE_MIGRATIONS.includes(file),
);

describe("rejectedStatements sur les migrations du dépôt", () => {
  it.each(additiveMigrations)("accepte %s, purement additive", (file) => {
    expect(rejectedStatements(readMigration(file))).toEqual([]);
  });

  it.each(Object.entries(ELEVATED_PRIVILEGE_MIGRATIONS))(
    "demande l'approbation des droits de modifier ou de supprimer accordés par %s, et de rien d'autre",
    (file, grants) => {
      expect(rejectedStatements(readMigration(file))).toEqual(grants);
    },
  );

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
      expect.stringMatching(
        /^CREATE FUNCTION history_entry_json_length\(value jsonb\) RETURNS integer LANGUAGE sql IMMUTABLE STRICT AS \$\$ SELECT .+\)::integer \$\$$/,
      ),
      expect.stringMatching(
        /^CREATE FUNCTION history_entry_stored_size\(entry "history_entry"\) RETURNS integer LANGUAGE sql STABLE AS \$\$ SELECT 115 .+ \+ 26 \$\$$/,
      ),
      "CREATE FUNCTION history_entry_fill_stored_size() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.stored_size := history_entry_stored_size(NEW); RETURN NEW; END; $$",
      `CREATE TRIGGER history_entry_fill_stored_size BEFORE INSERT ON "history_entry" FOR EACH ROW WHEN (NEW.stored_size IS NULL) EXECUTE FUNCTION history_entry_fill_stored_size()`,
      `UPDATE "history_entry" SET "stored_size" = history_entry_stored_size("history_entry")`,
      `ALTER TABLE "history_entry" ALTER COLUMN "stored_size" SET NOT NULL`,
    ]);
  });

  it("refuse la suppression du trigger et des fonctions de 0021_history_entry_stored_size_trigger_removal.sql", () => {
    expect(
      rejectedStatements(readMigration("0021_history_entry_stored_size_trigger_removal.sql")),
    ).toEqual([
      `DROP TRIGGER history_entry_fill_stored_size ON "history_entry"`,
      "DROP FUNCTION history_entry_fill_stored_size()",
      `DROP FUNCTION history_entry_stored_size("history_entry")`,
      "DROP FUNCTION history_entry_json_length(jsonb)",
    ]);
  });

  it("refuse les clés étrangères refaites, les colonnes rendues nullables et le droit de modifier de 0026_account_deletion.sql", () => {
    const rejected = rejectedStatements(readMigration("0026_account_deletion.sql"));

    expect(rejected).toHaveLength(23);
    expect(rejected).toContain(
      `ALTER TABLE "space_subscription" ALTER COLUMN "payer_id" DROP NOT NULL`,
    );
    expect(rejected.filter((statement) => statement.includes("DROP CONSTRAINT"))).toHaveLength(9);
    expect(rejected.filter((statement) => statement.startsWith("GRANT"))).toEqual([
      `GRANT UPDATE ("user_id", "deleted_member_number") ON "history_author" TO app`,
    ]);
  });

  it("refuse la suppression d'une colonne ajoutée à 0014_identity_rate_limit.sql", () => {
    const sql = `${readMigration("0014_identity_rate_limit.sql")}--> statement-breakpoint\nALTER TABLE "identity_user" DROP COLUMN "image";`;

    expect(rejectedStatements(sql)).toEqual([
      ...(ELEVATED_PRIVILEGE_MIGRATIONS["0014_identity_rate_limit.sql"] ?? []),
      `ALTER TABLE "identity_user" DROP COLUMN "image"`,
    ]);
  });
});
