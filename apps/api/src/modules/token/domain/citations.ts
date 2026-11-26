export type CitationVia = "alias" | "field";

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
};

export const citationMessage = (citations: readonly Citation[]): string => {
  const named = [
    ...new Set(citations.map(({ citing, via }) => `${citing} (${VIA_LABELS[via]})`)),
  ].toSorted();
  return `Token encore cité : ${named.join(", ")}`;
};
