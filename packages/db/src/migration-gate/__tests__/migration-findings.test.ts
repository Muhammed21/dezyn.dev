import { describe, expect, it } from "vitest";

import { migrationFindings } from "../migration-findings.ts";

const ADDED_TABLE = `CREATE TABLE "palette" ("id" uuid PRIMARY KEY NOT NULL);`;
const DROPPED_COLUMN = `ALTER TABLE "token" DROP COLUMN "description";`;

const makeReader =
  (files: Readonly<Record<string, string>>) =>
  (path: string): string =>
    files[path] ?? "";

describe("migrationFindings", () => {
  it("ne retient rien d'une PR qui ajoute une table", () => {
    const path = "packages/db/migrations/0017_palette.sql";

    expect(
      migrationFindings({
        nameStatus: `A\t${path}\n`,
        read: makeReader({ [path]: ADDED_TABLE }),
      }),
    ).toEqual([]);
  });

  it("retient la modification d'une migration déjà présente sur main, même additive", () => {
    const path = "packages/db/migrations/0014_identity_rate_limit.sql";

    expect(
      migrationFindings({
        nameStatus: `M\t${path}\n`,
        read: makeReader({ [path]: ADDED_TABLE }),
      }),
    ).toEqual([{ path, kind: "modified", statements: [] }]);
  });

  it("retient la suppression d'une migration déjà présente sur main", () => {
    const path = "packages/db/migrations/0014_identity_rate_limit.sql";

    expect(migrationFindings({ nameStatus: `D\t${path}\n`, read: makeReader({}) })).toEqual([
      { path, kind: "deleted", statements: [] },
    ]);
  });

  it("ignore le journal et les snapshots Drizzle, et les fichiers hors des migrations", () => {
    const nameStatus = [
      "M\tpackages/db/migrations/meta/_journal.json",
      "A\tpackages/db/migrations/meta/0017_snapshot.json",
      "M\tpackages/db/src/schema/token.ts",
      "A\tdocs/notes.sql",
      "A\tpackages/db/migrations/README.md",
      "A\tpackages/db/migrations/0017_palette.sql.orig",
      "A\tapps/api/packages/db/migrations/0017_palette.sql",
    ].join("\n");
    const read = makeReader({
      "docs/notes.sql": DROPPED_COLUMN,
      "packages/db/migrations/0017_palette.sql.orig": DROPPED_COLUMN,
      "apps/api/packages/db/migrations/0017_palette.sql": DROPPED_COLUMN,
    });

    expect(migrationFindings({ nameStatus, read })).toEqual([]);
  });

  it("retient l'instruction non additive d'une migration ajoutée", () => {
    const path = "packages/db/migrations/0017_token_description.sql";

    expect(
      migrationFindings({
        nameStatus: `A\t${path}\n`,
        read: makeReader({ [path]: DROPPED_COLUMN }),
      }),
    ).toEqual([
      {
        path,
        kind: "non-additive",
        statements: [`ALTER TABLE "token" DROP COLUMN "description"`],
      },
    ]);
  });
});
