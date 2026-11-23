import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import type { MemberEnv } from "#platform/member-identity.ts";
import { FORBIDDEN, type Problem, problemResponse } from "#platform/problem.ts";
import { validate } from "#platform/validate.ts";
import { AccountDeletionInput } from "@repo/contracts";

import type { Auth, PasswordRefusal } from "../application/auth.ts";
import type { AccountDeletionRefusal, AccountUseCases } from "../application/delete-account.ts";

const sessionOnly = createMiddleware<MemberEnv>(async (c, next) => {
  if (c.req.header("authorization") !== undefined) {
    return problemResponse(c, FORBIDDEN);
  }
  await next();
  return undefined;
});

const PASSWORD_REFUSALS: Readonly<Record<PasswordRefusal, Problem>> = {
  wrong_password: {
    type: "https://dezyn.dev/problems/wrong-password",
    title: "Mot de passe incorrect",
    status: 403,
  },
  too_many_attempts: { type: "about:blank", title: "Trop d'essais", status: 429 },
  unavailable: { type: "about:blank", title: "Service indisponible", status: 503 },
};

const refusalProblem = (refusal: AccountDeletionRefusal): Problem =>
  refusal.kind === "last_owner"
    ? {
        type: "https://dezyn.dev/problems/last-owner",
        title: "Dernier propriétaire d'un espace",
        status: 409,
        extensions: { spaces: refusal.spaces.map(({ id, name }) => ({ id, name })) },
      }
    : PASSWORD_REFUSALS[refusal.kind];

export const accountRoutes = ({
  accountDeletionOf,
  deleteAccount,
  verifyPassword,
}: AccountUseCases & Pick<Auth, "verifyPassword">) =>
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
    .delete("/", validate("json", AccountDeletionInput), async (c) => {
      const { password } = c.req.valid("json");
      const deleted = await deleteAccount({
        userId: c.get("identity").userId,
        checkPassword: () => verifyPassword({ headers: c.req.raw.headers, password }),
      });
      return deleted.ok ? c.body(null, 204) : problemResponse(c, refusalProblem(deleted.error));
    });
