import { describe, expect, it } from "vitest";

import { durableObjectRooms } from "../project-module.ts";

const makeRooms = () => {
  const calls: { readonly room: string; readonly scheduled: unknown }[] = [];
  return {
    calls,
    rooms: {
      getByName: (room: string) => ({
        fetch: async () => new Response(),
        changed: async () => undefined,
        signalAt: async (scheduled: unknown) => {
          calls.push({ room, scheduled });
        },
      }),
    },
  };
};

describe("les signaux programmés d'un projet vont au Durable Object de ce projet (ADR 0046)", () => {
  it("transmet la clé, les sujets et l'échéance en millisecondes", async () => {
    const { calls, rooms } = makeRooms();
    const at = new Date("2026-10-19T09:30:01Z");

    await durableObjectRooms(rooms).signals.signalAt({
      projectId: "projet-1",
      key: "batch:lot-1",
      topics: ["proposals"],
      at,
    });

    expect(calls).toEqual([
      {
        room: "projet-1",
        scheduled: { key: "batch:lot-1", topics: ["proposals"], at: at.getTime() },
      },
    ]);
  });
});
