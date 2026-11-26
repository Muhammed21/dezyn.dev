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
import type { HistoryEntry, HistoryFailure, HistoryPage } from "../../domain/history.ts";
import { projectHistoryRoute } from "../project-history-route.tsx";

const PROJECT_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";
const OCCURRED_AT = new Date("2026-10-18T12:00:00.000Z");
const PURGED_BEFORE = new Date("2026-09-01T12:00:00.000Z");

type ReadHistory = (project: {
  readonly projectId: string;
  readonly cursor?: string;
}) => Promise<Result<HistoryPage, HistoryFailure>>;

const makeEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: "0b8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
  action: "project.created",
  author: { kind: "member", name: "Ada Lovelace", left: false },
  clientId: undefined,
  occurredAt: OCCURRED_AT,
  ...overrides,
});

const reading =
  (page: Partial<HistoryPage> = {}): ReadHistory =>
  () =>
    Promise.resolve(
      ok({ entries: [makeEntry()], purgedBefore: undefined, nextCursor: undefined, ...page }),
    );

const renderProjectHistory = (
  readHistory: ReadHistory,
  events: ReturnType<typeof makeProjectEvents> = makeProjectEvents(),
  history = createMemoryHistory({ initialEntries: [`/projets/${PROJECT_ID}/historique`] }),
  queryClient = new QueryClient(),
) => {
  const root = createRootRoute();
  const signIn = createRoute({
    getParentRoute: () => root,
    path: "/connexion",
    component: () => <p>Page de connexion</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([
      projectHistoryRoute({ parent: root, readHistory, subscribe: events.subscribe }),
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

const entryItems = (screen: Awaited<ReturnType<typeof renderProjectHistory>>) =>
  screen.getByRole("list", { name: "Historique" }).getByRole("listitem");

const firstEntry = async (entry: HistoryEntry) => {
  const screen = await renderProjectHistory(reading({ entries: [entry] }));
  return { screen, item: entryItems(screen).nth(0) };
};

describe("page de l'historique d'un projet (ADR 0044 §6)", () => {
  it("liste les entrées du projet de l'adresse, dans l'ordre de l'API", async () => {
    const asked: string[] = [];
    const screen = await renderProjectHistory(({ projectId }) => {
      asked.push(projectId);
      return reading({
        entries: [
          makeEntry({ id: "5a8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b", action: "token.created" }),
          makeEntry({ action: "project.created" }),
        ],
      })({ projectId });
    });

    await expect.element(screen.getByRole("heading", { name: "Historique" })).toBeVisible();
    await expect.element(entryItems(screen).nth(0)).toHaveTextContent("Token créé");
    await expect.element(entryItems(screen).nth(1)).toHaveTextContent("Projet créé");
    expect(entryItems(screen).elements()).toHaveLength(2);
    expect(asked).toEqual([PROJECT_ID]);
  });

  it("montre l'auteur et la date de l'entrée, date et heure en français", async () => {
    const { item } = await firstEntry(makeEntry());

    await expect.element(item).toHaveTextContent("Ada Lovelace");
    await expect.element(item).toHaveTextContent(/18 octobre 2026 à \d{2}:\d{2}/);
    expect(item.getByText("via l'IA", { exact: false }).elements()).toHaveLength(0);
  });

  it.each([
    ["project.created", "Projet créé"],
    ["token.created", "Token créé"],
    ["modes.created", "Modes créés"],
    ["proposal.validated", "Proposition validée"],
    ["proposal.rejected", "Proposition rejetée"],
    ["mcp.read_history", "Historique lu par l'IA"],
    ["mcp.read_tokens", "Tokens lus par l'IA"],
    ["mcp.write_tokens", "Tokens écrits par l'IA"],
    ["mcp.open_proposal_batch", "Lot de propositions ouvert par l'IA"],
    ["mcp.close_proposal_batch", "Lot de propositions fermé par l'IA"],
    ["project.figma_file_changed", "Fichier Figma changé"],
    ["mcp.set_project_figma_file", "Fichier Figma changé par l'IA"],
    ["mcp.check_contrast", "Contraste vérifié par l'IA"],
    ["mcp.export_tokens", "Tokens exportés par l'IA"],
    ["token.archived", "token.archived"],
  ])("nomme l'action %s « %s »", async (action, label) => {
    const { item } = await firstEntry(makeEntry({ action }));

    await expect.element(item.getByText(label, { exact: true })).toBeVisible();
  });

  it("dit quelle IA a agi", async () => {
    const { item } = await firstEntry(makeEntry({ clientId: "client-claude" }));

    await expect.element(item).toHaveTextContent("via l'IA (client client-claude)");
  });

  it("dit qu'un membre a quitté l'espace", async () => {
    const { item } = await firstEntry(
      makeEntry({ author: { kind: "member", name: "Ada Lovelace", left: true } }),
    );

    await expect.element(item.getByText("Ada Lovelace (a quitté l'espace)")).toBeVisible();
  });

  it("montre un membre supprimé par son numéro, sans nom (ADR 0015)", async () => {
    const { item } = await firstEntry(makeEntry({ author: { kind: "deleted_member", number: 3 } }));

    await expect.element(item.getByText("Membre supprimé n°3", { exact: true })).toBeVisible();
  });

  it("garde l'entrée d'un auteur inconnu de l'app", async () => {
    const { item } = await firstEntry(makeEntry({ author: { kind: "unknown" } }));

    await expect.element(item.getByText("auteur inconnu", { exact: true })).toBeVisible();
  });

  it("annonce la date avant laquelle l'historique a été purgé", async () => {
    const screen = await renderProjectHistory(reading({ purgedBefore: PURGED_BEFORE }));

    await expect
      .element(
        screen.getByText(
          /^Les entrées antérieures au 1 septembre 2026 à \d{2}:\d{2} ont été supprimées\.$/,
        ),
      )
      .toBeVisible();
  });

  it("n'annonce aucune purge pour un historique complet", async () => {
    const screen = await renderProjectHistory(reading());

    await expect.element(entryItems(screen).nth(0)).toBeVisible();
    expect(screen.getByText("ont été supprimées", { exact: false }).elements()).toHaveLength(0);
  });

  it("annonce le chargement de l'historique", async () => {
    const screen = await renderProjectHistory(() => new Promise(() => {}));

    await expect.element(screen.getByText("Chargement de l'historique…")).toBeVisible();
  });

  it("renvoie vers la connexion quand le membre n'a pas de session", async () => {
    const screen = await renderProjectHistory(() => Promise.resolve(err("unauthenticated")));

    await expect.element(screen.getByText("Page de connexion")).toBeVisible();
  });

  it.each([
    ["not_found", "Ce projet est introuvable."],
    ["unavailable", "L'historique est indisponible pour le moment."],
    ["invalid_response", "L'historique est indisponible pour le moment."],
  ] as const)("annonce l'échec %s de la lecture", async (failure, message) => {
    const screen = await renderProjectHistory(() => Promise.resolve(err(failure)));

    await expect.element(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("list").elements()).toHaveLength(0);
  });

  it("relit l'historique de chaque projet : d'un projet à l'autre, les entrées changent", async () => {
    const otherProjectId = "9b8a7f6e-5d4c-4b3a-8f2e-1d0c9b8a7f6e";
    const history = createMemoryHistory({ initialEntries: [`/projets/${PROJECT_ID}/historique`] });
    const screen = await renderProjectHistory(
      ({ projectId }) =>
        reading({
          entries: [
            makeEntry({ action: projectId === PROJECT_ID ? "project.created" : "token.created" }),
          ],
        })({ projectId }),
      makeProjectEvents(),
      history,
    );
    await expect.element(entryItems(screen).nth(0)).toHaveTextContent("Projet créé");

    history.push(`/projets/${otherProjectId}/historique`);

    await expect.element(entryItems(screen).nth(0)).toHaveTextContent("Token créé");
  });
});

const NEXT_CURSOR = "eyJpZCI6IjEifQ";
const OLDER_ENTRY = makeEntry({
  id: "6b8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
  action: "token.created",
});

const olderButton = (screen: Awaited<ReturnType<typeof renderProjectHistory>>) =>
  screen.getByRole("button", { name: "Entrées plus anciennes" });

const byCursor =
  (
    pages: Readonly<Record<string, () => Promise<Result<HistoryPage, HistoryFailure>>>>,
  ): ReadHistory =>
  ({ cursor }) =>
    (pages[cursor ?? "first"] ?? (() => Promise.resolve(err("invalid_response"))))();

const page = (overrides: Partial<HistoryPage>) => () =>
  Promise.resolve(
    ok({ entries: [makeEntry()], purgedBefore: undefined, nextCursor: undefined, ...overrides }),
  );

describe("entrées plus anciennes de l'historique (ADR 0044 §6)", () => {
  it("charge la page suivante avec le curseur de l'API et l'ajoute sous la liste", async () => {
    const asked: (string | undefined)[] = [];
    const pages = byCursor({
      first: page({ nextCursor: NEXT_CURSOR }),
      [NEXT_CURSOR]: page({ entries: [OLDER_ENTRY] }),
    });
    const screen = await renderProjectHistory((project) => {
      asked.push(project.cursor);
      return pages(project);
    });

    await olderButton(screen).click();

    await expect.element(entryItems(screen).nth(1)).toHaveTextContent("Token créé");
    await expect.element(entryItems(screen).nth(0)).toHaveTextContent("Projet créé");
    expect(entryItems(screen).elements()).toHaveLength(2);
    expect(asked).toEqual([undefined, NEXT_CURSOR]);
  });

  it("ne propose pas d'entrées plus anciennes sur la dernière page", async () => {
    const screen = await renderProjectHistory(reading());

    await expect.element(entryItems(screen).nth(0)).toBeVisible();
    expect(olderButton(screen).elements()).toHaveLength(0);
  });

  it("retire le bouton une fois la dernière page chargée", async () => {
    const screen = await renderProjectHistory(
      byCursor({
        first: page({ nextCursor: NEXT_CURSOR }),
        [NEXT_CURSOR]: page({ entries: [OLDER_ENTRY] }),
      }),
    );

    await olderButton(screen).click();

    await expect.element(entryItems(screen).nth(1)).toBeVisible();
    expect(olderButton(screen).elements()).toHaveLength(0);
  });

  it("ne relance pas le chargement tant que le précédent est en cours", async () => {
    const asked: (string | undefined)[] = [];
    const screen = await renderProjectHistory((project) => {
      asked.push(project.cursor);
      return project.cursor === undefined
        ? page({ nextCursor: NEXT_CURSOR })()
        : new Promise(() => {});
    });

    await olderButton(screen).click();

    await expect.element(olderButton(screen)).toBeDisabled();
    expect(asked).toEqual([undefined, NEXT_CURSOR]);
  });

  it("garde l'annonce de purge de la première page", async () => {
    const screen = await renderProjectHistory(
      byCursor({
        first: page({ nextCursor: NEXT_CURSOR, purgedBefore: PURGED_BEFORE }),
        [NEXT_CURSOR]: page({ entries: [OLDER_ENTRY], purgedBefore: undefined }),
      }),
    );

    await olderButton(screen).click();

    await expect.element(entryItems(screen).nth(1)).toBeVisible();
    await expect
      .element(screen.getByText(/^Les entrées antérieures au 1 septembre 2026/))
      .toBeVisible();
  });

  it.each(["unavailable", "invalid_response", "not_found"] as const)(
    "garde la liste et annonce l'échec %s de la page suivante, puis réessaie",
    async (failure) => {
      const attempts = { count: 0 };
      const screen = await renderProjectHistory(
        byCursor({
          first: page({ nextCursor: NEXT_CURSOR }),
          [NEXT_CURSOR]: () => {
            attempts.count += 1;
            return attempts.count === 1
              ? Promise.resolve(err(failure))
              : page({ entries: [OLDER_ENTRY] })();
          },
        }),
      );

      await olderButton(screen).click();

      await expect
        .element(screen.getByRole("alert"))
        .toHaveTextContent("Les entrées plus anciennes sont indisponibles pour le moment.");
      await expect.element(entryItems(screen).nth(0)).toHaveTextContent("Projet créé");

      await olderButton(screen).click();

      await expect.element(entryItems(screen).nth(1)).toHaveTextContent("Token créé");
      expect(screen.getByRole("alert").elements()).toHaveLength(0);
    },
  );

  it("renvoie vers la connexion quand la session expire avant la page suivante", async () => {
    const screen = await renderProjectHistory(
      byCursor({
        first: page({ nextCursor: NEXT_CURSOR }),
        [NEXT_CURSOR]: () => Promise.resolve(err("unauthenticated")),
      }),
    );

    await olderButton(screen).click();

    await expect.element(screen.getByText("Page de connexion")).toBeVisible();
  });
});

const changingHistory = (initial: readonly HistoryEntry[]) => {
  const state = { entries: initial };
  const readHistory: ReadHistory = () =>
    Promise.resolve(ok({ entries: state.entries, purgedBefore: undefined, nextCursor: undefined }));
  return { state, readHistory };
};

const WRITTEN_BY_AI = makeEntry({
  id: "6c8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
  action: "mcp.write_tokens",
});

describe("l'historique d'un projet avance en direct (ADR 0046)", () => {
  it("un signal history relit l'historique, et la nouvelle entrée apparaît", async () => {
    const events = makeProjectEvents();
    const { state, readHistory } = changingHistory([makeEntry()]);
    const screen = await renderProjectHistory(readHistory, events);
    await expect.element(entryItems(screen).nth(0)).toHaveTextContent("Projet créé");

    state.entries = [WRITTEN_BY_AI, makeEntry()];
    events.emit(PROJECT_ID, ["history"]);

    await expect.element(entryItems(screen).nth(0)).toHaveTextContent("Tokens écrits par l'IA");
  });

  it("un signal d'un autre sujet ne relit rien", async () => {
    const events = makeProjectEvents();
    const reads: string[] = [];
    const screen = await renderProjectHistory(({ projectId }) => {
      reads.push(projectId);
      return reading()({ projectId });
    }, events);
    await expect.element(entryItems(screen).nth(0)).toBeVisible();

    events.emit(PROJECT_ID, ["proposals"]);
    events.emit(PROJECT_ID, ["history"]);

    await expect.poll(() => reads).toEqual([PROJECT_ID, PROJECT_ID]);
  });

  it("après une coupure, la réouverture relit l'historique, sans signal", async () => {
    const events = makeProjectEvents();
    const { state, readHistory } = changingHistory([makeEntry()]);
    const screen = await renderProjectHistory(readHistory, events);
    await expect.element(entryItems(screen).nth(0)).toHaveTextContent("Projet créé");

    state.entries = [WRITTEN_BY_AI, makeEntry()];
    events.resync(PROJECT_ID);

    await expect.element(entryItems(screen).nth(0)).toHaveTextContent("Tokens écrits par l'IA");
  });

  it("un signal history ne relit que l'historique, pas les autres données du projet", async () => {
    const events = makeProjectEvents();
    const queryClient = new QueryClient();
    const tokensKey = ["tokens", PROJECT_ID];
    queryClient.setQueryData(tokensKey, { tokens: [] });
    const screen = await renderProjectHistory(reading(), events, undefined, queryClient);
    await expect.element(entryItems(screen).nth(0)).toBeVisible();

    events.emit(PROJECT_ID, ["history"]);

    await expect
      .poll(() => queryClient.getQueryState(["history", PROJECT_ID])?.dataUpdateCount)
      .toBe(2);
    expect(queryClient.getQueryState(tokensKey)?.isInvalidated).toBe(false);
  });

  it("passer à un autre projet déplace l'abonnement sur ce projet", async () => {
    const events = makeProjectEvents();
    const otherProjectId = "9d8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";
    const history = createMemoryHistory({ initialEntries: [`/projets/${PROJECT_ID}/historique`] });
    const screen = await renderProjectHistory(reading(), events, history);
    await expect.element(entryItems(screen).nth(0)).toBeVisible();

    history.push(`/projets/${otherProjectId}/historique`);

    await expect.poll(() => events.subscribedProjects()).toEqual([otherProjectId]);
  });

  it("s'abonne au projet de l'adresse, et quitter la page ferme l'abonnement", async () => {
    const events = makeProjectEvents();
    const screen = await renderProjectHistory(reading(), events);
    await expect.element(entryItems(screen).nth(0)).toBeVisible();
    expect(events.subscribedProjects()).toEqual([PROJECT_ID]);

    await screen.unmount();

    expect(events.subscribedProjects()).toEqual([]);
  });
});
