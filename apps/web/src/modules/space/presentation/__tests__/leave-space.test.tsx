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

import type {
  LeaveFailure,
  SpaceFailure,
  SpaceSubscription,
  SpaceWithStorage,
} from "../../domain/space.ts";
import { leaveSpaceAction } from "../leave-space.tsx";

const SPACE_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";

type ReadSpace = (space: {
  readonly spaceId: string;
}) => Promise<Result<SpaceWithStorage, SpaceFailure>>;

type LeaveSpace = (space: { readonly spaceId: string }) => Promise<Result<undefined, LeaveFailure>>;

const makeSpace = (overrides: Partial<SpaceWithStorage> = {}): SpaceWithStorage => ({
  id: SPACE_ID,
  name: "Studio Ada",
  plan: "free",
  role: "owner",
  allowedActions: ["space.read", "member.leave"],
  storage: { usedBytes: 0, limitBytes: 500_000_000, alertReached: false },
  frozen: false,
  exceededFreeLimits: [],
  ...overrides,
});

const makeSubscription = (overrides: Partial<SpaceSubscription> = {}): SpaceSubscription => ({
  status: "active",
  currentPeriodEnd: new Date("2026-12-22T10:00:00.000Z"),
  payer: { name: "Ada Lovelace", email: "ada@dezyn.test", you: false, left: false },
  ...overrides,
});

const PAID_BY_ME = {
  payer: { name: "Ada Lovelace", email: "ada@dezyn.test", you: true, left: false },
} as const;

const reading =
  (space: SpaceWithStorage): ReadSpace =>
  () =>
    Promise.resolve(ok(space));

const pending = () => new Promise<never>(() => {});

const answeringLeave = (outcome: Result<undefined, LeaveFailure>) => {
  const departures: string[] = [];
  const leaveSpace: LeaveSpace = ({ spaceId }) => {
    departures.push(spaceId);
    return Promise.resolve(outcome);
  };
  return { departures, leaveSpace };
};

