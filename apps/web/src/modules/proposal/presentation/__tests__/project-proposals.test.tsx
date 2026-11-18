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
import type { BatchSummary, ProposalFailure } from "../../domain/proposal.ts";
import { projectProposals } from "../project-proposals.tsx";

const PROJECT_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";
const OTHER_PROJECT_ID = "5a3b0d2f-8c4e-4f9b-a021-3d6e7f8a9b0c";

type ListBatches = (project: {
  readonly projectId: string;
}) => Promise<Result<readonly BatchSummary[], ProposalFailure>>;

const makeBatch = (overrides: Partial<BatchSummary> = {}): BatchSummary => ({
  id: "0b8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
  intent: "Palette de la marque",
  state: "open",
  toReview: 2,
  ...overrides,
});

const listing =
  (batches: readonly BatchSummary[]): ListBatches =>
  () =>
    Promise.resolve(ok(batches));

const renderProposals = async (
  listBatches: ListBatches,
  events: ReturnType<typeof makeProjectEvents> = makeProjectEvents(),
  queryClient: QueryClient = new QueryClient(),
) => {
  const ProjectProposals = projectProposals({ listBatches, subscribe: events.subscribe });
  const root = createRootRoute();
  const project = createRoute({
    getParentRoute: () => root,
    path: "/projets/$projectId",
    component: function ProjectPage() {
      const { projectId } = project.useParams();
      return <ProjectProposals projectId={projectId} />;
    },
  });
  const signIn = createRoute({
    getParentRoute: () => root,
    path: "/connexion",
    component: () => <p>Page de connexion</p>,
  });
  const history = createMemoryHistory({ initialEntries: [`/projets/${PROJECT_ID}`] });
  const router = createRouter({ routeTree: root.addChildren([project, signIn]), history });
  return {
    history,
    screen: await render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
};

const changingListing = (initial: readonly BatchSummary[]) => {
  const state = { batches: initial, reads: 0 };
  const listBatches: ListBatches = () => {
    state.reads += 1;
    return Promise.resolve(ok(state.batches));
  };
  return { state, listBatches };
};

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 100);
  });

const batchItems = (screen: Awaited<ReturnType<typeof renderProposals>>["screen"]) =>
  screen.getByRole("list", { name: "Lots de propositions" }).getByRole("listitem");

