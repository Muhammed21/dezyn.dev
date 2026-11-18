type Subscription = {
  readonly projectId: string;
  readonly onTopics: (topics: readonly string[]) => void;
};

export const makeProjectEvents = () => {
  const open = new Set<Subscription>();
  return {
    subscribe: (subscription: Subscription) => {
      open.add(subscription);
      return () => {
        open.delete(subscription);
      };
    },
    emit: (projectId: string, topics: readonly string[]) =>
      [...open]
        .filter((subscription) => subscription.projectId === projectId)
        .forEach(({ onTopics }) => onTopics(topics)),
    subscribedProjects: () => [...open].map(({ projectId }) => projectId),
  };
};
