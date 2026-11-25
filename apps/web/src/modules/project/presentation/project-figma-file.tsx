import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type SubmitEvent, useState } from "react";

import type { Result } from "@repo/result";

import type {
  FigmaFile,
  FigmaFileFailure,
  ListedProject,
  ProjectsFailure,
} from "../domain/project.ts";

type ReadProject = (project: {
  readonly projectId: string;
}) => Promise<Result<ListedProject, ProjectsFailure>>;

type SetFigmaFile = (change: {
  readonly projectId: string;
  readonly url: string | null;
}) => Promise<Result<FigmaFile | undefined, FigmaFileFailure>>;

const UNAVAILABLE = "Le fichier Figma ne peut pas être enregistré pour le moment.";

const FAILURE_MESSAGES: Readonly<Record<FigmaFileFailure, string>> = {
  invalid_figma_file: "Ce lien n'est pas celui d'un fichier Figma.",
  not_found: "Ce projet est introuvable.",
  unauthenticated: "Votre session a expiré. Reconnectez-vous pour modifier le fichier Figma.",
  unavailable: UNAVAILABLE,
  invalid_response: UNAVAILABLE,
};

const FigmaFileForm = ({
  projectId,
  figmaFile,
  setFigmaFile,
}: {
  readonly projectId: string;
  readonly figmaFile: FigmaFile | undefined;
  readonly setFigmaFile: SetFigmaFile;
}) => {
  const [url, setUrl] = useState(figmaFile?.url ?? "");
  const queryClient = useQueryClient();
  const { data, isPending, mutate } = useMutation({
    mutationFn: setFigmaFile,
    onSuccess: async (result) => {
      if (result.ok) {
        setUrl(result.value?.url ?? "");
        await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      }
    },
  });
  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutate({ projectId, url });
  };
  const failure = !isPending && data?.ok === false ? data.error : undefined;
  return (
    <>
      {figmaFile === undefined ? (
        <p>Aucun fichier Figma pour ce projet.</p>
      ) : (
        <p>
          <a href={figmaFile.url} target="_blank" rel="noreferrer">
            Ouvrir le fichier Figma
          </a>
        </p>
      )}
      <form onSubmit={onSubmit}>
        <label>
          Lien du fichier Figma
          <input
            type="text"
            inputMode="url"
            name="figmaFileUrl"
            placeholder="https://www.figma.com/design/…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <button type="submit" disabled={isPending}>
          Enregistrer le fichier Figma
        </button>
        {figmaFile !== undefined && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => mutate({ projectId, url: null })}
          >
            Retirer le fichier Figma
          </button>
        )}
      </form>
      {failure !== undefined && <p role="alert">{FAILURE_MESSAGES[failure]}</p>}
    </>
  );
};

export const projectFigmaFile = ({
  readProject,
  setFigmaFile,
}: {
  readonly readProject: ReadProject;
  readonly setFigmaFile: SetFigmaFile;
}) =>
  function ProjectFigmaFile({ projectId }: { readonly projectId: string }) {
    const { data } = useQuery({
      queryKey: ["project", projectId],
      queryFn: () => readProject({ projectId }),
    });
    if (data?.ok !== true) {
      return null;
    }
    return (
      <section aria-labelledby="reglages-du-projet">
        <h2 id="reglages-du-projet">Réglages du projet</h2>
        <h3>Fichier Figma</h3>
        <FigmaFileForm
          projectId={projectId}
          figmaFile={data.value.figmaFile}
          setFigmaFile={setFigmaFile}
        />
      </section>
    );
  };
