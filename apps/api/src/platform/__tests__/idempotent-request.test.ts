import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "@repo/contracts";

import { type IdempotencyStore, idempotent, type StoredIdempotencyKey } from "../idempotency.ts";
import { idempotentRequest } from "../idempotent-request.ts";
import type { MemberEnv } from "../member-identity.ts";

const idOf = ({ userId, scope, key }: { userId: string; scope: string; key: string }) =>
  JSON.stringify([userId, scope, key]);

const makeMemoryStore = (): IdempotencyStore => {
  const keys = new Map<string, StoredIdempotencyKey>();
  return {
    reserve: async (claim) => {
      const stored = keys.get(idOf(claim));
      if (stored !== undefined) {
        return { reserved: false, stored };
      }
      keys.set(idOf(claim), { state: "in_progress", fingerprint: claim.fingerprint });
      return { reserved: true };
    },
    complete: async (claim, response) => {
      keys.set(idOf(claim), { state: "completed", fingerprint: claim.fingerprint, response });
    },
    release: async (claim) => {
      keys.delete(idOf(claim));
    },
  };
};

const makeWriteApp = () => {
  const writes: string[] = [];
  const write = idempotentRequest({
    idempotent: idempotent({ store: makeMemoryStore() }),
    replayable: async () => true,
  });
  const app = new Hono<MemberEnv>()
    .use(async (c, next) => {
      c.set("identity", { userId: "ada" });
      await next();
    })
    .on(["POST", "PUT"], "/ecriture", write, (c) => {
      writes.push(c.req.method);
      return c.json({ write: writes.length }, 201);
    });
  return { app, writes };
};

const send = (app: Hono<MemberEnv>, method: string) =>
  app.request("/ecriture", {
    method,
    headers: { [IDEMPOTENCY_KEY_HEADER]: "cle-unique" },
    body: JSON.stringify({ name: "couleur.fond" }),
  });

describe("idempotentRequest : la portée d'une clé REST comprend la méthode", () => {
  it("traite la même clé, le même chemin et le même corps sous une autre méthode comme une nouvelle requête", async () => {
    const { app, writes } = makeWriteApp();
    await send(app, "POST");

    const put = await send(app, "PUT");

    expect(put.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
    expect(writes).toEqual(["POST", "PUT"]);
  });

  it("rejoue la même clé sous la même méthode", async () => {
    const { app, writes } = makeWriteApp();
    await send(app, "PUT");

    const retried = await send(app, "PUT");

    expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe("true");
    expect(writes).toEqual(["PUT"]);
  });
});

const makeBodylessApp = () => {
  const writes: string[] = [];
  const app = new Hono<MemberEnv>()
    .use(async (c, next) => {
      c.set("identity", { userId: "ada" });
      await next();
    })
    .delete(
      "/ecriture",
      idempotentRequest({
        idempotent: idempotent({ store: makeMemoryStore() }),
        replayable: async () => true,
      }),
      (c) => {
        writes.push("DELETE");
        return c.body(null, 204);
      },
    );
  return { app, writes };
};

describe("idempotentRequest : une réponse sans corps se rejoue", () => {
  it("rejoue un 204 sans corps, signalé par Idempotency-Replayed, sans réécrire", async () => {
    const { app, writes } = makeBodylessApp();
    await send(app, "DELETE");

    const retried = await send(app, "DELETE");

    expect(retried.status).toBe(204);
    expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe("true");
    expect(retried.body).toBeNull();
    expect(writes).toEqual(["DELETE"]);
  });
});
