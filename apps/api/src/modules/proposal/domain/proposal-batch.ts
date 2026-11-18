import type { BatchState, ProposalBatch } from "./proposal.ts";

export const closedBatch = (batch: ProposalBatch): ProposalBatch => ({ ...batch, state: "closed" });

export const declareBatch = ({
  current,
  declared,
}: {
  readonly current: ProposalBatch | undefined;
  readonly declared: ProposalBatch;
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
