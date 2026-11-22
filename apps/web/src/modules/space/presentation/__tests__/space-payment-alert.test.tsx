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

import type { SpaceFailure, SpaceSubscription, SpaceWithStorage } from "../../domain/space.ts";
import { spacePaymentAlert } from "../space-payment-alert.tsx";

const SPACE_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";

type ReadSpace = (space: {
  readonly spaceId: string;
}) => Promise<Result<SpaceWithStorage, SpaceFailure>>;

const OWNER_RIGHTS = { role: "owner", allowedActions: ["space.read", "member.manage"] } as const;

const EDITOR_RIGHTS = { role: "editor", allowedActions: ["space.read"] } as const;

const PAST_DUE_SUBSCRIPTION: SpaceSubscription = { status: "past_due" };

const ACTIVE_SUBSCRIPTION: SpaceSubscription = { status: "active" };

const makeSpace = (overrides: Partial<SpaceWithStorage> = {}): SpaceWithStorage => ({
  id: SPACE_ID,
  name: "Studio Ada",
  plan: "team",
  ...OWNER_RIGHTS,
  storage: { usedBytes: 0, limitBytes: 20_000_000_000, alertReached: false },
  ...overrides,
});

const reading =
  (space: SpaceWithStorage): ReadSpace =>
  () =>
    Promise.resolve(ok(space));

const renderPaymentAlert = (readSpace: ReadSpace, queryClient = new QueryClient()) => {
  const SpacePaymentAlert = spacePaymentAlert({ readSpace });
  const root = createRootRoute();
  const hostPage = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => (
      <>
        <SpacePaymentAlert spaceId={SPACE_ID} />
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

type Screen = Awaited<ReturnType<typeof renderPaymentAlert>>;

const alertOf = (screen: Screen) => screen.getByRole("region", { name: "Paiement échoué" });

const pageLoaded = async (screen: Screen) => {
  await expect.element(screen.getByText("Page de l'espace")).toBeVisible();
};

describe("bandeau du retard de paiement de l'espace (ADR 0050 §4, #348)", () => {
  it("dit au propriétaire que le paiement a échoué et l'invite à mettre à jour son moyen de paiement", async () => {
    const screen = await renderPaymentAlert(
      reading(makeSpace({ subscription: PAST_DUE_SUBSCRIPTION })),
    );

    await expect
      .element(alertOf(screen))
      .toHaveTextContent(
        "Le dernier paiement du plan Team a échoué. L'espace reste au plan Team pendant que Polar relance le paiement : mettez à jour le moyen de paiement pour le garder.",
      );
  });

  it("mène à la page « Plan » de l'espace", async () => {
    const screen = await renderPaymentAlert(
      reading(makeSpace({ subscription: PAST_DUE_SUBSCRIPTION })),
    );

    await screen.getByRole("link", { name: "Mettre à jour le moyen de paiement" }).click();

    await expect.element(screen.getByText(`Plan de l'espace ${SPACE_ID}`)).toBeVisible();
  });

  it("ne s'affiche pas quand l'abonnement est actif", async () => {
    const screen = await renderPaymentAlert(
      reading(makeSpace({ subscription: ACTIVE_SUBSCRIPTION })),
    );

    await pageLoaded(screen);
    await expect.element(alertOf(screen)).not.toBeInTheDocument();
  });

  it("ne s'affiche pas à l'éditeur, à qui l'API ne donne pas l'abonnement", async () => {
    const screen = await renderPaymentAlert(reading(makeSpace({ ...EDITOR_RIGHTS })));

    await pageLoaded(screen);
    await expect.element(alertOf(screen)).not.toBeInTheDocument();
  });

  it("disparaît quand l'abonnement redevient actif", async () => {
    const queryClient = new QueryClient();
    const screen = await renderPaymentAlert(
      reading(makeSpace({ subscription: PAST_DUE_SUBSCRIPTION })),
      queryClient,
    );
    await expect.element(alertOf(screen)).toBeVisible();

    queryClient.setQueryData(
      ["space", SPACE_ID],
      ok(makeSpace({ subscription: ACTIVE_SUBSCRIPTION })),
    );

    await expect.element(alertOf(screen)).not.toBeInTheDocument();
  });

  it("demande l'espace de la page", async () => {
    const asked: string[] = [];
    const screen = await renderPaymentAlert(({ spaceId }) => {
      asked.push(spaceId);
      return Promise.resolve(ok(makeSpace({ subscription: PAST_DUE_SUBSCRIPTION })));
    });

    await expect.element(alertOf(screen)).toBeVisible();
    expect(asked).toEqual([SPACE_ID]);
  });

  it("ne s'affiche pas quand la lecture de l'espace échoue", async () => {
    const screen = await renderPaymentAlert(() => Promise.resolve(err("unavailable")));

    await pageLoaded(screen);
    await expect.element(alertOf(screen)).not.toBeInTheDocument();
  });
});
