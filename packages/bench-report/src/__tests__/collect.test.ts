import { describe, expect, it } from "vitest";

import { collectBenchReports } from "../collect.ts";

const GROUP = "bench/mcp.bench.ts > /v1/mcp sur un projet de 130 tokens";

const makeBenchmark = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: "1",
  name: "read_tokens",
  median: 2,
  sampleCount: 100,
  ...overrides,
});

const makeResults = (benchmarks: readonly object[], fullName = GROUP) => ({
  files: [{ filepath: "/ci/apps/api/bench/mcp.bench.ts", groups: [{ fullName, benchmarks }] }],
});

const makeSqlQueries = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  group: GROUP,
  name: "read_tokens",
  queries: 7,
  calls: 1,
  ...overrides,
});

const makeSource = ({
  dir = "apps/api",
  results = makeResults([makeBenchmark()]),
  sqlQueries = [],
}: {
  readonly dir?: string;
  readonly results?: unknown;
  readonly sqlQueries?: readonly unknown[];
} = {}) => ({ dir, results, sqlQueries: [{ benchmarks: sqlQueries }] });

describe("collecte des benchs de chaque package", () => {
  it("préfixe chaque groupe par le dossier de son package", () => {
    const { report } = collectBenchReports([
      makeSource({ dir: "apps/api" }),
      makeSource({ dir: "packages/db", results: makeResults([makeBenchmark()], "bench/q > g") }),
    ]);

    expect(report.files.map((file) => file.groups.map((group) => group.fullName))).toEqual([
      [`apps/api > ${GROUP}`],
      ["packages/db > bench/q > g"],
    ]);
  });

  it("garde les mesures de vitest bench", () => {
    const benchmark = makeBenchmark({ p99: 4, hz: 400 });

    const { report } = collectBenchReports([makeSource({ results: makeResults([benchmark]) })]);

    expect(report.files[0]?.groups[0]?.benchmarks).toEqual([benchmark]);
    expect(report.files[0]?.filepath).toBe("/ci/apps/api/bench/mcp.bench.ts");
  });

  it("ajoute à un bench les requêtes SQL relevées pour son groupe et son nom", () => {
    const { report } = collectBenchReports([
      makeSource({
        results: makeResults([makeBenchmark(), makeBenchmark({ name: "write_tokens" })]),
        sqlQueries: [makeSqlQueries({ name: "write_tokens", queries: 40, calls: 3 })],
      }),
    ]);

    expect(report.files[0]?.groups[0]?.benchmarks).toEqual([
      makeBenchmark(),
      makeBenchmark({ name: "write_tokens", sqlQueries: { queries: 40, calls: 3 } }),
    ]);
  });

  it("n'ajoute pas les requêtes SQL d'un bench du même nom dans un autre groupe", () => {
    const { report } = collectBenchReports([
      makeSource({ sqlQueries: [makeSqlQueries({ group: "bench/autre.bench.ts > autre" })] }),
    ]);

    expect(report.files[0]?.groups[0]?.benchmarks).toStrictEqual([makeBenchmark()]);
  });

  it("ignore un relevé de requêtes SQL mal formé", () => {
    const { report } = collectBenchReports([
      makeSource({
        sqlQueries: [
          makeSqlQueries({ queries: "7" }),
          makeSqlQueries({ calls: "1" }),
          makeSqlQueries({ group: undefined }),
          "rien",
        ],
      }),
    ]);

    expect(report.files[0]?.groups[0]?.benchmarks).toStrictEqual([makeBenchmark()]);
  });

  it("liste les benchs sans échantillon, que vitest bench a laissés vides après une erreur", () => {
    const { emptyBenchmarks } = collectBenchReports([
      makeSource({
        results: makeResults([
          makeBenchmark(),
          makeBenchmark({ name: "en erreur", sampleCount: 0 }),
          makeBenchmark({ name: "sans compte", sampleCount: undefined }),
        ]),
      }),
    ]);

    expect(emptyBenchmarks).toEqual([
      `apps/api > ${GROUP} > en erreur`,
      `apps/api > ${GROUP} > sans compte`,
    ]);
  });

  it("donne un rapport vide sans package mesuré", () => {
    expect(collectBenchReports([])).toEqual({ report: { files: [] }, emptyBenchmarks: [] });
  });
});
