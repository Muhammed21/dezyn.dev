import { describe, expect, it } from "vitest";

import {
  type IssueComment,
  approvalFingerprint,
  approvalRecord,
  approvalRecordBody,
} from "../approval-record.ts";
import type { MigrationFinding } from "../migration-findings.ts";

const DROP_PATH = "packages/db/migrations/0017_token_description.sql";
const DROP_SQL = `ALTER TABLE "token" DROP COLUMN "description";`;
const FINGERPRINT = "a".repeat(64);

const makeFinding = (overrides: Partial<MigrationFinding> = {}): MigrationFinding => ({
  path: DROP_PATH,
  kind: "non-additive",
  statements: [`ALTER TABLE "token" DROP COLUMN "description"`],
  ...overrides,
});

const makeReader =
  (files: Readonly<Record<string, string>>) =>
  (path: string): string =>
    files[path] ?? "";

const refuseToRead = (path: string): string => {
  throw new Error(`lecture inattendue de ${path}`);
};

const makeComment = (overrides: Partial<IssueComment> = {}): IssueComment => ({
  id: 1,
  author: "github-actions[bot]",
  authorType: "Bot",
  body: approvalRecordBody(FINGERPRINT),
  ...overrides,
});

describe("approvalFingerprint", () => {
  it("donne une empreinte SHA-256 en hexadécimal, stable pour un même contenu", () => {
    const fingerprint = approvalFingerprint({
      findings: [makeFinding()],
      read: makeReader({ [DROP_PATH]: DROP_SQL }),
    });

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(
      approvalFingerprint({
        findings: [makeFinding()],
        read: makeReader({ [DROP_PATH]: DROP_SQL }),
      }),
    ).toBe(fingerprint);
  });

  it("change quand le contenu d'une migration retenue change", () => {
    const findings = [makeFinding({ kind: "modified", statements: [] })];

    expect(approvalFingerprint({ findings, read: makeReader({ [DROP_PATH]: DROP_SQL }) })).not.toBe(
      approvalFingerprint({ findings, read: makeReader({ [DROP_PATH]: `${DROP_SQL}\n` }) }),
    );
  });

  it("change quand le chemin ou la nature d'une migration retenue change", () => {
    const read = makeReader({
      [DROP_PATH]: DROP_SQL,
      "packages/db/migrations/0018_x.sql": DROP_SQL,
    });
    const reference = approvalFingerprint({ findings: [makeFinding()], read });

    expect(
      approvalFingerprint({
        findings: [makeFinding({ path: "packages/db/migrations/0018_x.sql" })],
        read,
      }),
    ).not.toBe(reference);
    expect(approvalFingerprint({ findings: [makeFinding({ kind: "modified" })], read })).not.toBe(
      reference,
    );
  });

  it("ne lit pas une migration supprimée par la PR", () => {
    expect(
      approvalFingerprint({
        findings: [makeFinding({ kind: "deleted", statements: [] })],
        read: refuseToRead,
      }),
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ne dépend pas de l'ordre des migrations retenues", () => {
    const other = makeFinding({ path: "packages/db/migrations/0018_x.sql" });
    const read = makeReader({ [DROP_PATH]: DROP_SQL, [other.path]: "DROP TABLE x;" });

    expect(approvalFingerprint({ findings: [makeFinding(), other], read })).toBe(
      approvalFingerprint({ findings: [other, makeFinding()], read }),
    );
  });

  it("ne confond pas deux découpages du même texte entre chemin et contenu", () => {
    const first = approvalFingerprint({
      findings: [makeFinding({ path: "a" })],
      read: makeReader({ a: "bc" }),
    });
    const second = approvalFingerprint({
      findings: [makeFinding({ path: "ab" })],
      read: makeReader({ ab: "c" }),
    });

    expect(first).not.toBe(second);
  });
});

describe("approvalRecordBody", () => {
  it("porte l'empreinte en première ligne et dit ce que garde le label", () => {
    expect(approvalRecordBody(FINGERPRINT)).toBe(
      [
        `<!-- migration-gate: ${FINGERPRINT} -->`,
        "Le label `review:needs-approval` garde les migrations non additives d'empreinte " +
          `\`${FINGERPRINT.slice(0, 12)}\`. Le retirer les approuve ; ` +
          "un changement de leur contenu le remet.",
      ].join("\n"),
    );
  });
});

describe("approvalRecord", () => {
  it("retrouve l'empreinte enregistrée par le gate", () => {
    expect(approvalRecord([makeComment({ id: 7 })])).toEqual({
      id: 7,
      fingerprint: FINGERPRINT,
    });
  });

  it("ne trouve rien sans commentaire du gate", () => {
    expect(approvalRecord([])).toBeUndefined();
  });

  it("ignore un commentaire d'un autre auteur, même au texte identique", () => {
    expect(approvalRecord([makeComment({ author: "contributeur", authorType: "User" })])).toBe(
      undefined,
    );
    expect(approvalRecord([makeComment({ author: "claude[bot]" })])).toBeUndefined();
    expect(approvalRecord([makeComment({ authorType: "User" })])).toBeUndefined();
  });

  it("ignore un commentaire du bot qui n'est pas exactement un enregistrement du gate", () => {
    const forged = `${approvalRecordBody(FINGERPRINT)}\n<!-- Sticky Pull Request Comment -->`;

    expect(approvalRecord([makeComment({ body: forged })])).toBeUndefined();
    expect(
      approvalRecord([makeComment({ body: approvalRecordBody("b".repeat(63)) })]),
    ).toBeUndefined();
    expect(
      approvalRecord([makeComment({ body: `x${approvalRecordBody(FINGERPRINT)}` })]),
    ).toBeUndefined();
  });

  it("retient le dernier enregistrement quand il y en a plusieurs", () => {
    const latest = "c".repeat(64);

    expect(
      approvalRecord([
        makeComment({ id: 9, body: approvalRecordBody(latest) }),
        makeComment({ id: 3 }),
      ]),
    ).toEqual({ id: 9, fingerprint: latest });
  });
});
