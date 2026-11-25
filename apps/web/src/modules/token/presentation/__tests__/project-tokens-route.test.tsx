import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { err, ok, type Result } from "@repo/result";

import { makeProjectEvents } from "../../../../testing/project-events.ts";
import type { ProjectTokens, Token, TokensFailure } from "../../domain/token.ts";
import { projectTokensRoute, refreshProjectTokens } from "../project-tokens-route.tsx";

const PROJECT_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";
const OTHER_PROJECT_ID = "5a3b0d2f-8c4e-4f9b-a021-3d6e7f8a9b0c";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-25T10:00:00.000Z");
const DAYS_AGO = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
const PRIMARY_BLUE = { colorSpace: "srgb", components: [0.2, 0.4, 0.8], hex: "#3366cc" };
const NIGHT_BLUE = { colorSpace: "srgb", components: [0.1, 0.2, 0.4], hex: "#1a3366" };

type ReadTokens = (project: {
  readonly projectId: string;
}) => Promise<Result<ProjectTokens, TokensFailure>>;

const makeToken = (overrides: Partial<Token> = {}): Token => ({
  id: "0b6f3c2a-8d4e-4f1a-9c7b-5e2d1a0f9b8c",
  name: "couleur.fond.primaire",
  type: "color",
  value: { kind: "single", value: PRIMARY_BLUE },
  description: undefined,
  figma: undefined,
  ...overrides,
});

const reading =
  (tokens: ProjectTokens): ReadTokens =>
  () =>
    Promise.resolve(ok(tokens));

const ProjectProposals = ({ projectId }: { readonly projectId: string }) => (
  <p>Propositions du projet {projectId}</p>
);

const ProjectBanners = ({ projectId }: { readonly projectId: string }) => (
  <p>Bandeaux du projet {projectId}</p>
);

