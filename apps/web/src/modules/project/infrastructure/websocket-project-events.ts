import { z } from "zod";

export interface ProjectSocket {
  addEventListener(type: "message", listener: (message: { readonly data: unknown }) => void): void;
  addEventListener(type: "open" | "close", listener: () => void): void;
  send(data: string): void;
  close(): void;
}

export type OpenSocket = (url: string) => ProjectSocket;

export type Schedule = (delayMs: number, run: () => void) => () => void;

const FIRST_RETRY_MS = 1000;
const LONGEST_RETRY_MS = 30_000;
const PING_INTERVAL_MS = 30_000;

type Subscription = {
  readonly onTopics: (topics: readonly string[]) => void;
  readonly onResync: () => void;
};

type Connection = {
  readonly subscriptions: Set<Subscription>;
  stopped: boolean;
  failures: number;
  cancelRetry: () => void;
  cancelPing: () => void;
  socket: ProjectSocket | undefined;
};

const deliverToEach = (
  subscriptions: ReadonlySet<Subscription>,
  deliver: (subscription: Subscription) => void,
) => {
  const errors = [...subscriptions].flatMap((subscription) => {
    try {
      deliver(subscription);
      return [];
    } catch (error) {
      return [error];
    }
  });
  if (errors.length > 0) {
    throw errors[0];
  }
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

const connectTo = ({
  url,
  openSocket,
  schedule,
}: {
  readonly url: string;
  readonly openSocket: OpenSocket;
  readonly schedule: Schedule;
}): Connection => {
  const connection: Connection = {
    subscriptions: new Set(),
    stopped: false,
    failures: 0,
    cancelRetry: () => {},
    cancelPing: () => {},
    socket: undefined,
  };
  const connect = ({ retry }: { readonly retry: boolean }) => {
    const socket = openSocket(url);
    connection.socket = socket;
    socket.addEventListener("message", ({ data }) => {
      const signal = ProjectSignal.safeParse(parsed(data));
      if (signal.success) {
        deliverToEach(connection.subscriptions, ({ onTopics }) => onTopics(signal.data.topics));
      }
    });
    const ping = () => {
      connection.cancelPing = schedule(PING_INTERVAL_MS, () => {
        socket.send("ping");
        ping();
      });
    };
    socket.addEventListener("open", () => {
      connection.failures = 0;
      ping();
      if (retry) {
        deliverToEach(connection.subscriptions, ({ onResync }) => onResync());
      }
    });
    socket.addEventListener("close", () => {
      connection.cancelPing();
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
  return connection;
};

export const createWebSocketProjectEvents = ({
  apiUrl,
  openSocket,
  schedule,
}: {
  readonly apiUrl: string;
  readonly openSocket: OpenSocket;
  readonly schedule: Schedule;
}) => {
  const connections = new Map<string, Connection>();
  return {
    subscribe: ({
      projectId,
      onTopics,
      onResync,
    }: {
      readonly projectId: string;
      readonly onTopics: (topics: readonly string[]) => void;
      readonly onResync: () => void;
    }) => {
      const connection =
        connections.get(projectId) ??
        connectTo({ url: eventsUrlOf({ apiUrl, projectId }), openSocket, schedule });
      connections.set(projectId, connection);
      const subscription: Subscription = { onTopics, onResync };
      connection.subscriptions.add(subscription);
      return () => {
        if (!connection.subscriptions.delete(subscription) || connection.subscriptions.size > 0) {
          return;
        }
        connections.delete(projectId);
        connection.stopped = true;
        connection.cancelRetry();
        connection.socket?.close();
      };
    },
  };
};
