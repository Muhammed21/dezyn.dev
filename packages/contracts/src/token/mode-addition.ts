import { z } from "zod";

export const AddModeInput = z.object({
  name: z.string().trim().min(1).max(100),
  copiedFrom: z.string(),
});

export const AddedModeOutput = z.looseObject({
  mode: z.string(),
  copiedFrom: z.string(),
  modes: z.array(z.string()),
});

export const PENDING_PROPOSALS_PROBLEM_TYPE = "https://dezyn.dev/problems/pending-proposals";

export const PendingProposalsProblem = z.looseObject({
  type: z.literal(PENDING_PROPOSALS_PROBLEM_TYPE),
  title: z.string(),
  status: z.literal(400),
});
