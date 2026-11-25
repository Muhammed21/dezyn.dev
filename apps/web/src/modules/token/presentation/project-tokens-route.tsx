import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { type AnyRootRoute, createRoute, Link, Navigate } from "@tanstack/react-router";
import { type ComponentType, useEffect } from "react";

import type { Result } from "@repo/result";

import type { Clock } from "../../../platform/clock.ts";
import { daysAgoText, daysSince } from "../../../platform/days-ago.ts";
import { followTopic, type SubscribeToProject } from "../../../platform/project-signals.ts";
import type {
  FigmaState,
  ProjectTokens,
  Token,
  TokenFigmaState,
  TokensFailure,
} from "../domain/token.ts";

type ReadTokens = (project: {
  readonly projectId: string;
}) => Promise<Result<ProjectTokens, TokensFailure>>;

type ProjectProposals = ComponentType<{ readonly projectId: string }>;

type ProjectBanners = ComponentType<{ readonly projectId: string }>;

const tokensKeyOf = (projectId: string) => ["tokens", projectId];

export const refreshProjectTokens =
  (queryClient: QueryClient) =>
  ({ projectId }: { readonly projectId: string }) =>
    queryClient.invalidateQueries({ queryKey: tokensKeyOf(projectId) });

const READING_MESSAGES: Readonly<Record<Exclude<TokensFailure, "unauthenticated">, string>> = {
  not_found: "Ce projet est introuvable.",
  unavailable: "Les tokens sont indisponibles pour le moment.",
  invalid_response: "Les tokens sont indisponibles pour le moment.",
};

const TokenValue = ({
  token,
  modes,
}: {
  readonly token: Token;
  readonly modes: readonly string[];
}) => {
  if (token.value.kind === "single") {
    return <p>{JSON.stringify(token.value.value)}</p>;
  }
  const { values } = token.value;
  return (
    <ul aria-label={`Valeurs de ${token.name}`}>
      {modes.map((mode) => (
        <li key={mode}>
          {mode} : {JSON.stringify(values[mode])}
        </li>
      ))}
    </ul>
  );
};

const FIGMA_STATE_LABELS: Readonly<Record<FigmaState, string>> = {
  synced: "Synchronisé",
  diverged: "Divergent",
  missing_in_figma: "Absent de Figma",
  duplicate_in_figma: "Doublon dans Figma",
  unknown: "état inconnu",
};

const TokenFigma = ({
  figma,
  clock,
}: {
  readonly figma: TokenFigmaState | undefined;
  readonly clock: Clock;
}) => {
  if (figma === undefined) {
    return null;
  }
  const declared = daysAgoText(daysSince({ since: figma.declaredAt, now: clock() }));
  return (
    <p>
      Figma : {FIGMA_STATE_LABELS[figma.state]} ({declared})
    </p>
  );
};

const ProjectTokensList = ({
  projectId,
  readTokens,
  ProjectProposals,
  ProjectBanners,
  subscribe,
  clock,
}: {
  readonly projectId: string;
  readonly readTokens: ReadTokens;
  readonly ProjectProposals: ProjectProposals;
  readonly ProjectBanners: ProjectBanners;
  readonly subscribe: SubscribeToProject;
  readonly clock: Clock;
}) => {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      followTopic({
        subscribe,
        projectId,
        topic: "tokens",
        refetch: () => {
          void refreshProjectTokens(queryClient)({ projectId });
        },
      }),
    [subscribe, projectId, queryClient],
  );
  const { data } = useQuery({
    queryKey: tokensKeyOf(projectId),
    queryFn: () => readTokens({ projectId }),
  });
  if (data === undefined) {
    return <p>Chargement des tokens…</p>;
  }
  if (!data.ok) {
    return data.error === "unauthenticated" ? (
      <Navigate to="/connexion" />
    ) : (
      <p role="alert">{READING_MESSAGES[data.error]}</p>
    );
  }
  const { modes, tokens } = data.value;
  return (
    <main>
      <h1>Tokens</h1>
      <ProjectBanners projectId={projectId} />
      <Link to="/projets/$projectId/historique" params={{ projectId }}>
        Historique
      </Link>
      {tokens.length === 0 ? (
        <p>Aucun token pour le moment.</p>
      ) : (
        <ul aria-label="Tokens">
          {tokens.map((token) => (
            <li key={token.id}>
              <p>{token.name}</p>
              <p>{token.type === "unknown" ? "type inconnu" : token.type}</p>
              <TokenValue token={token} modes={modes} />
              <p>{token.description}</p>
              <TokenFigma figma={token.figma} clock={clock} />
            </li>
          ))}
        </ul>
      )}
      <ProjectProposals projectId={projectId} />
    </main>
  );
};

export const projectTokensRoute = ({
  parent,
  readTokens,
  ProjectProposals,
  ProjectBanners,
  subscribe,
  clock,
}: {
  readonly parent: AnyRootRoute;
  readonly readTokens: ReadTokens;
  readonly ProjectProposals: ProjectProposals;
  readonly ProjectBanners: ProjectBanners;
  readonly subscribe: SubscribeToProject;
  readonly clock: Clock;
}) => {
  const route = createRoute({
    getParentRoute: () => parent,
    path: "/projets/$projectId",
    component: function ProjectTokensPage() {
      const { projectId } = route.useParams();
      return (
        <ProjectTokensList
          projectId={projectId}
          readTokens={readTokens}
          ProjectProposals={ProjectProposals}
          ProjectBanners={ProjectBanners}
          subscribe={subscribe}
          clock={clock}
        />
      );
    },
  });
  return route;
};
