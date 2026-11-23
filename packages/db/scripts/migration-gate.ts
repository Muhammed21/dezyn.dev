import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

import {
  type IssueComment,
  approvalFingerprint,
  approvalRecord,
  approvalRecordBody,
} from "../src/migration-gate/approval-record.ts";
import { gateDecision } from "../src/migration-gate/gate-decision.ts";
import { gateSummary } from "../src/migration-gate/gate-summary.ts";
import {
  APPROVAL_LABEL,
  labelEvents,
  maintainerApprover,
} from "../src/migration-gate/maintainer-approval.ts";
import { migrationFindings, pullRequestFiles } from "../src/migration-gate/migration-findings.ts";

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
  execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const repository = required("GITHUB_REPOSITORY");
const pullRequestCheckout = required("PULL_REQUEST_CHECKOUT");
const event: unknown = JSON.parse(readFileSync(required("GITHUB_EVENT_PATH"), "utf8"));
const pullRequest = text(field(event, "pull_request", "number"));
const headSha = text(field(event, "pull_request", "head", "sha"));
if (pullRequest === undefined || headSha === undefined) {
  throw new Error("Événement sans pull_request.number ni pull_request.head.sha");
}
const issue = `repos/${repository}/issues/${pullRequest}`;

const readAtHead = (path: string): string =>
  run("git", ["-C", pullRequestCheckout, "show", `${headSha}:${path}`]);

const findings = migrationFindings({
  files: pullRequestFiles(
    run("gh", [
      "api",
      "--paginate",
      `repos/${repository}/pulls/${pullRequest}/files`,
      "--jq",
      '.[] | [.status, .filename, (.previous_filename // "")] | @tsv',
    ]),
  ),
  read: readAtHead,
});
const hasFindings = findings.length > 0;

const labelPresent = run("gh", ["api", `${issue}/labels`, "--jq", ".[].name"])
  .split("\n")
  .includes(APPROVAL_LABEL);

const LOGIN = /^[A-Za-z0-9-]+$/;

const roleOf = (login: string): string => {
  if (!LOGIN.test(login)) return "none";
  try {
    return run("gh", [
      "api",
      `repos/${repository}/collaborators/${login}/permission`,
      "--jq",
      ".role_name",
    ]).trim();
  } catch {
    return "none";
  }
};

const approverOf = (): string | undefined =>
  maintainerApprover({
    events: labelEvents(
      run("gh", [
        "api",
        "--paginate",
        `${issue}/events`,
        "--jq",
        '.[] | [.id, .event, (.label.name // ""), (.actor.login // ""), (.actor.type // ""), (.performed_via_github_app != null)] | @tsv',
      ]),
    ),
    roleOf,
  });

const comments = (): readonly IssueComment[] =>
  run("gh", [
    "api",
    "--paginate",
    `${issue}/comments`,
    "--jq",
    ".[] | {id, author: .user.login, authorType: .user.type, body} | @json",
  ])
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const comment: unknown = JSON.parse(line);
      return {
        id: Number(text(field(comment, "id"))),
        author: text(field(comment, "author")) ?? "",
        authorType: text(field(comment, "authorType")) ?? "",
        body: text(field(comment, "body")) ?? "",
      };
    });

const record = hasFindings ? approvalRecord(comments()) : undefined;
const approver = hasFindings && !labelPresent ? approverOf() : undefined;

const decision = gateDecision({
  hasFindings,
  labelPresent,
  approver,
  fingerprint: approvalFingerprint({ findings, read: readAtHead }),
  recordedFingerprint: record?.fingerprint,
});

if (decision.record !== undefined) {
  const body = approvalRecordBody(decision.record);
  if (record === undefined) {
    run("gh", ["api", "--method", "POST", `${issue}/comments`, "-f", `body=${body}`]);
  } else {
    run("gh", [
      "api",
      "--method",
      "PATCH",
      `repos/${repository}/issues/comments/${record.id}`,
      "-f",
      `body=${body}`,
    ]);
  }
}

if (decision.addLabel) {
  run("gh", ["api", "--method", "POST", `${issue}/labels`, "-f", `labels[]=${APPROVAL_LABEL}`]);
}

const summary = gateSummary({ outcome: decision.outcome, findings });
console.log(summary);
if (approver !== undefined) console.log(`Label ${APPROVAL_LABEL} retiré par ${approver}.`);
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile !== undefined) appendFileSync(summaryFile, summary);

if (decision.outcome === "awaiting-approval") {
  console.log(
    `::error::Migration non additive : le mainteneur retire le label ${APPROVAL_LABEL} pour l'approuver.`,
  );
  process.exitCode = 1;
}
