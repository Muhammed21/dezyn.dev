import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type SubmitEvent, useState } from "react";

import type { Result } from "@repo/result";

import type {
  AddedMode,
  ModeAddition,
  ModeAdditionFailure,
  ProjectTokens,
  TokensFailure,
} from "../domain/token.ts";

type ReadProject = (project: {
  readonly projectId: string;
}) => Promise<Result<{ readonly spaceId: string }, unknown>>;

type ReadSpace = (space: {
  readonly spaceId: string;
}) => Promise<Result<{ readonly allowedActions: readonly string[] }, unknown>>;

type ReadTokens = (project: {
  readonly projectId: string;
}) => Promise<Result<ProjectTokens, TokensFailure>>;

type AddMode = (addition: ModeAddition) => Promise<Result<AddedMode, ModeAdditionFailure>>;

const UNAVAILABLE = "Le mode ne peut pas être ajouté pour le moment.";

const FAILURE_MESSAGES: Readonly<Record<ModeAdditionFailure, string>> = {
  pending_proposals:
    "Des propositions attendent une relecture : relisez les lots en attente avant d'ajouter un mode.",
  name_taken: "Ce projet a déjà un mode de ce nom.",
  invalid_name: "Donnez au mode un nom de 1 à 100 caractères.",
  unknown_source: "Ce mode à copier n'existe plus dans le projet.",
  no_modes: "Ce projet n'a pas de modes à copier.",
  not_found: "Ce projet est introuvable.",
  unauthenticated: "Votre session a expiré. Reconnectez-vous pour ajouter un mode.",
  unavailable: UNAVAILABLE,
  invalid_response: UNAVAILABLE,
};

const ModeAdditionForm = ({
  projectId,
  modes,
  addMode,
}: {
  readonly projectId: string;
  readonly modes: readonly string[];
  readonly addMode: AddMode;
}) => {
  const [name, setName] = useState("");
  const [copiedFrom, setCopiedFrom] = useState(modes[0] ?? "");
  const queryClient = useQueryClient();
  const { data, isPending, mutate } = useMutation({
    mutationFn: addMode,
    onSuccess: async (result) => {
      if (result.ok) {
        setName("");
        await queryClient.invalidateQueries({ queryKey: ["tokens", projectId] });
      }
    },
  });
  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutate({ projectId, name, copiedFrom });
  };
  const settled = isPending ? undefined : data;
  return (
    <>
      <form onSubmit={onSubmit}>
        <label>
          Nom du mode
          <input
            type="text"
            name="modeName"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Mode à copier
          <select
            name="copiedFrom"
            value={copiedFrom}
            onChange={(event) => setCopiedFrom(event.target.value)}
          >
            {modes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={isPending}>
          Ajouter le mode
        </button>
      </form>
      {settled?.ok === true && (
        <p role="status">
          Mode « {settled.value.mode} » ajouté, avec les valeurs de « {settled.value.copiedFrom} ».
        </p>
      )}
      {settled?.ok === false && <p role="alert">{FAILURE_MESSAGES[settled.error]}</p>}
    </>
  );
};

export const projectModeAddition = ({
  readProject,
  readSpace,
  readTokens,
  addMode,
}: {
  readonly readProject: ReadProject;
  readonly readSpace: ReadSpace;
  readonly readTokens: ReadTokens;
  readonly addMode: AddMode;
}) =>
  function ProjectModeAddition({ projectId }: { readonly projectId: string }) {
    const { data: project } = useQuery({
      queryKey: ["project", projectId],
      queryFn: () => readProject({ projectId }),
    });
    const spaceId = project?.ok === true ? project.value.spaceId : undefined;
    const { data: space } = useQuery({
      queryKey: ["space", spaceId],
      queryFn: () => readSpace({ spaceId: spaceId ?? "" }),
      enabled: spaceId !== undefined,
    });
    const { data: tokens } = useQuery({
      queryKey: ["tokens", projectId],
      queryFn: () => readTokens({ projectId }),
    });
    const allowed = space?.ok === true && space.value.allowedActions.includes("mode.create");
    if (!allowed || tokens?.ok !== true || tokens.value.modes.length === 0) {
      return null;
    }
    return (
      <section aria-labelledby="ajouter-un-mode">
        <h3 id="ajouter-un-mode">Ajouter un mode</h3>
        <p>
          Le nouveau mode reçoit les valeurs du mode copié ; le relevé Figma suivant propose ses
          valeurs Figma.
        </p>
        <ModeAdditionForm projectId={projectId} modes={tokens.value.modes} addMode={addMode} />
      </section>
    );
  };
