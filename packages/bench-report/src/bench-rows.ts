export type SqlQueries = { readonly queries: number; readonly calls: number };

export type BenchRow = {
  readonly group: string;
  readonly name: string;
  readonly median?: number;
  readonly p99?: number;
  readonly mean?: number;
  readonly hz?: number;
  readonly sampleCount?: number;
  readonly rme?: number;
  readonly sqlQueries?: SqlQueries;
};

type Fields = { readonly [key: string]: unknown };

export const fieldsOf = (value: unknown): Fields =>
  typeof value === "object" && value !== null ? { ...value } : {};

export const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const numberOf = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const sqlQueriesOf = (value: unknown): SqlQueries | undefined => {
  const fields = fieldsOf(value);
  const queries = numberOf(fields.queries);
  const calls = numberOf(fields.calls);
  return queries === undefined || calls === undefined ? undefined : { queries, calls };
};

const benchRowOf =
  (group: string) =>
  (benchmark: unknown): BenchRow => {
    const fields = fieldsOf(benchmark);
    return {
      group,
      name: String(fields.name),
      median: numberOf(fields.median),
      p99: numberOf(fields.p99),
      mean: numberOf(fields.mean),
      hz: numberOf(fields.hz),
      sampleCount: numberOf(fields.sampleCount),
      rme: numberOf(fields.rme),
      sqlQueries: sqlQueriesOf(fields.sqlQueries),
    };
  };

export const benchRowsOf = (report: unknown): readonly BenchRow[] =>
  listOf(fieldsOf(report).files).flatMap((file) =>
    listOf(fieldsOf(file).groups).flatMap((group) => {
      const fields = fieldsOf(group);
      return listOf(fields.benchmarks).map(benchRowOf(String(fields.fullName)));
    }),
  );
