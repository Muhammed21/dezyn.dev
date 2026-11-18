export type SubscribeToProject = (subscription: {
  readonly projectId: string;
  readonly onTopics: (topics: readonly string[]) => void;
  readonly onResync: () => void;
}) => () => void;

export const followTopic = ({
  subscribe,
  projectId,
  topic,
  refetch,
}: {
  readonly subscribe: SubscribeToProject;
  readonly projectId: string;
  readonly topic: "proposals" | "history";
  readonly refetch: () => void;
}) =>
  subscribe({
    projectId,
    onTopics: (topics) => {
      if (topics.includes(topic)) {
        refetch();
      }
    },
    onResync: refetch,
  });
