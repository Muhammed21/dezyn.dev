import { describe, expect, it } from "vitest";

import { gateSummary } from "../gate-summary.ts";
import type { MigrationFinding } from "../migration-findings.ts";

const makeFinding = (overrides: Partial<MigrationFinding> = {}): MigrationFinding => ({
  path: "packages/db/migrations/0017_token_description.sql",
  kind: "non-additive",
  statements: [`ALTER TABLE "token" DROP COLUMN "description"`],
  ...overrides,
});

describe("gateSummary", () => {
  it("dit qu'une PR sans migration non additive passe", () => {
    expect(gateSummary({ outcome: "accepted", findings: [] })).toBe(
      "## Migration gate\n\nAucune migration non additive.\n",
    );
  });

  it("nomme le fichier et l'instruction en cause, et dit comment approuver", () => {
    const summary = gateSummary({ outcome: "awaiting-approval", findings: [makeFinding()] });

    expect(summary).toBe(
      [
        "## Migration gate",
        "",
        "Migrations non additives : retirez le label `review:needs-approval` pour les approuver.",
        "",
        "### `packages/db/migrations/0017_token_description.sql`",
        "",
        "Instructions hors de la liste additive :",
        "",
        "```sql",
        `ALTER TABLE "token" DROP COLUMN "description";`,
        "```",
        "",
      ].join("\n"),
    );
  });

  it.each([
    { kind: "modified", reason: "Migration déjà présente sur `main`, modifiée par la PR." },
    { kind: "deleted", reason: "Migration déjà présente sur `main`, supprimée par la PR." },
  ] as const)("explique une migration de main $kind", ({ kind, reason }) => {
    const finding = makeFinding({
      path: "packages/db/migrations/0014_identity_rate_limit.sql",
      kind,
      statements: [],
    });

    expect(gateSummary({ outcome: "awaiting-approval", findings: [finding] })).toBe(
      [
        "## Migration gate",
        "",
        "Migrations non additives : retirez le label `review:needs-approval` pour les approuver.",
        "",
        "### `packages/db/migrations/0014_identity_rate_limit.sql`",
        "",
        reason,
        "",
      ].join("\n"),
    );
  });

  it("dit des migrations approuvées qu'elles l'ont été par le retrait du label", () => {
    const summary = gateSummary({ outcome: "approved", findings: [makeFinding()] });

    expect(summary).toContain(
      "Migrations non additives, approuvées par le retrait du label `review:needs-approval`.",
    );
    expect(summary).toContain(`ALTER TABLE "token" DROP COLUMN "description";`);
  });
});
