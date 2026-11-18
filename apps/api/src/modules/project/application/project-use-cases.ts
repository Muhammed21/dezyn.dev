import type { createProject } from "./create-project.ts";
import type { listProjects } from "./list-projects.ts";
import type { subscribeToProject } from "./subscribe-to-project.ts";

export type ProjectUseCases = {
  readonly createProject: ReturnType<typeof createProject>;
  readonly listProjects: ReturnType<typeof listProjects>;
  readonly subscribeToProject: ReturnType<typeof subscribeToProject>;
};
