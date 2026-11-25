import type { HistoryWriter } from "#modules/history/contracts/history-writer.ts";
import type { ProjectAccess } from "#modules/space/contracts/membership.ts";
import { type FigmaFile, figmaFileOf } from "@repo/contracts";
import { err, ok, type Result } from "@repo/result";

import type { ProjectSignals } from "../domain/project-signals.ts";

export interface FigmaFileWriter {
  lockedFigmaFileOf(projectId: string): Promise<FigmaFile | null>;
  replace(change: {
    readonly projectId: string;
    readonly figmaFile: FigmaFile | null;
  }): Promise<void>;
}

export interface FigmaFileUnitOfWork {
  run<T>(
    work: (unit: {
      readonly figmaFiles: FigmaFileWriter;
      readonly history: HistoryWriter;
    }) => Promise<T>,
  ): Promise<T>;
}

export type FigmaFileFailure = "not_found" | "invalid_figma_file";

const figmaFileFrom = (url: string | null): Result<FigmaFile | null, "invalid_figma_file"> => {
  if (url === null) {
    return ok(null);
  }
  const figmaFile = figmaFileOf(url);
  return figmaFile === undefined ? err("invalid_figma_file") : ok(figmaFile);
};

export const setFigmaFile =
  ({
    access,
    unitOfWork,
    signals,
    now,
  }: {
    readonly access: ProjectAccess;
    readonly unitOfWork: FigmaFileUnitOfWork;
    readonly signals: ProjectSignals;
    readonly now: () => Date;
  }) =>
  async ({
    projectId,
    userId,
    clientId,
    url,
    correlationId,
  }: {
    readonly projectId: string;
    readonly userId: string;
    readonly clientId: string | null;
    readonly url: string | null;
    readonly correlationId: string;
  }): Promise<Result<FigmaFile | null, FigmaFileFailure>> => {
    const project = await access({ projectId, userId, action: "project.setFigmaFile" });
    if (project === undefined) {
      return err("not_found");
    }
    const parsed = figmaFileFrom(url);
    if (!parsed.ok) {
      return parsed;
    }
    const figmaFile = parsed.value;
    const changed = await unitOfWork.run(async ({ figmaFiles, history }) => {
      const before = await figmaFiles.lockedFigmaFileOf(projectId);
      if (before?.url === figmaFile?.url) {
        return false;
      }
      await figmaFiles.replace({ projectId, figmaFile });
      await history.append([
        {
          spaceId: project.spaceId,
          projectId,
          action: "project.figma_file_changed",
          userId,
          clientId,
          before: { figmaFile: before },
          after: { figmaFile },
          correlationId,
          occurredAt: now(),
        },
      ]);
      return true;
    });
    if (changed) {
      await signals.changed({ projectId, topics: ["history"] });
    }
    return ok(figmaFile);
  };
