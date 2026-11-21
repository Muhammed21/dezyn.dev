import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";

import type { Result } from "@repo/result";

import type { Clock } from "../../../platform/clock.ts";
import { type ListedProject, type ProjectsFailure, recentPurgeOf } from "../domain/project.ts";
import { PurgeNotice } from "./purge-notice.tsx";

type ReadProject = (project: {
  readonly projectId: string;
}) => Promise<Result<ListedProject, ProjectsFailure>>;

type SpaceStorageAlert = ComponentType<{ readonly spaceId: string }>;

export const projectBanners = ({
  readProject,
  SpaceStorageAlert,
  clock,
}: {
  readonly readProject: ReadProject;
  readonly SpaceStorageAlert: SpaceStorageAlert;
  readonly clock: Clock;
}) =>
  function ProjectBanners({ projectId }: { readonly projectId: string }) {
    const { data } = useQuery({
      queryKey: ["project", projectId],
      queryFn: () => readProject({ projectId }),
    });
    if (data?.ok !== true) {
      return null;
    }
    const project = data.value;
    const purgedAt = recentPurgeOf({ project, now: clock() });
    return (
      <>
        {purgedAt !== undefined && <PurgeNotice purgedAt={purgedAt} />}
        <SpaceStorageAlert spaceId={project.spaceId} />
      </>
    );
  };
