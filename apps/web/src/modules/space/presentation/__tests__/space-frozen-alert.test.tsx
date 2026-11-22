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

import type { SpaceFailure, SpaceWithStorage } from "../../domain/space.ts";
import { spaceFrozenAlert } from "../space-frozen-alert.tsx";

const SPACE_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";

type ReadSpace = (space: {
  readonly spaceId: string;
}) => Promise<Result<SpaceWithStorage, SpaceFailure>>;

const OWNER_RIGHTS = { role: "owner", allowedActions: ["space.read", "member.manage"] } as const;

const makeSpace = (overrides: Partial<SpaceWithStorage> = {}): SpaceWithStorage => ({
  id: SPACE_ID,
  name: "Studio Ada",
  plan: "free",
  ...OWNER_RIGHTS,
  storage: { usedBytes: 3_000_000_000, limitBytes: 500_000_000, alertReached: true },
  frozen: false,
  exceededFreeLimits: [],
  ...overrides,
});

const FROZEN_STATE = { frozen: true, exceededFreeLimits: ["projects", "storage"] } as const;

const reading =
  (read: Result<SpaceWithStorage, SpaceFailure>): ReadSpace =>
  () =>
    Promise.resolve(read);

const renderFrozenAlert = (readSpace: ReadSpace, queryClient = new QueryClient()) => {
  const SpaceFrozenAlert = spaceFrozenAlert({ readSpace });
  const root = createRootRoute();
  const hostPage = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => (
      <>
        <SpaceFrozenAlert spaceId={SPACE_ID} />
        <p>Page de l'espace</p>
      </>
    ),
  });
  const planPage = createRoute({
    getParentRoute: () => root,
    path: "/espaces/$spaceId/plan",
    component: function PlanPage() {
      return <p>Plan de l'espace {planPage.useParams().spaceId}</p>;
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([hostPage, planPage]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};

type Screen = Awaited<ReturnType<typeof renderFrozenAlert>>;

const ownerAlertOf = (screen: Screen) => screen.getByRole("region", { name: "Espace gelé" });

const editorAlertOf = (screen: Screen) => screen.getByRole("region", { name: "Accès suspendu" });

const pageLoaded = async (screen: Screen) => {
  await expect.element(screen.getByText("Page de l'espace")).toBeVisible();
};

describe("bandeau de l'espace gelé, pour le propriétaire (ADR 0050 §5, #349)", () => {
  it("explique au propriétaire ce qui est gelé, pourquoi, et comment lever le gel", async () => {
    const screen = await renderFrozenAlert(reading(ok(makeSpace(FROZEN_STATE))));

    await expect
      .element(ownerAlertOf(screen))
      .toHaveTextContent(
        "L'abonnement Team de cet espace est terminé, et l'espace dépasse les limites du plan Free : plus de 3 projets, plus de 500 Mo stockés. Rien n'est supprimé. Vos éditeurs sont suspendus, et vous ne pouvez plus créer de projet ni inviter. Repassez au plan Team, ou revenez sous les limites Free, pour lever le gel.",
      );
  });

  it("nomme la limite des membres", async () => {
    const screen = await renderFrozenAlert(
      reading(ok(makeSpace({ frozen: true, exceededFreeLimits: ["members"] }))),
    );

    await expect.element(ownerAlertOf(screen)).toHaveTextContent("plan Free : plus d'un membre.");
  });

  it("mène à la page « Plan » de l'espace", async () => {
    const screen = await renderFrozenAlert(reading(ok(makeSpace(FROZEN_STATE))));

    await screen.getByRole("link", { name: "Repasser au plan Team" }).click();

    await expect.element(screen.getByText(`Plan de l'espace ${SPACE_ID}`)).toBeVisible();
  });

  it("ne s'affiche pas quand l'espace n'est pas gelé", async () => {
    const screen = await renderFrozenAlert(reading(ok(makeSpace())));

    await pageLoaded(screen);
    await expect.element(ownerAlertOf(screen)).not.toBeInTheDocument();
    await expect.element(editorAlertOf(screen)).not.toBeInTheDocument();
  });

  it("disparaît quand le gel se lève", async () => {
    const queryClient = new QueryClient();
    const screen = await renderFrozenAlert(reading(ok(makeSpace(FROZEN_STATE))), queryClient);
    await expect.element(ownerAlertOf(screen)).toBeVisible();

    queryClient.setQueryData(["space", SPACE_ID], ok(makeSpace({ plan: "team" })));

    await expect.element(ownerAlertOf(screen)).not.toBeInTheDocument();
  });

  it("demande l'espace de la page", async () => {
    const asked: string[] = [];
    const screen = await renderFrozenAlert(({ spaceId }) => {
      asked.push(spaceId);
      return Promise.resolve(ok(makeSpace(FROZEN_STATE)));
    });

    await expect.element(ownerAlertOf(screen)).toBeVisible();
    expect(asked).toEqual([SPACE_ID]);
  });
});

describe("accès suspendu de l'éditeur d'un espace gelé (ADR 0050 §5, #349)", () => {
  it("dit à l'éditeur que son accès est suspendu jusqu'au retour au plan Team", async () => {
    const screen = await renderFrozenAlert(reading(err("frozen")));

    await expect
      .element(editorAlertOf(screen))
      .toHaveTextContent(
        "Votre accès à cet espace est suspendu : il est gelé jusqu'à son retour au plan Team. Rien n'y est supprimé ; un propriétaire peut repasser l'espace au plan Team.",
      );
    await expect.element(ownerAlertOf(screen)).not.toBeInTheDocument();
  });

  it("ne s'affiche pas quand la lecture de l'espace échoue pour une autre raison", async () => {
    const screen = await renderFrozenAlert(reading(err("unavailable")));

    await pageLoaded(screen);
    await expect.element(editorAlertOf(screen)).not.toBeInTheDocument();
    await expect.element(ownerAlertOf(screen)).not.toBeInTheDocument();
  });
});
