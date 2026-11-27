import { and, eq, inArray, max } from "drizzle-orm";

import type { PostgresDatabase, PostgresTransaction } from "#db";
import type { HistoryWriter } from "#modules/history/contracts/history-writer.ts";
import type { ProjectLock } from "#modules/project/contracts/project-lock.ts";
import type { StorageMeter } from "#modules/project/contracts/storage-meter.ts";
import type { StorageAlertDecision } from "#modules/space/contracts/storage-alert.ts";
import { schema } from "@repo/db";

import type { ModeStore, ModeUnitOfWork } from "../application/add-mode.ts";
import type { PendingProposals } from "../application/add-token.ts";
import { insertValues, postgresModeReader } from "./postgres-tokens.ts";

const { mode, modifier, token, tokenValue, tokenValueReference } = schema;

const postgresModeStore = (
  tx: PostgresTransaction,
  {
    projectLock,
    meter,
    newId,
  }: {
    readonly projectLock: ProjectLock;
    readonly meter: StorageMeter;
    readonly newId: () => string;
  },
): ModeStore => ({
  lock: async (projectId) => {
    await projectLock.exclusive(projectId);
    return postgresModeReader(tx).modesOf(projectId);
  },
  validatedValuesOf: async ({ projectId, modeId }) => {
    const values = await tx
      .select({
        id: tokenValue.id,
        tokenId: tokenValue.tokenId,
        value: tokenValue.value,
        referencedTokenId: tokenValue.referencedTokenId,
      })
      .from(tokenValue)
      .innerJoin(token, eq(token.id, tokenValue.tokenId))
      .where(
        and(
          eq(token.projectId, projectId),
          eq(token.status, "validated"),
          eq(tokenValue.modeId, modeId),
        ),
      );
    const references =
      values.length === 0
        ? []
        : await tx
            .select({
              tokenValueId: tokenValueReference.tokenValueId,
              field: tokenValueReference.field,
              referencedTokenId: tokenValueReference.referencedTokenId,
            })
            .from(tokenValueReference)
            .where(
              inArray(
                tokenValueReference.tokenValueId,
                values.map(({ id }) => id),
              ),
            );
    return values.map(({ id, tokenId, value, referencedTokenId }) => ({
      tokenId,
      value: {
        modeId,
        value,
        referencedTokenId,
        fieldReferences: references
          .filter(({ tokenValueId }) => tokenValueId === id)
          .map(({ field, referencedTokenId: fieldTokenId }) => ({
            field,
            referencedTokenId: fieldTokenId,
          })),
      },
    }));
  },
  append: async ({ projectId, mode: added, values }) => {
    const [row] = await tx
      .select({ modifierId: modifier.id, last: max(mode.position) })
      .from(modifier)
      .innerJoin(mode, eq(mode.modifierId, modifier.id))
      .where(eq(modifier.projectId, projectId))
      .groupBy(modifier.id);
    if (row === undefined) {
      throw new Error("Projet sans modes : aucun modificateur où ajouter le mode");
    }
    await tx.insert(mode).values({
      id: added.id,
      modifierId: row.modifierId,
      name: added.name,
      position: (row.last ?? -1) + 1,
    });
    if (values.length === 0) {
      return;
    }
    const written = await insertValues(tx, {
      newId,
      valuesOf: values.map(({ tokenId, value }) => ({ tokenId, values: [value] })),
    });
    await meter.add(projectId, written);
  },
});

export const postgresModeUnitOfWork = ({
  db,
  projectLockOn,
  historyWriterOn,
  proposalReplacerOn,
  storageMeterOn,
  storageAlertOn,
  newId,
}: {
  readonly db: PostgresDatabase;
  readonly projectLockOn: (tx: PostgresTransaction) => ProjectLock;
  readonly historyWriterOn: (tx: PostgresTransaction) => HistoryWriter;
  readonly proposalReplacerOn: (tx: PostgresTransaction) => PendingProposals;
  readonly storageMeterOn: (tx: PostgresTransaction) => StorageMeter;
  readonly storageAlertOn: (tx: PostgresTransaction) => StorageAlertDecision;
  readonly newId: () => string;
}): ModeUnitOfWork => ({
  run: (work) =>
    db.orm.transaction((tx) =>
      work({
        modes: postgresModeStore(tx, {
          projectLock: projectLockOn(tx),
          meter: storageMeterOn(tx),
          newId,
        }),
        proposals: proposalReplacerOn(tx),
        history: historyWriterOn(tx),
        storageAlert: storageAlertOn(tx),
      }),
    ),
});