const renderProjectTokens = (
  readTokens: ReadTokens,
  history = createMemoryHistory({ initialEntries: [`/projets/${PROJECT_ID}`] }),
  queryClient = new QueryClient(),
  events: ReturnType<typeof makeProjectEvents> = makeProjectEvents(),
) => {
  const root = createRootRoute();
  const signIn = createRoute({
    getParentRoute: () => root,
    path: "/connexion",
    component: () => <p>Page de connexion</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([
      projectTokensRoute({
        parent: root,
        readTokens,
        ProjectProposals,
        ProjectBanners,
        subscribe: events.subscribe,
        clock: () => NOW,
      }),
      signIn,
    ]),
    history,
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};

const tokenItems = (screen: Awaited<ReturnType<typeof renderProjectTokens>>) =>
  screen.getByRole("list", { name: "Tokens" }).getByRole("listitem");

describe("page des tokens d'un projet (ADR 0044 §6)", () => {
  it("liste les tokens du projet de l'adresse, dans l'ordre de l'API", async () => {
    const asked: string[] = [];
    const screen = await renderProjectTokens(({ projectId }) => {
      asked.push(projectId);
      return reading({
        modes: [],
        tokens: [
          makeToken({ name: "couleur.fond.primaire" }),
          makeToken({
            id: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
            name: "espacement.petit",
            type: "dimension",
            value: { kind: "single", value: { value: 8, unit: "px" } },
          }),
        ],
      })({ projectId });
    });

    await expect.element(screen.getByRole("heading", { name: "Tokens" })).toBeVisible();
    await expect.element(tokenItems(screen).nth(0)).toHaveTextContent("couleur.fond.primaire");
    await expect.element(tokenItems(screen).nth(1)).toHaveTextContent("espacement.petit");
    expect(tokenItems(screen).elements()).toHaveLength(2);
    expect(asked).toEqual([PROJECT_ID]);
  });

  it("relit les tokens de chaque projet : d'un projet à l'autre, les tokens changent", async () => {
    const history = createMemoryHistory({ initialEntries: [`/projets/${PROJECT_ID}`] });
    const screen = await renderProjectTokens(
      ({ projectId }) =>
        reading({ modes: [], tokens: [makeToken({ name: `token.de.${projectId}` })] })({
          projectId,
        }),
      history,
    );
    await expect.element(tokenItems(screen).nth(0)).toHaveTextContent(`token.de.${PROJECT_ID}`);

    history.push(`/projets/${OTHER_PROJECT_ID}`);

    await expect
      .element(tokenItems(screen).nth(0))
      .toHaveTextContent(`token.de.${OTHER_PROJECT_ID}`);
  });

  it("relit les tokens du projet quand on le lui demande, par exemple après une relecture", async () => {
    const queryClient = new QueryClient();
    const reads = { count: 0 };
    const screen = await renderProjectTokens(
      () => {
        reads.count += 1;
        return reading({ modes: [], tokens: [makeToken({ name: `lecture.${reads.count}` })] })({
          projectId: PROJECT_ID,
        });
      },
      undefined,
      queryClient,
    );
    await expect.element(tokenItems(screen).nth(0)).toHaveTextContent("lecture.1");

    await refreshProjectTokens(queryClient)({ projectId: PROJECT_ID });

    await expect.element(tokenItems(screen).nth(0)).toHaveTextContent("lecture.2");
  });

  it("ne relit pas les tokens d'un autre projet", async () => {
    const queryClient = new QueryClient();
    const reads = { count: 0 };
    await renderProjectTokens(
      () => {
        reads.count += 1;
        return reading({ modes: [], tokens: [] })({ projectId: PROJECT_ID });
      },
      undefined,
      queryClient,
    );
    await expect.poll(() => reads.count).toBe(1);

    await refreshProjectTokens(queryClient)({ projectId: OTHER_PROJECT_ID });

    expect(reads.count).toBe(1);
  });

  it("montre le type, la valeur brute en JSON et la description d'un token", async () => {
    const screen = await renderProjectTokens(
      reading({ modes: [], tokens: [makeToken({ description: "Fond des boutons" })] }),
    );

    const item = tokenItems(screen).nth(0);
    await expect.element(item.getByText("color", { exact: true })).toBeVisible();
    await expect.element(item).toHaveTextContent(JSON.stringify(PRIMARY_BLUE));
    await expect.element(item).toHaveTextContent("Fond des boutons");
  });

  it("nomme type inconnu un type que l'app ne connaît pas", async () => {
    const screen = await renderProjectTokens(
      reading({ modes: [], tokens: [makeToken({ type: "unknown" })] }),
    );

    const item = tokenItems(screen).nth(0);
    await expect.element(item.getByText("type inconnu", { exact: true })).toBeVisible();
    expect(item.getByText("unknown", { exact: true }).elements()).toHaveLength(0);
  });

  it("montre la valeur d'un token à modes dans chaque mode, dans l'ordre des modes du projet", async () => {
    const modal = makeToken({
      value: { kind: "by_mode", values: { sombre: NIGHT_BLUE, clair: PRIMARY_BLUE } },
    });
    const screen = await renderProjectTokens(
      reading({ modes: ["clair", "sombre"], tokens: [modal] }),
    );

    const values = screen.getByRole("list", { name: "Valeurs de couleur.fond.primaire" });
    await expect
      .element(values.getByRole("listitem").nth(0))
      .toHaveTextContent(`clair : ${JSON.stringify(PRIMARY_BLUE)}`);
    await expect
      .element(values.getByRole("listitem").nth(1))
      .toHaveTextContent(`sombre : ${JSON.stringify(NIGHT_BLUE)}`);
    expect(values.getByRole("listitem").elements()).toHaveLength(2);
  });

  it("mène à l'historique du projet", async () => {
    const screen = await renderProjectTokens(reading({ modes: [], tokens: [] }));

    await expect
      .element(screen.getByRole("link", { name: "Historique" }))
      .toHaveAttribute("href", `/projets/${PROJECT_ID}/historique`);
  });

  it("montre les propositions du projet de l'adresse, sous ses tokens", async () => {
    const screen = await renderProjectTokens(reading({ modes: [], tokens: [makeToken()] }));

    await expect.element(screen.getByText(`Propositions du projet ${PROJECT_ID}`)).toBeVisible();
  });

  it("montre les bandeaux du projet de l'adresse, sous son titre et avant ses tokens", async () => {
    const screen = await renderProjectTokens(reading({ modes: [], tokens: [makeToken()] }));

    const banners = screen.getByText(`Bandeaux du projet ${PROJECT_ID}`);
    await expect.element(banners).toBeVisible();
    expect(
      banners
        .element()
        .compareDocumentPosition(screen.getByRole("list", { name: "Tokens" }).element()),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("annonce un projet sans token", async () => {
    const screen = await renderProjectTokens(reading({ modes: [], tokens: [] }));

    await expect.element(screen.getByText("Aucun token pour le moment.")).toBeVisible();
    expect(screen.getByRole("listitem").elements()).toHaveLength(0);
  });

  it("annonce le chargement des tokens", async () => {
    const screen = await renderProjectTokens(() => new Promise(() => {}));

    await expect.element(screen.getByText("Chargement des tokens…")).toBeVisible();
  });

  it("renvoie vers la connexion quand le membre n'a pas de session", async () => {
    const screen = await renderProjectTokens(() => Promise.resolve(err("unauthenticated")));

    await expect.element(screen.getByText("Page de connexion")).toBeVisible();
  });

  it.each([
    ["not_found", "Ce projet est introuvable."],
    ["unavailable", "Les tokens sont indisponibles pour le moment."],
    ["invalid_response", "Les tokens sont indisponibles pour le moment."],
  ] as const)("annonce l'échec %s de la lecture", async (failure, message) => {
    const screen = await renderProjectTokens(() => Promise.resolve(err(failure)));

    await expect.element(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("list").elements()).toHaveLength(0);
  });
});

const changingTokens = (initial: readonly Token[]) => {
  const state = { tokens: initial };
  const readTokens: ReadTokens = () => Promise.resolve(ok({ modes: [], tokens: state.tokens }));
  return { state, readTokens };
};

const NIGHT_ID = "7c6f3c2a-8d4e-4f1a-9c7b-5e2d1a0f9b8c";

const NIGHT = makeToken({
  id: NIGHT_ID,
  name: "couleur.fond.nuit",
  value: { kind: "single", value: NIGHT_BLUE },
});

const renderLive = (readTokens: ReadTokens, events = makeProjectEvents()) =>
  renderProjectTokens(
    readTokens,
    createMemoryHistory({ initialEntries: [`/projets/${PROJECT_ID}`] }),
    new QueryClient(),
    events,
  );

describe("les tokens validés d'un projet apparaissent en direct (ADR 0046)", () => {
  it("un signal tokens relit les tokens, et le nouveau token apparaît", async () => {
    const events = makeProjectEvents();
    const { state, readTokens } = changingTokens([makeToken()]);
    const screen = await renderLive(readTokens, events);
    await expect.element(tokenItems(screen).nth(0)).toBeVisible();

    state.tokens = [makeToken(), NIGHT];
    events.emit(PROJECT_ID, ["history", "tokens"]);

    await expect.element(tokenItems(screen).nth(1)).toHaveTextContent("couleur.fond.nuit");
  });

  it("un signal d'un autre sujet ne relit pas les tokens", async () => {
    const events = makeProjectEvents();
    const reads: string[] = [];
    const screen = await renderLive(({ projectId }) => {
      reads.push(projectId);
      return reading({ modes: [], tokens: [makeToken()] })({ projectId });
    }, events);
    await expect.element(tokenItems(screen).nth(0)).toBeVisible();

    events.emit(PROJECT_ID, ["proposals", "history"]);
    events.emit(PROJECT_ID, ["tokens"]);

    await expect.poll(() => reads).toEqual([PROJECT_ID, PROJECT_ID]);
  });

  it("après une coupure, la réouverture relit les tokens, sans signal", async () => {
    const events = makeProjectEvents();
    const { state, readTokens } = changingTokens([makeToken()]);
    const screen = await renderLive(readTokens, events);
    await expect.element(tokenItems(screen).nth(0)).toBeVisible();

    state.tokens = [makeToken(), NIGHT];
    events.resync(PROJECT_ID);

    await expect.element(tokenItems(screen).nth(1)).toHaveTextContent("couleur.fond.nuit");
  });

  it("un signal tokens ne relit que les tokens, pas les autres données du projet", async () => {
    const events = makeProjectEvents();
    const queryClient = new QueryClient();
    const historyKey = ["history", PROJECT_ID];
    queryClient.setQueryData(historyKey, { pages: [], pageParams: [] });
    const screen = await renderProjectTokens(
      reading({ modes: [], tokens: [makeToken()] }),
      createMemoryHistory({ initialEntries: [`/projets/${PROJECT_ID}`] }),
      queryClient,
      events,
    );
    await expect.element(tokenItems(screen).nth(0)).toBeVisible();

    events.emit(PROJECT_ID, ["tokens"]);

    await expect
      .poll(() => queryClient.getQueryState(["tokens", PROJECT_ID])?.dataUpdateCount)
      .toBe(2);
    expect(queryClient.getQueryState(historyKey)?.isInvalidated).toBe(false);
  });

  it("passer à un autre projet déplace l'abonnement, et quitter la page le ferme", async () => {
    const events = makeProjectEvents();
    const history = createMemoryHistory({ initialEntries: [`/projets/${PROJECT_ID}`] });
    const screen = await renderProjectTokens(
      reading({ modes: [], tokens: [makeToken()] }),
      history,
      new QueryClient(),
      events,
    );
    await expect.element(tokenItems(screen).nth(0)).toBeVisible();
    expect(events.subscribedProjects()).toEqual([PROJECT_ID]);

    history.push(`/projets/${OTHER_PROJECT_ID}`);
    await expect.poll(() => events.subscribedProjects()).toEqual([OTHER_PROJECT_ID]);

    await screen.unmount();
    expect(events.subscribedProjects()).toEqual([]);
  });
});

describe("l'état Figma de chaque token, déclaré par l'IA du client (ADR 0024)", () => {
  it.each([
    ["synced", "Synchronisé"],
    ["diverged", "Divergent"],
    ["missing_in_figma", "Absent de Figma"],
    ["duplicate_in_figma", "Doublon dans Figma"],
  ] as const)(
    "montre l'état %s en français, avec l'âge de sa déclaration",
    async (state, label) => {
      const screen = await renderProjectTokens(
        reading({
          modes: [],
          tokens: [makeToken({ figma: { state, declaredAt: DAYS_AGO(3) } })],
        }),
      );

      await expect
        .element(tokenItems(screen).nth(0).getByText(`Figma : ${label} (il y a 3 jours)`))
        .toBeVisible();
    },
  );

  it("dit l'âge de la déclaration comme l'indice du dernier relevé Figma", async () => {
    const screen = await renderProjectTokens(
      reading({
        modes: [],
        tokens: [
          makeToken({ figma: { state: "synced", declaredAt: DAYS_AGO(0) } }),
          makeToken({ id: NIGHT_ID, figma: { state: "synced", declaredAt: DAYS_AGO(1) } }),
        ],
      }),
    );

    await expect
      .element(tokenItems(screen).nth(0).getByText("Figma : Synchronisé (aujourd’hui)"))
      .toBeVisible();
    await expect
      .element(tokenItems(screen).nth(1).getByText("Figma : Synchronisé (hier)"))
      .toBeVisible();
  });

  it("ne montre rien de Figma pour un token sans état Figma", async () => {
    const screen = await renderProjectTokens(
      reading({ modes: [], tokens: [makeToken({ figma: undefined })] }),
    );

    await expect.element(tokenItems(screen).nth(0)).toHaveTextContent("couleur.fond.primaire");
    expect(tokenItems(screen).nth(0).getByText(/Figma/).elements()).toHaveLength(0);
  });

  it("nomme état inconnu un état Figma que l'app ne connaît pas, sans casser la liste", async () => {
    const screen = await renderProjectTokens(
      reading({
        modes: [],
        tokens: [
          makeToken({ figma: { state: "unknown", declaredAt: DAYS_AGO(4) } }),
          makeToken({ id: NIGHT_ID, name: "couleur.fond.nuit" }),
        ],
      }),
    );

    await expect
      .element(tokenItems(screen).nth(0).getByText("Figma : état inconnu (il y a 4 jours)"))
      .toBeVisible();
    await expect.element(tokenItems(screen).nth(1)).toHaveTextContent("couleur.fond.nuit");
  });

  it("un signal tokens met à jour l'état Figma, sans recharger la page", async () => {
    const events = makeProjectEvents();
    const { state, readTokens } = changingTokens([
      makeToken({ figma: { state: "diverged", declaredAt: DAYS_AGO(5) } }),
    ]);
    const screen = await renderLive(readTokens, events);
    await expect
      .element(tokenItems(screen).nth(0).getByText("Figma : Divergent (il y a 5 jours)"))
      .toBeVisible();

    state.tokens = [makeToken({ figma: { state: "synced", declaredAt: DAYS_AGO(0) } })];
    events.emit(PROJECT_ID, ["tokens"]);

    await expect
      .element(tokenItems(screen).nth(0).getByText("Figma : Synchronisé (aujourd’hui)"))
      .toBeVisible();
  });
});
