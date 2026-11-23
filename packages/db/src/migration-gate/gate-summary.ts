import type { GateDecision } from "./gate-decision.ts";
import { APPROVAL_LABEL } from "./maintainer-approval.ts";
import type { MigrationFinding } from "./migration-findings.ts";

const HEADLINES: Readonly<Record<GateDecision["outcome"], string>> = {
  accepted: "Aucune migration non additive.",
  "awaiting-approval": `Migrations non additives : retirez le label \`${APPROVAL_LABEL}\` pour les approuver.`,
  approved: `Migrations non additives, approuvées par le retrait du label \`${APPROVAL_LABEL}\`.`,
};

const REASONS: Readonly<Record<MigrationFinding["kind"], string>> = {
  "non-additive": "Instructions hors de la liste additive :",
  modified: "Migration déjà présente sur `main`, modifiée par la PR.",
  deleted: "Migration déjà présente sur `main`, supprimée par la PR.",
};

const findingSection = ({ path, kind, statements }: MigrationFinding): readonly string[] => [
  `### \`${path}\``,
  "",
  REASONS[kind],
  "",
  ...(statements.length === 0
    ? []
    : ["```sql", ...statements.map((statement) => `${statement};`), "```", ""]),
];

export const gateSummary = ({
  outcome,
  findings,
}: {
  readonly outcome: GateDecision["outcome"];
  readonly findings: readonly MigrationFinding[];
}): string =>
  ["## Migration gate", "", HEADLINES[outcome], "", ...findings.flatMap(findingSection)].join("\n");
