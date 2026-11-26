import type { ProjectLock } from "#modules/project/contracts/project-lock.ts";
import type { ProjectSignals } from "#modules/project/contracts/project-signals.ts";
import type {
  DecidedStorageAlert,
  StorageAlertDecision,
  StorageAlertSender,
} from "#modules/space/contracts/storage-alert.ts";
import { type ComparedToken, duplicatesOf } from "#modules/token/contracts/duplicates.ts";
import type {
  ComparedDefinition,
  TokenDefinition,
} from "#modules/token/contracts/token-definition.ts";
import {
  type CheckTokens,
  type CitationReader,
  groupConflict,
  type TokenCheck,
} from "#modules/token/contracts/token-issues.ts";
import { err, ok, type Result } from "@repo/result";

import { batchExpirySignal, type DesignationRefusal } from "../domain/proposal-batch.ts";
import { plannedChange, type RequestedChange } from "../domain/proposal-change.ts";
import {
  comparedTokens,
  type Proposal,
  type ProposalBatch,
  type RecipeBatch,
} from "../domain/proposal.ts";
import { designatedBatchOf, liveBatchOf } from "./proposal-batches.ts";

export type Writer = {
  readonly projectId: string;
  readonly userId: string;
  readonly clientId: string;
};

export type ValidatedDefinition = ComparedDefinition & {
  readonly name: string;
  readonly $type: string;
};

export type ValidatedTokensOf = (projectId: string) => Promise<readonly ValidatedDefinition[]>;

export type Replaced = { readonly id: string; readonly name: string; readonly batchId: string };

export interface ProposalStore {
  pendingNamesOf(projectId: string): Promise<readonly string[]>;
  pendingOf(projectId: string, names: readonly string[]): Promise<readonly Proposal[]>;
  pendingTokensOf(projectId: string): Promise<readonly TokenDefinition[]>;
  replace(proposalIds: readonly string[]): Promise<void>;
  findOpenBatch(writer: Writer): Promise<ProposalBatch | undefined>;
  findBatch(batchId: string): Promise<RecipeBatch | undefined>;
  openBatchOf(candidate: ProposalBatch & Writer): Promise<ProposalBatch>;
  openDesignatedBatch(
    candidate: ProposalBatch & Writer & { readonly recipe: string },
  ): Promise<RecipeBatch>;
  closeBatch(batchId: string): Promise<void>;
  touchBatch(batchId: string, lastWrittenAt: Date): Promise<void>;
  propose(projectId: string, proposals: readonly Proposal[]): Promise<void>;
}

export type ProposalUnit = {
  readonly store: ProposalStore;
  readonly storageAlert: StorageAlertDecision;
  readonly project: ProjectLock;
  readonly checkTokens: CheckTokens;
  readonly validatedTokensOf: ValidatedTokensOf;
  readonly citations: CitationReader;
};

export interface ProposalUnitOfWork {
  run<T>(work: (unit: ProposalUnit) => Promise<T>): Promise<T>;
}

export type Written = {
  readonly batch: ProposalBatch | null;
  readonly proposals: readonly Proposal[];
  readonly unchanged: readonly string[];
  readonly replaced: readonly Replaced[];
};

export type WrittenWithDuplicates = Omit<Written, "proposals"> & {
  readonly proposals: readonly (Proposal & { readonly duplicates: readonly string[] })[];
};

export type UncheckedTokens = {
  readonly code: "unchecked_tokens";
  readonly checks: readonly TokenCheck[];
};

export type ProposedTokens = Writer & {
  readonly tokens: readonly TokenDefinition[];
  readonly validated: readonly ValidatedDefinition[];
  readonly createdAt: Date;
  readonly batchId?: string;
};

type ProposedChanges = Writer & {
  readonly changes: readonly RequestedChange[];
  readonly validated: readonly ValidatedDefinition[];
  readonly createdAt: Date;
  readonly batchId?: string;
  readonly newId: () => string;
};

export const proposeChanges = async (
  store: ProposalStore,
  { changes, validated, createdAt, newId, batchId, ...writer }: ProposedChanges,
): Promise<Result<Written, DesignationRefusal>> => {
  const designated =
    batchId === undefined
      ? undefined
      : await designatedBatchOf(store, { batchId, writer, now: createdAt });
  if (designated !== undefined && !designated.ok) {
    return designated;
  }
  const pending = await store.pendingOf(
    writer.projectId,
    changes.map(({ token }) => token.name),
  );
  const planned = changes.map((change) =>
    plannedChange({
      change,
      validated: validated.find(({ name }) => name === change.token.name),
      waiting: pending.find(({ name }) => name === change.token.name),
    }),
  );
  const replaced = planned.flatMap(({ replaces }): readonly Replaced[] =>
    replaces === undefined
      ? []
      : [{ id: replaces.id, name: replaces.name, batchId: replaces.batchId }],
  );
  await store.replace(replaced.map(({ id }) => id));
  const unchanged = planned.filter((entry) => entry.unchanged).map(({ token }) => token.name);
  const changed = planned.filter((entry) => !entry.unchanged);
  const live = designated?.value ?? (await liveBatchOf(store, { writer, now: createdAt }));
  if (changed.length === 0) {
    return ok({ batch: live ?? null, proposals: [], unchanged, replaced });
  }
  const batch =
    live ??
    (await store.openBatchOf({
      id: newId(),
      ...writer,
      intent: null,
      state: "open",
      openedAt: createdAt,
      lastWrittenAt: createdAt,
    }));
  await store.touchBatch(batch.id, createdAt);
  const proposals = changed.map(({ token, kind }): Proposal => ({
    id: newId(),
    batchId: batch.id,
    name: token.name,
    kind,
    token,
    status: "proposed",
    createdAt,
  }));
  await store.propose(writer.projectId, proposals);
  return ok({ batch, proposals, unchanged, replaced });
};

