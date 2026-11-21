import {
  CreatedProjectOutput,
  PlanRequiredProblem,
  ProjectOutput,
  ProjectsOutput,
} from "@repo/contracts";
import { err, ok } from "@repo/result";

import {
  BAD_REQUEST,
  CREATED,
  failureOf,
  type Fetch,
  FORBIDDEN,
  NOT_FOUND,
  OK,
  parseJson,
  send,
  UNAUTHORIZED,
} from "../../../platform/http.ts";
import type { ProjectGateway } from "../application/project-gateway.ts";
import type { ProjectCreationFailure, ProjectsFailure } from "../domain/project.ts";

const readingRefusalOf = (response: Response): ProjectsFailure => {
  if (response.status === UNAUTHORIZED) {
    return "unauthenticated";
  }
  if (response.status === NOT_FOUND) {
    return "not_found";
  }
  return failureOf(response);
};

const purgeDateOf = (historyPurgedAt: string | null) =>
  historyPurgedAt === null ? undefined : new Date(historyPurgedAt);

const refusalOf = async (response: Response): Promise<ProjectCreationFailure> => {
  if (response.status === BAD_REQUEST) {
    return "invalid_name";
  }
  if (response.status === UNAUTHORIZED) {
    return "unauthenticated";
  }
  if (response.status === NOT_FOUND) {
    return "not_found";
  }
  if (response.status === FORBIDDEN) {
    const problem = await parseJson(response, PlanRequiredProblem);
    return problem.ok ? { reason: "plan_required", limit: problem.value.limit } : "forbidden";
  }
  return failureOf(response);
};

export const createHttpProjectGateway = ({
  apiUrl,
  fetch,
}: {
  readonly apiUrl: string;
  readonly fetch: Fetch;
}): ProjectGateway => ({
  createProject: async ({ spaceId, name }) => {
    const sent = await send(fetch, `${apiUrl}/v1/spaces/${spaceId}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!sent.ok) {
      return sent;
    }
    const response = sent.value;
    if (response.status !== CREATED) {
      return err(await refusalOf(response));
    }
    const body = await parseJson(response, CreatedProjectOutput);
    if (!body.ok) {
      return body;
    }
    return ok({
      id: body.value.id,
      spaceId: body.value.spaceId,
      name: body.value.name,
      createdAt: new Date(body.value.createdAt),
    });
  },
  listProjects: async ({ spaceId }) => {
    const sent = await send(fetch, `${apiUrl}/v1/spaces/${spaceId}/projects`, { method: "GET" });
    if (!sent.ok) {
      return sent;
    }
    const response = sent.value;
    if (response.status !== OK) {
      return err(readingRefusalOf(response));
    }
    const body = await parseJson(response, ProjectsOutput);
    if (!body.ok) {
      return body;
    }
    return ok(
      body.value.projects.map(({ id, name, createdAt, historyPurgedAt }) => ({
        id,
        spaceId,
        name,
        createdAt: new Date(createdAt),
        historyPurgedAt: purgeDateOf(historyPurgedAt),
      })),
    );
  },
  readProject: async ({ projectId }) => {
    const sent = await send(fetch, `${apiUrl}/v1/projects/${projectId}`, { method: "GET" });
    if (!sent.ok) {
      return sent;
    }
    const response = sent.value;
    if (response.status !== OK) {
      return err(readingRefusalOf(response));
    }
    const body = await parseJson(response, ProjectOutput);
    if (!body.ok) {
      return body;
    }
    const { id, spaceId, name, createdAt, historyPurgedAt } = body.value;
    return ok({
      id,
      spaceId,
      name,
      createdAt: new Date(createdAt),
      historyPurgedAt: purgeDateOf(historyPurgedAt),
    });
  },
});
