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
  Checkout,
  CheckoutFailure,
  Portal,
  PortalFailure,
  SpaceFailure,
  SpaceSubscription,
  SpaceWithStorage,
} from "../../domain/space.ts";
import { spacePlanRoute } from "../space-plan-route.tsx";

const SPACE_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";
const CHECKOUT_URL = "https://sandbox.polar.sh/checkout/polar_c_1";
const PORTAL_URL = "https://sandbox.polar.sh/dezyn/portal?customer_session_token=polar_cst_1";

type ReadSpace = (space: {
  readonly spaceId: string;
}) => Promise<Result<SpaceWithStorage, SpaceFailure>>;
type StartCheckout = (space: {
  readonly spaceId: string;
}) => Promise<Result<Checkout, CheckoutFailure>>;
type OpenPortal = (space: { readonly spaceId: string }) => Promise<Result<Portal, PortalFailure>>;

const OWNER_RIGHTS = {
  role: "owner",
  allowedActions: ["space.read", "project.create", "member.invite", "subscription.checkout"],
} as const;

const EDITOR_RIGHTS = { role: "editor", allowedActions: ["space.read", "token.create"] } as const;

const makeSpace = (overrides: Partial<SpaceWithStorage> = {}): SpaceWithStorage => ({
  id: SPACE_ID,
  name: "Studio Ada",
  plan: "free",
  ...OWNER_RIGHTS,
  storage: { usedBytes: 0, limitBytes: 500_000_000, alertReached: false },
  ...overrides,
});

const makeSubscription = (overrides: Partial<SpaceSubscription> = {}): SpaceSubscription => ({
  status: "active",
  currentPeriodEnd: new Date("2026-12-22T10:00:00.000Z"),
  payer: { name: "Ada Lovelace", email: "ada@dezyn.test", you: true },
  ...overrides,
});

const PAID_BY_SOMEONE_ELSE = {
  payer: { name: "Ada Lovelace", email: "ada@dezyn.test", you: false },
} as const;

const makeTeamSpace = (subscription: Partial<SpaceSubscription> = {}) =>
  makeSpace({ plan: "team", subscription: makeSubscription(subscription) });

const reading =
  (space: SpaceWithStorage): ReadSpace =>
  () =>
    Promise.resolve(ok(space));

const readingInTurn = (spaces: readonly SpaceWithStorage[]) => {
  const reads = { count: 0 };
  const readSpace: ReadSpace = () => {
    const space = spaces[Math.min(reads.count, spaces.length - 1)] ?? makeSpace();
    reads.count += 1;
    return Promise.resolve(ok(space));
  };
  return { reads, readSpace };
};

const checkingOut =
  (url = CHECKOUT_URL): StartCheckout =>
  () =>
    Promise.resolve(ok({ url }));

const openingPortal =
  (url = PORTAL_URL): OpenPortal =>
  () =>
    Promise.resolve(ok({ url }));

const QUICK_POLLING = { intervalMs: 20, timeoutMs: 200 };

