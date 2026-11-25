import { Hono } from "hono";

import { planRequired } from "#modules/space/contracts/plan.ts";
import type { MemberEnv } from "#platform/member-identity.ts";
import { FORBIDDEN, problemResponse } from "#platform/problem.ts";
import { validate } from "#platform/validate.ts";
import { CreateProjectInput, FigmaFileInput, Uuid } from "@repo/contracts";

import type { ProjectUseCases } from "../application/project-use-cases.ts";
import { listedProjectOutputOf } from "./project-output.ts";

export const projectRoutes = ({ readProject, setFigmaFile }: ProjectUseCases) =>
  new Hono<MemberEnv>()
    .get("/:projectId", async (c) => {
      const projectId = Uuid.safeParse(c.req.param("projectId")).data;
      if (projectId === undefined) {
        return c.notFound();
      }
      const read = await readProject({ projectId, userId: c.get("identity").userId });
      if (!read.ok) {
        return c.notFound();
      }
      const { spaceId, ...listed } = read.value;
      return c.json({ ...listedProjectOutputOf(listed), spaceId });
    })
    .put("/:projectId/figma-file", validate("json", FigmaFileInput), async (c) => {
      const projectId = Uuid.safeParse(c.req.param("projectId")).data;
      if (projectId === undefined) {
        return c.notFound();
      }
      const set = await setFigmaFile({
        projectId,
        userId: c.get("identity").userId,
        clientId: null,
        url: c.req.valid("json").url,
        correlationId: c.get("correlationId"),
      });
      return set.ok ? c.json({ figmaFile: set.value }) : c.notFound();
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
            projects: listed.value.map(listedProjectOutputOf),
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
