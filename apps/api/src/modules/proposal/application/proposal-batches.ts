import type { ProjectSignals } from "#modules/project/contracts/project-signals.ts";
import { err, ok, type Result } from "@repo/result";

import {
  batchExpirySignal,
  closedBatch,
  declareBatch,
  batchStateAt,
  designatedBatch,
  type DesignationRefusal,
} from "../domain/proposal-batch.ts";
import type { ProposalBatch, RecipeBatch } from "../domain/proposal.ts";
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

export const designatedBatchOf = async (
  store: ProposalStore,
  {
    batchId,
    writer,
    now,
  }: { readonly batchId: string; readonly writer: Writer; readonly now: Date },
): Promise<Result<RecipeBatch, DesignationRefusal>> => {
  const designated = designatedBatch({
    batch: await store.findBatch(batchId),
    caller: writer,
    now,
  });
  return "refusal" in designated ? err(designated.refusal) : ok(designated.batch);
};

export type OpenedBatch = {
  readonly batch: RecipeBatch;
  readonly closed: ProposalBatch | null;
};

export type ClosedBatch = { readonly batch: RecipeBatch | null };

const implicit = (batch: ProposalBatch): RecipeBatch => ({ ...batch, recipe: null });

const liveOrNull = (batch: ProposalBatch | undefined): RecipeBatch | null =>
  batch === undefined ? null : implicit(batch);

const declaredBatch = async (
  store: ProposalStore,
  {
    candidate,
    recipe,
    writer,
  }: {
    readonly candidate: ProposalBatch & Writer;
    readonly recipe: string | undefined;
    readonly writer: Writer;
  },
): Promise<OpenedBatch> => {
  if (recipe !== undefined) {
    return { batch: await store.openDesignatedBatch({ ...candidate, recipe }), closed: null };
  }
  const { batch, closed } = declareBatch({
    current: await liveBatchOf(store, { writer, now: candidate.openedAt }),
    declared: candidate,
  });
  if (closed !== null) {
    await store.closeBatch(closed.id);
  }
  return { batch: implicit(await store.openBatchOf(batch)), closed };
};

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
  async ({
    intent,
    recipe,
    ...writer
  }: Writer & { readonly intent: string; readonly recipe?: string }): Promise<OpenedBatch> => {
    const opened = await unitOfWork.run(async ({ store }) => {
      const openedAt = now();
      return declaredBatch(store, {
        candidate: {
          id: newId(),
          ...writer,
          intent,
          state: "open",
          openedAt,
          lastWrittenAt: openedAt,
        },
        recipe,
        writer,
      });
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
  async ({
    batchId,
    ...writer
  }: Writer & { readonly batchId?: string }): Promise<Result<ClosedBatch, DesignationRefusal>> => {
    const closed = await unitOfWork.run(
      async ({ store }): Promise<Result<ClosedBatch, DesignationRefusal>> => {
        const at = now();
        const current =
          batchId === undefined
            ? ok(liveOrNull(await liveBatchOf(store, { writer, now: at })))
            : await designatedBatchOf(store, { batchId, writer, now: at });
        if (!current.ok) {
          return err(current.error);
        }
        if (current.value === null) {
          return ok({ batch: null });
        }
        await store.closeBatch(current.value.id);
        return ok({ batch: closedBatch(current.value) });
      },
    );
    if (closed.ok && closed.value.batch !== null) {
      await signals.changed({ projectId: writer.projectId, topics: ["proposals"] });
    }
    return closed;
  };
