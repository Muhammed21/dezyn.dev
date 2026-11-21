import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { err, ok, type Result } from "@repo/result";

import type { SpaceFailure, SpaceStorage, SpaceWithStorage } from "../../domain/space.ts";
import { spaceStorageAlert } from "../space-storage-alert.tsx";

const SPACE_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";

type ReadSpace = (space: {
  readonly spaceId: string;
}) => Promise<Result<SpaceWithStorage, SpaceFailure>>;

const OWNER_RIGHTS = { role: "owner", allowedActions: ["space.read", "member.manage"] } as const;

const EDITOR_RIGHTS = { role: "editor", allowedActions: ["space.read"] } as const;

const FREE_AT_ALERT: SpaceStorage = {
  usedBytes: 400_000_000,
  limitBytes: 500_000_000,
  alertReached: true,
};

const FREE_JUST_UNDER_ALERT: SpaceStorage = {
  usedBytes: 399_999_999,
  limitBytes: 500_000_000,
  alertReached: false,
};

const makeSpace = (overrides: Partial<SpaceWithStorage> = {}): SpaceWithStorage => ({
  id: SPACE_ID,
  name: "Studio Ada",
  plan: "free",
  ...EDITOR_RIGHTS,
  storage: FREE_JUST_UNDER_ALERT,
  ...overrides,
});

const reading =
  (space: SpaceWithStorage): ReadSpace =>
  () =>
    Promise.resolve(ok(space));

const renderStorageAlert = (readSpace: ReadSpace, queryClient = new QueryClient()) => {
  const SpaceStorageAlert = spaceStorageAlert({ readSpace });
  return render(
    <QueryClientProvider client={queryClient}>
      <SpaceStorageAlert spaceId={SPACE_ID} />
      <p>Page de l'espace</p>
    </QueryClientProvider>,
  );
};

type Screen = Awaited<ReturnType<typeof renderStorageAlert>>;

const alertOf = (screen: Screen) => screen.getByRole("region", { name: "Stockage bientôt plein" });

const pageLoaded = async (screen: Screen) => {
  await expect.element(screen.getByText("Page de l'espace")).toBeVisible();
};

describe("bandeau du stockage de l'espace à 80 % (ADR 0032, #32)", () => {
  it.each([
    ["au propriétaire", OWNER_RIGHTS],
    ["à l'éditeur", EDITOR_RIGHTS],
  ] as const)("s'affiche %s quand l'espace atteint 80 % de sa limite", async (_case, rights) => {
    const screen = await renderStorageAlert(
      reading(makeSpace({ ...rights, storage: FREE_AT_ALERT })),
    );

    await expect.element(alertOf(screen)).toBeVisible();
    await expect
      .element(alertOf(screen))
      .toHaveTextContent(/Cet espace utilise 80 % de son stockage : 400\sMo sur 500\sMo\./);
  });

  it.each([
    ["au propriétaire", OWNER_RIGHTS],
    ["à l'éditeur", EDITOR_RIGHTS],
  ] as const)("ne s'affiche pas %s à un octet sous 80 %", async (_case, rights) => {
    const screen = await renderStorageAlert(
      reading(makeSpace({ ...rights, storage: FREE_JUST_UNDER_ALERT })),
    );

    await pageLoaded(screen);
    await expect.element(alertOf(screen)).not.toBeInTheDocument();
  });

  it("suit l'alerte décidée par l'API, pas un calcul de l'app", async () => {
    const screen = await renderStorageAlert(
      reading(makeSpace({ storage: { ...FREE_AT_ALERT, alertReached: false } })),
    );

    await pageLoaded(screen);
    await expect.element(alertOf(screen)).not.toBeInTheDocument();
  });

  it("dit ce qui se passe à 100 %, sans bloquer le MCP", async () => {
    const screen = await renderStorageAlert(reading(makeSpace({ storage: FREE_AT_ALERT })));

    await expect
      .element(alertOf(screen))
      .toHaveTextContent(
        "À 100 %, dezyn purge les plus anciennes images de snapshots puis l'historique, en commençant par le projet qui consomme le plus. Le MCP reste disponible.",
      );
  });

  it("donne en Go le stockage d'un espace Team, arrondi vers le bas", async () => {
    const screen = await renderStorageAlert(
      reading(
        makeSpace({
          plan: "team",
          storage: { usedBytes: 17_999_999_999, limitBytes: 20_000_000_000, alertReached: true },
        }),
      ),
    );

    await expect
      .element(alertOf(screen))
      .toHaveTextContent(/Cet espace utilise 89 % de son stockage : 17,9\sGo sur 20\sGo\./);
  });

  it("demande l'espace de la page", async () => {
    const asked: string[] = [];
    const screen = await renderStorageAlert(({ spaceId }) => {
      asked.push(spaceId);
      return Promise.resolve(ok(makeSpace({ storage: FREE_AT_ALERT })));
    });

    await expect.element(alertOf(screen)).toBeVisible();
    expect(asked).toEqual([SPACE_ID]);
  });

  it("donne en Go un stockage d'exactement 1 Go", async () => {
    const screen = await renderStorageAlert(
      reading(
        makeSpace({
          storage: { usedBytes: 1_000_000_000, limitBytes: 500_000_000, alertReached: true },
        }),
      ),
    );

    await expect
      .element(alertOf(screen))
      .toHaveTextContent(/Cet espace utilise 200 % de son stockage : 1\sGo sur 500\sMo\./);
  });

  it("reprend l'espace déjà lu par la page, sans le relire", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["space", SPACE_ID], ok(makeSpace({ storage: FREE_AT_ALERT })));

    const screen = await renderStorageAlert(() => new Promise<never>(() => {}), queryClient);

    await expect.element(alertOf(screen)).toBeVisible();
  });

  it("ne s'affiche pas quand la lecture de l'espace échoue", async () => {
    const screen = await renderStorageAlert(() => Promise.resolve(err("unavailable")));

    await pageLoaded(screen);
    await expect.element(alertOf(screen)).not.toBeInTheDocument();
  });
});
