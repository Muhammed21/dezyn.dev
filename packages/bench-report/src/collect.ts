import { fieldsOf, listOf, type SqlQueries } from "./bench-rows.ts";

type Benchmark = { readonly [key: string]: unknown };

type Group = { readonly fullName: string; readonly benchmarks: readonly Benchmark[] };

type File = { readonly [key: string]: unknown; readonly groups: readonly Group[] };

export type BenchSource = {
  readonly dir: string;
  readonly results: unknown;
  readonly sqlQueries: readonly unknown[];
};

const keyOf = (group: string, name: unknown) => `${group}::${String(name)}`;

const sqlQueriesByKey = (sidecars: readonly unknown[]): ReadonlyMap<string, SqlQueries> =>
  new Map(
    sidecars
      .flatMap((sidecar) => listOf(fieldsOf(sidecar).benchmarks))
      .map(fieldsOf)
      .flatMap(({ group, name, queries, calls }) =>
        typeof group === "string" && typeof queries === "number" && typeof calls === "number"
          ? [[keyOf(group, name), { queries, calls }] as const]
          : [],
      ),
  );

const collectSource = ({ dir, results, sqlQueries }: BenchSource): readonly File[] => {
  const queriesByKey = sqlQueriesByKey(sqlQueries);
  return listOf(fieldsOf(results).files).map((file) => {
    const fileFields = fieldsOf(file);
    return {
      ...fileFields,
      groups: listOf(fileFields.groups).map((group) => {
        const groupFields = fieldsOf(group);
        const fullName = String(groupFields.fullName);
        return {
          ...groupFields,
          fullName: `${dir} > ${fullName}`,
          benchmarks: listOf(groupFields.benchmarks).map((benchmark) => {
            const fields = fieldsOf(benchmark);
            const queries = queriesByKey.get(keyOf(fullName, fields.name));
            return queries === undefined ? fields : { ...fields, sqlQueries: queries };
          }),
        };
      }),
    };
  });
};

const emptyBenchmarksOf = (files: readonly File[]) =>
  files.flatMap((file) =>
    file.groups.flatMap((group) =>
      group.benchmarks
        .filter(
          (benchmark) => !(typeof benchmark.sampleCount === "number" && benchmark.sampleCount > 0),
        )
        .map((benchmark) => `${group.fullName} > ${String(benchmark.name)}`),
    ),
  );

export const collectBenchReports = (sources: readonly BenchSource[]) => {
  const files = sources.flatMap(collectSource);
  return { report: { files }, emptyBenchmarks: emptyBenchmarksOf(files) };
};
