import { Hono } from "hono";

import type { MemberEnv } from "#platform/member-identity.ts";
import { problemResponse } from "#platform/problem.ts";
import { Uuid } from "@repo/contracts";

import type { ProjectUseCases } from "../application/project-use-cases.ts";

export const projectEventsRoutes = ({ subscribeToProject }: ProjectUseCases) =>
  new Hono<MemberEnv>().get("/:projectId/events", async (c) => {
    const projectId = Uuid.safeParse(c.req.param("projectId")).data;
    if (projectId === undefined) {
      return c.notFound();
    }
    if (c.req.header("upgrade") !== "websocket") {
      return problemResponse(c, {
        type: "about:blank",
        title: "Mise à niveau WebSocket attendue",
        status: 426,
      });
    }
    const subscribed = await subscribeToProject({
      projectId,
      userId: c.get("identity").userId,
      request: c.req.raw,
    });
    return subscribed.ok ? subscribed.value : c.notFound();
  });
