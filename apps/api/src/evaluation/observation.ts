import { and, asc, eq, inArray } from "drizzle-orm";

import type { PostgresDatabase } from "#db";
import { schema } from "@repo/db";

export type ObservedProposal = {
  readonly name: string;
  readonly kind: string;
  readonly status: string;
};

export type ObservedBatch = {
  readonly id: string;
  readonly intent: string | null;
  readonly recipe: string | null;
  readonly state: string;
  readonly proposals: readonly ObservedProposal[];
};

export type ObservedToken = {
  readonly name: string;
  readonly figmaState: string | null;
  readonly declaredAt: Date | null;
};

export type ObservedEntry = {
  readonly id: string;
  readonly action: string;
  readonly outcome: unknown;
};

export type Observation = {
  readonly figmaFile: { readonly url: string; readonly key: string } | null;
  readonly modes: readonly string[];
  readonly tokens: readonly ObservedToken[];
  readonly batches: readonly ObservedBatch[];
  readonly history: readonly ObservedEntry[];
};

const outcomeOf = (after: unknown): unknown =>
  typeof after === "object" && after !== null && "outcome" in after ? after.outcome : undefined;

export const observeProject = async (
  db: PostgresDatabase,
  projectId: string,
): Promise<Observation> => {
  const [project] = await db.orm
    .select({ url: schema.project.figmaFileUrl, key: schema.project.figmaFileKey })
    .from(schema.project)
    .where(eq(schema.project.id, projectId));
  const modes = await db.orm
    .select({ name: schema.mode.name })
    .from(schema.mode)
    .innerJoin(schema.modifier, eq(schema.modifier.id, schema.mode.modifierId))
    .where(eq(schema.modifier.projectId, projectId))
    .orderBy(asc(schema.mode.position));
  const tokens = await db.orm
    .select({
      name: schema.token.name,
      figmaState: schema.tokenFigmaState.state,
      declaredAt: schema.tokenFigmaState.declaredAt,
    })
    .from(schema.token)
    .leftJoin(schema.tokenFigmaState, eq(schema.tokenFigmaState.tokenId, schema.token.id))
    .where(and(eq(schema.token.projectId, projectId), eq(schema.token.status, "validated")))
    .orderBy(asc(schema.token.name));
  const batches = await db.orm
    .select({
      id: schema.proposalBatch.id,
      intent: schema.proposalBatch.intent,
      recipe: schema.proposalBatch.recipe,
      state: schema.proposalBatch.state,
    })
    .from(schema.proposalBatch)
    .where(eq(schema.proposalBatch.projectId, projectId))
    .orderBy(asc(schema.proposalBatch.openedAt));
  const proposals =
    batches.length === 0
      ? []
      : await db.orm
          .select({
            batchId: schema.proposal.batchId,
            name: schema.proposal.tokenName,
            kind: schema.proposal.kind,
            status: schema.proposal.status,
          })
          .from(schema.proposal)
          .where(
            inArray(
              schema.proposal.batchId,
              batches.map(({ id }) => id),
            ),
          )
          .orderBy(asc(schema.proposal.tokenName));
  const history = await db.orm
    .select({
      id: schema.historyEntry.id,
      action: schema.historyEntry.action,
      after: schema.historyEntry.after,
    })
    .from(schema.historyEntry)
    .where(eq(schema.historyEntry.projectId, projectId))
    .orderBy(asc(schema.historyEntry.occurredAt));
  return {
    figmaFile:
      project?.url == null || project.key == null ? null : { url: project.url, key: project.key },
    modes: modes.map(({ name }) => name),
    tokens: tokens.map(({ name, figmaState, declaredAt }) => ({ name, figmaState, declaredAt })),
    batches: batches.map((batch) => ({
      ...batch,
      proposals: proposals
        .filter(({ batchId }) => batchId === batch.id)
        .map(({ name, kind, status }) => ({ name, kind, status })),
    })),
    history: history.map(({ id, action, after }) => ({ id, action, outcome: outcomeOf(after) })),
  };
};
