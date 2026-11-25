import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { err, ok, type Result } from "@repo/result";

import type { Clock } from "../../../../platform/clock.ts";
import { makeProjectEvents } from "../../../../testing/project-events.ts";
import type { ProjectDetails, ProjectsFailure } from "../../domain/project.ts";
import { projectFigmaSurvey } from "../project-figma-survey.tsx";

const PROJECT_ID = "0b6f3c2a-8d4e-4f1a-9c7b-5e2d1a0f9b8c";
const FIGMA_KEY = "aB3dE5fG7hI9jK1lM3nO5p";
const FIGMA_URL = `https://www.figma.com/design/${FIGMA_KEY}/Design-system`;
const SURVEYED_AT = new Date("2026-11-02T09:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_HEADING = "Relevé Figma en retard";

type ReadProject = (project: {
  readonly projectId: string;
}) => Promise<Result<ProjectDetails, ProjectsFailure>>;

const makeProject = (overrides: Partial<ProjectDetails> = {}): ProjectDetails => ({
  id: PROJECT_ID,
  spaceId: "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
  name: "Site vitrine",
  createdAt: new Date("2026-01-01T09:00:00.000Z"),
  historyPurgedAt: undefined,
  figmaFile: undefined,
  lastFigmaSurveyAt: undefined,
  ...overrides,
});

const SURVEYED = { lastFigmaSurveyAt: SURVEYED_AT };
const WITH_FIGMA_FILE = { figmaFile: { url: FIGMA_URL, key: FIGMA_KEY } };

const daysAfterSurvey = (days: number): Clock => {
  const now = new Date(SURVEYED_AT.getTime() + days * DAY_MS);
  return () => now;
};

const reading =
  (project: ProjectDetails): ReadProject =>
  () =>
    Promise.resolve(ok(project));

const renderSurvey = ({
  readProject,
  clock = daysAfterSurvey(3),
  events = makeProjectEvents(),
}: {
  readonly readProject: ReadProject;
  readonly clock?: Clock;
  readonly events?: ReturnType<typeof makeProjectEvents>;
}) => {
  const ProjectFigmaSurvey = projectFigmaSurvey({
    readProject,
    subscribe: events.subscribe,
    clock,
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectFigmaSurvey projectId={PROJECT_ID} />
      <p>Page du projet</p>
    </QueryClientProvider>,
  );
};

describe("indice du dernier relevé Figma sur la page du projet (ADR 0059 §6)", () => {
  it("dit depuis combien de jours le projet a été relevé, avec le lien du fichier Figma", async () => {
    const screen = await renderSurvey({
      readProject: reading(makeProject({ ...SURVEYED, ...WITH_FIGMA_FILE })),
    });

    await expect.element(screen.getByText("Dernier relevé Figma : il y a 3 jours")).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Voir le fichier Figma relevé" }))
      .toHaveAttribute("href", FIGMA_URL);
    expect(screen.getByRole("heading", { name: STALE_HEADING }).elements()).toHaveLength(0);
  });

  it("dit aujourd'hui pour un relevé du jour même", async () => {
    const screen = await renderSurvey({
      readProject: reading(makeProject(SURVEYED)),
      clock: daysAfterSurvey(0),
    });

    await expect.element(screen.getByText("Dernier relevé Figma : aujourd’hui")).toBeVisible();
  });

  it("ne montre pas de lien quand le projet n'a plus de fichier Figma", async () => {
    const screen = await renderSurvey({ readProject: reading(makeProject(SURVEYED)) });

    await expect.element(screen.getByText("Dernier relevé Figma : il y a 3 jours")).toBeVisible();
    expect(screen.getByRole("link").elements()).toHaveLength(0);
  });

  it("n'est pas mis en avant 14 jours après le relevé", async () => {
    const screen = await renderSurvey({
      readProject: reading(makeProject(SURVEYED)),
      clock: daysAfterSurvey(14),
    });

    await expect.element(screen.getByText("Dernier relevé Figma : il y a 14 jours")).toBeVisible();
    expect(screen.getByRole("heading", { name: STALE_HEADING }).elements()).toHaveLength(0);
  });

  it("est mis en avant au-delà de 14 jours", async () => {
    const screen = await renderSurvey({
      readProject: reading(makeProject({ ...SURVEYED, ...WITH_FIGMA_FILE })),
      clock: daysAfterSurvey(15),
    });

    const stale = screen.getByRole("region", { name: STALE_HEADING });
    await expect.element(stale).toBeVisible();
    await expect.element(stale.getByText("Dernier relevé Figma : il y a 15 jours")).toBeVisible();
    await expect
      .element(stale.getByRole("link", { name: "Voir le fichier Figma relevé" }))
      .toHaveAttribute("href", FIGMA_URL);
  });

  it("ne montre aucun indice pour un projet jamais relevé", async () => {
    const screen = await renderSurvey({
      readProject: reading(makeProject(WITH_FIGMA_FILE)),
    });

    await expect.element(screen.getByText("Page du projet")).toBeVisible();
    expect(screen.getByText(/Dernier relevé Figma/).elements()).toHaveLength(0);
  });

  it("ne montre rien quand le projet ne se lit pas", async () => {
    const screen = await renderSurvey({ readProject: () => Promise.resolve(err("not_found")) });

    await expect.element(screen.getByText("Page du projet")).toBeVisible();
    expect(screen.getByText(/Dernier relevé Figma/).elements()).toHaveLength(0);
  });

  it("se met à jour sans recharger la page quand le signal tokens du projet arrive", async () => {
    const events = makeProjectEvents();
    const store = { project: makeProject(WITH_FIGMA_FILE) };
    const screen = await renderSurvey({
      readProject: () => Promise.resolve(ok(store.project)),
      events,
    });
    await expect.element(screen.getByText("Page du projet")).toBeVisible();
    await expect.poll(() => events.subscribedProjects()).toEqual([PROJECT_ID]);

    store.project = { ...store.project, ...SURVEYED };
    events.emit(PROJECT_ID, ["tokens"]);

    await expect.element(screen.getByText("Dernier relevé Figma : il y a 3 jours")).toBeVisible();
  });

  it("ne relit pas le projet sur un signal qui ne concerne pas les tokens", async () => {
    const events = makeProjectEvents();
    const asked: string[] = [];
    const screen = await renderSurvey({
      readProject: ({ projectId }) => {
        asked.push(projectId);
        return reading(makeProject(SURVEYED))({ projectId });
      },
      events,
    });
    await expect.element(screen.getByText("Dernier relevé Figma : il y a 3 jours")).toBeVisible();
    await expect.poll(() => events.subscribedProjects()).toEqual([PROJECT_ID]);

    events.emit(PROJECT_ID, ["proposals", "history"]);

    expect(asked).toEqual([PROJECT_ID]);
  });
});
