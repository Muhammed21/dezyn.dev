import {
  type ComparedDefinition,
  referencedNames,
  sameDefinition,
  type TokenDefinition,
} from "#modules/token/contracts/token-definition.ts";
import type { Citation } from "#modules/token/contracts/token-issues.ts";

import type { Proposal, ProposalKind } from "./proposal.ts";

export type RequestedChange = {
  readonly kind: "write" | "delete";
  readonly token: TokenDefinition;
};

export type PlannedChange = {
  readonly token: TokenDefinition;
  readonly kind: ProposalKind;
  readonly replaces: Proposal | undefined;
  readonly unchanged: boolean;
};

const plannedDeletion = (token: TokenDefinition, waiting: Proposal | undefined): PlannedChange => {
  const alreadyWaiting = waiting?.kind === "delete";
  return {
    token,
    kind: "delete",
    replaces: alreadyWaiting ? undefined : waiting,
    unchanged: alreadyWaiting,
  };
};

export const plannedChange = ({
  change: { kind, token },
  validated,
  waiting,
}: {
  readonly change: RequestedChange;
  readonly validated: ComparedDefinition | undefined;
  readonly waiting: Proposal | undefined;
}): PlannedChange => {
  if (kind === "delete") {
    return plannedDeletion(token, waiting);
  }
  const sameAsWaiting =
    waiting !== undefined && waiting.kind !== "delete" && sameDefinition(waiting.token, token);
  const sameAsValidated = validated !== undefined && sameDefinition(validated, token);
  return {
    token,
    kind: validated === undefined ? "create" : "update",
    replaces: sameAsWaiting ? undefined : waiting,
    unchanged: sameAsWaiting || sameAsValidated,
  };
};

export type DeletionFailure =
  | { readonly code: "duplicate_name" }
  | { readonly code: "unknown_token" }
  | { readonly code: "pending_creation" };

export type DeletionRefusal = { readonly index: number; readonly failure: DeletionFailure };

const deletionFailure = (
  name: string,
  index: number,
  {
    names,
    validatedNames,
    pendingNames,
  }: {
    readonly names: readonly string[];
    readonly validatedNames: readonly string[];
    readonly pendingNames: readonly string[];
  },
): DeletionFailure | undefined => {
  if (names.indexOf(name) !== index) {
    return { code: "duplicate_name" };
  }
  if (validatedNames.includes(name)) {
    return undefined;
  }
  return pendingNames.includes(name) ? { code: "pending_creation" } : { code: "unknown_token" };
};

export const deletionRefusals = (known: {
  readonly names: readonly string[];
  readonly validatedNames: readonly string[];
  readonly pendingNames: readonly string[];
}): readonly DeletionRefusal[] =>
  known.names.flatMap((name, index): readonly DeletionRefusal[] => {
    const failure = deletionFailure(name, index, known);
    return failure === undefined ? [] : [{ index, failure }];
  });

const stillCites = (citation: Citation, pendingInBatch: readonly Proposal[]): boolean =>
  pendingInBatch
    .filter(({ name }) => name === citation.citing)
    .every(
      ({ kind, token }) => kind !== "delete" && referencedNames(token).includes(citation.cited),
    );

export const remainingCitations = ({
  citations,
  pendingInBatch,
}: {
  readonly citations: readonly Citation[];
  readonly pendingInBatch: readonly Proposal[];
}): readonly Citation[] => citations.filter((citation) => stillCites(citation, pendingInBatch));
