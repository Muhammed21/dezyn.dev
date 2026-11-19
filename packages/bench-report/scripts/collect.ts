import { globSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { collectBenchReports } from "../src/collect.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const outFile = process.argv[2];

if (outFile === undefined) {
  process.stderr.write("usage: collect.ts OUT_FILE\n");
  process.exit(2);
}

const results = globSync("{apps,packages}/**/bench-results.json", {
  exclude: (path) => basename(path) === "node_modules",
}).toSorted();

if (results.length === 0) {
  writeFileSync(outFile, JSON.stringify({ files: [] }));
  process.stdout.write("no bench-results.json found\n");
  process.exit(0);
}

const { report, emptyBenchmarks } = collectBenchReports(
  results.map((path) => ({
    dir: dirname(path),
    results: readJson(path),
    sqlQueries: globSync(join(dirname(path), "bench-sql-queries", "*.json"))
      .toSorted()
      .map(readJson),
  })),
);

writeFileSync(outFile, JSON.stringify(report));

if (emptyBenchmarks.length > 0) {
  process.stdout.write(
    [
      ...emptyBenchmarks,
      "::error::Bench sans échantillon : vitest bench avale l'erreur du bench, relancez-le en local pour la voir.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

process.stdout.write(`${results.length} bench file(s) merged into ${outFile}\n`);
