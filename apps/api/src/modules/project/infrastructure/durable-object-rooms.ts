import type { ProjectChannel } from "../domain/project-channel.ts";
import type { ProjectSignals } from "../domain/project-signals.ts";

export type ProjectRooms = {
  readonly getByName: (projectId: string) => {
    readonly fetch: (request: Request) => Promise<Response>;
    readonly changed: (topics: readonly string[]) => Promise<void>;
  };
};

export const durableObjectRooms = (
  rooms: ProjectRooms,
): { readonly signals: ProjectSignals; readonly channel: ProjectChannel } => ({
  signals: {
    changed: ({ projectId, topics }) => rooms.getByName(projectId).changed(topics),
  },
  channel: {
    connect: ({ projectId, request }) => rooms.getByName(projectId).fetch(request),
  },
});
