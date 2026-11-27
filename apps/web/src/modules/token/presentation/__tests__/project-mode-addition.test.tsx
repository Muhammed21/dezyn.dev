import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { err, ok, type Result } from "@repo/result";

import type {
  AddedMode,
  ModeAddition,
  ModeAdditionFailure,
  ProjectTokens,
  TokensFailure,
} from "../../domain/token.ts";
import { projectModeAddition } from "../project-mode-addition.tsx";

const PROJECT_ID = "0b6f3c2a-8d4e-4f1a-9c7b-5e2d1a0f9b8c";
const SPACE_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";

const MEMBER_ACTIONS = ["space.read", "token.create", "mode.create", "proposal.review"];

const makeProjectTokens = (overrides: Partial<ProjectTokens> = {}): ProjectTokens => ({
  modes: ["clair", "sombre"],
  tokens: [],
  ...overrides,
});

type AddMode = (addition: ModeAddition) => Promise<Result<AddedMode, ModeAdditionFailure>>;

const makeModesStore = ({
  modes = ["clair", "sombre"],
  addMode,
}: { readonly modes?: readonly string[]; readonly addMode?: AddMode } = {}) => {
  const additions: ModeAddition[] = [];
  const store = { tokens: makeProjectTokens({ modes }) };
  const asked: string[] = [];
  const readTokens = ({
    projectId,
  }: {
    readonly projectId: string;
  }): Promise<Result<ProjectTokens, TokensFailure>> => {
    asked.push(projectId);
    return Promise.resolve(ok(store.tokens));
  };
  const addingMode: AddMode = (addition) => {
    additions.push(addition);
    if (addMode !== undefined) {
      return addMode(addition);
    }
    const name = addition.name.trim();
    store.tokens = { ...store.tokens, modes: [...store.tokens.modes, name] };
    return Promise.resolve(
      ok({ mode: name, copiedFrom: addition.copiedFrom, modes: store.tokens.modes }),
    );
  };
  return { readTokens, addMode: addingMode, additions, asked };
};

const renderModeAddition = ({
  allowedActions = MEMBER_ACTIONS,
  store = makeModesStore(),
}: {
  readonly allowedActions?: readonly string[];
  readonly store?: ReturnType<typeof makeModesStore>;
} = {}) => {
  const ProjectModeAddition = projectModeAddition({
    readProject: () => Promise.resolve(ok({ spaceId: SPACE_ID })),
    readSpace: () => Promise.resolve(ok({ allowedActions })),
    readTokens: store.readTokens,
    addMode: store.addMode,
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectModeAddition projectId={PROJECT_ID} />
    </QueryClientProvider>,
  );
};

type Screen = Awaited<ReturnType<typeof renderModeAddition>>;

const addMode = async (
  screen: Screen,
  { name, copiedFrom }: { readonly name: string; readonly copiedFrom?: string },
) => {
  await screen.getByLabelText("Nom du mode").fill(name);
  if (copiedFrom !== undefined) {
    await screen.getByLabelText("Mode à copier").selectOptions(copiedFrom);
  }
  await screen.getByRole("button", { name: "Ajouter le mode" }).click();
};

describe("le formulaire « Ajouter un mode » de la page du projet (ADR 0062)", () => {
  it("propose de copier chacun des modes du projet, le premier par défaut", async () => {
    const screen = await renderModeAddition();

    await expect.element(screen.getByRole("heading", { name: "Ajouter un mode" })).toBeVisible();
    await expect.element(screen.getByLabelText("Mode à copier")).toHaveValue("clair");
    expect(
      screen
        .getByRole("option")
        .elements()
        .map((option) => option.textContent),
    ).toEqual(["clair", "sombre"]);
  });

  it("un membre ajoute un mode en copiant le mode choisi, et le formulaire le compte parmi les modes", async () => {
    const store = makeModesStore();
    const screen = await renderModeAddition({ store });

    await addMode(screen, { name: "contraste-eleve", copiedFrom: "sombre" });

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Mode « contraste-eleve » ajouté, avec les valeurs de « sombre ».");
    await expect.element(screen.getByLabelText("Nom du mode")).toHaveValue("");
    await expect
      .element(screen.getByRole("option", { name: "contraste-eleve" }))
      .toBeInTheDocument();
    expect(store.additions).toEqual([
      { projectId: PROJECT_ID, name: "contraste-eleve", copiedFrom: "sombre" },
    ]);
  });

  it("n'apparaît pas à un membre qui n'a pas le droit d'ajouter un mode", async () => {
    const store = makeModesStore();
    const screen = await renderModeAddition({ allowedActions: ["space.read"], store });

    await expect.poll(() => store.asked).toEqual([PROJECT_ID]);
    expect(screen.getByRole("heading", { name: "Ajouter un mode" }).elements()).toEqual([]);
  });

  it("n'apparaît pas dans un projet sans modes", async () => {
    const store = makeModesStore({ modes: [] });
    const screen = await renderModeAddition({ store });

    await expect.poll(() => store.asked).toEqual([PROJECT_ID]);
    expect(screen.getByRole("heading", { name: "Ajouter un mode" }).elements()).toEqual([]);
  });

  it.each<[ModeAdditionFailure, string]>([
    [
      "pending_proposals",
      "Des propositions attendent une relecture : relisez les lots en attente avant d'ajouter un mode.",
    ],
    ["name_taken", "Ce projet a déjà un mode de ce nom."],
    ["invalid_name", "Donnez au mode un nom de 1 à 100 caractères."],
    ["unknown_source", "Ce mode à copier n'existe plus dans le projet."],
    ["unavailable", "Le mode ne peut pas être ajouté pour le moment."],
  ])("dit pourquoi l'ajout est refusé (%s)", async (failure, message) => {
    const store = makeModesStore({ addMode: () => Promise.resolve(err(failure)) });
    const screen = await renderModeAddition({ store });

    await addMode(screen, { name: "contraste-eleve" });

    await expect.element(screen.getByRole("alert")).toHaveTextContent(message);
    await expect.element(screen.getByLabelText("Nom du mode")).toHaveValue("contraste-eleve");
  });
});
