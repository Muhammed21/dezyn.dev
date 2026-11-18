import { rejectedStatements } from "./rejected-statements.ts";

export type MigrationFinding = {
  readonly path: string;
  readonly kind: "non-additive" | "modified" | "deleted";
  readonly statements: readonly string[];
};

const MIGRATION_FILE = /^packages\/db\/migrations\/[^/]+\.sql$/;

const findingOf = (
  { status, path }: { readonly status: string; readonly path: string },
  read: (path: string) => string,
): readonly MigrationFinding[] => {
  if (status === "D") return [{ path, kind: "deleted", statements: [] }];
  if (status !== "A") return [{ path, kind: "modified", statements: [] }];
  const statements = rejectedStatements(read(path));
  return statements.length === 0 ? [] : [{ path, kind: "non-additive", statements }];
};

export const migrationFindings = ({
  nameStatus,
  read,
}: {
  readonly nameStatus: string;
  readonly read: (path: string) => string;
}): readonly MigrationFinding[] =>
  nameStatus
    .split("\n")
    .map((line) => {
      const [status = "", path = ""] = line.split("\t");
      return { status, path };
    })
    .filter(({ path }) => MIGRATION_FILE.test(path))
    .flatMap((change) => findingOf(change, read));
