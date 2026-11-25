export type Project = {
  readonly id: string;
  readonly spaceId: string;
  readonly name: string;
  readonly createdAt: Date;
};

export type PlanRequired = { readonly reason: "plan_required"; readonly limit: number | undefined };

export type ProjectCreationFailure =
  | "unauthenticated"
  | "not_found"
  | "forbidden"
  | "invalid_name"
  | "unavailable"
  | "invalid_response"
  | PlanRequired;

export type FigmaFile = { readonly url: string; readonly key: string };

export type ListedProject = Project & {
  readonly historyPurgedAt: Date | undefined;
  readonly figmaFile: FigmaFile | undefined;
};

export type ProjectsFailure = "unauthenticated" | "not_found" | "unavailable" | "invalid_response";

export type FigmaFileFailure = ProjectsFailure | "invalid_figma_file";

const PURGE_NOTICE_MS = 7 * 24 * 60 * 60 * 1000;

export const recentPurgeOf = ({
  project,
  now,
}: {
  readonly project: ListedProject;
  readonly now: Date;
}): Date | undefined => {
  const purgedAt = project.historyPurgedAt;
  return purgedAt !== undefined && now.getTime() - purgedAt.getTime() < PURGE_NOTICE_MS
    ? purgedAt
    : undefined;
};
