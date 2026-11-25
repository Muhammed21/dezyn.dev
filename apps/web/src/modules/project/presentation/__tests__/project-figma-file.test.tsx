import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { err, ok, type Result } from "@repo/result";

import type {
  FigmaFile,
  FigmaFileFailure,
  ListedProject,
  ProjectsFailure,
} from "../../domain/project.ts";
import { projectFigmaFile } from "../project-figma-file.tsx";

const PROJECT_ID = "0b6f3c2a-8d4e-4f1a-9c7b-5e2d1a0f9b8c";
const FIGMA_KEY = "aB3dE5fG7hI9jK1lM3nO5p";
const FIGMA_URL = `https://www.figma.com/design/${FIGMA_KEY}/Design-system`;
const MOVED_FIGMA_URL = "https://www.figma.com/design/zY8xW6vU4tS2rQ0pO8nM6l/Design-system-v2";
const INVALID_LINK_MESSAGE = "Ce lien n'est pas celui d'un fichier Figma.";

type SetFigmaFile = (change: {
  readonly projectId: string;
  readonly url: string | null;
}) => Promise<Result<FigmaFile | undefined, FigmaFileFailure>>;

const makeProject = (overrides: Partial<ListedProject> = {}): ListedProject => ({
  id: PROJECT_ID,
  spaceId: "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
  name: "Site vitrine",
  createdAt: new Date("2026-01-01T09:00:00.000Z"),
  historyPurgedAt: undefined,
  figmaFile: undefined,
  ...overrides,
});

const WITH_FIGMA_FILE = { figmaFile: { url: FIGMA_URL, key: FIGMA_KEY } };

const makeProjectStore = (initial: ListedProject) => {
  const changes: (string | null)[] = [];
  const store = { project: initial };
  const readProject = (): Promise<Result<ListedProject, ProjectsFailure>> =>
    Promise.resolve(ok(store.project));
  const setFigmaFile: SetFigmaFile = ({ url }) => {
    changes.push(url);
    const figmaFile = url === null ? undefined : { url, key: FIGMA_KEY };
    store.project = { ...store.project, figmaFile };
    return Promise.resolve(ok(figmaFile));
  };
  return { readProject, setFigmaFile, changes };
};

const renderFigmaFile = ({
  readProject,
  setFigmaFile,
}: {
  readonly readProject: () => Promise<Result<ListedProject, ProjectsFailure>>;
  readonly setFigmaFile: SetFigmaFile;
}) => {
  const ProjectFigmaFile = projectFigmaFile({ readProject, setFigmaFile });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectFigmaFile projectId={PROJECT_ID} />
    </QueryClientProvider>,
  );
};

type Screen = Awaited<ReturnType<typeof renderFigmaFile>>;

const saveLink = async (screen: Screen, url: string) => {
  await screen.getByLabelText("Lien du fichier Figma").fill(url);
  await screen.getByRole("button", { name: "Enregistrer le fichier Figma" }).click();
};

describe("le fichier Figma dans les réglages du projet (ADR 0059 §4)", () => {
  it("dit qu'un projet n'a pas encore de fichier Figma", async () => {
    const screen = await renderFigmaFile(makeProjectStore(makeProject()));

    await expect.element(screen.getByText("Aucun fichier Figma pour ce projet.")).toBeVisible();
    expect(screen.getByRole("link").elements()).toHaveLength(0);
  });

  it("montre le lien du fichier Figma du projet", async () => {
    const screen = await renderFigmaFile(makeProjectStore(makeProject(WITH_FIGMA_FILE)));

    await expect
      .element(screen.getByRole("link", { name: "Ouvrir le fichier Figma" }))
      .toHaveAttribute("href", FIGMA_URL);
  });

  it("un membre renseigne le lien, qui s'affiche sur le projet", async () => {
    const store = makeProjectStore(makeProject());
    const screen = await renderFigmaFile(store);

    await saveLink(screen, FIGMA_URL);

    await expect
      .element(screen.getByRole("link", { name: "Ouvrir le fichier Figma" }))
      .toHaveAttribute("href", FIGMA_URL);
    expect(store.changes).toEqual([FIGMA_URL]);
  });

  it("un membre modifie le lien, prérempli avec le lien actuel", async () => {
    const store = makeProjectStore(makeProject(WITH_FIGMA_FILE));
    const screen = await renderFigmaFile(store);
    await expect.element(screen.getByLabelText("Lien du fichier Figma")).toHaveValue(FIGMA_URL);

    await saveLink(screen, MOVED_FIGMA_URL);

    await expect
      .element(screen.getByRole("link", { name: "Ouvrir le fichier Figma" }))
      .toHaveAttribute("href", MOVED_FIGMA_URL);
  });

  it("un membre retire le fichier Figma", async () => {
    const store = makeProjectStore(makeProject(WITH_FIGMA_FILE));
    const screen = await renderFigmaFile(store);

    await screen.getByRole("button", { name: "Retirer le fichier Figma" }).click();

    await expect.element(screen.getByText("Aucun fichier Figma pour ce projet.")).toBeVisible();
    await expect.element(screen.getByLabelText("Lien du fichier Figma")).toHaveValue("");
    expect(store.changes).toEqual([null]);
  });

  it("ne propose pas de retirer un fichier Figma absent", async () => {
    const screen = await renderFigmaFile(makeProjectStore(makeProject()));

    await expect.element(screen.getByLabelText("Lien du fichier Figma")).toBeVisible();
    expect(screen.getByRole("button", { name: "Retirer le fichier Figma" }).elements()).toEqual([]);
  });

  it("refuse un lien qui n'est pas un fichier Figma, avec un message clair", async () => {
    const { readProject } = makeProjectStore(makeProject());
    const screen = await renderFigmaFile({
      readProject,
      setFigmaFile: () => Promise.resolve(err("invalid_figma_file")),
    });

    await saveLink(screen, "https://www.example.com/design-system");

    await expect.element(screen.getByRole("alert")).toHaveTextContent(INVALID_LINK_MESSAGE);
    await expect
      .element(screen.getByLabelText("Lien du fichier Figma"))
      .toHaveValue("https://www.example.com/design-system");
  });

  it("dit quand l'enregistrement est impossible", async () => {
    const { readProject } = makeProjectStore(makeProject());
    const screen = await renderFigmaFile({
      readProject,
      setFigmaFile: () => Promise.resolve(err("unavailable")),
    });

    await saveLink(screen, FIGMA_URL);

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Le fichier Figma ne peut pas être enregistré pour le moment.");
  });
});
