import type { ProjectSignals } from "#modules/project/contracts/project-signals.ts";
import type { StorageAlertSender } from "#modules/space/contracts/storage-alert.ts";
import { TokenDefinitionInput } from "#modules/token/contracts/token-definition.ts";
import type { Citation, CitedToken } from "#modules/token/contracts/token-issues.ts";
import { err, ok, type Result } from "@repo/result";

import type { DesignationRefusal } from "../domain/proposal-batch.ts";
import {
  type DeletionFailure,
  deletionRefusals,
  remainingCitations,
  type RequestedChange,
} from "../domain/proposal-change.ts";
import { designatedBatchOf, liveBatchOf } from "./proposal-batches.ts";
import {
  announceWritten,
  proposeChanges,
  type ProposalUnitOfWork,
  replacingFigmaStates,
  type ValidatedDefinition,
  type Writer,
  type Written,
} from "./write-tokens.ts";

export type UndeletableTokens = {
  readonly code: "undeletable_tokens";
  readonly refusals: readonly {
    readonly index: number;
    readonly failure: DeletionFailure | CitedToken;
  }[];
};

const citedRefusals = (
  names: readonly string[],
  citations: readonly Citation[],
): UndeletableTokens["refusals"] =>
  names.flatMap((name, index) => {
    const cited = citations.filter((citation) => citation.cited === name);
    return cited.length === 0
      ? []
      : [{ index, failure: { code: "cited_token" as const, citations: cited } }];
  });

const deletedChanges = (
  validated: readonly ValidatedDefinition[],
  names: readonly string[],
): readonly RequestedChange[] =>
  names.flatMap((name) =>
    validated
      .filter((token) => token.name === name)
      .map(({ $type, $value, modes, $description, $extensions }) => ({
        kind: "delete" as const,
        token: TokenDefinitionInput.parse({
          name,
          $type,
          $value,
          modes,
          $description,
          $extensions,
        }),
      })),
  );

export const deleteTokens =
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
    names,
    spaceId,
    batchId,
    ...writer
  }: Writer & {
    readonly spaceId: string;
    readonly names: readonly string[];
    readonly batchId?: string;
  }): Promise<Result<Written, UndeletableTokens | DesignationRefusal>> => {
    const outcome = await unitOfWork.run(
      async ({ store, figmaStates, storageAlert, project, validatedTokensOf, citations }) => {
        await project.write(writer.projectId);
        const validated = await validatedTokensOf(writer.projectId);
        const refused = deletionRefusals({
          names,
          validatedNames: validated.map(({ name }) => name),
          pendingNames: await store.pendingNamesOf(writer.projectId),
        });
        if (refused.length > 0) {
          const undeletable: UndeletableTokens = { code: "undeletable_tokens", refusals: refused };
          return err(undeletable);
        }
        const createdAt = now();
        const target =
          batchId === undefined
            ? ok(await liveBatchOf(store, { writer, now: createdAt }))
            : await designatedBatchOf(store, { batchId, writer, now: createdAt });
        if (!target.ok) {
          return target;
        }
        const found = await citations.citationsOf({ projectId: writer.projectId, names });
        const pending = await store.pendingOf(writer.projectId, [
          ...names,
          ...found.map(({ citing }) => citing),
        ]);
        const cited = citedRefusals(
          names,
          remainingCitations({
            citations: found,
            pendingInBatch: pending.filter((proposal) => proposal.batchId === target.value?.id),
          }),
        );
        if (cited.length > 0) {
          const undeletable: UndeletableTokens = { code: "undeletable_tokens", refusals: cited };
          return err(undeletable);
        }
        const written = await proposeChanges(store, {
          ...writer,
          changes: deletedChanges(validated, names),
          validated,
          createdAt,
          newId,
          batchId,
        });
        if (!written.ok) {
          return written;
        }
        return ok({
          written: written.value,
          alert: await storageAlert(spaceId),
          createdAt,
          figmaReplaced: await replacingFigmaStates(figmaStates, written.value),
        });
      },
    );
    return announceWritten({ sendStorageAlert, signals, projectId: writer.projectId })<
      Written,
      UndeletableTokens | DesignationRefusal
    >(outcome);
  };
