import { and, asc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { PostgresDatabase, PostgresTransaction } from "#db";
import type { HistoryWriter } from "#modules/history/contracts/history-writer.ts";
import type { ProjectLock } from "#modules/project/contracts/project-lock.ts";
import type { StorageMeter } from "#modules/project/contracts/storage-meter.ts";
import type { StorageAlertDecision } from "#modules/space/contracts/storage-alert.ts";
import { schema } from "@repo/db";
import type { Err, Result } from "@repo/result";

import type { PendingProposals, TokenUnitOfWork } from "../application/add-token.ts";
import type {
  FigmaProposals,
  FigmaStateWriter,
  FigmaUnitOfWork,
  RejectedValueReader,
} from "../application/declare-figma-states.ts";
import type { ModifierReader } from "../application/export-tokens.ts";
import type {
  ImportTargetLock,
  ModesWriter,
  TokenImportUnit,
  TokenImportUnitOfWork,
} from "../application/import-tokens.ts";
import type { FigmaStateReader, ValidatedTokenReader } from "../application/read-tokens.ts";
import type {
  CitationReader,
  ModeReader,
  CreatedToken,
  ModeValue,
  ProjectTokenReader,
  TokenWriter,
} from "../application/token-values.ts";
import type { Citation, CitationVia } from "../domain/citations.ts";
import { contrastBackgrounds } from "../domain/contrast-pairs.ts";
import type { ComparedDefinition } from "../domain/same-definition.ts";

const {
  identityUser,
  mode,
  modifier,
  proposal,
  token,
  tokenFigmaState,
  tokenValue,
  tokenValueReference,
} = schema;

type Queryable = Pick<
  PostgresTransaction,
  "select" | "selectDistinct" | "insert" | "update" | "delete"
>;

export const postgresProjectTokenReader = (orm: Queryable): ProjectTokenReader => ({
  tokensOf: (projectId) =>
    orm
      .select({ id: token.id, name: token.name, $type: token.type, status: token.status })
      .from(token)
      .where(eq(token.projectId, projectId)),
});

export const postgresModifierReader = (orm: Queryable): ModifierReader => ({
  modifierOf: async (projectId) => {
    const [row] = await orm
      .select({ name: modifier.name })
      .from(modifier)
      .where(eq(modifier.projectId, projectId));
    return row?.name;
  },
});

export const postgresModeReader = (orm: Queryable): ModeReader => ({
  modesOf: (projectId) =>
    orm
      .select({ id: mode.id, name: mode.name })
      .from(mode)
      .innerJoin(modifier, eq(modifier.id, mode.modifierId))
      .where(eq(modifier.projectId, projectId))
      .orderBy(asc(mode.position)),
});

const postgresModesWriter = (orm: Queryable, newId: () => string): ModesWriter => ({
  create: async ({ projectId, modifier: name, modes }) => {
    const modifierId = newId();
    await orm.insert(modifier).values({ id: modifierId, projectId, name });
    await orm.insert(mode).values(
      modes.map(({ id, name: modeName }, position) => ({
        id,
        modifierId,
        name: modeName,
        position,
      })),
    );
  },
});

const postgresImportTargetLock = (tx: Queryable, projectLock: ProjectLock): ImportTargetLock => ({
  lock: async (projectId) => {
    await projectLock.exclusive(projectId);
    const [modifierName, modes, tokens] = await Promise.all([
      postgresModifierReader(tx).modifierOf(projectId),
      postgresModeReader(tx).modesOf(projectId),
      postgresProjectTokenReader(tx).tokensOf(projectId),
    ]);
    return { modifier: modifierName, modes, tokens };
  },
});

const insertValues = async (
  tx: Queryable,
  {
    newId,
    valuesOf,
  }: {
    readonly newId: () => string;
    readonly valuesOf: readonly {
      readonly tokenId: string;
      readonly values: readonly ModeValue[];
    }[];
  },
) => {
  const rows = valuesOf.flatMap(({ tokenId, values }) =>
    values.map((stored) => ({ id: newId(), tokenId, stored })),
  );
  const writtenValues = await tx
    .insert(tokenValue)
    .values(
      rows.map(({ id, tokenId, stored: { modeId, value, referencedTokenId } }) => ({
        id,
        tokenId,
        modeId,
        value,
        referencedTokenId,
      })),
    )
    .returning();
  const references = rows.flatMap(({ id, stored }) =>
    stored.fieldReferences.map(({ field, referencedTokenId }) => ({
      id: newId(),
      tokenValueId: id,
      field,
      referencedTokenId,
    })),
  );
  if (references.length === 0) {
    return writtenValues;
  }
  const writtenReferences = await tx.insert(tokenValueReference).values(references).returning();
  return [...writtenValues, ...writtenReferences];
};

const createAllOn =
  (
    tx: Queryable,
    { newId, meter }: { readonly newId: () => string; readonly meter: StorageMeter },
  ) =>
  async <Created extends CreatedToken>(
    created: readonly Created[],
  ): Promise<Created | undefined> => {
    const [first] = created;
    if (first === undefined) {
      return undefined;
    }
    const inserted = await tx
      .insert(token)
      .values(
        created.map(({ token: added }) => ({
          id: added.id,
          projectId: added.projectId,
          name: added.name,
          type: added.$type,
          description: added.$description ?? null,
          extensions: added.$extensions ?? null,
          status: added.status,
          createdAt: added.createdAt,
        })),
      )
      .onConflictDoNothing({ target: [token.projectId, token.name] })
      .returning();
    const taken = created.find(({ token: added }) => !inserted.some(({ id }) => id === added.id));
    if (taken !== undefined) {
      return taken;
    }
    const written = await insertValues(tx, {
      newId,
      valuesOf: created.map(({ token: added, values }) => ({ tokenId: added.id, values })),
    });
    await meter.add(first.token.projectId, [...inserted, ...written]);
    return undefined;
  };

const deleteAllOn =
  (tx: Queryable, meter: StorageMeter) =>
  async ({
    projectId,
    names,
  }: {
    readonly projectId: string;
    readonly names: readonly string[];
  }) => {
    if (names.length === 0) {
      return;
    }
    const ids = (
      await tx
        .select({ id: token.id })
        .from(token)
        .where(and(eq(token.projectId, projectId), inArray(token.name, [...names])))
        .for("update")
    ).map(({ id }) => id);
    if (ids.length === 0) {
      return;
    }
    const removedReferences = await tx
      .select({ row: tokenValueReference })
      .from(tokenValueReference)
      .innerJoin(tokenValue, eq(tokenValue.id, tokenValueReference.tokenValueId))
      .where(inArray(tokenValue.tokenId, ids));
    const removedValues = await tx
      .delete(tokenValue)
      .where(inArray(tokenValue.tokenId, ids))
      .returning();
    const removedStates = await tx
      .delete(tokenFigmaState)
      .where(inArray(tokenFigmaState.tokenId, ids))
      .returning();
    const removedTokens = await tx.delete(token).where(inArray(token.id, ids)).returning();
    await meter.remove(projectId, [
      ...removedTokens,
      ...removedValues,
      ...removedReferences.map(({ row }) => row),
      ...removedStates,
    ]);
  };

export const postgresTokenWriter = (
  tx: Queryable,
  { newId, meter }: { readonly newId: () => string; readonly meter: StorageMeter },
): TokenWriter => {
  const createAll = createAllOn(tx, { newId, meter });
  return {
    createAll,
    deleteAll: deleteAllOn(tx, meter),
    create: async (added, values) =>
      (await createAll([{ token: added, values }])) === undefined ? "created" : "name_taken",
    replaceAll: async (replaced) => {
      const [first] = replaced;
      if (first === undefined) {
        return;
      }
      const { projectId } = first.token;
      const before = await tx
        .select()
        .from(token)
        .where(
          and(
            eq(token.projectId, projectId),
            inArray(
              token.name,
              replaced.map(({ token: { name } }) => name),
            ),
          ),
        );
      const found = replaced.flatMap(({ token: definition, values }) => {
        const row = before.find(({ name }) => name === definition.name);
        return row === undefined ? [] : [{ id: row.id, definition, values }];
      });
      const ids = found.map(({ id }) => id);
      if (ids.length === 0) {
        return;
      }
      const updated = await tx
        .update(token)
        .set({
          description: sql`case ${token.id} ${sql.join(
            found.map(
              ({ id, definition }) =>
                sql`when ${id}::uuid then ${definition.$description ?? null}::text`,
            ),
            sql` `,
          )} end`,
          extensions: sql`case ${token.id} ${sql.join(
            found.map(
              ({ id, definition }) =>
                sql`when ${id}::uuid then ${
                  definition.$extensions === undefined
                    ? null
                    : JSON.stringify(definition.$extensions)
                }::jsonb`,
            ),
            sql` `,
          )} end`,
        })
        .where(inArray(token.id, ids))
        .returning();
      const removedReferences = await tx
        .select({ row: tokenValueReference })
        .from(tokenValueReference)
        .innerJoin(tokenValue, eq(tokenValue.id, tokenValueReference.tokenValueId))
        .where(inArray(tokenValue.tokenId, ids));
      const removedValues = await tx
        .delete(tokenValue)
        .where(inArray(tokenValue.tokenId, ids))
        .returning();
      const written = await insertValues(tx, {
        newId,
        valuesOf: found.map(({ id, values }) => ({ tokenId: id, values })),
      });
      await meter.resize(projectId, {
        removed: [...before, ...removedValues, ...removedReferences.map(({ row }) => row)],
        added: [...updated, ...written],
      });
    },
  };
};

const cited = alias(token, "cited");

const citing = alias(token, "citing");

type CitedTarget = { readonly projectId: string; readonly names: readonly string[] };

type CitationSource = (orm: Queryable, target: CitedTarget) => Promise<readonly Citation[]>;

const citationsOfSource =
  (
    via: CitationVia,
    rowsOf: (
      orm: Queryable,
      target: CitedTarget,
    ) => Promise<readonly { readonly cited: string; readonly citing: string }[]>,
  ): CitationSource =>
  async (orm, target) =>
    (await rowsOf(orm, target)).map((row) => ({ ...row, via }));

const citedBy = (projectId: string, names: readonly string[]) =>
  and(
    eq(cited.projectId, projectId),
    inArray(cited.name, [...names]),
    notInArray(citing.name, [...names]),
  );

const StoredExtensions = z.record(z.string(), z.unknown());

const CITATION_SOURCES: readonly CitationSource[] = [
  citationsOfSource("alias", (orm, { projectId, names }) =>
    orm
      .selectDistinct({ cited: cited.name, citing: citing.name })
      .from(tokenValue)
      .innerJoin(cited, eq(cited.id, tokenValue.referencedTokenId))
      .innerJoin(citing, eq(citing.id, tokenValue.tokenId))
      .where(citedBy(projectId, names)),
  ),
  citationsOfSource("field", (orm, { projectId, names }) =>
    orm
      .selectDistinct({ cited: cited.name, citing: citing.name })
      .from(tokenValueReference)
      .innerJoin(tokenValue, eq(tokenValue.id, tokenValueReference.tokenValueId))
      .innerJoin(cited, eq(cited.id, tokenValueReference.referencedTokenId))
      .innerJoin(citing, eq(citing.id, tokenValue.tokenId))
      .where(citedBy(projectId, names)),
  ),
  citationsOfSource("contrastOn", async (orm, { projectId, names }) =>
    (
      await orm
        .select({ name: token.name, extensions: token.extensions })
        .from(token)
        .where(
          and(
            eq(token.projectId, projectId),
            eq(token.status, "validated"),
            isNotNull(token.extensions),
            notInArray(token.name, [...names]),
          ),
        )
    ).flatMap(({ name, extensions }) =>
      contrastBackgrounds(StoredExtensions.parse(extensions))
        .filter((background) => names.includes(background.name))
        .map((background) => ({ cited: background.name, citing: name })),
    ),
  ),
];

export const postgresCitationReader = (orm: Queryable): CitationReader => ({
  citationsOf: async (target) => {
    if (target.names.length === 0) {
      return [];
    }
    return (await Promise.all(CITATION_SOURCES.map((source) => source(orm, target)))).flat();
  },
});

export const postgresTokenUnitOfWork = ({
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
  readonly storageMeterOn: (tx: PostgresTransaction) => StorageMeter;
  readonly proposalReplacerOn: (tx: PostgresTransaction) => PendingProposals;
  readonly storageAlertOn: (tx: PostgresTransaction) => StorageAlertDecision;
  readonly newId: () => string;
}): TokenUnitOfWork => ({
  run: (work) =>
    db.orm.transaction((tx) =>
      work({
        project: projectLockOn(tx),
        modes: postgresModeReader(tx),
        projectTokens: postgresProjectTokenReader(tx),
        tokens: postgresTokenWriter(tx, { newId, meter: storageMeterOn(tx) }),
        validatedTokens: postgresValidatedTokenReader(tx),
        citations: postgresCitationReader(tx),
        history: historyWriterOn(tx),
        proposals: proposalReplacerOn(tx),
        storageAlert: storageAlertOn(tx),
      }),
    ),
});

export const postgresTokenImportUnitOfWork = ({
  db,
  projectLockOn,
  historyWriterOn,
  proposalReplacerOn,
  storageMeterOn,
  newId,
}: {
  readonly db: PostgresDatabase;
  readonly projectLockOn: (tx: PostgresTransaction) => ProjectLock;
  readonly historyWriterOn: (tx: PostgresTransaction) => HistoryWriter;
  readonly storageMeterOn: (tx: PostgresTransaction) => StorageMeter;
  readonly proposalReplacerOn: (tx: PostgresTransaction) => PendingProposals;
  readonly newId: () => string;
}): TokenImportUnitOfWork => ({
  async run<T, E>(work: (unit: TokenImportUnit) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    class RolledBack extends Error {
      readonly failure: Err<E>;

      constructor(failure: Err<E>) {
        super("Transaction annulée");
        this.failure = failure;
      }
    }
    return db.orm
      .transaction(async (tx) => {
        const outcome = await work({
          target: postgresImportTargetLock(tx, projectLockOn(tx)),
          modes: postgresModesWriter(tx, newId),
          tokens: postgresTokenWriter(tx, { newId, meter: storageMeterOn(tx) }),
          history: historyWriterOn(tx),
          proposals: proposalReplacerOn(tx),
        });
        if (!outcome.ok) {
          throw new RolledBack(outcome);
        }
        return outcome;
      })
      .catch((error: unknown) => {
        if (error instanceof RolledBack) {
          return error.failure;
        }
        throw error;
      });
  },
});

const referenced = alias(token, "referenced");

export const postgresValidatedTokenReader = (orm: Queryable): ValidatedTokenReader => ({
  validatedValuesOf: (projectId) =>
    orm
      .select({
        tokenId: token.id,
        name: token.name,
        $type: token.type,
        $description: token.description,
        $extensions: token.extensions,
        mode: mode.name,
        value: tokenValue.value,
        referencedName: referenced.name,
      })
      .from(token)
      .innerJoin(tokenValue, eq(tokenValue.tokenId, token.id))
      .leftJoin(mode, eq(mode.id, tokenValue.modeId))
      .leftJoin(referenced, eq(referenced.id, tokenValue.referencedTokenId))
      .where(and(eq(token.projectId, projectId), eq(token.status, "validated")))
      .orderBy(asc(token.name), asc(mode.position)),
});

export const postgresFigmaStateWriter = (tx: Queryable, meter: StorageMeter): FigmaStateWriter => ({
  declare: async ({ projectId, states, declaredAt, userId, clientId }) => {
    const tokenIds = states.map(({ tokenId }) => tokenId);
    await tx
      .select({ id: token.id })
      .from(token)
      .where(inArray(token.id, tokenIds))
      .for("no key update");
    const before = await tx
      .select()
      .from(tokenFigmaState)
      .where(inArray(tokenFigmaState.tokenId, tokenIds))
      .for("update");
    const after = await tx
      .insert(tokenFigmaState)
      .values(
        states.map((declared) => ({
          tokenId: declared.tokenId,
          state: declared.state,
          figmaVariables: declared.state === "duplicate_in_figma" ? declared.figmaVariables : null,
          proposalId: declared.proposalId,
          declaredAt,
          userId,
          clientId,
        })),
      )
      .onConflictDoUpdate({
        target: tokenFigmaState.tokenId,
        set: {
          state: sql`excluded.state`,
          figmaVariables: sql`excluded.figma_variables`,
          declaredAt: sql`excluded.declared_at`,
          userId: sql`excluded.user_id`,
          clientId: sql`excluded.client_id`,
          proposalId: sql`case when excluded.state = 'diverged' then coalesce(excluded.proposal_id, ${tokenFigmaState.proposalId}) end`,
        },
      })
      .returning();
    await meter.remove(projectId, before);
    await meter.add(projectId, after);
  },
});

const FigmaState = z.enum(["synced", "missing_in_figma", "duplicate_in_figma", "diverged"]);

const FigmaVariables = z.array(z.string()).nullable();

const FigmaValue = z.object({
  $value: z.unknown().optional(),
  modes: z.record(z.string(), z.unknown()).optional(),
});

const figmaValueOf = (stored: unknown) => {
  const { $value, modes } = FigmaValue.parse(stored);
  return modes === undefined ? { $value } : { modes };
};

export const postgresFigmaStateReader = (db: PostgresDatabase): FigmaStateReader => ({
  figmaStatesOf: async (projectId) => {
    const rows = await db.orm
      .select({
        tokenId: tokenFigmaState.tokenId,
        state: tokenFigmaState.state,
        figmaVariables: tokenFigmaState.figmaVariables,
        rejectedValue: tokenFigmaState.rejectedValue,
        declaredAt: tokenFigmaState.declaredAt,
        userId: tokenFigmaState.userId,
        name: identityUser.name,
        clientId: tokenFigmaState.clientId,
        proposalId: proposal.id,
        batchId: proposal.batchId,
        proposed: proposal.payload,
      })
      .from(tokenFigmaState)
      .innerJoin(token, eq(token.id, tokenFigmaState.tokenId))
      .leftJoin(identityUser, eq(identityUser.id, tokenFigmaState.userId))
      .leftJoin(
        proposal,
        and(eq(proposal.id, tokenFigmaState.proposalId), eq(proposal.status, "proposed")),
      )
      .where(eq(token.projectId, projectId));
    return rows.map(
      ({
        tokenId,
        state,
        figmaVariables,
        rejectedValue,
        declaredAt,
        userId,
        name,
        clientId,
        proposalId,
        batchId,
        proposed,
      }) => {
        const variables = FigmaVariables.parse(figmaVariables);
        const declared = FigmaState.parse(state);
        return {
          tokenId,
          state: declared,
          ...(variables === null ? {} : { figmaVariables: variables }),
          ...(proposalId === null || batchId === null
            ? {}
            : { proposal: { id: proposalId, batchId, value: figmaValueOf(proposed) } }),
          ...(declared !== "diverged" || rejectedValue === null
            ? {}
            : { rejectedValue: figmaValueOf(rejectedValue) }),
          declaredAt,
          author:
            userId === null || name === null
              ? { kind: "deleted_member" as const }
              : { kind: "member" as const, userId, name },
          clientId,
        };
      },
    );
  },
});

export const postgresFigmaUnitOfWork = ({
  db,
  proposalWriterOn,
  storageMeterOn,
  storageAlertOn,
}: {
  readonly db: PostgresDatabase;
  readonly proposalWriterOn: (tx: PostgresTransaction) => FigmaProposals;
  readonly storageMeterOn: (tx: PostgresTransaction) => StorageMeter;
  readonly storageAlertOn: (tx: PostgresTransaction) => StorageAlertDecision;
}): FigmaUnitOfWork => ({
  run: (work) =>
    db.orm.transaction((tx) =>
      work({
        figmaStates: postgresFigmaStateWriter(tx, storageMeterOn(tx)),
        proposals: proposalWriterOn(tx),
        storageAlert: storageAlertOn(tx),
      }),
    ),
});

const resizeFigmaStatesOf = async (
  tx: Queryable,
  {
    meter,
    proposalIds,
    change,
  }: {
    readonly meter: StorageMeter;
    readonly proposalIds: readonly string[];
    readonly change: Partial<typeof tokenFigmaState.$inferInsert>;
  },
) => {
  if (proposalIds.length === 0) {
    return false;
  }
  const before = await tx
    .select({ row: tokenFigmaState, projectId: token.projectId })
    .from(tokenFigmaState)
    .innerJoin(token, eq(token.id, tokenFigmaState.tokenId))
    .where(inArray(tokenFigmaState.proposalId, [...proposalIds]))
    .for("update", { of: tokenFigmaState });
  const after = await tx
    .update(tokenFigmaState)
    .set(change)
    .where(inArray(tokenFigmaState.proposalId, [...proposalIds]))
    .returning();
  const [changed] = before;
  if (changed === undefined) {
    return false;
  }
  await meter.resize(changed.projectId, { removed: before.map(({ row }) => row), added: after });
  return true;
};

export const postgresFigmaStateSynchronizer = (tx: Queryable, meter: StorageMeter) => ({
  proposalsValidated: async (proposalIds: readonly string[]) => {
    await resizeFigmaStatesOf(tx, {
      meter,
      proposalIds,
      change: { state: "synced", proposalId: null },
    });
  },
  proposalsRejected: (
    rejected: readonly { readonly proposalId: string; readonly token: ComparedDefinition }[],
  ) =>
    resizeFigmaStatesOf(tx, {
      meter,
      proposalIds: rejected.map(({ proposalId }) => proposalId),
      change: {
        rejectedValue: sql`case ${tokenFigmaState.proposalId} ${sql.join(
          rejected.map(
            ({ proposalId, token: { $value, modes } }) =>
              sql`when ${proposalId}::uuid then ${JSON.stringify({ $value, modes })}::jsonb`,
          ),
          sql` `,
        )} end`,
        proposalId: null,
      },
    }),
});

export const postgresRejectedValueReader = (db: PostgresDatabase): RejectedValueReader => ({
  rejectedValuesOf: async (projectId) => {
    const rows = await db.orm
      .select({ tokenId: tokenFigmaState.tokenId, rejectedValue: tokenFigmaState.rejectedValue })
      .from(tokenFigmaState)
      .innerJoin(token, eq(token.id, tokenFigmaState.tokenId))
      .where(and(eq(token.projectId, projectId), isNotNull(tokenFigmaState.rejectedValue)));
    return rows.map(({ tokenId, rejectedValue }) => ({
      tokenId,
      rejected: FigmaValue.parse(rejectedValue),
    }));
  },
});
