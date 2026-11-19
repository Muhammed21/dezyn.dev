import { type BenchRow, benchRowsOf } from "./bench-rows.ts";

export type ReadReport = { readonly json: unknown } | { readonly error: string };

const HEADER = "<!-- dezyn:perf-compare -->";
const TITLE = "### perf — micro-bench";
const FOOTER = "_Informative only — never gates merge. Source: `vitest bench` output._";
const MISSING = "—";

const prettifyGroup = (fullName: string) => fullName.replace(/ > bench\/[^>]*\.bench\.ts >/, " >");

const sectionsOf = (rows: readonly BenchRow[]) =>
  [...new Set(rows.map((row) => prettifyGroup(row.group)))].map((section) => ({
    section,
    rows: rows.filter((row) => prettifyGroup(row.group) === section),
  }));

const formatMs = (value: number | undefined) =>
  value === undefined ? MISSING : `${value.toFixed(4)}ms`;

const formatFixed = (value: number | undefined) =>
  value === undefined ? MISSING : value.toFixed(2);

const formatDelta = (pr: number | undefined, base: number | undefined) => {
  if (pr === undefined || base === undefined || base === 0) return MISSING;
  const delta = ((pr - base) / base) * 100;
  const arrow = delta > 5 ? " 🔺" : delta < -5 ? " 🟢" : "";
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%${arrow}`;
};

const formatQueries = (row: BenchRow | undefined) => {
  if (row?.sqlQueries === undefined) return MISSING;
  const { queries, calls } = row.sqlQueries;
  return calls > 1 ? `${queries} (total de ${calls} appels)` : `${queries}`;
};

const formatQueriesDelta = (pr: BenchRow, base: BenchRow | undefined) => {
  if (pr.sqlQueries === undefined || base?.sqlQueries === undefined) return MISSING;
  const delta = pr.sqlQueries.queries - base.sqlQueries.queries;
  return delta > 0 ? `+${delta} 🔺` : delta < 0 ? `${delta} 🟢` : "0";
};

const keyOf = (row: BenchRow) => `${row.group}::${row.name}`;

const prOnlyTable = ({ section, rows }: { section: string; rows: readonly BenchRow[] }) => [
  `#### \`${section}\``,
  "",
  "| benchmark | median | p99 | mean | hz | n | rme | requêtes SQL |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...rows.map(
    (row) =>
      `| \`${row.name}\` | ${formatMs(row.median)} | ${formatMs(row.p99)} | ${formatMs(row.mean)} | ${formatFixed(row.hz)} | ${row.sampleCount ?? MISSING} | ±${formatFixed(row.rme)}% | ${formatQueries(row)} |`,
  ),
  "",
];

const diffTable =
  (baseByKey: ReadonlyMap<string, BenchRow>) =>
  ({ section, rows }: { section: string; rows: readonly BenchRow[] }) => [
    `#### \`${section}\``,
    "",
    "| benchmark | median (PR) | median (main) | Δ | p99 (PR) | p99 (main) | Δ | requêtes SQL (PR) | requêtes SQL (main) | Δ |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => {
      const base = baseByKey.get(keyOf(row));
      return `| \`${row.name}\` | ${formatMs(row.median)} | ${formatMs(base?.median)} | ${formatDelta(row.median, base?.median)} | ${formatMs(row.p99)} | ${formatMs(base?.p99)} | ${formatDelta(row.p99, base?.p99)} | ${formatQueries(row)} | ${formatQueries(base)} | ${formatQueriesDelta(row, base)} |`;
    }),
    "",
  ];

const baselineRowsOf = (baseline: ReadReport | undefined) => {
  if (baseline === undefined) return { reason: "no baseline path supplied" };
  if ("error" in baseline) return { reason: `baseline unreadable (${baseline.error})` };
  const rows = benchRowsOf(baseline.json);
  return rows.length === 0 ? { reason: "baseline contains no benchmarks" } : { rows };
};

const bodyOf = (prRows: readonly BenchRow[], baseline: ReadReport | undefined) => {
  const base = baselineRowsOf(baseline);
  if ("reason" in base) {
    return [
      `_No baseline yet — ${base.reason}. Showing PR run only._`,
      "",
      ...sectionsOf(prRows).flatMap(prOnlyTable),
    ];
  }
  const baseByKey = new Map(base.rows.map((row) => [keyOf(row), row]));
  const prKeys = new Set(prRows.map(keyOf));
  const orphans = base.rows.filter((row) => !prKeys.has(keyOf(row))).length;
  return [
    ...sectionsOf(prRows).flatMap(diffTable(baseByKey)),
    ...(orphans > 0 ? [`_Baseline-only benchmarks (removed or renamed): ${orphans}_`, ""] : []),
  ];
};

export const renderComparison = ({
  pr,
  baseline,
}: {
  readonly pr: ReadReport;
  readonly baseline?: ReadReport;
}) => {
  if ("error" in pr) {
    return [HEADER, TITLE, "", `_PR bench artifact unreadable: ${pr.error}_`].join("\n");
  }
  const prRows = benchRowsOf(pr.json);
  if (prRows.length === 0) {
    return [HEADER, TITLE, "", "_No benchmarks found in PR artifact._"].join("\n");
  }
  return [HEADER, TITLE, "", ...bodyOf(prRows, baseline), FOOTER].join("\n");
};