const OWNER_ONLY = "Seul un propriétaire de l'espace peut passer au plan Team.";

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const renderPlan = ({
  readSpace = reading(makeSpace()),
  startCheckout = checkingOut(),
  openPortal = openingPortal(),
  goTo = () => undefined,
  path = `/espaces/${SPACE_ID}/plan`,
  polling = QUICK_POLLING,
}: {
  readonly readSpace?: ReadSpace;
  readonly startCheckout?: StartCheckout;
  readonly openPortal?: OpenPortal;
  readonly goTo?: (url: string) => void;
  readonly path?: string;
  readonly polling?: { readonly intervalMs: number; readonly timeoutMs: number };
} = {}) => {
  const root = createRootRoute();
  const signIn = createRoute({
    getParentRoute: () => root,
    path: "/connexion",
    component: () => <p>Page de connexion</p>,
  });
  const spacePage = createRoute({
    getParentRoute: () => root,
    path: "/espaces/$spaceId",
    component: function SpacePage() {
      return <p>Projets de l'espace {spacePage.useParams().spaceId}</p>;
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([
      spacePlanRoute({ parent: root, readSpace, startCheckout, openPortal, goTo, polling }),
      spacePage,
      signIn,
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};

type Screen = Awaited<ReturnType<typeof renderPlan>>;

const upgradeButton = (screen: Screen) =>
  screen.getByRole("button", { name: "Passer au plan Team" });

const RETURN_PATH = `/espaces/${SPACE_ID}/plan?checkout=polar_c_1`;

describe("page « Plan » d'un espace (ADR 0050 §2, spec #343)", () => {
  it("montre le plan de l'espace, le prix HT du plan Team et ce qu'il apporte", async () => {
    const screen = await renderPlan();

    await expect.element(screen.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible();
    await expect.element(screen.getByText("Plan actuel : Free")).toBeVisible();
    await expect
      .element(screen.getByText("34,99 € HT par mois et par espace, sans engagement."))
      .toBeVisible();
    const benefits = screen.getByRole("list", { name: "Ce qu'apporte le plan Team" });
    await expect
      .element(benefits.getByRole("listitem").nth(0))
      .toHaveTextContent("Projets illimités, au lieu de 3");
    await expect
      .element(benefits.getByRole("listitem").nth(1))
      .toHaveTextContent("20 Go de stockage, au lieu de 500 Mo");
    await expect
      .element(benefits.getByRole("listitem").nth(2))
      .toHaveTextContent("Des éditeurs invités dans l'espace, au lieu d'un seul membre");
  });

  it("lit l'espace de l'adresse", async () => {
    const asked: string[] = [];
    const screen = await renderPlan({
      readSpace: ({ spaceId }) => {
        asked.push(spaceId);
        return Promise.resolve(ok(makeSpace()));
      },
    });

    await expect.element(upgradeButton(screen)).toBeVisible();
    expect(asked).toContain(SPACE_ID);
  });

  it("ramène aux projets de l'espace", async () => {
    const screen = await renderPlan();

    await screen.getByRole("link", { name: "Retour aux projets" }).click();

    await expect.element(screen.getByText(`Projets de l'espace ${SPACE_ID}`)).toBeVisible();
  });

  it("propose à un propriétaire d'un espace Free de passer au plan Team, et l'envoie au checkout", async () => {
    const asked: string[] = [];
    const visited: string[] = [];
    const screen = await renderPlan({
      startCheckout: ({ spaceId }) => {
        asked.push(spaceId);
        return checkingOut()({ spaceId });
      },
      goTo: (url) => visited.push(url),
    });

    await expect.element(upgradeButton(screen)).toBeVisible();
    expect(screen.getByRole("alert").query()).toBeNull();
    expect(screen.getByText(OWNER_ONLY).query()).toBeNull();
    await upgradeButton(screen).click();

    await expect.poll(() => visited).toEqual([CHECKOUT_URL]);
    expect(asked).toEqual([SPACE_ID]);
  });

  it("désactive le bouton pendant la création du checkout", async () => {
    const screen = await renderPlan({ startCheckout: () => new Promise(() => {}) });

    await upgradeButton(screen).click();

    await expect.element(upgradeButton(screen)).toBeDisabled();
  });

  it.each([
    ["already_team", "Cet espace est déjà au plan Team."],
    ["forbidden", "Seul un propriétaire de l'espace peut passer au plan Team."],
    ["not_found", "Cet espace est introuvable."],
    ["unavailable", "Le paiement est indisponible pour le moment."],
    ["invalid_response", "Le paiement est indisponible pour le moment."],
  ] as const)("annonce l'échec %s du checkout, sans quitter la page", async (failure, message) => {
    const visited: string[] = [];
    const screen = await renderPlan({
      startCheckout: () => Promise.resolve(err(failure)),
      goTo: (url) => visited.push(url),
    });

    await upgradeButton(screen).click();

    await expect.element(screen.getByRole("alert")).toHaveTextContent(message);
    await expect.element(upgradeButton(screen)).toBeEnabled();
    expect(visited).toEqual([]);
  });

  it("renvoie vers la connexion quand le checkout trouve la session expirée", async () => {
    const screen = await renderPlan({
      startCheckout: () => Promise.resolve(err("unauthenticated")),
    });

    await upgradeButton(screen).click();

    await expect.element(screen.getByText("Page de connexion")).toBeVisible();
  });

  it("montre le plan à un éditeur, sans lui proposer de souscrire", async () => {
    const screen = await renderPlan({ readSpace: reading(makeSpace({ ...EDITOR_RIGHTS })) });

    await expect.element(screen.getByText("Plan actuel : Free")).toBeVisible();
    await expect
      .element(screen.getByText("Seul un propriétaire de l'espace peut passer au plan Team."))
      .toBeVisible();
    await expect.element(upgradeButton(screen)).not.toBeInTheDocument();
  });

  it("ne propose pas le plan Team à un espace qui l'a déjà", async () => {
    const screen = await renderPlan({ readSpace: reading(makeSpace({ plan: "team" })) });

    await expect.element(screen.getByText("Plan actuel : Team")).toBeVisible();
    await expect.element(upgradeButton(screen)).not.toBeInTheDocument();
  });

  it("montre un plan inconnu de l'app sans proposer de souscrire", async () => {
    const screen = await renderPlan({ readSpace: reading(makeSpace({ plan: "unknown" })) });

    await expect.element(screen.getByText("Plan actuel : inconnu")).toBeVisible();
    await expect.element(upgradeButton(screen)).not.toBeInTheDocument();
  });

  it("renvoie vers la connexion quand le membre n'a pas de session", async () => {
    const screen = await renderPlan({ readSpace: () => Promise.resolve(err("unauthenticated")) });

    await expect.element(screen.getByText("Page de connexion")).toBeVisible();
  });

  it.each([
    ["not_found", "Cet espace est introuvable."],
    ["unavailable", "Le plan de l'espace est indisponible pour le moment."],
    ["invalid_response", "Le plan de l'espace est indisponible pour le moment."],
  ] as const)("annonce l'échec %s de la lecture de l'espace", async (failure, message) => {
    const screen = await renderPlan({ readSpace: () => Promise.resolve(err(failure)) });

    await expect.element(screen.getByRole("alert")).toHaveTextContent(message);
    await expect.element(upgradeButton(screen)).not.toBeInTheDocument();
  });
});

describe("retour du checkout sur la page « Plan » (spec #343, stories 5 et 6)", () => {
  it("relit l'espace jusqu'au plan Team, puis annonce l'activation", async () => {
    const { reads, readSpace } = readingInTurn([
      makeSpace(),
      makeSpace(),
      makeSpace({ plan: "team" }),
    ]);
    const screen = await renderPlan({ readSpace, path: RETURN_PATH });

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Votre espace est passé au plan Team.");
    await expect.element(screen.getByText("Plan actuel : Team")).toBeVisible();
    const readsAtTeam = reads.count;
    await pause(QUICK_POLLING.intervalMs * 5);
    expect(reads.count).toBe(readsAtTeam);
    expect(readsAtTeam).toBeGreaterThanOrEqual(3);
  });

  it("attend la confirmation sans proposer de payer une seconde fois", async () => {
    const screen = await renderPlan({
      readSpace: reading(makeSpace()),
      path: RETURN_PATH,
      polling: { intervalMs: 20, timeoutMs: 60_000 },
    });

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Paiement reçu, confirmation de l'activation…");
    await expect.element(upgradeButton(screen)).not.toBeInTheDocument();
  });

  it("annonce « activation en cours » quand le délai est dépassé, et cesse de relire l'espace", async () => {
    const { reads, readSpace } = readingInTurn([makeSpace()]);
    const screen = await renderPlan({ readSpace, path: RETURN_PATH });

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent(
        "Paiement reçu, activation en cours. L'espace passera au plan Team dans quelques minutes.",
      );
    const readsAtTimeout = reads.count;
    await pause(QUICK_POLLING.intervalMs * 5);
    expect(reads.count).toBe(readsAtTimeout);
    await expect.element(upgradeButton(screen)).not.toBeInTheDocument();
  });

  it("reconnaît le retour d'un checkout dont l'identifiant se lit comme un nombre", async () => {
    const screen = await renderPlan({
      path: `/espaces/${SPACE_ID}/plan?checkout=42`,
      polling: { intervalMs: 20, timeoutMs: 60_000 },
    });

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Paiement reçu, confirmation de l'activation…");
  });

  it("sans retour du checkout, ne relit pas l'espace en boucle", async () => {
    const { reads, readSpace } = readingInTurn([makeSpace()]);
    const screen = await renderPlan({ readSpace });

    await expect.element(upgradeButton(screen)).toBeVisible();
    await pause(QUICK_POLLING.intervalMs * 5);
    expect(reads.count).toBe(1);
    expect(screen.getByRole("status").query()).toBeNull();
  });
});

const manageButton = (screen: Screen) => screen.getByRole("button", { name: "Gérer l'abonnement" });

describe("abonnement d'un espace Team sur la page « Plan » (ADR 0050 §3, spec #343)", () => {
  it("montre au payeur la date du prochain renouvellement, et qu'il paie", async () => {
    const screen = await renderPlan({ readSpace: reading(makeTeamSpace()) });

    await expect
      .element(screen.getByText("Prochain renouvellement le 22 décembre 2026."))
      .toBeVisible();
    await expect.element(screen.getByText("Vous payez cet abonnement.")).toBeVisible();
    expect(screen.getByText(/prend fin/).query()).toBeNull();
    expect(screen.getByRole("alert").query()).toBeNull();
  });

  it("ne montre pas de date pour un statut d'abonnement inconnu de l'app", async () => {
    const screen = await renderPlan({ readSpace: reading(makeTeamSpace({ status: "unknown" })) });

    await expect.element(screen.getByText("Vous payez cet abonnement.")).toBeVisible();
    expect(screen.getByText(/Prochain renouvellement/).query()).toBeNull();
    expect(screen.getByText(/prend fin/).query()).toBeNull();
  });

  it("envoie le payeur vers le portail client de Polar", async () => {
    const asked: string[] = [];
    const visited: string[] = [];
    const screen = await renderPlan({
      readSpace: reading(makeTeamSpace()),
      openPortal: ({ spaceId }) => {
        asked.push(spaceId);
        return openingPortal()({ spaceId });
      },
      goTo: (url) => visited.push(url),
    });

    await manageButton(screen).click();

    await expect.poll(() => visited).toEqual([PORTAL_URL]);
    expect(asked).toEqual([SPACE_ID]);
  });

  it("désactive le bouton pendant l'ouverture du portail", async () => {
    const screen = await renderPlan({
      readSpace: reading(makeTeamSpace()),
      openPortal: () => new Promise(() => {}),
    });

    await manageButton(screen).click();

    await expect.element(manageButton(screen)).toBeDisabled();
  });

  it("montre à un autre propriétaire qui paie, sans lui ouvrir le portail", async () => {
    const screen = await renderPlan({ readSpace: reading(makeTeamSpace(PAID_BY_SOMEONE_ELSE)) });

    await expect.element(screen.getByText("Payé par Ada Lovelace (ada@dezyn.test).")).toBeVisible();
    await expect
      .element(screen.getByText("Prochain renouvellement le 22 décembre 2026."))
      .toBeVisible();
    await expect.element(manageButton(screen)).not.toBeInTheDocument();
  });

  it("montre la date de fin d'un abonnement résilié, sans date de renouvellement", async () => {
    const screen = await renderPlan({ readSpace: reading(makeTeamSpace({ status: "canceling" })) });

    await expect
      .element(screen.getByText("Abonnement résilié : le plan Team prend fin le 22 décembre 2026."))
      .toBeVisible();
    expect(screen.getByText(/Prochain renouvellement/).query()).toBeNull();
    await expect.element(manageButton(screen)).toBeVisible();
  });

  it("ne montre aucune date pour un abonnement sans fin de période", async () => {
    const screen = await renderPlan({
      readSpace: reading(makeTeamSpace({ currentPeriodEnd: undefined })),
    });

    await expect.element(screen.getByText("Vous payez cet abonnement.")).toBeVisible();
    expect(screen.getByText(/Prochain renouvellement/).query()).toBeNull();
    expect(screen.getByText(/prend fin/).query()).toBeNull();
  });

  it("ne montre ni payeur ni portail pour un abonnement terminé, et propose de repasser Team", async () => {
    const screen = await renderPlan({
      readSpace: reading(
        makeSpace({ plan: "free", subscription: makeSubscription({ status: "ended" }) }),
      ),
    });

    await expect.element(upgradeButton(screen)).toBeVisible();
    expect(screen.getByText("Vous payez cet abonnement.").query()).toBeNull();
    expect(screen.getByText(/Prochain renouvellement/).query()).toBeNull();
    await expect.element(manageButton(screen)).not.toBeInTheDocument();
  });

  it.each([
    ["forbidden", "Seul le payeur de l'abonnement peut le gérer."],
    ["not_found", "Cet espace est introuvable."],
    ["unavailable", "Le portail de paiement est indisponible pour le moment."],
    ["invalid_response", "Le portail de paiement est indisponible pour le moment."],
  ] as const)("annonce l'échec %s du portail, sans quitter la page", async (failure, message) => {
    const visited: string[] = [];
    const screen = await renderPlan({
      readSpace: reading(makeTeamSpace()),
      openPortal: () => Promise.resolve(err(failure)),
      goTo: (url) => visited.push(url),
    });

    await manageButton(screen).click();

    await expect.element(screen.getByRole("alert")).toHaveTextContent(message);
    await expect.element(manageButton(screen)).toBeEnabled();
    expect(visited).toEqual([]);
  });

  it("renvoie vers la connexion quand le portail trouve la session expirée", async () => {
    const screen = await renderPlan({
      readSpace: reading(makeTeamSpace()),
      openPortal: () => Promise.resolve(err("unauthenticated")),
    });

    await manageButton(screen).click();

    await expect.element(screen.getByText("Page de connexion")).toBeVisible();
  });
});
