import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { err, ok, type Result } from "@repo/result";

import type { Clock } from "../../../../platform/clock.ts";
import type { ListedProject, ProjectsFailure } from "../../domain/project.ts";
import { projectBanners } from "../project-banners.tsx";

const PROJECT_ID = "0b6f3c2a-8d4e-4f1a-9c7b-5e2d1a0f9b8c";
const SPACE_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";
const PURGED_AT = new Date("2026-01-10T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const PURGE_NOTICE =
  "L'historique de ce projet a été purgé le 10 janvier 2026 pour libérer du stockage.";

type ReadProject = (project: {
  readonly projectId: string;
}) => Promise<Result<ListedProject, ProjectsFailure>>;

const daysAfterPurge = (days: number): Clock => {
  const now = new Date(PURGED_AT.getTime() + days * DAY_MS);
  return () => now;
};

const makeProject = (overrides: Partial<ListedProject> = {}): ListedProject => ({
  id: PROJECT_ID,
  spaceId: SPACE_ID,
  name: "Site vitrine",
  createdAt: new Date("2026-01-01T09:00:00.000Z"),
  historyPurgedAt: undefined,
  figmaFile: undefined,
  ...overrides,
});

const reading =
  (project: ListedProject): ReadProject =>
  () =>
    Promise.resolve(ok(project));

const SpaceStorageAlertStub = ({ spaceId }: { readonly spaceId: string }) => (
  <p>Stockage de l'espace {spaceId}</p>
);

const renderBanners = ({
  readProject,
  clock = daysAfterPurge(1),
}: {
  readonly readProject: ReadProject;
  readonly clock?: Clock;
}) => {
  const ProjectBanners = projectBanners({
    readProject,
    SpaceStorageAlert: SpaceStorageAlertStub,
    clock,
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectBanners projectId={PROJECT_ID} />
      <p>Page du projet</p>
    </QueryClientProvider>,
  );
};

describe("bandeaux de la page d'un projet (#333)", () => {
  it("montre la date de la purge d'un projet purgé il y a moins de 7 jours", async () => {
    const asked: string[] = [];
    const screen = await renderBanners({
      readProject: ({ projectId }) => {
        asked.push(projectId);
        return reading(makeProject({ historyPurgedAt: PURGED_AT }))({ projectId });
      },
    });

    await expect.element(screen.getByRole("status")).toHaveTextContent(PURGE_NOTICE);
    expect(asked).toEqual([PROJECT_ID]);
  });

  it("ne montre plus le bandeau de purge 7 jours après la purge", async () => {
    const screen = await renderBanners({
      readProject: reading(makeProject({ historyPurgedAt: PURGED_AT })),
      clock: daysAfterPurge(7),
    });

    await expect.element(screen.getByText(`Stockage de l'espace ${SPACE_ID}`)).toBeVisible();
    expect(screen.getByRole("status").elements()).toHaveLength(0);
  });

  it("ne montre aucun bandeau de purge pour un projet jamais purgé", async () => {
    const screen = await renderBanners({ readProject: reading(makeProject()) });

    await expect.element(screen.getByText(`Stockage de l'espace ${SPACE_ID}`)).toBeVisible();
    expect(screen.getByRole("status").elements()).toHaveLength(0);
  });

  it("place l'alerte de stockage de l'espace du projet", async () => {
    const screen = await renderBanners({ readProject: reading(makeProject()) });

    await expect.element(screen.getByText(`Stockage de l'espace ${SPACE_ID}`)).toBeVisible();
  });

  it("lit les bandeaux de chaque projet : deux projets de deux espaces ont chacun les leurs", async () => {
    const otherProjectId = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
    const otherSpaceId = "9b8a7f6e-5d4c-4b3a-8f2e-1d0c9b8a7f6e";
    const ProjectBanners = projectBanners({
      readProject: ({ projectId }) =>
        reading(
          projectId === otherProjectId
            ? makeProject({ id: otherProjectId, spaceId: otherSpaceId })
            : makeProject(),
        )({ projectId }),
      SpaceStorageAlert: SpaceStorageAlertStub,
      clock: daysAfterPurge(1),
    });

    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <ProjectBanners projectId={PROJECT_ID} />
        <ProjectBanners projectId={otherProjectId} />
      </QueryClientProvider>,
    );

    await expect.element(screen.getByText(`Stockage de l'espace ${SPACE_ID}`)).toBeVisible();
    await expect.element(screen.getByText(`Stockage de l'espace ${otherSpaceId}`)).toBeVisible();
  });

  it("ne montre rien quand le projet ne se lit pas", async () => {
    const screen = await renderBanners({ readProject: () => Promise.resolve(err("not_found")) });

    await expect.element(screen.getByText("Page du projet")).toBeVisible();
    expect(screen.getByText(/Stockage de l'espace/).elements()).toHaveLength(0);
    expect(screen.getByRole("status").elements()).toHaveLength(0);
  });
});
