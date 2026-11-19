import { describe, expect, it } from "vitest";

import { renderComparison } from "../compare.ts";

const GROUP = "apps/api > bench/mcp.bench.ts > /v1/mcp sur un projet de 130 tokens";

const makeBenchmark = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  name: "read_tokens",
  median: 2,
  p99: 4,
  mean: 2.5,
  hz: 400,
  sampleCount: 100,
  rme: 1.5,
  ...overrides,
});

const makeReport = (benchmarks: readonly object[], fullName = GROUP) => ({
  files: [{ filepath: "/ci/apps/api/bench/mcp.bench.ts", groups: [{ fullName, benchmarks }] }],
});

const read = (json: unknown) => ({ json });

const rowOf = (markdown: string, name: string) =>
  markdown.split("\n").find((line) => line.startsWith(`| \`${name}\` |`));

const cellsOf = (row: string | undefined) =>
  (row ?? "")
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());

describe("comparaison des requêtes SQL d'un bench avec main", () => {
  it("affiche les requêtes de la PR, celles de main et l'écart, signalé quand il monte", () => {
    const markdown = renderComparison({
      pr: read(makeReport([makeBenchmark({ sqlQueries: { queries: 7, calls: 1 } })])),
      baseline: read(makeReport([makeBenchmark({ sqlQueries: { queries: 5, calls: 1 } })])),
    });

    expect(cellsOf(rowOf(markdown, "read_tokens")).slice(-3)).toEqual(["7", "5", "+2 🔺"]);
  });

  it("signale un écart qui descend", () => {
    const markdown = renderComparison({
      pr: read(makeReport([makeBenchmark({ sqlQueries: { queries: 4, calls: 1 } })])),
      baseline: read(makeReport([makeBenchmark({ sqlQueries: { queries: 5, calls: 1 } })])),
    });

    expect(cellsOf(rowOf(markdown, "read_tokens")).slice(-3)).toEqual(["4", "5", "-1 🟢"]);
  });

  it("affiche un écart nul sans signal", () => {
    const markdown = renderComparison({
      pr: read(makeReport([makeBenchmark({ sqlQueries: { queries: 5, calls: 1 } })])),
      baseline: read(makeReport([makeBenchmark({ sqlQueries: { queries: 5, calls: 1 } })])),
    });

    expect(cellsOf(rowOf(markdown, "read_tokens")).slice(-3)).toEqual(["5", "5", "0"]);
  });

  it("affiche « — » pour main et l'écart quand la référence n'a pas de requêtes SQL", () => {
    const markdown = renderComparison({
      pr: read(makeReport([makeBenchmark({ sqlQueries: { queries: 7, calls: 1 } })])),
      baseline: read(makeReport([makeBenchmark()])),
    });

    expect(cellsOf(rowOf(markdown, "read_tokens")).slice(-3)).toEqual(["7", "—", "—"]);
  });

  it("affiche « — » pour la PR et l'écart quand la PR n'a pas de requêtes SQL", () => {
    const markdown = renderComparison({
      pr: read(makeReport([makeBenchmark()])),
      baseline: read(makeReport([makeBenchmark({ sqlQueries: { queries: 5, calls: 1 } })])),
    });

    expect(cellsOf(rowOf(markdown, "read_tokens")).slice(-3)).toEqual(["—", "5", "—"]);
  });

  it("dit qu'un bench qui enchaîne plusieurs appels donne leur total", () => {
    const chained = "write_tokens, close_proposal_batch, puis validate";
    const markdown = renderComparison({
      pr: read(
        makeReport([makeBenchmark({ name: chained, sqlQueries: { queries: 40, calls: 3 } })]),
      ),
      baseline: read(
        makeReport([makeBenchmark({ name: chained, sqlQueries: { queries: 38, calls: 3 } })]),
      ),
    });

    expect(cellsOf(rowOf(markdown, chained)).slice(-3)).toEqual([
      "40 (total de 3 appels)",
      "38 (total de 3 appels)",
      "+2 🔺",
    ]);
  });

  it("ignore des requêtes SQL mal formées", () => {
    const markdown = renderComparison({
      pr: read(makeReport([makeBenchmark({ sqlQueries: { queries: "7", calls: 1 } })])),
      baseline: read(makeReport([makeBenchmark({ sqlQueries: { queries: 5 } })])),
    });

    expect(cellsOf(rowOf(markdown, "read_tokens")).slice(-3)).toEqual(["—", "—", "—"]);
  });

  it("ajoute les requêtes SQL de la PR quand il n'y a pas de référence", () => {
    const markdown = renderComparison({
      pr: read(makeReport([makeBenchmark({ sqlQueries: { queries: 7, calls: 1 } })])),
    });

    expect(markdown).toContain("| benchmark | median | p99 | mean | hz | n | rme | requêtes SQL |");
    expect(cellsOf(rowOf(markdown, "read_tokens")).at(-1)).toBe("7");
  });
});

