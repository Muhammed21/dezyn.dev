import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

import { gateDecision } from "../src/migration-gate/gate-decision.ts";
import { gateSummary } from "../src/migration-gate/gate-summary.ts";
import { APPROVAL_LABEL, gateTrigger } from "../src/migration-gate/gate-trigger.ts";
import { migrationFindings } from "../src/migration-gate/migration-findings.ts";

const MIGRATIONS = "packages/db/migrations";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} manquante`);
  return value;
};

const field = (value: unknown, ...keys: readonly string[]): unknown =>
  keys.reduce<unknown>(
    (current, key) =>
      typeof current === "object" && current !== null ? Reflect.get(current, key) : undefined,
    value,
  );

const text = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number" ? String(value) : undefined;

const run = (command: string, args: readonly string[]): string =>
  execFileSync(command, args, { encoding: "utf8" });

const succeeds = (command: string, args: readonly string[]): boolean => {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const repository = required("GITHUB_REPOSITORY");
const event: unknown = JSON.parse(readFileSync(required("GITHUB_EVENT_PATH"), "utf8"));
const pullRequest = text(field(event, "pull_request", "number"));
if (pullRequest === undefined) throw new Error("Événement sans pull_request.number");
const issueLabels = `repos/${repository}/issues/${pullRequest}/labels`;

const migrationsChangedByPush = (): boolean => {
  const before = text(field(event, "before"));
  const after = text(field(event, "after"));
  if (before === undefined || after === undefined) return true;
  const fetched = succeeds("git", ["fetch", "--no-tags", "--depth=1", "origin", before, after]);
  return (
    !fetched ||
    !succeeds("git", [
      "diff",
      "--quiet",
      before,
      after,
      "--",
      MIGRATIONS,
      `:(exclude)${MIGRATIONS}/meta`,
    ])
  );
};

const findings = migrationFindings({
  nameStatus: run("git", [
    "diff",
    "--name-status",
    "--no-renames",
    "HEAD^1",
    "HEAD",
    "--",
    MIGRATIONS,
  ]),
  read: (path) => readFileSync(path, "utf8"),
});

const labelPresent = run("gh", ["api", issueLabels, "--jq", ".[].name"])
  .split("\n")
  .includes(APPROVAL_LABEL);

const decision = gateDecision({
  hasFindings: findings.length > 0,
  labelPresent,
  trigger: gateTrigger({
    action: text(field(event, "action")) ?? "",
    label: text(field(event, "label", "name")),
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? "1"),
    migrationsChanged: migrationsChangedByPush,
  }),
});

if (decision.addLabel) {
  run("gh", ["api", "--method", "POST", issueLabels, "-f", `labels[]=${APPROVAL_LABEL}`]);
}

const summary = gateSummary({ outcome: decision.outcome, findings });
console.log(summary);
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile !== undefined) appendFileSync(summaryFile, summary);

if (decision.outcome === "awaiting-approval") {
  console.log(
    `::error::Migration non additive : retirez le label ${APPROVAL_LABEL} pour l'approuver.`,
  );
  process.exitCode = 1;
}
