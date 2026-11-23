import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import type { MemberEnv } from "#platform/member-identity.ts";
import { FORBIDDEN, problemResponse } from "#platform/problem.ts";

import type { AccountUseCases } from "../application/delete-account.ts";

const sessionOnly = createMiddleware<MemberEnv>(async (c, next) => {
  if (c.req.header("authorization") !== undefined) {
    return problemResponse(c, FORBIDDEN);
  }
  await next();
  return undefined;
});

export const accountRoutes = ({ accountDeletionOf, deleteAccount }: AccountUseCases) =>
  new Hono<MemberEnv>()
    .use(sessionOnly)
    .get("/deletion", async (c) => {
      const { paidSpaces, lastOwnerSpaces } = await accountDeletionOf(c.get("identity").userId);
      return c.json({
        paidSpaces: paidSpaces.map(({ currentPeriodEnd, ...paid }) => ({
          ...paid,
          currentPeriodEnd: currentPeriodEnd?.toISOString() ?? null,
        })),
        lastOwnerSpaces,
      });
    })
    .delete("/", async (c) => {
      const deleted = await deleteAccount(c.get("identity").userId);
      if (deleted.ok) {
        return c.body(null, 204);
      }
      return problemResponse(c, {
        type: "https://dezyn.dev/problems/last-owner",
        title: "Dernier propriétaire d'un espace",
        status: 409,
        extensions: {
          spaces: deleted.error.spaces.map(({ id, name }) => ({ id, name })),
        },
      });
    });
