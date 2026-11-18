import { z } from "zod";

export interface ProjectSocket {
  addEventListener(type: "message", listener: (message: { readonly data: unknown }) => void): void;
  addEventListener(type: "open" | "close", listener: () => void): void;
  close(): void;
}

export type OpenSocket = (url: string) => ProjectSocket;

export type Schedule = (delayMs: number, run: () => void) => () => void;

const FIRST_RETRY_MS = 1000;
const LONGEST_RETRY_MS = 30_000;

type Connection = {
  stopped: boolean;
  failures: number;
  cancelRetry: () => void;
  socket: ProjectSocket | undefined;
};

const retryDelayOf = (failures: number) =>
  Math.min(FIRST_RETRY_MS * 2 ** failures, LONGEST_RETRY_MS);

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
  schedule,
}: {
  readonly apiUrl: string;
  readonly openSocket: OpenSocket;
  readonly schedule: Schedule;
}) => ({
  subscribe: ({
    projectId,
    onTopics,
    onResync,
  }: {
    readonly projectId: string;
    readonly onTopics: (topics: readonly string[]) => void;
    readonly onResync: () => void;
  }) => {
    const url = eventsUrlOf({ apiUrl, projectId });
    const connection: Connection = {
      stopped: false,
      failures: 0,
      cancelRetry: () => {},
      socket: undefined,
    };
    const connect = ({ retry }: { readonly retry: boolean }) => {
      const socket = openSocket(url);
      connection.socket = socket;
      socket.addEventListener("message", ({ data }) => {
        const signal = ProjectSignal.safeParse(parsed(data));
        if (signal.success) {
          onTopics(signal.data.topics);
        }
      });
      socket.addEventListener("open", () => {
        connection.failures = 0;
        if (retry) {
          onResync();
        }
      });
      socket.addEventListener("close", () => {
        if (connection.stopped) {
          return;
        }
        connection.cancelRetry = schedule(retryDelayOf(connection.failures), () =>
          connect({ retry: true }),
        );
        connection.failures += 1;
      });
    };
    connect({ retry: false });
    return () => {
      connection.stopped = true;
      connection.cancelRetry();
      connection.socket?.close();
    };
  },
});
