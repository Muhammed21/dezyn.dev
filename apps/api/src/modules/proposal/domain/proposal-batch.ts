import type { BatchState, ProposalBatch } from "./proposal.ts";

export const closedBatch = <Batch extends ProposalBatch>(batch: Batch): Batch => ({
  ...batch,
  state: "closed",
});

export const declareBatch = <Declared extends ProposalBatch>({
  current,
  declared,
}: {
  readonly current: ProposalBatch | undefined;
  readonly declared: Declared;
}) => ({ batch: declared, closed: current === undefined ? null : closedBatch(current) });

const IDLE_LIMIT_MS = 30 * 60 * 1000;

const EXPIRY_MARGIN_MS = 1000;

export const batchExpirySignal = ({
  projectId,
  batchId,
  lastWrittenAt,
}: {
  readonly projectId: string;
  readonly batchId: string;
  readonly lastWrittenAt: Date;
}) => ({
  projectId,
  key: `batch:${batchId}`,
  topics: ["proposals" as const],
  at: new Date(lastWrittenAt.getTime() + IDLE_LIMIT_MS + EXPIRY_MARGIN_MS),
});

export const batchStateAt = ({
  batch,
  now,
}: {
  readonly batch: Pick<ProposalBatch, "state" | "lastWrittenAt">;
  readonly now: Date;
}): BatchState =>
  batch.state === "open" && now.getTime() - batch.lastWrittenAt.getTime() < IDLE_LIMIT_MS
    ? "open"
    : "closed";

export type DesignationRefusal = "unknown_batch" | "closed_batch";

export const designatedBatch = <Designated extends ProposalBatch>({
  batch,
  caller,
  now,
}: {
  readonly batch: Designated | undefined;
  readonly caller: Pick<ProposalBatch, "projectId" | "clientId"> & { readonly userId: string };
  readonly now: Date;
}): { readonly batch: Designated } | { readonly refusal: DesignationRefusal } => {
  if (
    batch === undefined ||
    batch.projectId !== caller.projectId ||
    batch.userId !== caller.userId ||
    batch.clientId !== caller.clientId
  ) {
    return { refusal: "unknown_batch" };
  }
  return batchStateAt({ batch, now }) === "open" ? { batch } : { refusal: "closed_batch" };
};