const renderLeaveSpace = ({
  readSpace,
  leaveSpace = pending,
  queryClient = new QueryClient(),
}: {
  readonly readSpace: ReadSpace;
  readonly leaveSpace?: LeaveSpace;
  readonly queryClient?: QueryClient;
}) => {
  const LeaveSpaceButton = leaveSpaceAction({ readSpace, leaveSpace });
  const root = createRootRoute();
  const spacePage = createRoute({
    getParentRoute: () => root,
    path: "/espaces/$spaceId",
    component: function SpacePage() {
      return <LeaveSpaceButton spaceId={spacePage.useParams().spaceId} />;
    },
  });
  const mySpaces = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <p>Mes espaces</p>,
  });
  const signIn = createRoute({
    getParentRoute: () => root,
    path: "/connexion",
    component: () => <p>Page de connexion</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([spacePage, mySpaces, signIn]),
    history: createMemoryHistory({ initialEntries: [`/espaces/${SPACE_ID}`] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};

type Screen = Awaited<ReturnType<typeof renderLeaveSpace>>;

const leaveButton = (screen: Screen) => screen.getByRole("button", { name: "Quitter l'espace" });

const confirmButton = (screen: Screen) =>
  screen.getByRole("button", { name: "Confirmer le départ" });

const confirmation = (screen: Screen) => screen.getByRole("region", { name: "Quitter l'espace" });

describe("quitter l'espace (ADR 0011 §5)", () => {
  it("un membre qui peut partir voit « Quitter l'espace », sans partir encore", async () => {
    const { departures, leaveSpace } = answeringLeave(ok(undefined));
    const screen = await renderLeaveSpace({ readSpace: reading(makeSpace()), leaveSpace });

    await expect.element(leaveButton(screen)).toBeVisible();
    expect(confirmation(screen).query()).toBeNull();
    expect(departures).toEqual([]);
  });

  it("lit l'espace de la page", async () => {
    const asked: string[] = [];
    const screen = await renderLeaveSpace({
      readSpace: ({ spaceId }) => {
        asked.push(spaceId);
        return Promise.resolve(ok(makeSpace()));
      },
    });

    await expect.element(leaveButton(screen)).toBeVisible();
    expect(asked).toEqual([SPACE_ID]);
  });

  it("partage la lecture de l'espace avec le reste de la page", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["space", SPACE_ID], ok(makeSpace()));
    const screen = await renderLeaveSpace({ readSpace: pending, queryClient });

    await expect.element(leaveButton(screen)).toBeVisible();
  });

  it("un membre qui ne peut pas partir ne voit pas le bouton", async () => {
    const read = Promise.resolve(ok(makeSpace({ allowedActions: ["space.read"] })));
    const screen = await renderLeaveSpace({ readSpace: () => read });

    await read;
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    expect(leaveButton(screen).query()).toBeNull();
  });

  it("demande une confirmation, puis part et revient à la liste des espaces", async () => {
    const { departures, leaveSpace } = answeringLeave(ok(undefined));
    const screen = await renderLeaveSpace({ readSpace: reading(makeSpace()), leaveSpace });

    await leaveButton(screen).click();
    await expect
      .element(confirmation(screen))
      .toHaveTextContent("Quitter l'espace « Studio Ada » ?");
    expect(screen.getByRole("alert").query()).toBeNull();
    await confirmButton(screen).click();

    await expect.element(screen.getByText("Mes espaces")).toBeVisible();
    expect(departures).toEqual([SPACE_ID]);
  });

  it("après le départ, la liste des espaces est relue", async () => {
    const { leaveSpace } = answeringLeave(ok(undefined));
    const queryClient = new QueryClient();
    queryClient.setQueryData(["my-spaces"], ok([]));
    queryClient.setQueryData(["other"], ok([]));
    const screen = await renderLeaveSpace({
      readSpace: reading(makeSpace()),
      leaveSpace,
      queryClient,
    });

    await leaveButton(screen).click();
    await confirmButton(screen).click();

    await expect.element(screen.getByText("Mes espaces")).toBeVisible();
    expect(queryClient.getQueryState(["my-spaces"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["other"])?.isInvalidated).toBe(false);
  });

  it("un départ refusé ne relit pas la liste des espaces", async () => {
    const { leaveSpace } = answeringLeave(err("last_owner"));
    const queryClient = new QueryClient();
    queryClient.setQueryData(["my-spaces"], ok([]));
    const screen = await renderLeaveSpace({
      readSpace: reading(makeSpace()),
      leaveSpace,
      queryClient,
    });

    await leaveButton(screen).click();
    await confirmButton(screen).click();

    await expect.element(screen.getByRole("alert")).toBeVisible();
    expect(queryClient.getQueryState(["my-spaces"])?.isInvalidated).toBe(false);
  });

  it("« Annuler » referme la confirmation, sans partir", async () => {
    const { departures, leaveSpace } = answeringLeave(ok(undefined));
    const screen = await renderLeaveSpace({ readSpace: reading(makeSpace()), leaveSpace });

    await leaveButton(screen).click();
    await screen.getByRole("button", { name: "Annuler" }).click();

    await expect.element(confirmation(screen)).not.toBeInTheDocument();
    expect(departures).toEqual([]);
  });

  it("le payeur d'un abonnement actif est averti que l'abonnement sera résilié en fin de période", async () => {
    const screen = await renderLeaveSpace({
      readSpace: reading(makeSpace({ plan: "team", subscription: makeSubscription(PAID_BY_ME) })),
    });

    await leaveButton(screen).click();

    await expect
      .element(confirmation(screen))
      .toHaveTextContent(
        "Vous payez l'abonnement Team de cet espace : en partant, il sera résilié et prendra fin le 22 décembre 2026. L'espace reste au plan Team jusque-là, puis les autres propriétaires devront souscrire à nouveau.",
      );
  });

  it("le payeur d'un abonnement déjà résilié est averti de la date de fin", async () => {
    const screen = await renderLeaveSpace({
      readSpace: reading(
        makeSpace({
          plan: "team",
          subscription: makeSubscription({ ...PAID_BY_ME, status: "canceling" }),
        }),
      ),
    });

    await leaveButton(screen).click();

    await expect
      .element(confirmation(screen))
      .toHaveTextContent(
        "Vous payez l'abonnement Team de cet espace, déjà résilié : il prend fin le 22 décembre 2026. L'espace reste au plan Team jusque-là, puis les autres propriétaires devront souscrire à nouveau.",
      );
  });

  it("sans date de fin connue, le payeur est averti de la fin de la période payée", async () => {
    const screen = await renderLeaveSpace({
      readSpace: reading(
        makeSpace({
          plan: "team",
          subscription: makeSubscription({ ...PAID_BY_ME, currentPeriodEnd: undefined }),
        }),
      ),
    });

    await leaveButton(screen).click();

    await expect
      .element(confirmation(screen))
      .toHaveTextContent("il sera résilié et prendra fin à la fin de la période payée.");
  });

  it.each([
    ["un propriétaire qui ne paie pas", makeSubscription()],
    ["le payeur d'un abonnement terminé", makeSubscription({ ...PAID_BY_ME, status: "ended" })],
  ])("%s n'est pas averti d'une résiliation", async (_case, subscription) => {
    const screen = await renderLeaveSpace({
      readSpace: reading(makeSpace({ plan: "team", subscription })),
    });

    await leaveButton(screen).click();

    await expect.element(confirmation(screen)).toBeVisible();
    expect(confirmation(screen).getByText("abonnement", { exact: false }).query()).toBeNull();
  });

  it.each([
    [
      "last_owner",
      "Vous êtes le dernier propriétaire de l'espace : nommez un autre propriétaire avant de partir.",
    ],
    ["not_found", "Cet espace est introuvable."],
    ["unavailable", "Le départ est indisponible pour le moment."],
    ["invalid_response", "Le départ est indisponible pour le moment."],
  ] as const)("annonce l'échec %s, sans quitter la page", async (failure, message) => {
    const { leaveSpace } = answeringLeave(err(failure));
    const screen = await renderLeaveSpace({ readSpace: reading(makeSpace()), leaveSpace });

    await leaveButton(screen).click();
    await confirmButton(screen).click();

    await expect.element(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByText("Mes espaces").query()).toBeNull();
  });

  it("renvoie vers la connexion quand le membre n'a plus de session", async () => {
    const { leaveSpace } = answeringLeave(err("unauthenticated"));
    const screen = await renderLeaveSpace({ readSpace: reading(makeSpace()), leaveSpace });

    await leaveButton(screen).click();
    await confirmButton(screen).click();

    await expect.element(screen.getByText("Page de connexion")).toBeVisible();
  });

  it("désactive la confirmation pendant le départ", async () => {
    const screen = await renderLeaveSpace({ readSpace: reading(makeSpace()) });

    await leaveButton(screen).click();
    await confirmButton(screen).click();

    await expect.element(confirmButton(screen)).toBeDisabled();
  });
});
