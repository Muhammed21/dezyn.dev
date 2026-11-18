import { z } from "zod";

export type ProjectSocket = {
  readonly addEventListener: (
    type: "message",
    listener: (message: { readonly data: unknown }) => void,
  ) => void;
  readonly close: () => void;
};

export type OpenSocket = (url: string) => ProjectSocket;

const ProjectSignal = z.object({ type: z.literal("changed"), topics: z.array(z.string()) });

const parsed = (data: unknown): unknown => {
  try {
    return JSON.parse(String(data));
  } catch {
    return undefined;
  }
};

const eventsUrlOf = ({
  apiUrl,
  projectId,
}: {
  readonly apiUrl: string;
  readonly projectId: string;
}) => {
  const url = new URL(`/v1/projects/${encodeURIComponent(projectId)}/events`, apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
};

export const createWebSocketProjectEvents = ({
  apiUrl,
  openSocket,
}: {
  readonly apiUrl: string;
  readonly openSocket: OpenSocket;
}) => ({
  subscribe: ({
    projectId,
    onTopics,
  }: {
    readonly projectId: string;
    readonly onTopics: (topics: readonly string[]) => void;
  }) => {
    const socket = openSocket(eventsUrlOf({ apiUrl, projectId }));
    socket.addEventListener("message", ({ data }) => {
      const signal = ProjectSignal.safeParse(parsed(data));
      if (signal.success) {
        onTopics(signal.data.topics);
      }
    });
    return () => socket.close();
  },
});
