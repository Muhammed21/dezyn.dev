import { Hono } from "hono";

import { planRequired } from "#modules/space/contracts/plan.ts";
import type { MemberEnv } from "#platform/member-identity.ts";
import { FORBIDDEN, problemResponse } from "#platform/problem.ts";
import { validate } from "#platform/validate.ts";
import { CreateProjectInput, Uuid } from "@repo/contracts";

import type { ProjectUseCases } from "../application/project-use-cases.ts";

export const projectRoutes = ({ readProject }: ProjectUseCases) =>
  new Hono<MemberEnv>().get("/:projectId", async (c) => {
    const projectId = Uuid.safeParse(c.req.param("projectId")).data;
    if (projectId === undefined) {
      return c.notFound();
    }
    const read = await readProject({ projectId, userId: c.get("identity").userId });
    if (!read.ok) {
      return c.notFound();
    }
    const { id, spaceId, name, createdAt, historyPurgedAt } = read.value;
    return c.json({
      id,
      spaceId,
      name,
      createdAt: createdAt.toISOString(),
      historyPurgedAt: historyPurgedAt?.toISOString() ?? null,
    });
  });

export const projectsRoutes = ({ createProject, listProjects }: ProjectUseCases) =>
  new Hono<MemberEnv>()
    .get("/:spaceId/projects", async (c) => {
      const spaceId = Uuid.safeParse(c.req.param("spaceId")).data;
      if (spaceId === undefined) {
        return c.notFound();
      }
      const listed = await listProjects({ spaceId, userId: c.get("identity").userId });
      return listed.ok
        ? c.json({
            projects: listed.value.map(({ id, name, createdAt, historyPurgedAt }) => ({
              id,
              name,
              createdAt: createdAt.toISOString(),
              historyPurgedAt: historyPurgedAt?.toISOString() ?? null,
            })),
          })
        : c.notFound();
    })
    .post("/:spaceId/projects", validate("json", CreateProjectInput), async (c) => {
      const spaceId = Uuid.safeParse(c.req.param("spaceId")).data;
      if (spaceId === undefined) {
        return c.notFound();
      }
      const created = await createProject({
        spaceId,
        userId: c.get("identity").userId,
        name: c.req.valid("json").name,
        correlationId: c.get("correlationId"),
      });
      if (created.ok) {
        return c.json(created.value, 201);
      }
      if (created.error === "not_found") {
        return c.notFound();
      }
      if (created.error === "forbidden") {
        return problemResponse(c, FORBIDDEN);
      }
      return problemResponse(c, planRequired(created.error));
    });
