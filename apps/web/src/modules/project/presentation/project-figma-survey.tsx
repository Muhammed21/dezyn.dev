import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { Result } from "@repo/result";

import type { Clock } from "../../../platform/clock.ts";
import { followTopic, type SubscribeToProject } from "../../../platform/project-signals.ts";
import {
  type FigmaFile,
  figmaSurveyAgeOf,
  type ProjectDetails,
  type ProjectsFailure,
} from "../domain/project.ts";

type ReadProject = (project: {
  readonly projectId: string;
}) => Promise<Result<ProjectDetails, ProjectsFailure>>;

const AGO = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

const SurveyedFile = ({ figmaFile }: { readonly figmaFile: FigmaFile | undefined }) =>
  figmaFile === undefined ? null : (
    <a href={figmaFile.url} target="_blank" rel="noreferrer">
      Voir le fichier Figma relevé
    </a>
  );

export const projectFigmaSurvey = ({
  readProject,
  subscribe,
  clock,
}: {
  readonly readProject: ReadProject;
  readonly subscribe: SubscribeToProject;
  readonly clock: Clock;
}) =>
  function ProjectFigmaSurvey({ projectId }: { readonly projectId: string }) {
    const queryClient = useQueryClient();
    useEffect(
      () =>
        followTopic({
          subscribe,
          projectId,
          topic: "tokens",
          refetch: () => {
            void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
          },
        }),
      [projectId, queryClient],
    );
    const { data } = useQuery({
      queryKey: ["project", projectId],
      queryFn: () => readProject({ projectId }),
    });
    if (data?.ok !== true) {
      return null;
    }
    const age = figmaSurveyAgeOf({ project: data.value, now: clock() });
    if (age === undefined) {
      return null;
    }
    const lastSurvey = `Dernier relevé Figma : ${AGO.format(-age.days, "day")}`;
    if (!age.stale) {
      return (
        <p>
          <span>{lastSurvey}</span> <SurveyedFile figmaFile={data.value.figmaFile} />
        </p>
      );
    }
    return (
      <section aria-labelledby="releve-figma-en-retard">
        <h2 id="releve-figma-en-retard">Relevé Figma en retard</h2>
        <p>{lastSurvey}</p>
        <p>Au-delà de 14 jours, un relevé planifié s'est peut-être arrêté.</p>
        <SurveyedFile figmaFile={data.value.figmaFile} />
      </section>
    );
  };
