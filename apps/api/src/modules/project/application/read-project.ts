import type { ProjectAccess } from "#modules/space/contracts/membership.ts";
import { err, ok, type Result } from "@repo/result";

import type { Project } from "../domain/project.ts";

export type ReadProject = Project & { readonly historyPurgedAt: Date | null };

export interface ProjectReader {
  projectOf(projectId: string): Promise<ReadProject>;
}

export const readProject =
  ({ access, projects }: { readonly access: ProjectAccess; readonly projects: ProjectReader }) =>
  async ({
    projectId,
    userId,
  }: {
    readonly projectId: string;
    readonly userId: string;
  }): Promise<Result<ReadProject, "not_found">> => {
    if ((await access({ projectId, userId, action: "space.read" })) === undefined) {
      return err("not_found");
    }
    return ok(await projects.projectOf(projectId));
  };
