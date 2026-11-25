import { CreateProjectInput, FigmaFileInput, Uuid } from "@repo/contracts";
import { err, type Result } from "@repo/result";

import type {
  FigmaFile,
  FigmaFileFailure,
  ListedProject,
  Project,
  ProjectCreationFailure,
  ProjectsFailure,
} from "../domain/project.ts";
import type { ProjectGateway, ProjectToCreate } from "./project-gateway.ts";

const isUuid = (id: string) => Uuid.safeParse(id).success;

export const projectUseCases = ({ gateway }: { readonly gateway: ProjectGateway }) => ({
  createProject: async ({
    spaceId,
    name,
  }: ProjectToCreate): Promise<Result<Project, ProjectCreationFailure>> => {
    if (!isUuid(spaceId)) {
      return err("not_found");
    }
    const input = CreateProjectInput.safeParse({ name });
    if (!input.success) {
      return err("invalid_name");
    }
    return gateway.createProject({ spaceId, name: input.data.name });
  },
  listProjects: async ({
    spaceId,
  }: {
    readonly spaceId: string;
  }): Promise<Result<readonly ListedProject[], ProjectsFailure>> =>
    isUuid(spaceId) ? gateway.listProjects({ spaceId }) : err("not_found"),
  readProject: async ({
    projectId,
  }: {
    readonly projectId: string;
  }): Promise<Result<ListedProject, ProjectsFailure>> =>
    isUuid(projectId) ? gateway.readProject({ projectId }) : err("not_found"),
  setFigmaFile: async ({
    projectId,
    url,
  }: {
    readonly projectId: string;
    readonly url: string | null;
  }): Promise<Result<FigmaFile | undefined, FigmaFileFailure>> => {
    if (!isUuid(projectId)) {
      return err("not_found");
    }
    const input = FigmaFileInput.safeParse({ url });
    if (!input.success) {
      return err("invalid_figma_file");
    }
    return gateway.setFigmaFile({ projectId, url: input.data.url });
  },
});
