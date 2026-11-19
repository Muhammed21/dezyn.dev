import { readFileSync } from "node:fs";

import { type ReadReport, renderComparison } from "../src/compare.ts";

const readReport = (path: string): ReadReport => {
  try {
    return { json: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

const [prPath, baselinePath] = process.argv.slice(2);

if (prPath === undefined) {
  process.stderr.write("usage: compare.ts <pr.json> [baseline.json]\n");
  process.exit(2);
}

process.stdout.write(
  `${renderComparison({
    pr: readReport(prPath),
    baseline: baselinePath === undefined ? undefined : readReport(baselinePath),
  })}\n`,
);
