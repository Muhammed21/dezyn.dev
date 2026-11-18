type Subscription = {
  readonly projectId: string;
  readonly onTopics: (topics: readonly string[]) => void;
  readonly onResync: () => void;
};

export const makeProjectEvents = () => {
  const open = new Set<Subscription>();
  const of = (projectId: string) =>
    [...open].filter((subscription) => subscription.projectId === projectId);
  return {
    subscribe: (subscription: Subscription) => {
      open.add(subscription);
      return () => {
        open.delete(subscription);
      };
    },
    emit: (projectId: string, topics: readonly string[]) =>
      of(projectId).forEach(({ onTopics }) => onTopics(topics)),
    resync: (projectId: string) => of(projectId).forEach(({ onResync }) => onResync()),
    subscribedProjects: () => [...open].map(({ projectId }) => projectId),
  };
};