describe("comparaison des temps d'un bench avec main", () => {
  it("affiche médiane et p99 de la PR et de main, avec leurs écarts en pourcentage", () => {
    const markdown = renderComparison({
      pr: read(makeReport([makeBenchmark({ median: 2.2, p99: 3.6 })])),
      baseline: read(makeReport([makeBenchmark({ median: 2, p99: 4 })])),
    });

    expect(cellsOf(rowOf(markdown, "read_tokens")).slice(0, 7)).toEqual([
      "`read_tokens`",
      "2.2000ms",
      "2.0000ms",
      "+10.0% 🔺",
      "3.6000ms",
      "4.0000ms",
      "-10.0% 🟢",
    ]);
  });

  it("ne signale pas un écart de temps de 5 % ou moins", () => {
    const markdown = renderComparison({
      pr: read(makeReport([makeBenchmark({ median: 2.08, p99: 3.84 })])),
      baseline: read(makeReport([makeBenchmark({ median: 2, p99: 4 })])),
    });

    expect(cellsOf(rowOf(markdown, "read_tokens")).slice(3, 7)).toEqual([
      "+4.0%",
      "3.8400ms",
      "4.0000ms",
      "-4.0%",
    ]);
  });

  it("affiche « — » quand main n'a pas ce bench ou une médiane nulle", () => {
    const markdown = renderComparison({
      pr: read(makeReport([makeBenchmark(), makeBenchmark({ name: "nouveau" })])),
      baseline: read(makeReport([makeBenchmark({ median: 0 })])),
    });

    expect(cellsOf(rowOf(markdown, "read_tokens")).slice(2, 4)).toEqual(["0.0000ms", "—"]);
    expect(cellsOf(rowOf(markdown, "nouveau")).slice(2, 4)).toEqual(["—", "—"]);
  });

  it("compte les benchs de main absents de la PR", () => {
    const markdown = renderComparison({
      pr: read(makeReport([makeBenchmark()])),
      baseline: read(makeReport([makeBenchmark(), makeBenchmark({ name: "supprimé" })])),
    });

    expect(markdown).toContain("_Baseline-only benchmarks (removed or renamed): 1_");
  });

  it("ne parle pas de benchs supprimés quand main n'en a pas", () => {
    const markdown = renderComparison({
      pr: read(makeReport([makeBenchmark()])),
      baseline: read(makeReport([makeBenchmark()])),
    });

    expect(markdown.split("\n").slice(-3)).toEqual([
      "| `read_tokens` | 2.0000ms | 2.0000ms | 0.0% | 4.0000ms | 4.0000ms | 0.0% | — | — | — |",
      "",
      "_Informative only — never gates merge. Source: `vitest bench` output._",
    ]);
  });

  it("regroupe les benchs par groupe, sans le nom du fichier de bench", () => {
    const markdown = renderComparison({
      pr: read(makeReport([makeBenchmark()])),
      baseline: read(makeReport([makeBenchmark()])),
    });

    expect(markdown.split("\n").slice(0, 7)).toEqual([
      "<!-- dezyn:perf-compare -->",
      "### perf — micro-bench",
      "",
      "#### `apps/api > /v1/mcp sur un projet de 130 tokens`",
      "",
      "| benchmark | median (PR) | median (main) | Δ | p99 (PR) | p99 (main) | Δ | requêtes SQL (PR) | requêtes SQL (main) | Δ |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]);
    expect(markdown.split("\n").at(-1)).toBe(
      "_Informative only — never gates merge. Source: `vitest bench` output._",
    );
  });
});

describe("commentaire complet", () => {
  it("compare chaque groupe de benchs à main, puis compte ceux que la PR a retirés", () => {
    const otherGroup = "apps/api > bench/lots.bench.ts > /v1/proposal-batches";
    const markdown = renderComparison({
      pr: read({
        files: [
          {
            groups: [
              { fullName: GROUP, benchmarks: [makeBenchmark({ median: 21, p99: 19 })] },
              {
                fullName: otherGroup,
                benchmarks: [makeBenchmark({ name: "validate", median: 20, p99: 20 })],
              },
            ],
          },
        ],
      }),
      baseline: read({
        files: [
          {
            groups: [
              {
                fullName: GROUP,
                benchmarks: [
                  makeBenchmark({ median: 20, p99: 20 }),
                  makeBenchmark({ name: "retiré" }),
                ],
              },
              {
                fullName: otherGroup,
                benchmarks: [makeBenchmark({ name: "validate", median: 20, p99: 20 })],
              },
            ],
          },
        ],
      }),
    });

    expect(markdown).toBe(
      [
        "<!-- dezyn:perf-compare -->",
        "### perf — micro-bench",
        "",
        "#### `apps/api > /v1/mcp sur un projet de 130 tokens`",
        "",
        "| benchmark | median (PR) | median (main) | Δ | p99 (PR) | p99 (main) | Δ | requêtes SQL (PR) | requêtes SQL (main) | Δ |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        "| `read_tokens` | 21.0000ms | 20.0000ms | +5.0% | 19.0000ms | 20.0000ms | -5.0% | — | — | — |",
        "",
        "#### `apps/api > /v1/proposal-batches`",
        "",
        "| benchmark | median (PR) | median (main) | Δ | p99 (PR) | p99 (main) | Δ | requêtes SQL (PR) | requêtes SQL (main) | Δ |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        "| `validate` | 20.0000ms | 20.0000ms | 0.0% | 20.0000ms | 20.0000ms | 0.0% | — | — | — |",
        "",
        "_Baseline-only benchmarks (removed or renamed): 1_",
        "",
        "_Informative only — never gates merge. Source: `vitest bench` output._",
      ].join("\n"),
    );
  });

  it("montre la PR seule, groupe par groupe, sans référence", () => {
    const markdown = renderComparison({
      pr: read({
        files: [
          {
            groups: [
              {
                fullName: GROUP,
                benchmarks: [makeBenchmark({ sqlQueries: { queries: 12, calls: 1 } })],
              },
              { fullName: "apps/api > lots", benchmarks: [makeBenchmark({ name: "validate" })] },
            ],
          },
        ],
      }),
      baseline: read({ files: [] }),
    });

    expect(markdown).toBe(
      [
        "<!-- dezyn:perf-compare -->",
        "### perf — micro-bench",
        "",
        "_No baseline yet — baseline contains no benchmarks. Showing PR run only._",
        "",
        "#### `apps/api > /v1/mcp sur un projet de 130 tokens`",
        "",
        "| benchmark | median | p99 | mean | hz | n | rme | requêtes SQL |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        "| `read_tokens` | 2.0000ms | 4.0000ms | 2.5000ms | 400.00 | 100 | ±1.50% | 12 |",
        "",
        "#### `apps/api > lots`",
        "",
        "| benchmark | median | p99 | mean | hz | n | rme | requêtes SQL |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        "| `validate` | 2.0000ms | 4.0000ms | 2.5000ms | 400.00 | 100 | ±1.50% | — |",
        "",
        "_Informative only — never gates merge. Source: `vitest bench` output._",
      ].join("\n"),
    );
  });

  it("affiche « — » pour un écart quand la PR n'a pas la mesure, et les requêtes d'un nouveau bench", () => {
    const markdown = renderComparison({
      pr: read(
        makeReport([
          makeBenchmark({ median: undefined }),
          makeBenchmark({ name: "nouveau", sqlQueries: { queries: 3, calls: 1 } }),
        ]),
      ),
      baseline: read(makeReport([makeBenchmark()])),
    });

    expect(cellsOf(rowOf(markdown, "read_tokens")).slice(1, 4)).toEqual(["—", "2.0000ms", "—"]);
    expect(cellsOf(rowOf(markdown, "nouveau")).slice(-3)).toEqual(["3", "—", "—"]);
  });
});

describe("rendu sans référence de main utilisable", () => {
  it("dit qu'aucune référence n'a été fournie et montre la PR seule", () => {
    const markdown = renderComparison({
      pr: read(makeReport([makeBenchmark({ hz: 412.345, sampleCount: 90, rme: 1.234 })])),
    });

    expect(markdown).toContain(
      "_No baseline yet — no baseline path supplied. Showing PR run only._",
    );
    expect(cellsOf(rowOf(markdown, "read_tokens")).slice(0, 7)).toEqual([
      "`read_tokens`",
      "2.0000ms",
      "4.0000ms",
      "2.5000ms",
      "412.35",
      "90",
      "±1.23%",
    ]);
  });

  it("affiche « — » pour les mesures absentes de la PR", () => {
    const markdown = renderComparison({
      pr: read(makeReport([{ name: "read_tokens" }])),
    });

    expect(cellsOf(rowOf(markdown, "read_tokens"))).toEqual([
      "`read_tokens`",
      "—",
      "—",
      "—",
      "—",
      "—",
      "±—%",
      "—",
    ]);
  });

  it("dit que la référence est illisible", () => {
    const markdown = renderComparison({
      pr: read(makeReport([makeBenchmark()])),
      baseline: { error: "ENOENT" },
    });

    expect(markdown).toContain("_No baseline yet — baseline unreadable (ENOENT).");
  });

  it("dit que la référence n'a aucun bench", () => {
    const markdown = renderComparison({
      pr: read(makeReport([makeBenchmark()])),
      baseline: read({ files: [] }),
    });

    expect(markdown).toContain("_No baseline yet — baseline contains no benchmarks.");
  });
});

describe("rendu d'un artefact de PR inutilisable", () => {
  it("dit que l'artefact de la PR est illisible", () => {
    expect(renderComparison({ pr: { error: "Unexpected token" } })).toBe(
      [
        "<!-- dezyn:perf-compare -->",
        "### perf — micro-bench",
        "",
        "_PR bench artifact unreadable: Unexpected token_",
      ].join("\n"),
    );
  });

  it("dit que la PR n'a aucun bench", () => {
    expect(renderComparison({ pr: read({ files: "rien" }) })).toBe(
      [
        "<!-- dezyn:perf-compare -->",
        "### perf — micro-bench",
        "",
        "_No benchmarks found in PR artifact._",
      ].join("\n"),
    );
  });
});
