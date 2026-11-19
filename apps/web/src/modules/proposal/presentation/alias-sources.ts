import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { Result } from "@repo/result";

import { followTopic, type SubscribeToProject } from "../../../platform/project-signals.ts";
import type { Batch, ValidatedTokens } from "../domain/proposal.ts";
import type { AliasValues } from "./alias.ts";

export type ReadTokens = (project: {
  readonly projectId: string;
}) => Promise<Result<ValidatedTokens, unknown>>;

export type AliasSources = { readonly before: AliasValues; readonly after: AliasValues };

export const tokensKeyOf = (projectId: string | undefined) => ["tokens", projectId];

type Entry = readonly [string, unknown];

const validatedValuesOf = (read: Result<ValidatedTokens, unknown> | undefined): AliasValues =>
  new Map(
    read?.ok === true
      ? read.value.tokens.flatMap(({ name, value }): readonly Entry[] =>
          value.kind === "single" ? [[name, value.value]] : [],
        )
      : [],
  );

const proposedValuesOf = (batch: Batch | undefined): readonly Entry[] =>
  (batch?.proposals ?? [])
    .filter(({ status }) => status === "proposed")
    .map(({ name, proposed }): Entry => [name, proposed.$value]);

export const useAliasSources = ({
  batch,
  readTokens,
  subscribe,
}: {
  readonly batch: Batch | undefined;
  readonly readTokens: ReadTokens;
  readonly subscribe: SubscribeToProject;
}): AliasSources => {
  const queryClient = useQueryClient();
  const projectId = batch?.projectId;
  useEffect(() => {
    if (projectId === undefined) {
      return undefined;
    }
    return followTopic({
      subscribe,
      projectId,
      topic: "tokens",
      refetch: () => {
        void queryClient.invalidateQueries({ queryKey: tokensKeyOf(projectId) });
      },
    });
  }, [subscribe, projectId, queryClient]);
  const { data } = useQuery({
    queryKey: tokensKeyOf(projectId),
    queryFn: projectId === undefined ? skipToken : () => readTokens({ projectId }),
  });
  const before = validatedValuesOf(data);
  return { before, after: new Map([...before, ...proposedValuesOf(batch)]) };
};
