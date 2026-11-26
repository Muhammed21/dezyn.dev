import { contrastBackgrounds } from "./contrast-pairs.ts";
import { referencedNames } from "./field-references.ts";
import type { TokenDefinition } from "./token.ts";

export type CitationVia = "alias" | "field" | "contrastOn";

export type Citation = {
  readonly cited: string;
  readonly citing: string;
  readonly via: CitationVia;
};

export interface CitationReader {
  citationsOf(cited: {
    readonly projectId: string;
    readonly names: readonly string[];
  }): Promise<readonly Citation[]>;
}

export type CitedToken = { readonly code: "cited_token"; readonly citations: readonly Citation[] };

const VIA_LABELS: Readonly<Record<CitationVia, string>> = {
  alias: "alias",
  field: "champ",
  contrastOn: "paire de contraste",
};

const contrastBackgroundNames = ({ $extensions }: TokenDefinition): readonly string[] =>
  contrastBackgrounds($extensions).map(({ name }) => name);

const CITED_NAMES: Readonly<Record<CitationVia, (token: TokenDefinition) => readonly string[]>> = {
  alias: referencedNames,
  field: referencedNames,
  contrastOn: contrastBackgroundNames,
};

export const stillCites = (token: TokenDefinition, { cited, via }: Citation): boolean =>
  CITED_NAMES[via](token).includes(cited);

export const citationMessage = (citations: readonly Citation[]): string => {
  const named = [
    ...new Set(citations.map(({ citing, via }) => `${citing} (${VIA_LABELS[via]})`)),
  ].toSorted();
  return `Token encore cité : ${named.join(", ")}`;
};
