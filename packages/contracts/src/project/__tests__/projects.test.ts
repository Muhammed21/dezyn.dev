import { describe, expect, it } from "vitest";

import { checkOutputSchema, ProjectOutput, ProjectsOutput } from "../../index.ts";

const makeProject = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
  name: "Site vitrine",
  createdAt: "2026-10-19T09:00:00.000Z",
  historyPurgedAt: null,
  figmaFile: null,
  ...overrides,
});

describe("sortie de la liste des projets d'un espace", () => {
  it("garde une clé ajoutée plus tard par le serveur (ADR 0023 §1)", () => {
    const later = { projects: [makeProject({ tokenCount: 12 })], nextCursor: null };

    expect(ProjectsOutput.parse(later)).toEqual(later);
  });

  it("refuse un identifiant de projet qui n'est pas un UUID", () => {
    expect(ProjectsOutput.safeParse({ projects: [makeProject({ id: "projet-1" })] }).success).toBe(
      false,
    );
  });

  it("refuse une date de création qui n'est pas une date ISO", () => {
    expect(
      ProjectsOutput.safeParse({ projects: [makeProject({ createdAt: "hier" })] }).success,
    ).toBe(false);
  });

  it("décode la date de la dernière purge de l'historique", () => {
    const purged = { projects: [makeProject({ historyPurgedAt: "2026-11-10T08:00:00.000Z" })] };

    expect(ProjectsOutput.parse(purged)).toEqual(purged);
  });

  it("refuse un projet qui ne dit pas quand son historique a été purgé", () => {
    const { historyPurgedAt: _, ...withoutTrace } = makeProject();

    expect(ProjectsOutput.safeParse({ projects: [withoutTrace] }).success).toBe(false);
  });

  it("refuse une date de purge qui n'est pas une date ISO", () => {
    expect(
      ProjectsOutput.safeParse({ projects: [makeProject({ historyPurgedAt: "hier" })] }).success,
    ).toBe(false);
  });
});

const SPACE_ID = "9b8a7f6e-5d4c-4b3a-8f2e-1d0c9b8a7f6e";

const makeReadProject = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  ...makeProject({ spaceId: SPACE_ID }),
  lastFigmaSurveyAt: null,
  ...overrides,
});

describe("sortie de la lecture d'un projet, avec son espace", () => {
  it("lit le projet, son espace et la date de la dernière purge de son historique", () => {
    const read = makeReadProject({ historyPurgedAt: "2026-11-10T08:00:00.000Z" });

    expect(ProjectOutput.parse(read)).toEqual(read);
  });

  it("refuse un projet lu sans son espace", () => {
    expect(ProjectOutput.safeParse(makeProject()).success).toBe(false);
  });

  it("refuse un espace qui n'est pas un UUID", () => {
    expect(ProjectOutput.safeParse(makeProject({ spaceId: "espace-1" })).success).toBe(false);
  });

  it("refuse un projet qui ne dit pas quand son historique a été purgé", () => {
    const { historyPurgedAt: _, ...withoutTrace } = makeReadProject();

    expect(ProjectOutput.safeParse(withoutTrace).success).toBe(false);
  });

  it("garde une clé ajoutée plus tard par le serveur (ADR 0023 §1)", () => {
    const later = makeReadProject({ tokenCount: 12 });

    expect(ProjectOutput.parse(later)).toEqual(later);
  });

  it("lit la date du dernier relevé Figma (ADR 0059 §6)", () => {
    const read = makeReadProject({ lastFigmaSurveyAt: "2026-11-16T10:30:00.000Z" });

    expect(ProjectOutput.parse(read)).toEqual(read);
  });

  it("refuse un projet qui ne dit pas quand il a été relevé dans Figma", () => {
    const { lastFigmaSurveyAt: _, ...withoutSurvey } = makeReadProject();

    expect(ProjectOutput.safeParse(withoutSurvey).success).toBe(false);
  });

  it("refuse une date de dernier relevé qui n'est pas une date ISO", () => {
    expect(ProjectOutput.safeParse(makeReadProject({ lastFigmaSurveyAt: "lundi" })).success).toBe(
      false,
    );
  });
});

describe("conventions de sortie de la liste des projets (ADR 0023 §4)", () => {
  it("ProjectOutput les respecte", () => {
    expect(checkOutputSchema("ProjectOutput", ProjectOutput)).toEqual([]);
  });

  it("ProjectsOutput les respecte", () => {
    expect(checkOutputSchema("ProjectsOutput", ProjectsOutput)).toEqual([]);
  });
});
