import { createHash } from "node:crypto";

import { APPROVAL_LABEL } from "./maintainer-approval.ts";
import type { MigrationFinding } from "./migration-findings.ts";

export type IssueComment = {
  readonly id: number;
  readonly author: string;
  readonly authorType: string;
  readonly body: string;
};

const GATE_AUTHOR = "github-actions[bot]";
const RECORD_HEADER = /<!-- migration-gate: ([0-9a-f]{64}) -->/;

export const approvalFingerprint = ({
  findings,
  read,
}: {
  readonly findings: readonly MigrationFinding[];
  readonly read: (path: string) => string;
}): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        findings
          .map(({ path, kind }) => ({
            path,
            kind,
            content: kind === "deleted" ? null : read(path),
          }))
          .toSorted((first, second) => first.path.localeCompare(second.path)),
      ),
    )
    .digest("hex");

export const approvalRecordBody = (fingerprint: string): string =>
  [
    `<!-- migration-gate: ${fingerprint} -->`,
    `Le label \`${APPROVAL_LABEL}\` garde les migrations non additives d'empreinte ` +
      `\`${fingerprint.slice(0, 12)}\`. Le retirer les approuve ; ` +
      "un changement de leur contenu le remet.",
  ].join("\n");

export const approvalRecord = (
  comments: readonly IssueComment[],
): { readonly id: number; readonly fingerprint: string } | undefined =>
  comments
    .filter(({ author, authorType }) => author === GATE_AUTHOR && authorType === "Bot")
    .flatMap(({ id, body }) => {
      const fingerprint = RECORD_HEADER.exec(body)?.[1];
      if (fingerprint === undefined || body !== approvalRecordBody(fingerprint)) return [];
      return [{ id, fingerprint }];
    })
    .toSorted((first, second) => first.id - second.id)
    .at(-1);
