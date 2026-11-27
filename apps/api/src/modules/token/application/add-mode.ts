import type { HistoryWriter } from "#modules/history/contracts/history-writer.ts";
import type { ProjectSignals } from "#modules/project/contracts/project-signals.ts";
import type { ProjectAccess } from "#modules/space/contracts/membership.ts";
import type {
  DecidedStorageAlert,
  StorageAlertDecision,
  StorageAlertSender,
} from "#modules/space/contracts/storage-alert.ts";
import { err, ok, type Result } from "@repo/result";

import { type ModeAdditionRefusal, modeAdditionOf } from "../domain/mode-addition.ts";
import type { PendingProposals } from "./add-token.ts";
import type { ModeValue, ProjectMode } from "./token-values.ts";

export type TokenModeValue = { readonly tokenId: string; readonly value: ModeValue };

export interface ModeStore {
  lock(projectId: string): Promise<readonly ProjectMode[]>;
  validatedValuesOf(mode: {
    readonly projectId: string;
    readonly modeId: string;
  }): Promise<readonly TokenModeValue[]>;
  append(added: {
    readonly projectId: string;
    readonly mode: ProjectMode;
    readonly values: readonly TokenModeValue[];
  }): Promise<void>;
}

export interface ModeUnitOfWork {
  run<T>(
    work: (unit: {
      readonly modes: ModeStore;
      readonly proposals: Pick<PendingProposals, "pendingNamesOf">;
      readonly history: HistoryWriter;
      readonly storageAlert: StorageAlertDecision;
    }) => Promise<T>,
  ): Promise<T>;
}

export type AddedMode = {
  readonly mode: string;
  readonly copiedFrom: string;
  readonly modes: readonly string[];
};

export type ModeAdditionFailure = "not_found" | ModeAdditionRefusal;

export const addMode =
  ({
    access,
    unitOfWork,
    sendStorageAlert,
    signals,
    newId,
    now,
  }: {
    readonly access: ProjectAccess;
    readonly unitOfWork: ModeUnitOfWork;
    readonly sendStorageAlert: StorageAlertSender;
    readonly signals: ProjectSignals;
    readonly newId: () => string;
    readonly now: () => Date;
  }) =>
  async ({
    projectId,
    userId,
    name,
    copiedFrom,
    correlationId,
  }: {
    readonly projectId: string;
    readonly userId: string;
    readonly name: string;
    readonly copiedFrom: string;
    readonly correlationId: string;
  }): Promise<Result<AddedMode, ModeAdditionFailure>> => {
    const project = await access({ projectId, userId, action: "mode.create" });
    if (project === undefined) {
      return err("not_found");
    }
    const result = await unitOfWork.run(
      async ({
        modes,
        proposals,
        history,
        storageAlert,
      }): Promise<
        Result<
          { readonly added: AddedMode; readonly alert: DecidedStorageAlert | undefined },
          ModeAdditionFailure
        >
      > => {
        const projectModes = await modes.lock(projectId);
        const addition = modeAdditionOf({
          modes: projectModes,
          pendingNames: await proposals.pendingNamesOf(projectId),
          name,
          copiedFrom,
        });
        if ("refusal" in addition) {
          return err(addition.refusal);
        }
        const mode = { id: newId(), name };
        const copied = await modes.validatedValuesOf({
          projectId,
          modeId: addition.source.id,
        });
        await modes.append({
          projectId,
          mode,
          values: copied.map(({ tokenId, value }) => ({
            tokenId,
            value: { ...value, modeId: mode.id },
          })),
        });
        await history.append([
          {
            spaceId: project.spaceId,
            projectId,
            action: "mode.added",
            userId,
            clientId: null,
            before: null,
            after: { mode: name, copiedFrom },
            correlationId,
            occurredAt: now(),
          },
        ]);
        return ok({
          added: {
            mode: name,
            copiedFrom,
            modes: [...projectModes.map((projectMode) => projectMode.name), name],
          },
          alert: await storageAlert(project.spaceId),
        });
      },
    );
    if (!result.ok) {
      return result;
    }
    if (result.value.alert !== undefined) {
      await sendStorageAlert(result.value.alert);
    }
    await signals.changed({ projectId, topics: ["history", "tokens"] });
    return ok(result.value.added);
  };
