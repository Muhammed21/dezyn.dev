import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";

import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "@repo/contracts";

import { fingerprintOf, type Idempotent, type IdempotencyRefusal } from "./idempotency.ts";
import type { MemberEnv } from "./member-identity.ts";
import { type Problem, problemResponse } from "./problem.ts";

const StoredResponse = z.object({
  status: z.int(),
  contentType: z.string().nullable(),
  body: z.string(),
});

type StoredResponse = z.output<typeof StoredResponse> & {
  readonly replay?: "allowed" | "denied";
};

export type Replayable = (c: Context<MemberEnv>) => Promise<boolean>;

const REFUSAL_PROBLEMS: Readonly<Record<IdempotencyRefusal, Problem>> = {
  invalid_idempotency_key: {
    type: "https://dezyn.dev/problems/invalid-idempotency-key",
    title: "Clé d'idempotence invalide",
    status: 400,
  },
  idempotency_in_progress: {
    type: "https://dezyn.dev/problems/idempotency-in-progress",
    title: "Requête encore en cours avec cette clé d'idempotence",
    status: 409,
  },
  idempotency_key_reused: {
    type: "https://dezyn.dev/problems/idempotency-key-reused",
    title: "Clé d'idempotence déjà utilisée avec un autre corps",
    status: 422,
  },
};

const storedOf = async (response: Response): Promise<StoredResponse> => ({
  status: response.status,
  contentType: response.headers.get("content-type"),
  body: await response.clone().text(),
});

const replayedResponse = ({ status, contentType, body }: StoredResponse) =>
  new Response(body === "" ? null : body, {
    status,
    headers: {
      ...(contentType === null ? {} : { "content-type": contentType }),
      [IDEMPOTENCY_REPLAYED_HEADER]: "true",
    },
  });

export const idempotentRequest = ({
  idempotent,
  replayable,
}: {
  readonly idempotent: Idempotent;
  readonly replayable: Replayable;
}) =>
  createMiddleware<MemberEnv>(async (c, next) => {
    const key = c.req.header(IDEMPOTENCY_KEY_HEADER);
    if (key === undefined) {
      await next();
      return undefined;
    }
    const outcome = await idempotent<StoredResponse>({
      claim: {
        userId: c.get("identity").userId,
        scope: `rest:${c.req.method} ${c.req.path}`,
        key,
        fingerprint: fingerprintOf({ body: await c.req.text() }),
      },
      parse: (stored) => StoredResponse.parse(stored),
      run: async () => {
        await next();
        return { response: await storedOf(c.res), memorable: c.res.status < 500 };
      },
      replay: async (stored) => ({
        ...stored,
        replay: (await replayable(c)) ? "allowed" : "denied",
      }),
    });
    if ("refusal" in outcome) {
      return problemResponse(c, REFUSAL_PROBLEMS[outcome.refusal]);
    }
    if (outcome.response.replay === "denied") {
      await next();
      return undefined;
    }
    return outcome.response.replay === "allowed" ? replayedResponse(outcome.response) : undefined;
  });
