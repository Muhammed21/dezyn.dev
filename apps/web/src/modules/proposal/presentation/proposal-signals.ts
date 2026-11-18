import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export type SubscribeToProject = (subscription: {
  readonly projectId: string;
  readonly onTopics: (topics: readonly string[]) => void;
}) => () => void;

export const useProposalSignals = ({
  subscribe,
  projectId,
  refresh,
}: {
  readonly subscribe: SubscribeToProject;
  readonly projectId: string | undefined;
  readonly refresh: { readonly scope: "proposal-batches" | "proposal-batch"; readonly id: string };
}) => {
  const queryClient = useQueryClient();
  const { scope, id } = refresh;
  useEffect(() => {
    if (projectId === undefined) {
      return undefined;
    }
    return subscribe({
      projectId,
      onTopics: (topics) => {
        if (topics.includes("proposals")) {
          void queryClient.invalidateQueries({ queryKey: [scope, id] });
        }
      },
    });
  }, [subscribe, projectId, queryClient, scope, id]);
};
