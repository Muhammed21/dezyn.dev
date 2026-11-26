import { referencesFirst } from "#modules/token/contracts/token-definition.ts";

import type { BatchState, Proposal } from "./proposal.ts";

export type BatchPlan =
  | { readonly refusal: "batch_open" }
  | { readonly refusal: "unknown_propositions"; readonly ids: readonly string[] }
  | { readonly toValidate: readonly Proposal[]; readonly toReject: readonly Proposal[] };

export const planBatchValidation = ({
  batchState,
  proposals,
  rejected,
}: {
  readonly batchState: BatchState;
  readonly proposals: readonly Proposal[];
  readonly rejected: readonly string[];
}): BatchPlan => {
  if (batchState === "open") {
    return { refusal: "batch_open" };
  }
  const unknown = rejected.filter((id) => !proposals.some((proposal) => proposal.id === id));
  if (unknown.length > 0) {
    return { refusal: "unknown_propositions", ids: unknown };
  }
  const proposed = proposals.filter(({ status }) => status === "proposed");
  const validated = proposed.filter(({ id }) => !rejected.includes(id));
  return {
    toValidate: [
      ...referencesFirst(
        validated.filter(({ kind }) => kind !== "delete"),
        ({ token }) => token,
      ),
      ...validated.filter(({ kind }) => kind === "delete"),
    ],
    toReject: proposed.filter(({ id }) => rejected.includes(id)),
  };
};
