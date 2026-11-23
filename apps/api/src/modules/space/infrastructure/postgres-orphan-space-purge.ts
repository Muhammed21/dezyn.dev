import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  notExists,
  sql,
  TransactionRollbackError,
} from "drizzle-orm";
import { z } from "zod";

import type { PostgresDatabase, PostgresTransaction } from "#db";
import { schema } from "@repo/db";

import type {
  OrphanPurgeStep,
  OrphanPurgeUnitOfWork,
  OrphanSpaces,
} from "../application/purge-orphan-spaces.ts";
import type { OrphanSpace } from "../domain/orphan-space.ts";

const {
  historyAuthor,
  historyEntry,
  mode,
  modifier,
  project,
  proposal,
  proposalBatch,
  space,
  spaceInvitation,
  spaceMember,
  spacePlanChange,
  spaceSubscription,
  token,
  tokenFigmaState,
  tokenValue,
} = schema;

export const ORPHAN_PURGE_BATCH_SIZE = 500;

const StoredOrphan = z
  .object({
    spaceId: z.string(),
    status: z.string().nullable(),
    currentPeriodEnd: z.date().nullable(),
    cancelRequestedAt: z.date().nullable(),
  })
  .transform(({ spaceId, status, currentPeriodEnd, cancelRequestedAt }): OrphanSpace => ({
    spaceId,
    subscription:
      status === null
        ? undefined
        : {
            status,
            currentPeriodEnd: currentPeriodEnd ?? undefined,
            cancelRequested: cancelRequestedAt !== null,
          },
  }));

const LockTaken = z.object({ taken: z.boolean() });

export const postgresOrphanPurgeLock = (tx: PostgresTransaction) => ({
  tryTake: async (spaceId: string): Promise<boolean> => {
    const { rows } = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`orphan-space-purge:${spaceId}`}, 0)) AS taken`,
    );
    return LockTaken.parse(rows[0]).taken;
  },
});

const orphans = (orm: Pick<PostgresTransaction, "select">) =>
  orm
    .select({
      spaceId: space.id,
      status: spaceSubscription.status,
      currentPeriodEnd: spaceSubscription.currentPeriodEnd,
      cancelRequestedAt: spaceSubscription.cancelRequestedAt,
    })
    .from(space)
    .leftJoin(spaceSubscription, eq(spaceSubscription.spaceId, space.id))
    .$dynamic();

const noOpenMember = (orm: Pick<PostgresTransaction, "select">) =>
  notExists(
    orm
      .select({ id: spaceMember.id })
      .from(spaceMember)
      .where(and(eq(spaceMember.spaceId, space.id), isNull(spaceMember.closedAt))),
  );

export const postgresOrphanSpaces = (db: PostgresDatabase): OrphanSpaces => ({
  list: async () =>
    z
      .array(StoredOrphan)
      .parse(await orphans(db.orm).where(noOpenMember(db.orm)).orderBy(asc(space.id))),
});

const purgeProjectHistory = async (tx: PostgresTransaction, projectId: string) => {
  const { rowCount } = await tx
    .delete(historyEntry)
    .where(
      inArray(
        historyEntry.id,
        tx
          .select({ id: historyEntry.id })
          .from(historyEntry)
          .where(eq(historyEntry.projectId, projectId))
          .limit(ORPHAN_PURGE_BATCH_SIZE),
      ),
    );
  return (rowCount ?? 0) > 0;
};

const purgeProject = async (tx: PostgresTransaction, projectId: string) => {
  const tokens = tx.select({ id: token.id }).from(token).where(eq(token.projectId, projectId));
  const modifiers = tx
    .select({ id: modifier.id })
    .from(modifier)
    .where(eq(modifier.projectId, projectId));
  await tx.delete(tokenFigmaState).where(inArray(tokenFigmaState.tokenId, tokens));
  await tx.delete(tokenValue).where(inArray(tokenValue.tokenId, tokens));
  await tx.delete(token).where(eq(token.projectId, projectId));
  await tx.delete(mode).where(inArray(mode.modifierId, modifiers));
  await tx.delete(modifier).where(eq(modifier.projectId, projectId));
  await tx.delete(proposal).where(eq(proposal.projectId, projectId));
  await tx.delete(proposalBatch).where(eq(proposalBatch.projectId, projectId));
  await tx.delete(project).where(eq(project.id, projectId));
};

const purgeSpaceRows = async (tx: PostgresTransaction, spaceId: string) => {
  await tx.delete(spacePlanChange).where(eq(spacePlanChange.spaceId, spaceId));
  await tx.delete(spaceSubscription).where(eq(spaceSubscription.spaceId, spaceId));
  await tx.delete(spaceMember).where(eq(spaceMember.spaceId, spaceId));
  await tx.delete(historyAuthor).where(eq(historyAuthor.spaceId, spaceId));
  await tx.delete(space).where(eq(space.id, spaceId));
};

const nextStep = async (tx: PostgresTransaction, spaceId: string): Promise<OrphanPurgeStep> => {
  const [next] = await tx
    .select({ id: project.id })
    .from(project)
    .where(eq(project.spaceId, spaceId))
    .orderBy(asc(project.id))
    .limit(1);
  if (next === undefined) {
    await purgeSpaceRows(tx, spaceId);
    return "purged";
  }
  if (!(await purgeProjectHistory(tx, next.id))) {
    await purgeProject(tx, next.id);
  }
  return "continued";
};

const SKIPPED = "skipped";

export const postgresOrphanPurgeUnitOfWork = (db: PostgresDatabase): OrphanPurgeUnitOfWork => ({
  step: async ({ spaceId, purgeable }) => {
    try {
      return await db.orm.transaction(async (tx) => {
        if (!(await postgresOrphanPurgeLock(tx).tryTake(spaceId))) {
          return SKIPPED;
        }
        await tx.delete(spaceInvitation).where(eq(spaceInvitation.spaceId, spaceId));
        const [row] = await orphans(tx).where(and(eq(space.id, spaceId), noOpenMember(tx)));
        if (row === undefined || !purgeable(StoredOrphan.parse(row).subscription)) {
          tx.rollback();
        }
        return nextStep(tx, spaceId);
      });
    } catch (error) {
      if (error instanceof TransactionRollbackError) {
        return SKIPPED;
      }
      throw error;
    }
  },
});
