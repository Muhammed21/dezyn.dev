import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

const connect = async (projectId: string) => {
  const response = await env.PROJECT_ROOMS.getByName(projectId).fetch("https://realtime/", {
    headers: { upgrade: "websocket" },
  });
  const received: unknown[] = [];
  const texts: string[] = [];
  response.webSocket?.accept();
  response.webSocket?.addEventListener("message", ({ data }) => {
    const text = String(data);
    if (text.startsWith("{")) {
      received.push(JSON.parse(text));
    } else {
      texts.push(text);
    }
  });
  return {
    status: response.status,
    received,
    texts,
    send: (text: string) => response.webSocket?.send(text),
  };
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

const changedSignal = (topics: readonly string[]) => ({ type: "changed", topics });

const pause = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const ALARM_WAIT_MS = 2000;

describe("le Durable Object d'un projet envoie au plus un signal par seconde", () => {
  it("un second signal dans la même seconde attend l'alarme, avec les sujets fusionnés", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);
    const connection = await connect(projectId);

    await room.changed(["proposals"]);
    await room.changed(["history", "tokens"]);
    await room.changed(["proposals"]);
    await vi.waitFor(() => expect(connection.received).toEqual([PROPOSALS_CHANGED]));

    expect(await runDurableObjectAlarm(room)).toBe(true);

    await vi.waitFor(
      () =>
        expect(connection.received).toEqual([
          PROPOSALS_CHANGED,
          changedSignal(["history", "tokens", "proposals"]),
        ]),
      { timeout: ALARM_WAIT_MS },
    );
  });

  it("dix signaux en rafale donnent exactement deux messages", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);
    const connection = await connect(projectId);

    await Array.from({ length: 10 }).reduce<Promise<void>>(
      (previous) => previous.then(() => room.changed(["proposals"])),
      Promise.resolve(),
    );
    await runDurableObjectAlarm(room);

    await vi.waitFor(
      () => expect(connection.received).toEqual([PROPOSALS_CHANGED, PROPOSALS_CHANGED]),
      { timeout: ALARM_WAIT_MS },
    );
    expect(await runDurableObjectAlarm(room)).toBe(false);
  });

  it("un signal une seconde après le dernier envoi part tout de suite, sans alarme", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);
    const connection = await connect(projectId);

    await room.changed(["proposals"]);
    await pause(1100);
    await room.changed(["tokens"]);

    await vi.waitFor(() =>
      expect(connection.received).toEqual([PROPOSALS_CHANGED, changedSignal(["tokens"])]),
    );
    expect(await runDurableObjectAlarm(room)).toBe(false);
  });

  it("après l'envoi de l'alarme, un nouveau signal attend la seconde suivante, avec ses seuls sujets", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);
    const connection = await connect(projectId);
    await room.changed(["proposals"]);
    await room.changed(["history"]);
    await pause(1100);
    await runDurableObjectAlarm(room);

    await room.changed(["tokens"]);
    await vi.waitFor(() =>
      expect(connection.received).toEqual([PROPOSALS_CHANGED, changedSignal(["history"])]),
    );
    expect(await runDurableObjectAlarm(room)).toBe(true);

    await vi.waitFor(() =>
      expect(connection.received).toEqual([
        PROPOSALS_CHANGED,
        changedSignal(["history"]),
        changedSignal(["tokens"]),
      ]),
    );
  });

  it("une alarme en retard n'est pas doublée par un envoi immédiat : l'envoi emporte l'attente", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);
    const connection = await connect(projectId);
    await room.changed(["proposals"]);
    await room.changed(["history"]);
    await runInDurableObject(room, (_instance, state) =>
      state.storage.setAlarm(Date.now() + 60_000),
    );
    await pause(1100);

    await room.changed(["tokens"]);

    await vi.waitFor(
      () =>
        expect(connection.received).toEqual([
          PROPOSALS_CHANGED,
          changedSignal(["history", "tokens"]),
        ]),
      { timeout: ALARM_WAIT_MS },
    );
    expect(await runDurableObjectAlarm(room)).toBe(false);
    await room.changed(["proposals"]);
    await runDurableObjectAlarm(room);
    await vi.waitFor(
      () =>
        expect(connection.received).toEqual([
          PROPOSALS_CHANGED,
          changedSignal(["history", "tokens"]),
          PROPOSALS_CHANGED,
        ]),
      { timeout: ALARM_WAIT_MS },
    );
  });

  it("un signal seul ne programme pas d'alarme", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);

    await room.changed(["proposals"]);

    expect(await runDurableObjectAlarm(room)).toBe(false);
  });

  it("les sujets en attente survivent à la mise en veille du Durable Object", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);
    const connection = await connect(projectId);

    await room.changed(["proposals"]);
    await room.changed(["history"]);
    await evictDurableObject(room);
    await runDurableObjectAlarm(room);

    await vi.waitFor(
      () => expect(connection.received).toEqual([PROPOSALS_CHANGED, changedSignal(["history"])]),
      { timeout: ALARM_WAIT_MS },
    );
  });
});

