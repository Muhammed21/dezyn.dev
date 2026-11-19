import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type SqlQueries = { readonly queries: number; readonly calls: number };

const QUERIES = /desc="(?<queries>\d+) requetes"/;

const queriesOf = (response: Response) => {
  const serverTiming = response.headers.get("server-timing");
  const queries = QUERIES.exec(serverTiming ?? "")?.groups?.queries;
  if (queries === undefined) {
    throw new Error(`Réponse sans requêtes SQL dans Server-Timing : ${serverTiming}`);
  }
  return Number(queries);
};

type NamedSuite = { readonly name: string; readonly suite?: NamedSuite };

const suiteNamesOf = (suite: NamedSuite | undefined): readonly string[] =>
  suite === undefined ? [] : [...suiteNamesOf(suite.suite), suite.name];

export const benchGroupOf = ({
  file,
  suite,
}: {
  readonly file: { readonly name: string };
  readonly suite: NamedSuite;
}) => [file.name, ...suiteNamesOf(suite)].join(" > ");

export const sqlQueriesOf = (responses: readonly Response[]): SqlQueries => ({
  queries: responses.map(queriesOf).reduce((total, queries) => total + queries, 0),
  calls: responses.length,
});

export const writeBenchSqlQueries = ({
  dir,
  group,
  name,
  sqlQueries,
}: {
  readonly dir: string;
  readonly group: string;
  readonly name: string;
  readonly sqlQueries: SqlQueries;
}) => {
  const target = join(dir, "bench-sql-queries");
  const file = `${createHash("sha256").update(`${group}::${name}`).digest("hex").slice(0, 16)}.json`;
  mkdirSync(target, { recursive: true });
  writeFileSync(
    join(target, file),
    JSON.stringify({ benchmarks: [{ group, name, ...sqlQueries }] }),
  );
};
