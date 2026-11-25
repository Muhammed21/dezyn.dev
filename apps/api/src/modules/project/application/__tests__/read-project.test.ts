import { describe, expect, it } from "vitest";

import type { ProjectAccess } from "#modules/space/contracts/membership.ts";
import { err, ok } from "@repo/result";

import { type ReadProject, readProject } from "../read-project.ts";

const ADA = "ada";

const makeProject = (overrides: Partial<ReadProject> = {}): ReadProject => ({
  id: "0b6f3c2a-8d4e-4f1a-9c7b-5e2d1a0f9b8c",
  spaceId: "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
  name: "Site vitrine",
  createdAt: new Date("2026-11-01T09:00:00.000Z"),
  historyPurgedAt: new Date("2026-11-10T08:00:00.000Z"),
  figmaFile: null,
  ...overrides,
});

const readWith = ({
  project,
  readers,
}: {
  readonly project: ReadProject;
  readonly readers: readonly string[];
}) => {
  const access: ProjectAccess = async ({ projectId, userId, action }) =>
    projectId === project.id && readers.includes(userId) && action === "space.read"
      ? { id: project.id, spaceId: project.spaceId }
      : undefined;
  return readProject({ access, projects: { projectOf: async () => project } });
};

describe("lire un projet seul", () => {
  it("rend à un lecteur de l'espace le projet, son espace et sa dernière purge", async () => {
    const project = makeProject();
    const read = readWith({ project, readers: [ADA] });

    expect(await read({ projectId: project.id, userId: ADA })).toEqual(ok(project));
  });

  it("ne trouve pas le projet pour un utilisateur qui ne peut pas lire son espace", async () => {
    const project = makeProject();
    const read = readWith({ project, readers: [] });

    expect(await read({ projectId: project.id, userId: ADA })).toEqual(err("not_found"));
  });
});