describe("le Durable Object d'un projet garde ses connexions vivantes", () => {
  it("un ping reçoit pong", async () => {
    const connection = await connect(crypto.randomUUID());

    connection.send("ping");

    await vi.waitFor(() => expect(connection.texts).toEqual(["pong"]));
  });

  it("un ping reçoit pong après la mise en veille du Durable Object", async () => {
    const projectId = crypto.randomUUID();
    const connection = await connect(projectId);

    await evictDurableObject(env.PROJECT_ROOMS.getByName(projectId));
    connection.send("ping");

    await vi.waitFor(() => expect(connection.texts).toEqual(["pong"]));
  });
});

const inMs = (ms: number) => Date.now() + ms;

describe("le Durable Object d'un projet diffuse ses signaux programmés à leur échéance", () => {
  it("à l'échéance d'une clé, ses sujets sont diffusés, pas avant", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);
    const connection = await connect(projectId);

    await room.signalAt({ key: "batch:a", topics: ["proposals"], at: inMs(300) });

    expect(connection.received).toEqual([]);
    await vi.waitFor(() => expect(connection.received).toEqual([PROPOSALS_CHANGED]), {
      timeout: ALARM_WAIT_MS,
    });
  });

  it("programmer la même clé remplace son échéance", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);
    const connection = await connect(projectId);

    await room.signalAt({ key: "batch:a", topics: ["proposals"], at: inMs(300) });
    await room.signalAt({ key: "batch:a", topics: ["proposals"], at: inMs(60_000) });
    await pause(800);

    expect(connection.received).toEqual([]);
  });

  it("deux clés gardent chacune leur échéance", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);
    const connection = await connect(projectId);

    await room.signalAt({ key: "batch:a", topics: ["proposals"], at: inMs(200) });
    await room.signalAt({ key: "batch:b", topics: ["history"], at: inMs(1500) });

    await vi.waitFor(() => expect(connection.received).toEqual([PROPOSALS_CHANGED]), {
      timeout: 1000,
    });
    await vi.waitFor(
      () => expect(connection.received).toEqual([PROPOSALS_CHANGED, changedSignal(["history"])]),
      { timeout: 3000 },
    );
  });

  it("des échéances simultanées donnent un seul message, sujets fusionnés", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);
    const connection = await connect(projectId);
    const at = inMs(300);

    await room.signalAt({ key: "batch:a", topics: ["proposals"], at });
    await room.signalAt({ key: "batch:b", topics: ["history"], at });

    await vi.waitFor(
      () => expect(connection.received).toEqual([changedSignal(["proposals", "history"])]),
      { timeout: ALARM_WAIT_MS },
    );
    await pause(300);
    expect(connection.received).toHaveLength(1);
  });

  it("une échéance moins d'une seconde après un envoi attend la fin de la seconde", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);
    const connection = await connect(projectId);

    await room.changed(["tokens"]);
    await room.signalAt({ key: "batch:a", topics: ["proposals"], at: inMs(200) });
    await pause(600);

    expect(connection.received).toEqual([changedSignal(["tokens"])]);
    await vi.waitFor(
      () => expect(connection.received).toEqual([changedSignal(["tokens"]), PROPOSALS_CHANGED]),
      { timeout: ALARM_WAIT_MS },
    );
  });

  it("un envoi immédiat garde les échéances à venir", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);
    const connection = await connect(projectId);

    await room.signalAt({ key: "batch:a", topics: ["proposals"], at: inMs(1500) });
    await room.changed(["tokens"]);

    await vi.waitFor(
      () => expect(connection.received).toEqual([changedSignal(["tokens"]), PROPOSALS_CHANGED]),
      { timeout: 3000 },
    );
  });

  it("une échéance survit à la mise en veille du Durable Object", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);
    const connection = await connect(projectId);

    await room.signalAt({ key: "batch:a", topics: ["proposals"], at: inMs(500) });
    await evictDurableObject(room);

    await vi.waitFor(() => expect(connection.received).toEqual([PROPOSALS_CHANGED]), {
      timeout: ALARM_WAIT_MS,
    });
  });

  it("une alarme partie avant toute échéance n'envoie rien et reste programmée", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);
    const connection = await connect(projectId);
    await room.signalAt({ key: "batch:a", topics: ["proposals"], at: inMs(60_000) });

    await runDurableObjectAlarm(room);
    await pause(200);

    expect(connection.received).toEqual([]);
    expect(await runDurableObjectAlarm(room)).toBe(true);
  });

  it("sans échéance ni attente, plus aucune alarme n'est programmée", async () => {
    const projectId = crypto.randomUUID();
    const room = env.PROJECT_ROOMS.getByName(projectId);
    const connection = await connect(projectId);

    await room.signalAt({ key: "batch:a", topics: ["proposals"], at: inMs(200) });
    await vi.waitFor(() => expect(connection.received).toEqual([PROPOSALS_CHANGED]), {
      timeout: ALARM_WAIT_MS,
    });

    expect(await runDurableObjectAlarm(room)).toBe(false);
  });
});