export const proposeTokens = (
  store: ProposalStore,
  { tokens, ...proposed }: ProposedTokens & { readonly newId: () => string },
): Promise<Result<Written, DesignationRefusal>> =>
  proposeChanges(store, {
    ...proposed,
    changes: tokens.map((token) => ({ kind: "write", token })),
  });

type WrittenOutcome<W extends Written> = {
  readonly written: W;
  readonly alert: DecidedStorageAlert | undefined;
  readonly createdAt: Date;
};

export const announceWritten =
  ({
    sendStorageAlert,
    signals,
    projectId,
  }: {
    readonly sendStorageAlert: StorageAlertSender;
    readonly signals: ProjectSignals;
    readonly projectId: string;
  }) =>
  async <W extends Written, E>(outcome: Result<WrittenOutcome<W>, E>): Promise<Result<W, E>> => {
    if (!outcome.ok) {
      return outcome;
    }
    if (outcome.value.alert !== undefined) {
      await sendStorageAlert(outcome.value.alert);
    }
    const { proposals, replaced, batch } = outcome.value.written;
    if (proposals.length > 0 || replaced.length > 0) {
      await signals.changed({ projectId, topics: ["proposals"] });
    }
    if (proposals.length > 0 && batch !== null) {
      await signals.signalAt(
        batchExpirySignal({ projectId, batchId: batch.id, lastWrittenAt: outcome.value.createdAt }),
      );
    }
    return ok(outcome.value.written);
  };

const nameConflicts = (
  tokens: readonly TokenDefinition[],
  projectNames: readonly string[],
): readonly TokenCheck[] =>
  tokens.flatMap((token, index): readonly TokenCheck[] => {
    const other = groupConflict(token.name, [...projectNames, ...tokens.map(({ name }) => name)]);
    return other === undefined ? [] : [{ index, failure: { code: "name_conflict", other } }];
  });

export const writeTokens =
  ({
    unitOfWork,
    sendStorageAlert,
    signals,
    newId,
    now,
  }: {
    readonly unitOfWork: ProposalUnitOfWork;
    readonly sendStorageAlert: StorageAlertSender;
    readonly signals: ProjectSignals;
    readonly newId: () => string;
    readonly now: () => Date;
  }) =>
  async ({
    tokens,
    spaceId,
    batchId,
    ...writer
  }: Writer & {
    readonly spaceId: string;
    readonly tokens: readonly TokenDefinition[];
    readonly batchId?: string;
  }): Promise<Result<WrittenWithDuplicates, UncheckedTokens | DesignationRefusal>> => {
    const outcome = await unitOfWork.run(
      async ({ store, storageAlert, project, checkTokens, validatedTokensOf }) => {
        await project.write(writer.projectId);
        const checks = await checkTokens({ projectId: writer.projectId, tokens });
        if (checks.length > 0) {
          const unchecked: UncheckedTokens = { code: "unchecked_tokens", checks };
          return err(unchecked);
        }
        const validated = await validatedTokensOf(writer.projectId);
        const conflicts = nameConflicts(tokens, [
          ...validated.map(({ name }) => name),
          ...(await store.pendingNamesOf(writer.projectId)),
        ]);
        if (conflicts.length > 0) {
          const refused: UncheckedTokens = { code: "unchecked_tokens", checks: conflicts };
          return err(refused);
        }
        const createdAt = now();
        const written = await proposeTokens(store, {
          ...writer,
          tokens,
          validated,
          createdAt,
          newId,
          batchId,
        });
        if (!written.ok) {
          return written;
        }
        const among = comparedTokens<ComparedToken>({
          validated,
          pending: await store.pendingTokensOf(writer.projectId),
        });
        return ok({
          written: {
            ...written.value,
            proposals: written.value.proposals.map((proposal) => ({
              ...proposal,
              duplicates: duplicatesOf({ token: proposal.token, among }),
            })),
          },
          alert: await storageAlert(spaceId),
          createdAt,
        });
      },
    );
    return announceWritten({ sendStorageAlert, signals, projectId: writer.projectId })<
      WrittenWithDuplicates,
      UncheckedTokens | DesignationRefusal
    >(outcome);
  };
