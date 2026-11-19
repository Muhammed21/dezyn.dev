import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const COLLECT = fileURLToPath(new URL("../collect.ts", import.meta.url));
const COMPARE = fileURLToPath(new URL("../compare.ts", import.meta.url));

const GROUP = "bench/mcp.bench.ts > /v1/mcp sur un projet de 130 tokens";

const makeBenchmark = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  name: "read_tokens",
  median: 2,
  p99: 4,
  sampleCount: 100,
  ...overrides,
});

const makeResults = (benchmarks: readonly object[]) => ({
  files: [
    { filepath: "/ci/apps/api/bench/mcp.bench.ts", groups: [{ fullName: GROUP, benchmarks }] },
  ],
});

const makeRepo = (files: Readonly<Record<string, unknown>>) => {
  const root = mkdtempSync(join(tmpdir(), "bench-report-"));
  Object.entries(files).forEach(([path, content]) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(
      join(root, path),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  });
  return root;
};

const run = (script: string, { cwd, args }: { cwd: string; args: readonly string[] }) =>
  spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

describe("collect.ts lancé par le workflow après pnpm bench", () => {
  it("fusionne les benchs des packages et leurs requêtes SQL dans le fichier demandé", () => {
    const root = makeRepo({
      "apps/api/bench-results.json": makeResults([makeBenchmark()]),
      "apps/api/bench-sql-queries/mcp.bench.json": {
        benchmarks: [{ group: GROUP, name: "read_tokens", queries: 7, calls: 1 }],
      },
      "apps/api/node_modules/dep/bench-results.json": makeResults([makeBenchmark({ name: "dep" })]),
    });

    const result = run(COLLECT, { cwd: root, args: ["out.json"] });

    expect({ status: result.status, stdout: result.stdout }).toEqual({
      status: 0,
      stdout: "1 bench file(s) merged into out.json\n",
    });
    expect(readJson(join(root, "out.json"))).toEqual({
      files: [
        {
          filepath: "/ci/apps/api/bench/mcp.bench.ts",
          groups: [
            {
              fullName: `apps/api > ${GROUP}`,
              benchmarks: [makeBenchmark({ sqlQueries: { queries: 7, calls: 1 } })],
            },
          ],
        },
      ],
    });
  });

  it("écrit un rapport vide quand aucun package n'a de bench", () => {
    const root = makeRepo({ "apps/api/package.json": {} });

    const result = run(COLLECT, { cwd: root, args: ["out.json"] });

    expect({ status: result.status, stdout: result.stdout }).toEqual({
      status: 0,
      stdout: "no bench-results.json found\n",
    });
    expect(readJson(join(root, "out.json"))).toEqual({ files: [] });
  });

  it("échoue en annotant la CI quand un bench n'a aucun échantillon", () => {
    const root = makeRepo({
      "apps/api/bench-results.json": makeResults([makeBenchmark({ sampleCount: 0 })]),
    });

    const result = run(COLLECT, { cwd: root, args: ["out.json"] });

    expect({ status: result.status, stdout: result.stdout }).toEqual({
      status: 1,
      stdout: [
        `apps/api > ${GROUP} > read_tokens`,
        "::error::Bench sans échantillon : vitest bench avale l'erreur du bench, relancez-le en local pour la voir.",
        "",
      ].join("\n"),
    });
  });

  it("refuse de tourner sans fichier de sortie", () => {
    const result = run(COLLECT, { cwd: makeRepo({}), args: [] });

    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 2,
      stderr: "usage: collect.ts OUT_FILE\n",
    });
  });
});

describe("compare.ts lancé par le workflow pour le commentaire de la PR", () => {
  it("écrit la comparaison de la PR avec la référence de main", () => {
    const root = makeRepo({
      "pr.json": makeResults([makeBenchmark({ sqlQueries: { queries: 7, calls: 1 } })]),
      "main.json": makeResults([makeBenchmark({ sqlQueries: { queries: 5, calls: 1 } })]),
    });

    const result = run(COMPARE, { cwd: root, args: ["pr.json", "main.json"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("| `read_tokens` |");
    expect(result.stdout).toContain("| 7 | 5 | +2 🔺 |");
  });

  it("montre la PR seule quand la référence de main n'a pas été téléchargée", () => {
    const root = makeRepo({ "pr.json": makeResults([makeBenchmark()]) });

    const result = run(COMPARE, { cwd: root, args: ["pr.json", "absent.json"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("_No baseline yet — baseline unreadable (ENOENT");
  });

  it("dit qu'un artefact de PR n'est pas du JSON", () => {
    const root = makeRepo({ "pr.json": "pas du json" });

    const result = run(COMPARE, { cwd: root, args: ["pr.json"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("_PR bench artifact unreadable: Unexpected token");
  });

  it("montre la PR seule sans chemin de référence", () => {
    const root = makeRepo({ "pr.json": makeResults([makeBenchmark()]) });

    const result = run(COMPARE, { cwd: root, args: ["pr.json"] });

    expect(result.stdout).toContain("_No baseline yet — no baseline path supplied.");
  });

  it("refuse de tourner sans artefact de PR", () => {
    const result = run(COMPARE, { cwd: makeRepo({}), args: [] });

    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 2,
      stderr: "usage: compare.ts <pr.json> [baseline.json]\n",
    });
  });
});
