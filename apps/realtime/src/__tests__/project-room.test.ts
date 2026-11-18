import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

const connect = async (projectId: string) => {
  const response = await env.PROJECT_ROOMS.getByName(projectId).fetch("https://realtime/", {
    headers: { upgrade: "websocket" },
  });
  const received: unknown[] = [];
  response.webSocket?.accept();
  response.webSocket?.addEventListener("message", ({ data }) => {
    received.push(JSON.parse(String(data)));
  });
  return { status: response.status, received };
};

const PROPOSALS_CHANGED = { type: "changed", topics: ["proposals"] };

describe("le Durable Object d'un projet diffuse ses signaux à ses connexions (ADR 0046)", () => {
  it("une poignée de main WebSocket est acceptée", async () => {
    const connection = await connect(crypto.randomUUID());

    expect(connection.status).toBe(101);
  });

  it("toutes les connexions du projet reçoivent le signal", async () => {
    const projectId = crypto.randomUUID();
    const first = await connect(projectId);
    const second = await connect(projectId);

    await env.PROJECT_ROOMS.getByName(projectId).changed(["proposals"]);

    await vi.waitFor(() => {
      expect(first.received).toEqual([PROPOSALS_CHANGED]);
      expect(second.received).toEqual([PROPOSALS_CHANGED]);
    });
  });

  it("une connexion d'un autre projet ne reçoit pas le signal", async () => {
    const projectId = crypto.randomUUID();
    const watched = await connect(projectId);
    const other = await connect(crypto.randomUUID());

    await env.PROJECT_ROOMS.getByName(projectId).changed(["proposals"]);

    await vi.waitFor(() => expect(watched.received).toEqual([PROPOSALS_CHANGED]));
    expect(other.received).toEqual([]);
  });

  it("une connexion reçoit encore le signal après la mise en veille du Durable Object", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);
    const connection = await connect(projectId);

    await evictDurableObject(room);
    await room.changed(["proposals"]);

    await vi.waitFor(() => expect(connection.received).toEqual([PROPOSALS_CHANGED]));
  });

  it("une requête sans Upgrade: websocket reçoit 426", async () => {
    const response = await env.PROJECT_ROOMS.getByName(crypto.randomUUID()).fetch(
      "https://realtime/",
    );

    expect(response.status).toBe(426);
  });
});
