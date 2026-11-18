import { describe, expect, it } from "vitest";

import { createProjectEvents } from "../project-module.ts";

const PROJECT_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";

type Listener = (event: { readonly data: unknown }) => void;

type FakeSocket = {
  readonly url: string;
  readonly listeners: { readonly type: string; readonly listener: Listener }[];
  readonly state: { closed: boolean };
};

const dispatch = (socket: FakeSocket | undefined, type: string, data?: unknown) =>
  socket?.listeners
    .filter((entry) => entry.type === type)
    .forEach(({ listener }) => listener({ data }));

const makeSockets = () => {
  const opened: FakeSocket[] = [];
  return {
    opened,
    openSocket: (url: string) => {
      const socket: FakeSocket = { url, listeners: [], state: { closed: false } };
      opened.push(socket);
      return {
        addEventListener: (type: "message" | "open" | "close", listener: Listener) => {
          socket.listeners.push({ type, listener });
        },
        close: () => {
          socket.state.closed = true;
          dispatch(socket, "close");
        },
      };
    },
    receive: (data: string) =>
      opened
        .filter(({ state }) => !state.closed)
        .forEach((socket) => dispatch(socket, "message", data)),
    open: (index: number) => dispatch(opened[index], "open"),
    drop: (index: number) => {
      const socket = opened[index];
      if (socket !== undefined) {
        socket.state.closed = true;
      }
      dispatch(socket, "close");
    },
  };
};

type Scheduled = { readonly delayMs: number; readonly run: () => void; cancelled: boolean };

const makeScheduler = () => {
  const scheduled: Scheduled[] = [];
  return {
    delays: () => scheduled.map(({ delayMs }) => delayMs),
    pending: () => scheduled.filter(({ cancelled }) => !cancelled),
    schedule: (delayMs: number, run: () => void) => {
      const entry: Scheduled = { delayMs, run, cancelled: false };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    runLast: () => {
      const last = scheduled.at(-1);
      if (last !== undefined && !last.cancelled) {
        last.cancelled = true;
        last.run();
      }
    },
  };
};

const subscribed = ({ apiUrl = "https://api.dezyn.dev" }: { readonly apiUrl?: string } = {}) => {
  const sockets = makeSockets();
  const scheduler = makeScheduler();
  const received: (readonly string[])[] = [];
  const resyncs: string[] = [];
  const unsubscribe = createProjectEvents({
    apiUrl,
    openSocket: sockets.openSocket,
    schedule: scheduler.schedule,
  }).subscribe({
    projectId: PROJECT_ID,
    onTopics: (topics) => received.push(topics),
    onResync: () => resyncs.push(PROJECT_ID),
  });
  return { sockets, scheduler, received, resyncs, unsubscribe };
};

const dropAndRetry = (
  { sockets, scheduler }: Pick<ReturnType<typeof subscribed>, "sockets" | "scheduler">,
  index: number,
) => {
  sockets.drop(index);
  scheduler.runLast();
};

describe("l'app web suit un projet par la WebSocket de l'API (ADR 0046)", () => {
  it.each([
    ["https://api.dezyn.dev", `wss://api.dezyn.dev/v1/projects/${PROJECT_ID}/events`],
    ["http://127.0.0.1:3000", `ws://127.0.0.1:3000/v1/projects/${PROJECT_ID}/events`],
  ])("depuis l'API %s, ouvre %s", (apiUrl, url) => {
    const { sockets } = subscribed({ apiUrl });

    expect(sockets.opened.map((opened) => opened.url)).toEqual([url]);
  });

  it("remet les sujets d'un signal changed", () => {
    const { sockets, received } = subscribed();

    sockets.receive(JSON.stringify({ type: "changed", topics: ["proposals"] }));

    expect(received).toEqual([["proposals"]]);
  });

  it.each([
    ["un message qui n'est pas du JSON", "proposals"],
    ["un autre type de message", JSON.stringify({ type: "ping", topics: ["proposals"] })],
    [
      "des sujets qui ne sont pas une liste",
      JSON.stringify({ type: "changed", topics: "proposals" }),
    ],
  ])("ignore %s", (_case, data) => {
    const { sockets, received } = subscribed();

    sockets.receive(data);

    expect(received).toEqual([]);
  });

  it("se désabonner ferme la WebSocket, sans la rouvrir", () => {
    const { sockets, scheduler, unsubscribe } = subscribed();
    sockets.open(0);

    unsubscribe();

    expect(sockets.opened.map(({ state }) => state.closed)).toEqual([true]);
    expect(scheduler.pending()).toEqual([]);
  });
});

describe("la WebSocket d'un projet se rétablit après une coupure (plan temps réel, story 2)", () => {
  it("une coupure non voulue rouvre la WebSocket du même projet après 1 s", () => {
    const subscription = subscribed();
    subscription.sockets.open(0);

    subscription.sockets.drop(0);

    expect(subscription.scheduler.delays()).toEqual([1000]);
    subscription.scheduler.runLast();
    expect(subscription.sockets.opened.map(({ url }) => url)).toEqual([
      `wss://api.dezyn.dev/v1/projects/${PROJECT_ID}/events`,
      `wss://api.dezyn.dev/v1/projects/${PROJECT_ID}/events`,
    ]);
  });

  it("tant que la WebSocket ne se rouvre pas, le délai double jusqu'à 30 s", () => {
    const subscription = subscribed();

    Array.from({ length: 8 }, (_, index) => dropAndRetry(subscription, index));

    expect(subscription.scheduler.delays()).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });

  it("après une ouverture réussie, le délai revient à 1 s", () => {
    const subscription = subscribed();
    dropAndRetry(subscription, 0);
    dropAndRetry(subscription, 1);
    subscription.sockets.open(2);

    subscription.sockets.drop(2);

    expect(subscription.scheduler.delays()).toEqual([1000, 2000, 1000]);
  });

  it("chaque réouverture après une coupure demande un rattrapage, pas la première ouverture", () => {
    const subscription = subscribed();
    subscription.sockets.open(0);
    expect(subscription.resyncs).toEqual([]);

    dropAndRetry(subscription, 0);
    subscription.sockets.open(1);
    dropAndRetry(subscription, 1);
    subscription.sockets.open(2);

    expect(subscription.resyncs).toEqual([PROJECT_ID, PROJECT_ID]);
  });

  it("les signaux arrivent encore sur la WebSocket rouverte", () => {
    const subscription = subscribed();
    dropAndRetry(subscription, 0);
    subscription.sockets.open(1);

    subscription.sockets.receive(JSON.stringify({ type: "changed", topics: ["proposals"] }));

    expect(subscription.received).toEqual([["proposals"]]);
  });

  it("se désabonner pendant l'attente annule la reconnexion", () => {
    const subscription = subscribed();
    subscription.sockets.drop(0);

    subscription.unsubscribe();
    subscription.scheduler.runLast();

    expect(subscription.scheduler.pending()).toEqual([]);
    expect(subscription.sockets.opened).toHaveLength(1);
  });
});
