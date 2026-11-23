import { describe, expect, it } from "vitest";

import {
  type PullRequestFile,
  migrationFindings,
  pullRequestFiles,
} from "../migration-findings.ts";

const ADDED_TABLE = `CREATE TABLE "palette" ("id" uuid PRIMARY KEY NOT NULL);`;
const DROPPED_COLUMN = `ALTER TABLE "token" DROP COLUMN "description";`;

const makeFile = (overrides: Partial<PullRequestFile> = {}): PullRequestFile => ({
  status: "added",
  filename: "packages/db/migrations/0017_palette.sql",
  previousFilename: "",
  ...overrides,
});

const makeReader =
  (files: Readonly<Record<string, string>>) =>
  (path: string): string =>
    files[path] ?? "";

describe("migrationFindings", () => {
  it("ne retient rien d'une PR qui ajoute une table", () => {
    const path = "packages/db/migrations/0017_palette.sql";

    expect(
      migrationFindings({
        files: [makeFile({ filename: path })],
        read: makeReader({ [path]: ADDED_TABLE }),
      }),
    ).toEqual([]);
  });

  it("retient la modification d'une migration déjà présente sur main, même additive", () => {
    const path = "packages/db/migrations/0014_identity_rate_limit.sql";

    expect(
      migrationFindings({
        files: [makeFile({ status: "modified", filename: path })],
        read: makeReader({ [path]: ADDED_TABLE }),
      }),
    ).toEqual([{ path, kind: "modified", statements: [] }]);
  });

  it("retient la suppression d'une migration déjà présente sur main", () => {
    const path = "packages/db/migrations/0014_identity_rate_limit.sql";

    expect(
      migrationFindings({
        files: [makeFile({ status: "removed", filename: path })],
        read: makeReader({}),
      }),
    ).toEqual([{ path, kind: "deleted", statements: [] }]);
  });

  it("ignore le journal et les snapshots Drizzle, et les fichiers hors des migrations", () => {
    const files = [
      makeFile({ status: "modified", filename: "packages/db/migrations/meta/_journal.json" }),
      makeFile({ filename: "packages/db/migrations/meta/0017_snapshot.json" }),
      makeFile({ status: "modified", filename: "packages/db/src/schema/token.ts" }),
      makeFile({ filename: "docs/notes.sql" }),
      makeFile({ filename: "packages/db/migrations/README.md" }),
      makeFile({ filename: "packages/db/migrations/0017_palette.sql.orig" }),
      makeFile({ filename: "apps/api/packages/db/migrations/0017_palette.sql" }),
    ];
    const read = makeReader({
      "docs/notes.sql": DROPPED_COLUMN,
      "packages/db/migrations/0017_palette.sql.orig": DROPPED_COLUMN,
      "apps/api/packages/db/migrations/0017_palette.sql": DROPPED_COLUMN,
    });

    expect(migrationFindings({ files, read })).toEqual([]);
  });

  it("retient l'instruction non additive d'une migration ajoutée", () => {
    const path = "packages/db/migrations/0017_token_description.sql";

    expect(
      migrationFindings({
        files: [makeFile({ filename: path })],
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

  it("traite une migration renommée comme la suppression de l'ancienne et l'ajout de la nouvelle", () => {
    const path = "packages/db/migrations/0018_palette.sql";
    const previous = "packages/db/migrations/0014_identity_rate_limit.sql";

    expect(
      migrationFindings({
        files: [makeFile({ status: "renamed", filename: path, previousFilename: previous })],
        read: makeReader({ [path]: DROPPED_COLUMN }),
      }),
    ).toEqual([
      { path: previous, kind: "deleted", statements: [] },
      {
        path,
        kind: "non-additive",
        statements: [`ALTER TABLE "token" DROP COLUMN "description"`],
      },
    ]);
  });

  it("analyse une migration copiée comme une migration ajoutée", () => {
    const path = "packages/db/migrations/0018_copy.sql";

    expect(
      migrationFindings({
        files: [makeFile({ status: "copied", filename: path })],
        read: makeReader({ [path]: ADDED_TABLE }),
      }),
    ).toEqual([]);
  });

  it.each(["changed", "unchanged", "inconnu"])(
    "retient comme modifiée une migration de statut « %s »",
    (status) => {
      const path = "packages/db/migrations/0014_identity_rate_limit.sql";

      expect(
        migrationFindings({
          files: [makeFile({ status, filename: path })],
          read: makeReader({ [path]: ADDED_TABLE }),
        }),
      ).toEqual([{ path, kind: "modified", statements: [] }]);
    },
  );
});

describe("pullRequestFiles", () => {
  it("lit les fichiers de la PR sortis en TSV par l'API des fichiers de la PR", () => {
    const tsv = [
      "added\tpackages/db/migrations/0017_palette.sql\t",
      "renamed\tpackages/db/migrations/0018_b.sql\tpackages/db/migrations/0014_a.sql",
      "",
    ].join("\n");

    expect(pullRequestFiles(tsv)).toEqual([
      makeFile(),
      makeFile({
        status: "renamed",
        filename: "packages/db/migrations/0018_b.sql",
        previousFilename: "packages/db/migrations/0014_a.sql",
      }),
    ]);
  });

  it("refuse une ligne mal formée plutôt que d'oublier un fichier", () => {
    expect(() => pullRequestFiles("removed\tpackages/db/migrations/0014_a.sql")).toThrow(
      "Fichier de PR illisible : removed\tpackages/db/migrations/0014_a.sql",
    );
    expect(() => pullRequestFiles("x\tremoved\tpackages/db/migrations/0014_a.sql\t")).toThrow(
      "Fichier de PR illisible",
    );
    expect(() => pullRequestFiles("Removed\tpackages/db/migrations/0014_a.sql\t")).toThrow(
      "Fichier de PR illisible",
    );
    expect(() => pullRequestFiles("removed\t\t")).toThrow("Fichier de PR illisible");
  });

  it("ne lit rien d'une sortie vide", () => {
    expect(pullRequestFiles("")).toEqual([]);
  });
});
