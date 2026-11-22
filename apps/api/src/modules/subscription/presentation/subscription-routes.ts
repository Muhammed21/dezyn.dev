import { type Context, Hono } from "hono";

import type { AppEnv } from "#platform/http.ts";
import type { MemberEnv } from "#platform/member-identity.ts";
import { FORBIDDEN, type Problem, problemResponse } from "#platform/problem.ts";
import { Uuid } from "@repo/contracts";

import type { SubscriptionUseCases } from "../application/subscription-use-cases.ts";

const UNAVAILABLE: Problem = {
  type: "about:blank",
  title: "Paiement indisponible",
  status: 503,
};

const ALREADY_TEAM: Problem = {
  type: "https://dezyn.dev/problems/already-team",
  title: "Espace déjà au plan Team",
  status: 409,
};

const NOTIFICATION_PROBLEMS: Readonly<
  Record<"invalid_signature" | "malformed" | "unavailable", Problem>
> = {
  invalid_signature: { type: "about:blank", title: "Signature invalide", status: 401 },
  malformed: { type: "about:blank", title: "Événement illisible", status: 400 },
  unavailable: UNAVAILABLE,
};

export const checkoutRoutes = ({ startCheckout }: Pick<SubscriptionUseCases, "startCheckout">) =>
  new Hono<MemberEnv>().post("/:spaceId/checkout", async (c: Context<MemberEnv>) => {
    const spaceId = Uuid.safeParse(c.req.param("spaceId")).data;
    if (spaceId === undefined) {
      return c.notFound();
    }
    const checkout = await startCheckout({ spaceId, userId: c.get("identity").userId });
    if (checkout.ok) {
      return c.json(checkout.value, 201);
    }
    if (checkout.error === "not_found") {
      return c.notFound();
    }
    if (checkout.error === "forbidden") {
      return problemResponse(c, FORBIDDEN);
    }
    return problemResponse(c, checkout.error === "already_team" ? ALREADY_TEAM : UNAVAILABLE);
  });

export const polarWebhookRoutes = ({
  receiveNotification,
}: Pick<SubscriptionUseCases, "receiveNotification">) =>
  new Hono<AppEnv>().post("/", async (c) => {
    const received = await receiveNotification(await c.req.text(), c.req.header());
    return received.ok
      ? c.json({ received: true })
      : problemResponse(c, NOTIFICATION_PROBLEMS[received.error]);
  });