describe("propositions d'un projet (ADR 0012 §1, ADR 0044 §6)", () => {
  it("liste les lots du projet dans l'ordre de l'API, avec leur intention, leur état et le nombre à relire", async () => {
    const asked: string[] = [];
    const { screen } = await renderProposals(({ projectId }) => {
      asked.push(projectId);
      return listing([
        makeBatch(),
        makeBatch({
          id: "1c8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
          intent: "Espacements",
          state: "closed",
          toReview: 0,
        }),
      ])({ projectId });
    });

    await expect.element(screen.getByRole("heading", { name: "Propositions" })).toBeVisible();
    await expect
      .element(batchItems(screen).nth(0))
      .toHaveTextContent("Palette de la marqueOuvert2 à relire");
    await expect.element(batchItems(screen).nth(1)).toHaveTextContent("EspacementsFermé0 à relire");
    expect(batchItems(screen).elements()).toHaveLength(2);
    expect(asked).toEqual([PROJECT_ID]);
  });

  it("mène à la page de chaque lot", async () => {
    const { screen } = await renderProposals(
      listing([makeBatch(), makeBatch({ id: "1c8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b" })]),
    );

    await expect
      .element(batchItems(screen).nth(0).getByRole("link"))
      .toHaveAttribute("href", "/lots/0b8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b");
    await expect
      .element(batchItems(screen).nth(1).getByRole("link"))
      .toHaveAttribute("href", "/lots/1c8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b");
  });

  it("nomme Sans intention un lot ouvert sans intention", async () => {
    const { screen } = await renderProposals(listing([makeBatch({ intent: undefined })]));

    await expect
      .element(batchItems(screen).nth(0).getByText("Sans intention", { exact: true }))
      .toBeVisible();
  });

  it("nomme état inconnu un état que l'app ne connaît pas", async () => {
    const { screen } = await renderProposals(listing([makeBatch({ state: "unknown" })]));

    await expect
      .element(batchItems(screen).nth(0).getByText("état inconnu", { exact: true }))
      .toBeVisible();
    expect(screen.getByText("unknown", { exact: true }).elements()).toHaveLength(0);
  });

  it("relit les lots de chaque projet : d'un projet à l'autre, les lots changent", async () => {
    const { screen, history } = await renderProposals(({ projectId }) =>
      listing([makeBatch({ intent: `Intention de ${projectId}` })])({ projectId }),
    );
    await expect.element(batchItems(screen).nth(0)).toHaveTextContent(`Intention de ${PROJECT_ID}`);

    history.push(`/projets/${OTHER_PROJECT_ID}`);

    await expect
      .element(batchItems(screen).nth(0))
      .toHaveTextContent(`Intention de ${OTHER_PROJECT_ID}`);
  });

  it("annonce un projet sans proposition", async () => {
    const { screen } = await renderProposals(listing([]));

    await expect.element(screen.getByText("Aucune proposition pour le moment.")).toBeVisible();
    expect(screen.getByRole("listitem").elements()).toHaveLength(0);
  });

  it("annonce le chargement des propositions", async () => {
    const { screen } = await renderProposals(() => new Promise(() => {}));

    await expect.element(screen.getByText("Chargement des propositions…")).toBeVisible();
  });

  it("renvoie vers la connexion quand le membre n'a pas de session", async () => {
    const { screen } = await renderProposals(() => Promise.resolve(err("unauthenticated")));

    await expect.element(screen.getByText("Page de connexion")).toBeVisible();
  });

  it.each(["not_found", "unavailable", "invalid_response"] as const)(
    "annonce l'échec %s de la lecture",
    async (failure) => {
      const { screen } = await renderProposals(() => Promise.resolve(err(failure)));

      await expect
        .element(screen.getByRole("alert"))
        .toHaveTextContent("Les propositions sont indisponibles pour le moment.");
      expect(screen.getByRole("list").elements()).toHaveLength(0);
    },
  );

  describe("en temps réel (ADR 0046)", () => {
    const SPACING = makeBatch({
      id: "1c8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
      intent: "Espacements",
    });

    it("un signal proposals du projet affiché fait apparaître les nouveaux lots, sans action du membre", async () => {
      const events = makeProjectEvents();
      const { state, listBatches } = changingListing([makeBatch()]);
      const { screen } = await renderProposals(listBatches, events);
      await expect.element(batchItems(screen).nth(0)).toBeVisible();

      state.batches = [makeBatch(), SPACING];
      events.emit(PROJECT_ID, ["proposals"]);

      await expect.element(batchItems(screen).nth(1)).toHaveTextContent("Espacements");
    });

    it("s'abonne au seul projet affiché, et suit le membre d'un projet à l'autre", async () => {
      const events = makeProjectEvents();
      const { history, screen } = await renderProposals(listing([makeBatch()]), events);
      await expect.element(batchItems(screen).nth(0)).toBeVisible();
      expect(events.subscribedProjects()).toEqual([PROJECT_ID]);

      history.push(`/projets/${OTHER_PROJECT_ID}`);

      await expect.poll(() => events.subscribedProjects()).toEqual([OTHER_PROJECT_ID]);
    });

    it("un signal proposals ne relit que les lots, pas les tokens du projet", async () => {
      const events = makeProjectEvents();
      const queryClient = new QueryClient();
      const tokensKey = ["project-tokens", PROJECT_ID];
      queryClient.setQueryData(tokensKey, ok({ modes: [], tokens: [] }));
      const { state, listBatches } = changingListing([makeBatch()]);
      const { screen } = await renderProposals(listBatches, events, queryClient);
      await expect.element(batchItems(screen).nth(0)).toBeVisible();

      events.emit(PROJECT_ID, ["proposals"]);

      await expect.poll(() => state.reads).toBe(2);
      expect(queryClient.getQueryState(tokensKey)?.isInvalidated).toBe(false);
    });

    it("après une coupure, la réouverture relit les lots, sans signal", async () => {
      const events = makeProjectEvents();
      const { state, listBatches } = changingListing([makeBatch()]);
      const { screen } = await renderProposals(listBatches, events);
      await expect.element(batchItems(screen).nth(0)).toBeVisible();

      state.batches = [makeBatch(), SPACING];
      events.resync(PROJECT_ID);

      await expect.element(batchItems(screen).nth(1)).toHaveTextContent("Espacements");
    });

    it("un signal d'un autre sujet ne relit rien", async () => {
      const events = makeProjectEvents();
      const { state, listBatches } = changingListing([makeBatch()]);
      const { screen } = await renderProposals(listBatches, events);
      await expect.element(batchItems(screen).nth(0)).toBeVisible();

      events.emit(PROJECT_ID, ["history"]);
      await settle();

      expect(state.reads).toBe(1);
    });

    it("quitter la page ferme l'abonnement", async () => {
      const events = makeProjectEvents();
      const { history, screen } = await renderProposals(listing([makeBatch()]), events);
      await expect.element(batchItems(screen).nth(0)).toBeVisible();

      history.push("/connexion");

      await expect.element(screen.getByText("Page de connexion")).toBeVisible();
      expect(events.subscribedProjects()).toEqual([]);
    });
  });
});
