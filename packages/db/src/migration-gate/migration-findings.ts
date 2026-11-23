import { rejectedStatements } from "./rejected-statements.ts";

export type PullRequestFile = {
  readonly status: string;
  readonly filename: string;
  readonly previousFilename: string;
};

export type MigrationFinding = {
  readonly path: string;
  readonly kind: "non-additive" | "modified" | "deleted";
  readonly statements: readonly string[];
};

type Change = { readonly kind: "added" | "deleted" | "modified"; readonly path: string };

const MIGRATION_FILE = /^packages\/db\/migrations\/[^/]+\.sql$/;
const FILE_LINE = /^([a-z]+)\t([^\t]+)\t([^\t]*)$/;
const ADDED = new Set(["added", "copied"]);

const changesOf = ({ status, filename, previousFilename }: PullRequestFile): readonly Change[] => {
  if (status === "renamed") {
    return [
      { kind: "deleted", path: previousFilename },
      { kind: "added", path: filename },
    ];
  }
  if (status === "removed") return [{ kind: "deleted", path: filename }];
  return [{ kind: ADDED.has(status) ? "added" : "modified", path: filename }];
};

const findingOf = (
  { kind, path }: Change,
  read: (path: string) => string,
): readonly MigrationFinding[] => {
  if (kind !== "added") return [{ path, kind, statements: [] }];
  const statements = rejectedStatements(read(path));
  return statements.length === 0 ? [] : [{ path, kind: "non-additive", statements }];
};

export const pullRequestFiles = (tsv: string): readonly PullRequestFile[] =>
  tsv
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const match = FILE_LINE.exec(line);
      if (match === null) throw new Error(`Fichier de PR illisible : ${line}`);
      const [status, filename, previousFilename] = match.slice(1);
      return {
        status: String(status),
        filename: String(filename),
        previousFilename: String(previousFilename),
      };
    });

export const migrationFindings = ({
  files,
  read,
}: {
  readonly files: readonly PullRequestFile[];
  readonly read: (path: string) => string;
}): readonly MigrationFinding[] =>
  files
    .flatMap(changesOf)
    .filter(({ path }) => MIGRATION_FILE.test(path))
    .flatMap((change) => findingOf(change, read));
