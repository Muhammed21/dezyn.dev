import { skipToken, useQuery } from "@tanstack/react-query";

import { type ReadTokens, tokensKeyOf } from "./alias-sources.ts";

const NO_MODES: readonly string[] = [];

export const useProjectModes = ({
  projectId,
  readTokens,
}: {
  readonly projectId: string | undefined;
  readonly readTokens: ReadTokens;
}): readonly string[] => {
  const { data } = useQuery({
    queryKey: tokensKeyOf(projectId),
    queryFn: projectId === undefined ? skipToken : () => readTokens({ projectId }),
  });
  return data?.ok === true ? data.value.modes : NO_MODES;
};
