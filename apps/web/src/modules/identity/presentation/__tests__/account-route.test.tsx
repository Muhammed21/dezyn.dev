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
  AccountDeletion,
  AccountDeletionFailure,
  DeleteAccountFailure,
  PaidSpace,
} from "../../domain/account.ts";
import { accountRoute } from "../account-route.tsx";

type ReadDeletion = () => Promise<Result<AccountDeletion, AccountDeletionFailure>>;
type DeleteAccount = () => Promise<Result<undefined, DeleteAccountFailure>>;

const STUDIO = { id: "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b", name: "Studio Ada" };

const makePaidSpace = (overrides: Partial<PaidSpace> = {}): PaidSpace => ({
  ...STUDIO,
  currentPeriodEnd: new Date("2026-12-22T10:00:00.000Z"),
  ...overrides,
});

const makeDeletion = (overrides: Partial<AccountDeletion> = {}): AccountDeletion => ({
  paidSpaces: [],
  lastOwnerSpaces: [],
  ...overrides,
});

const reading =
  (deletion: AccountDeletion): ReadDeletion =>
  () =>
    Promise.resolve(ok(deletion));

const deleted: DeleteAccount = () => Promise.resolve(ok(undefined));

const renderAccount = ({
  accountDeletion = reading(makeDeletion()),
  deleteAccount = deleted,
  queryClient = new QueryClient(),
}: {
  readonly accountDeletion?: ReadDeletion;
  readonly deleteAccount?: DeleteAccount;
  readonly queryClient?: QueryClient;
} = {}) => {
  const root = createRootRoute();
  const signIn = createRoute({
    getParentRoute: () => root,
    path: "/connexion",
    component: () => <p>Page de connexion</p>,
  });
  const members = createRoute({
    getParentRoute: () => root,
    path: "/espaces/$spaceId",
    component: function SpacePage() {
      return <p>Page de l'espace {members.useParams().spaceId}</p>;
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([
      accountRoute({ parent: root, accountDeletion, deleteAccount }),
      signIn,
      members,
    ]),
    history: createMemoryHistory({ initialEntries: ["/compte"] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};

const confirmButton = (screen: Awaited<ReturnType<typeof renderAccount>>) =>
  screen.getByRole("button", { name: "Supprimer définitivement mon compte" });

describe("suppression du compte depuis l'app (ADR 0015, ADR 0050 §3)", () => {
  it("avertit que l'historique garde les actions du compte sous un membre supprimé", async () => {
    const screen = await renderAccount();

    await expect
      .element(
        screen.getByText(
          "Vos actions restent dans l'historique des projets, sous un membre supprimé, sans votre nom.",
        ),
      )
      .toBeVisible();
  });

  it("nomme chaque espace dont le compte paie l'abonnement, et sa date de fin", async () => {
    const screen = await renderAccount({
      accountDeletion: reading(
        makeDeletion({
          paidSpaces: [
            makePaidSpace(),
            makePaidSpace({
              id: "9b8a7f6e-5d4c-4b3a-8f2e-1d0c9b8a7f6e",
              name: "Studio Grace",
              currentPeriodEnd: undefined,
            }),
          ],
        }),
      ),
    });

    const list = screen.getByRole("list", { name: "Abonnements résiliés" });
    await expect
      .element(list.getByRole("listitem").nth(0))
      .toHaveTextContent(
        "L'abonnement Team de « Studio Ada » sera résilié : il prendra fin le 22 décembre 2026.",
      );
    await expect
      .element(list.getByRole("listitem").nth(1))
      .toHaveTextContent(
        "L'abonnement Team de « Studio Grace » sera résilié : il prendra fin à la fin de la période payée.",
      );
  });

  it("sans espace payé, n'annonce aucune résiliation", async () => {
    const screen = await renderAccount();

    await expect.element(confirmButton(screen)).toBeVisible();
    expect(screen.getByRole("list", { name: "Abonnements résiliés" }).query()).toBeNull();
  });

  it("supprime le compte à la confirmation, puis renvoie vers la connexion", async () => {
    const asked: string[] = [];
    const screen = await renderAccount({
      deleteAccount: () => {
        asked.push("suppression");
        return Promise.resolve(ok(undefined));
      },
    });

    await confirmButton(screen).click();

    await expect.element(screen.getByText("Page de connexion")).toBeVisible();
    expect(asked).toEqual(["suppression"]);
  });

  it("oublie les données du compte supprimé", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["my-spaces"], [STUDIO]);
    const screen = await renderAccount({ queryClient });

    await confirmButton(screen).click();

    await expect.element(screen.getByText("Page de connexion")).toBeVisible();
    expect(queryClient.getQueryData(["my-spaces"])).toBeUndefined();
  });

  it("garde les données du compte quand la suppression est refusée", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["my-spaces"], [STUDIO]);
    const screen = await renderAccount({
      queryClient,
      deleteAccount: () => Promise.resolve(err({ kind: "last_owner", spaces: [STUDIO] })),
    });

    await confirmButton(screen).click();

    await expect.element(screen.getByRole("alert")).toBeVisible();
    expect(queryClient.getQueryData(["my-spaces"])).toEqual([STUDIO]);
  });

  it("désactive la confirmation pendant la suppression", async () => {
    const screen = await renderAccount({ deleteAccount: () => new Promise(() => {}) });

    await confirmButton(screen).click();

    await expect.element(confirmButton(screen)).toBeDisabled();
  });

  it("le dernier propriétaire d'un espace nomme d'abord un successeur, sans pouvoir confirmer", async () => {
    const screen = await renderAccount({
      accountDeletion: reading(makeDeletion({ lastOwnerSpaces: [STUDIO] })),
    });

    await expect
      .element(
        screen.getByText(
          "Vous êtes le dernier propriétaire de ces espaces : nommez un autre propriétaire avant de supprimer votre compte.",
        ),
      )
      .toBeVisible();
    await screen.getByRole("link", { name: "Studio Ada" }).click();
    await expect.element(screen.getByText(`Page de l'espace ${STUDIO.id}`)).toBeVisible();
  });

  it("ne propose pas la confirmation au dernier propriétaire d'un espace", async () => {
    const screen = await renderAccount({
      accountDeletion: reading(makeDeletion({ lastOwnerSpaces: [STUDIO] })),
    });

    await expect.element(screen.getByRole("link", { name: "Studio Ada" })).toBeVisible();
    expect(confirmButton(screen).query()).toBeNull();
  });

  it("un refus du dernier propriétaire à la confirmation nomme les espaces à transmettre", async () => {
    const screen = await renderAccount({
      deleteAccount: () => Promise.resolve(err({ kind: "last_owner", spaces: [STUDIO] })),
    });

    await confirmButton(screen).click();

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent(
        "Vous êtes le dernier propriétaire de ces espaces : nommez un autre propriétaire avant de supprimer votre compte.",
      );
    await expect.element(screen.getByRole("link", { name: "Studio Ada" })).toBeVisible();
  });

  it.each(["unavailable", "invalid_response"] as const)(
    "annonce que la suppression est indisponible sur %s",
    async (kind) => {
      const screen = await renderAccount({ deleteAccount: () => Promise.resolve(err({ kind })) });

      await confirmButton(screen).click();

      await expect
        .element(screen.getByRole("alert"))
        .toHaveTextContent("La suppression du compte est indisponible pour le moment.");
    },
  );

  it("renvoie vers la connexion quand la suppression trouve la session expirée", async () => {
    const screen = await renderAccount({
      deleteAccount: () => Promise.resolve(err({ kind: "unauthenticated" })),
    });

    await confirmButton(screen).click();

    await expect.element(screen.getByText("Page de connexion")).toBeVisible();
  });

  it("renvoie vers la connexion quand le membre n'a pas de session", async () => {
    const screen = await renderAccount({
      accountDeletion: () => Promise.resolve(err("unauthenticated")),
    });

    await expect.element(screen.getByText("Page de connexion")).toBeVisible();
  });

  it.each(["unavailable", "invalid_response"] as const)(
    "annonce que la page est indisponible sur %s",
    async (failure) => {
      const screen = await renderAccount({
        accountDeletion: () => Promise.resolve(err(failure)),
      });

      await expect
        .element(screen.getByRole("alert"))
        .toHaveTextContent("La suppression du compte est indisponible pour le moment.");
      expect(confirmButton(screen).query()).toBeNull();
    },
  );
});
