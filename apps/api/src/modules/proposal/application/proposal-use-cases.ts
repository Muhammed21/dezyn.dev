import type { deleteTokens } from "./delete-tokens.ts";
import type { closeBatch, openBatch } from "./proposal-batches.ts";
import type {
  batchOf,
  listBatches,
  pendingProposalsOf,
  projectOfBatch,
  projectOfProposal,
  reviewProposal,
  validateBatch,
} from "./review-proposals.ts";
import type { writeTokens } from "./write-tokens.ts";

export type ProposalUseCases = {
  readonly writeTokens: ReturnType<typeof writeTokens>;
  readonly deleteTokens: ReturnType<typeof deleteTokens>;
  readonly openBatch: ReturnType<typeof openBatch>;
  readonly closeBatch: ReturnType<typeof closeBatch>;
  readonly listBatches: ReturnType<typeof listBatches>;
  readonly batchOf: ReturnType<typeof batchOf>;
  readonly reviewProposal: ReturnType<typeof reviewProposal>;
  readonly validateBatch: ReturnType<typeof validateBatch>;
  readonly pendingProposalsOf: ReturnType<typeof pendingProposalsOf>;
  readonly projectOfProposal: ReturnType<typeof projectOfProposal>;
  readonly projectOfBatch: ReturnType<typeof projectOfBatch>;
};
