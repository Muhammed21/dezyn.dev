import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { followTopic, type SubscribeToProject } from "../../../platform/project-signals.ts";

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
    return followTopic({
      subscribe,
      projectId,
      topic: "proposals",
      refetch: () => {
        void queryClient.invalidateQueries({ queryKey: [scope, id] });
      },
    });
  }, [subscribe, projectId, queryClient, scope, id]);
};
