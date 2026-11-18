import { describe, expect, it } from "vitest";

import { createProjectEvents } from "../project-module.ts";

const PROJECT_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";

type FakeSocket = {
  readonly url: string;
  readonly listeners: {
    readonly type: string;
    readonly listener: (message: { readonly data: unknown }) => void;
  }[];
  readonly state: { closed: boolean };
};

const makeSockets = () => {
  const opened: FakeSocket[] = [];
  return {
    opened,
    openSocket: (url: string) => {
      const socket: FakeSocket = { url, listeners: [], state: { closed: false } };
      opened.push(socket);
      return {
        addEventListener: (
          type: "message",
          listener: (message: { readonly data: unknown }) => void,
        ) => {
          socket.listeners.push({ type, listener });
        },
        close: () => {
          socket.state.closed = true;
        },
      };
    },
    receive: (data: string) =>
      opened.forEach(({ listeners }) =>
        listeners
          .filter(({ type }) => type === "message")
          .forEach(({ listener }) => listener({ data })),
      ),
  };
};

const subscribed = ({ apiUrl = "https://api.dezyn.dev" }: { readonly apiUrl?: string } = {}) => {
  const sockets = makeSockets();
  const received: (readonly string[])[] = [];
  const unsubscribe = createProjectEvents({ apiUrl, openSocket: sockets.openSocket }).subscribe({
    projectId: PROJECT_ID,
    onTopics: (topics) => received.push(topics),
  });
  return { sockets, received, unsubscribe };
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

  it("se désabonner ferme la WebSocket", () => {
    const { sockets, unsubscribe } = subscribed();

    unsubscribe();

    expect(sockets.opened.map(({ state }) => state.closed)).toEqual([true]);
  });
});
