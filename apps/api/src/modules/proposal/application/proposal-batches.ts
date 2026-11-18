import type { ProjectSignals } from "#modules/project/contracts/project-signals.ts";

import {
  batchExpirySignal,
  closedBatch,
  declareBatch,
  batchStateAt,
} from "../domain/proposal-batch.ts";
import type { ProposalBatch } from "../domain/proposal.ts";
import type { ProposalStore, ProposalUnitOfWork, Writer } from "./write-tokens.ts";

export const liveBatchOf = async (
  store: ProposalStore,
  { writer, now }: { readonly writer: Writer; readonly now: Date },
): Promise<ProposalBatch | undefined> => {
  const current = await store.findOpenBatch(writer);
  if (current === undefined || batchStateAt({ batch: current, now }) === "open") {
    return current;
  }
  await store.closeBatch(current.id);
  return undefined;
};

export type OpenedBatch = {
  readonly batch: ProposalBatch;
  readonly closed: ProposalBatch | null;
};

export type ClosedBatch = { readonly batch: ProposalBatch | null };

export const openBatch =
  ({
    unitOfWork,
    signals,
    newId,
    now,
  }: {
    readonly unitOfWork: ProposalUnitOfWork;
    readonly signals: ProjectSignals;
    readonly newId: () => string;
    readonly now: () => Date;
  }) =>
  async ({ intent, ...writer }: Writer & { readonly intent: string }): Promise<OpenedBatch> => {
    const opened = await unitOfWork.run(async ({ store }) => {
      const openedAt = now();
      const { batch, closed } = declareBatch({
        current: await liveBatchOf(store, { writer, now: openedAt }),
        declared: {
          id: newId(),
          ...writer,
          intent,
          state: "open",
          openedAt,
          lastWrittenAt: openedAt,
        },
      });
      if (closed !== null) {
        await store.closeBatch(closed.id);
      }
      return { batch: await store.openBatchOf(batch), closed };
    });
    await signals.changed({ projectId: writer.projectId, topics: ["proposals"] });
    await signals.signalAt(
      batchExpirySignal({
        projectId: writer.projectId,
        batchId: opened.batch.id,
        lastWrittenAt: opened.batch.lastWrittenAt,
      }),
    );
    return opened;
  };

export const closeBatch =
  ({
    unitOfWork,
    signals,
    now,
  }: {
    readonly unitOfWork: ProposalUnitOfWork;
    readonly signals: ProjectSignals;
    readonly now: () => Date;
  }) =>
  async (writer: Writer): Promise<ClosedBatch> => {
    const closed = await unitOfWork.run(async ({ store }): Promise<ClosedBatch> => {
      const current = await liveBatchOf(store, { writer, now: now() });
      if (current === undefined) {
        return { batch: null };
      }
      await store.closeBatch(current.id);
      return { batch: closedBatch(current) };
    });
    if (closed.batch !== null) {
      await signals.changed({ projectId: writer.projectId, topics: ["proposals"] });
    }
    return closed;
  };
