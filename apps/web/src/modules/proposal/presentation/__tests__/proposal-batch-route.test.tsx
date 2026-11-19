import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { err, ok, type Result } from "@repo/result";

import { makeProjectEvents } from "../../../../testing/project-events.ts";
import type {
  Batch,
  BatchSummary,
  BatchValidationFailure,
  Decision,
  Proposal,
  ProposalFailure,
  ReviewedProposal,
  ReviewFailure,
  ValidatedBatch,
} from "../../domain/proposal.ts";
import { projectProposals } from "../project-proposals.tsx";
import { proposalBatchRoute } from "../proposal-batch-route.tsx";

const BATCH_ID = "0b8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";
const OTHER_BATCH_ID = "1c8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";
const PROJECT_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";
const PRIMARY_BLUE = { colorSpace: "srgb", components: [0.1, 0.4, 0.9] };
const NIGHT_BLUE = { colorSpace: "srgb", components: [0.1, 0.2, 0.4] };

type ReadBatch = (batch: { readonly batchId: string }) => Promise<Result<Batch, ProposalFailure>>;

type ReviewProposal = (review: {
  readonly proposalId: string;
  readonly decision: Decision;
}) => Promise<Result<ReviewedProposal, ReviewFailure>>;

type ListBatches = (project: {
  readonly projectId: string;
}) => Promise<Result<readonly BatchSummary[], ProposalFailure>>;

type ValidateBatch = (validation: {
  readonly batchId: string;
  readonly rejected: readonly string[];
}) => Promise<Result<ValidatedBatch, BatchValidationFailure>>;

type Review = {
  readonly reviewProposal?: ReviewProposal;
  readonly validateBatch?: ValidateBatch;
  readonly onReviewed?: (project: { readonly projectId: string }) => Promise<unknown>;
  readonly listBatches?: ListBatches;
  readonly events?: ReturnType<typeof makeProjectEvents>;
};

const makeProposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  id: "2d8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
  name: "couleur.fond.primaire",
  kind: "create",
  status: "proposed",
  validated: undefined,
  proposed: { $type: "color", $value: PRIMARY_BLUE },
  duplicates: [],
  ...overrides,
});

const makeBatch = (overrides: Partial<Batch> = {}): Batch => ({
  id: BATCH_ID,
  projectId: PROJECT_ID,
  intent: "Palette de la marque",
  state: "closed",
  proposals: [makeProposal()],
  ...overrides,
});

const reading =
  (batch: Batch): ReadBatch =>
  () =>
    Promise.resolve(ok(batch));

const renderBatch = async (
  readBatch: ReadBatch,
  {
    reviewProposal = () => new Promise(() => {}),
    validateBatch = () => new Promise(() => {}),
    onReviewed = () => Promise.resolve(),
    listBatches,
    events = makeProjectEvents(),
  }: Review = {},
) => {
  const ProjectProposals =
    listBatches === undefined
      ? undefined
      : projectProposals({ listBatches, subscribe: events.subscribe });
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        {ProjectProposals === undefined ? null : <ProjectProposals projectId={PROJECT_ID} />}
      </>
    ),
  });
  const signIn = createRoute({
    getParentRoute: () => root,
    path: "/connexion",
    component: () => <p>Page de connexion</p>,
  });
  const history = createMemoryHistory({ initialEntries: [`/lots/${BATCH_ID}`] });
  const router = createRouter({
    routeTree: root.addChildren([
      proposalBatchRoute({
        parent: root,
        readBatch,
        reviewProposal,
        validateBatch,
        onReviewed,
        subscribe: events.subscribe,
      }),
      signIn,
    ]),
    history,
  });
  return {
    history,
    screen: await render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
};

type Screen = Awaited<ReturnType<typeof renderBatch>>["screen"];

const proposalList = (screen: Screen) => screen.getByRole("list", { name: "Propositions du lot" });

const proposalItems = (screen: Screen) => proposalList(screen).getByRole("listitem");

describe("page d'un lot de propositions (ADR 0012 §1, ADR 0044 §6)", () => {
  it("montre l'intention et l'état du lot, et mène aux tokens de son projet", async () => {
    const asked: string[] = [];
    const { screen } = await renderBatch(({ batchId }) => {
      asked.push(batchId);
      return reading(makeBatch())({ batchId });
    });

    await expect
      .element(screen.getByRole("heading", { name: "Palette de la marque" }))
      .toBeVisible();
    await expect.element(screen.getByText("Fermé", { exact: true })).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Tokens du projet" }))
      .toHaveAttribute("href", `/projets/${PROJECT_ID}`);
    expect(asked).toEqual([BATCH_ID]);
  });

  it.each([
    ["Sans intention", { intent: undefined }],
    ["Ouvert", { state: "open" }],
    ["état inconnu", { state: "unknown" }],
  ] as const)("nomme %s", async (text, overrides) => {
    const { screen } = await renderBatch(reading(makeBatch(overrides)));

    await expect.element(screen.getByText(text, { exact: true })).toBeVisible();
  });

  it("signale les tokens qui portent déjà la valeur d'une proposition", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [makeProposal({ duplicates: ["couleur.bleu.nuit", "couleur.bord"] })],
        }),
      ),
    );

    await expect
      .element(proposalItems(screen).getByText("Même valeur que couleur.bleu.nuit, couleur.bord"))
      .toBeVisible();
  });

  it("ne signale rien pour une proposition sans doublon", async () => {
    const { screen } = await renderBatch(reading(makeBatch()));

    await expect.element(proposalItems(screen)).toBeVisible();
    expect(
      proposalItems(screen)
        .getByText(/Même valeur que/)
        .elements(),
    ).toHaveLength(0);
  });

  it("liste les propositions dans l'ordre de l'API, avec leur nom, leur nature et leur statut", async () => {
    const update = makeProposal({
      id: "3e8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
      name: "couleur.bleu.500",
      kind: "update",
      status: "validated",
      validated: { $type: "color", $value: PRIMARY_BLUE },
      proposed: { $type: "color", $value: NIGHT_BLUE },
    });
    const { screen } = await renderBatch(
      reading(makeBatch({ proposals: [makeProposal(), update] })),
    );

    const creation = proposalItems(screen).nth(0);
    await expect.element(creation).toHaveTextContent("couleur.fond.primaire");
    await expect.element(creation.getByText("Création", { exact: true })).toBeVisible();
    await expect.element(creation.getByText("Proposée", { exact: true })).toBeVisible();
    const modification = proposalItems(screen).nth(1);
    await expect.element(modification).toHaveTextContent("couleur.bleu.500");
    await expect.element(modification.getByText("Modification", { exact: true })).toBeVisible();
    await expect.element(modification.getByText("Validée", { exact: true })).toBeVisible();
    expect(proposalItems(screen).elements()).toHaveLength(2);
  });

  it.each([
    ["Rejetée", { status: "rejected" }],
    ["Remplacée", { status: "replaced" }],
    ["statut inconnu", { status: "unknown" }],
    ["nature inconnue", { kind: "unknown" }],
  ] as const)("nomme %s", async (text, overrides) => {
    const { screen } = await renderBatch(
      reading(makeBatch({ proposals: [makeProposal(overrides)] })),
    );

    await expect
      .element(proposalItems(screen).nth(0).getByText(text, { exact: true }))
      .toBeVisible();
  });

  it("relit chaque lot : d'un lot à l'autre, les propositions changent", async () => {
    const { screen, history } = await renderBatch(({ batchId }) =>
      reading(makeBatch({ proposals: [makeProposal({ name: `token.du.lot.${batchId}` })] }))({
        batchId,
      }),
    );
    await expect
      .element(proposalItems(screen).nth(0))
      .toHaveTextContent(`token.du.lot.${BATCH_ID}`);

    history.push(`/lots/${OTHER_BATCH_ID}`);

    await expect
      .element(proposalItems(screen).nth(0))
      .toHaveTextContent(`token.du.lot.${OTHER_BATCH_ID}`);
  });

  it("annonce le chargement du lot", async () => {
    const { screen } = await renderBatch(() => new Promise(() => {}));

    await expect.element(screen.getByText("Chargement du lot…")).toBeVisible();
  });

  it("renvoie vers la connexion quand le membre n'a pas de session", async () => {
    const { screen } = await renderBatch(() => Promise.resolve(err("unauthenticated")));

    await expect.element(screen.getByText("Page de connexion")).toBeVisible();
  });

  it.each([
    ["not_found", "Ce lot est introuvable."],
    ["unavailable", "Ce lot est indisponible pour le moment."],
    ["invalid_response", "Ce lot est indisponible pour le moment."],
  ] as const)("annonce l'échec %s de la lecture", async (failure, message) => {
    const { screen } = await renderBatch(() => Promise.resolve(err(failure)));

    await expect.element(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("list").elements()).toHaveLength(0);
  });
});

const reviewedAs =
  (status: ReviewedProposal["status"]): ReviewProposal =>
  ({ proposalId }) =>
    Promise.resolve(ok({ id: proposalId, name: "couleur.fond.primaire", kind: "create", status }));

const readingInTurn = (...batches: readonly Batch[]) => {
  const reads = { count: 0 };
  const readBatch: ReadBatch = () => {
    const batch = batches[Math.min(reads.count, batches.length - 1)] ?? makeBatch();
    reads.count += 1;
    return Promise.resolve(ok(batch));
  };
  return { readBatch, reads };
};

const preview = (screen: Screen, name: string) =>
  proposalItems(screen).nth(0).getByRole("figure", { name });

type DrawnProperty =
  | "backgroundColor"
  | "backgroundImage"
  | "boxShadow"
  | "fontFamily"
  | "fontWeight"
  | "fontSize";

type Figure = ReturnType<typeof preview>;

const drawn = (screen: Screen, name: string, property: DrawnProperty) =>
  drawnIn(preview(screen, name), property);

const drawnIn = (figure: Figure, property: DrawnProperty) => {
  const drawing = figure.element().querySelector('[aria-hidden="true"]');
  return drawing === null
    ? ""
    : [drawing, ...drawing.querySelectorAll("*")]
        .map((element) => getComputedStyle(element)[property])
        .join(" | ");
};

const makeUpdate = (overrides: Partial<Proposal> = {}) =>
  makeProposal({
    kind: "update",
    validated: { $type: "color", $value: PRIMARY_BLUE },
    proposed: { $type: "color", $value: NIGHT_BLUE },
    ...overrides,
  });

describe("aperçu avant/après d'une proposition", () => {
  it("montre la couleur validée avant et la couleur proposée après, annoncées par leur seul hex", async () => {
    const { screen } = await renderBatch(reading(makeBatch({ proposals: [makeUpdate()] })));

    const before = preview(screen, "Avant : #1a66e6");
    await expect.element(before).toBeVisible();
    await expect.element(before.getByText("Avant", { exact: true })).toBeVisible();
    await expect.element(before.getByText("#1a66e6", { exact: true })).toBeVisible();
    const after = preview(screen, "Après : #1a3366");
    await expect.element(after).toBeVisible();
    await expect.element(after.getByText("Après", { exact: true })).toBeVisible();
    await expect.element(after.getByText("#1a3366", { exact: true })).toBeVisible();
    expect(drawn(screen, "Avant : #1a66e6", "backgroundColor")).toContain("rgb(26, 102, 230)");
    expect(drawn(screen, "Après : #1a3366", "backgroundColor")).toContain("rgb(26, 51, 102)");
    expect(proposalItems(screen).getByText("Nouveau token").elements()).toHaveLength(0);
    expect(proposalItems(screen).getByRole("img").elements()).toHaveLength(0);
  });

  it("donne le hex avec son alpha d'une couleur transparente", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [
            makeUpdate({ proposed: { $type: "color", $value: { ...NIGHT_BLUE, alpha: 0 } } }),
          ],
        }),
      ),
    );

    await expect.element(preview(screen, "Après : #1a336600")).toBeVisible();
  });

  it("montre la dimension validée avant et la dimension proposée après, chacune avec son unité", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [
            makeUpdate({
              validated: { $type: "dimension", $value: { value: 16, unit: "px" } },
              proposed: { $type: "dimension", $value: { value: 1, unit: "rem" } },
            }),
          ],
        }),
      ),
    );

    const before = preview(screen, "Avant : 16px");
    await expect.element(before.getByText("16px", { exact: true })).toBeVisible();
    const after = preview(screen, "Après : 1rem");
    await expect.element(after.getByText("1rem", { exact: true })).toBeVisible();
    expect(proposalItems(screen).getByRole("img").elements()).toHaveLength(0);
  });

  it("dessine 16px et 1rem en deux barres de même largeur, à la même échelle", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [
            makeUpdate({
              validated: { $type: "dimension", $value: { value: 16, unit: "px" } },
              proposed: { $type: "dimension", $value: { value: 1, unit: "rem" } },
            }),
          ],
        }),
      ),
    );
    const barWidth = (name: string) => {
      const bar = preview(screen, name).element().querySelector('[aria-hidden="true"]');
      return bar === null ? undefined : getComputedStyle(bar).width;
    };

    await expect.element(preview(screen, "Avant : 16px")).toBeVisible();
    expect(barWidth("Avant : 16px")).toBe("16px");
    expect(barWidth("Après : 1rem")).toBe("16px");
  });

  it("montre un nombre en texte lisible, avant et après", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [
            makeUpdate({
              validated: { $type: "number", $value: 1.5 },
              proposed: { $type: "number", $value: 2 },
            }),
          ],
        }),
      ),
    );

    await expect.element(preview(screen, "Avant : 1.5").getByText("1.5")).toBeVisible();
    await expect.element(preview(screen, "Après : 2").getByText("2")).toBeVisible();
  });

  it("ne montre que l'aperçu Après d'une création, marqué Nouveau token", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [
            makeProposal({
              kind: "create",
              validated: undefined,
              proposed: { $type: "color", $value: PRIMARY_BLUE },
            }),
          ],
        }),
      ),
    );

    await expect.element(preview(screen, "Après : #1a66e6")).toBeVisible();
    await expect.element(proposalItems(screen).getByText("Nouveau token")).toBeVisible();
    expect(
      proposalItems(screen)
        .getByRole("figure", { name: /^Avant/ })
        .elements(),
    ).toHaveLength(0);
  });

  it.each([
    ["un type sans aperçu", { $type: "number", $value: 1.5 }, "1.5"],
    [
      "une couleur mal formée",
      { $type: "color", $value: { colorSpace: "srgb", components: [2, 0, 0] } },
      JSON.stringify({ colorSpace: "srgb", components: [2, 0, 0] }),
    ],
  ])("montre %s en texte brut, et la proposition reste rejetable", async (_case, token, text) => {
    const sent: Decision[] = [];
    const { screen } = await renderBatch(
      reading(makeBatch({ proposals: [makeUpdate({ proposed: token })] })),
      {
        reviewProposal: (review) => {
          sent.push(review.decision);
          return reviewedAs("rejected")(review);
        },
      },
    );

    await expect.element(preview(screen, `Après : ${text}`)).toBeVisible();
    await expect.element(preview(screen, `Après : ${text}`).getByText(text)).toBeVisible();
    expect(
      preview(screen, `Après : ${text}`)
        .getByText(/#[0-9a-f]{6}/)
        .elements(),
    ).toHaveLength(0);
    await expect.element(preview(screen, "Avant : #1a66e6")).toBeVisible();
    await proposalItems(screen).nth(0).getByRole("button", { name: "Rejeter" }).click();
    await expect.poll(() => sent).toEqual(["reject"]);
  });

  it.each(["validated", "rejected", "replaced"] as const)(
    "garde les aperçus d'une proposition au statut %s",
    async (status) => {
      const { screen } = await renderBatch(
        reading(makeBatch({ proposals: [makeUpdate({ status })] })),
      );

      await expect.element(preview(screen, "Avant : #1a66e6")).toBeVisible();
      await expect.element(preview(screen, "Après : #1a3366")).toBeVisible();
    },
  );
});

const SAMPLE_TEXT = "Portez ce vieux whisky au juge blond qui fume";

const makeShadowLayer = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  color: { colorSpace: "srgb", components: [0, 0, 0], alpha: 0.25 },
  offsetX: { value: 0, unit: "px" },
  offsetY: { value: 4, unit: "px" },
  blur: { value: 8, unit: "px" },
  spread: { value: 0, unit: "px" },
  ...overrides,
});

const makeTypography = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  fontFamily: "Inter",
  fontSize: { value: 16, unit: "px" },
  fontWeight: 400,
  lineHeight: 1.5,
  letterSpacing: { value: 0, unit: "px" },
  ...overrides,
});

const expectBeforeAfter = async (screen: Screen, before: string, after: string) => {
  await expect.element(preview(screen, `Avant : ${before}`)).toBeVisible();
  await expect
    .element(preview(screen, `Avant : ${before}`).getByText(before, { exact: true }))
    .toBeVisible();
  await expect.element(preview(screen, `Après : ${after}`)).toBeVisible();
  await expect
    .element(preview(screen, `Après : ${after}`).getByText(after, { exact: true }))
    .toBeVisible();
};

describe("aperçu avant/après d'une ombre, d'une police et d'un dégradé", () => {
  it("montre l'ombre validée et l'ombre proposée à plusieurs couches, annoncées par leur valeur", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [
            makeUpdate({
              validated: { $type: "shadow", $value: makeShadowLayer() },
              proposed: {
                $type: "shadow",
                $value: [
                  makeShadowLayer(),
                  makeShadowLayer({
                    color: PRIMARY_BLUE,
                    offsetY: { value: 1, unit: "px" },
                    blur: { value: 2, unit: "px" },
                    inset: true,
                  }),
                ],
              },
            }),
          ],
        }),
      ),
    );

    await expectBeforeAfter(
      screen,
      "0px 4px 8px 0px #00000040",
      "0px 4px 8px 0px #00000040, inset 0px 1px 2px 0px #1a66e6",
    );
    expect(drawn(screen, "Avant : 0px 4px 8px 0px #00000040", "boxShadow")).toContain(
      "rgba(0, 0, 0, 0.25) 0px 4px 8px 0px",
    );
    expect(
      drawn(
        screen,
        "Après : 0px 4px 8px 0px #00000040, inset 0px 1px 2px 0px #1a66e6",
        "boxShadow",
      ),
    ).toContain("rgba(0, 0, 0, 0.25) 0px 4px 8px 0px, rgb(26, 102, 230) 0px 1px 2px 0px inset");
    expect(proposalItems(screen).getByText(SAMPLE_TEXT).elements()).toHaveLength(0);
  });

  it("montre la typographie validée et la typographie proposée sur un texte d'exemple", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [
            makeUpdate({
              validated: { $type: "typography", $value: makeTypography() },
              proposed: {
                $type: "typography",
                $value: makeTypography({
                  fontFamily: ["Georgia", "serif"],
                  fontSize: { value: 1.25, unit: "rem" },
                  fontWeight: "bold",
                }),
              },
            }),
          ],
        }),
      ),
    );

    const before = "Inter · 16px · 400 · interligne 1.5 · espacement 0px";
    const after = "Georgia, serif · 1.25rem · bold · interligne 1.5 · espacement 0px";
    await expectBeforeAfter(screen, before, after);
    await expect.element(preview(screen, `Avant : ${before}`).getByText(SAMPLE_TEXT)).toBeVisible();
    await expect.element(preview(screen, `Après : ${after}`).getByText(SAMPLE_TEXT)).toBeVisible();
    expect(drawn(screen, `Avant : ${before}`, "fontFamily")).toContain("Inter");
    expect(drawn(screen, `Après : ${after}`, "fontFamily")).toContain("Georgia, serif");
    expect(drawn(screen, `Après : ${after}`, "fontSize")).toContain("20px");
    expect(drawn(screen, `Après : ${after}`, "fontWeight")).toContain("700");
  });

  it.each([
    {
      $type: "fontFamily",
      validated: "Inter",
      proposed: ["Georgia", "serif"],
      before: "Inter",
      after: "Georgia, serif",
      property: "fontFamily",
      drawnBefore: "Inter",
      drawnAfter: "Georgia, serif",
    },
    {
      $type: "fontWeight",
      validated: 300,
      proposed: "semi-bold",
      before: "300",
      after: "semi-bold",
      property: "fontWeight",
      drawnBefore: "300",
      drawnAfter: "600",
    },
  ] as const)(
    "montre la valeur $type validée et proposée sur un texte d'exemple",
    async ({ $type, validated, proposed, before, after, property, drawnBefore, drawnAfter }) => {
      const { screen } = await renderBatch(
        reading(
          makeBatch({
            proposals: [
              makeUpdate({
                validated: { $type, $value: validated },
                proposed: { $type, $value: proposed },
              }),
            ],
          }),
        ),
      );

      await expectBeforeAfter(screen, before, after);
      await expect
        .element(preview(screen, `Avant : ${before}`).getByText(SAMPLE_TEXT))
        .toBeVisible();
      await expect
        .element(preview(screen, `Après : ${after}`).getByText(SAMPLE_TEXT))
        .toBeVisible();
      expect(drawn(screen, `Avant : ${before}`, property)).toContain(drawnBefore);
      expect(drawn(screen, `Après : ${after}`, property)).toContain(drawnAfter);
    },
  );

  it("montre le dégradé validé et un dégradé proposé à une seule étape, annoncés par leurs étapes", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [
            makeUpdate({
              validated: {
                $type: "gradient",
                $value: [
                  { color: PRIMARY_BLUE, position: 0 },
                  { color: NIGHT_BLUE, position: 1 },
                ],
              },
              proposed: { $type: "gradient", $value: [{ color: NIGHT_BLUE, position: 0.5 }] },
            }),
          ],
        }),
      ),
    );

    await expectBeforeAfter(screen, "#1a66e6 0%, #1a3366 100%", "#1a3366 50%");
    expect(drawn(screen, "Avant : #1a66e6 0%, #1a3366 100%", "backgroundImage")).toContain(
      "linear-gradient(to right, rgb(26, 102, 230) 0%, rgb(26, 51, 102) 100%)",
    );
    expect(drawn(screen, "Après : #1a3366 50%", "backgroundImage")).toContain(
      "linear-gradient(to right, rgb(26, 51, 102) 50%, rgb(26, 51, 102) 50%)",
    );
    expect(proposalItems(screen).getByText(SAMPLE_TEXT).elements()).toHaveLength(0);
  });

  it("montre en texte brut une ombre dont un champ est un alias, sans texte d'exemple", async () => {
    const value = makeShadowLayer({ color: "{couleur.ombre}" });
    const text = JSON.stringify(value);
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [
            makeUpdate({
              validated: { $type: "shadow", $value: makeShadowLayer() },
              proposed: { $type: "shadow", $value: value },
            }),
          ],
        }),
      ),
    );

    await expect.element(preview(screen, `Après : ${text}`).getByText(text)).toBeVisible();
    await expect.element(preview(screen, "Avant : 0px 4px 8px 0px #00000040")).toBeVisible();
    expect(proposalItems(screen).getByText(SAMPLE_TEXT).elements()).toHaveLength(0);
  });
});

const modeRow = (screen: Screen, mode: string) =>
  proposalItems(screen).nth(0).getByRole("group", { name: mode });

const modePreview = (screen: Screen, mode: string, name: string) =>
  modeRow(screen, mode).getByRole("figure", { name });

const makeModalColor = (modes: Readonly<Record<string, unknown>>) => ({ $type: "color", modes });

describe("aperçu avant/après d'un token à modes", () => {
  it("montre un avant/après par mode, nommé, et marque Inchangé le mode dont la valeur ne bouge pas", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [
            makeUpdate({
              validated: makeModalColor({ clair: PRIMARY_BLUE, sombre: PRIMARY_BLUE }),
              proposed: makeModalColor({ clair: { ...PRIMARY_BLUE }, sombre: NIGHT_BLUE }),
            }),
          ],
        }),
      ),
    );

    await expect
      .element(modeRow(screen, "clair").getByText("clair", { exact: true }))
      .toBeVisible();
    await expect.element(modePreview(screen, "clair", "Avant : #1a66e6")).toBeVisible();
    await expect.element(modePreview(screen, "clair", "Après : #1a66e6")).toBeVisible();
    await expect.element(modeRow(screen, "clair").getByText("Inchangé")).toBeVisible();
    await expect
      .element(modeRow(screen, "sombre").getByText("sombre", { exact: true }))
      .toBeVisible();
    await expect.element(modePreview(screen, "sombre", "Avant : #1a66e6")).toBeVisible();
    await expect
      .element(modePreview(screen, "sombre", "Après : #1a3366").getByText("#1a3366"))
      .toBeVisible();
    expect(modeRow(screen, "sombre").getByText("Inchangé").elements()).toHaveLength(0);
    expect(drawnIn(modePreview(screen, "clair", "Après : #1a66e6"), "backgroundColor")).toContain(
      "rgb(26, 102, 230)",
    );
    expect(drawnIn(modePreview(screen, "sombre", "Avant : #1a66e6"), "backgroundColor")).toContain(
      "rgb(26, 102, 230)",
    );
    expect(drawnIn(modePreview(screen, "sombre", "Après : #1a3366"), "backgroundColor")).toContain(
      "rgb(26, 51, 102)",
    );
    expect(proposalItems(screen).getByText("Nouveau token").elements()).toHaveLength(0);
  });

  it("ne montre que l'aperçu Après de chaque mode d'une création, marquée une fois Nouveau token", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [
            makeProposal({
              kind: "create",
              validated: undefined,
              proposed: makeModalColor({ clair: PRIMARY_BLUE, sombre: NIGHT_BLUE }),
            }),
          ],
        }),
      ),
    );

    await expect.element(modePreview(screen, "clair", "Après : #1a66e6")).toBeVisible();
    await expect.element(modePreview(screen, "sombre", "Après : #1a3366")).toBeVisible();
    await expect.element(proposalItems(screen).getByText("Nouveau token")).toBeVisible();
    expect(
      proposalItems(screen)
        .getByRole("figure", { name: /^Avant/ })
        .elements(),
    ).toHaveLength(0);
    expect(proposalItems(screen).getByText("Inchangé").elements()).toHaveLength(0);
    expect(proposalItems(screen).getByText("Nouveau mode").elements()).toHaveLength(0);
  });

  it("ne montre que l'aperçu Après d'un mode absent de l'avant, marqué Nouveau mode", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [
            makeUpdate({
              validated: makeModalColor({ clair: PRIMARY_BLUE }),
              proposed: makeModalColor({ clair: { ...PRIMARY_BLUE }, sombre: NIGHT_BLUE }),
            }),
          ],
        }),
      ),
    );

    await expect.element(modePreview(screen, "sombre", "Après : #1a3366")).toBeVisible();
    await expect.element(modeRow(screen, "sombre").getByText("Nouveau mode")).toBeVisible();
    expect(
      modeRow(screen, "sombre")
        .getByRole("figure", { name: /^Avant/ })
        .elements(),
    ).toHaveLength(0);
    await expect.element(modePreview(screen, "clair", "Avant : #1a66e6")).toBeVisible();
    expect(modeRow(screen, "clair").getByText("Nouveau mode").elements()).toHaveLength(0);
    expect(proposalItems(screen).getByText("Nouveau token").elements()).toHaveLength(0);
    expect(proposalItems(screen).getByText("Mode retiré").elements()).toHaveLength(0);
  });

  it("montre l'aperçu Avant seul d'un mode absent de l'après, marqué Mode retiré", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [
            makeUpdate({
              validated: makeModalColor({ clair: PRIMARY_BLUE, sombre: NIGHT_BLUE }),
              proposed: makeModalColor({ clair: { ...PRIMARY_BLUE } }),
            }),
          ],
        }),
      ),
    );

    await expect.element(modePreview(screen, "sombre", "Avant : #1a3366")).toBeVisible();
    expect(drawnIn(modePreview(screen, "sombre", "Avant : #1a3366"), "backgroundColor")).toContain(
      "rgb(26, 51, 102)",
    );
    await expect.element(modeRow(screen, "sombre").getByText("Mode retiré")).toBeVisible();
    expect(
      modeRow(screen, "sombre")
        .getByRole("figure", { name: /^Après/ })
        .elements(),
    ).toHaveLength(0);
    expect(modeRow(screen, "sombre").getByText("Inchangé").elements()).toHaveLength(0);
    await expect.element(modePreview(screen, "clair", "Après : #1a66e6")).toBeVisible();
    expect(modeRow(screen, "clair").getByText("Mode retiré").elements()).toHaveLength(0);
    expect(proposalItems(screen).getByText("Nouveau mode").elements()).toHaveLength(0);
  });

  it("montre la valeur simple d'avant comme aperçu Avant de chaque mode", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [
            makeUpdate({
              validated: { $type: "color", $value: PRIMARY_BLUE },
              proposed: makeModalColor({ clair: { ...PRIMARY_BLUE }, sombre: NIGHT_BLUE }),
            }),
          ],
        }),
      ),
    );

    await expect.element(modePreview(screen, "clair", "Avant : #1a66e6")).toBeVisible();
    await expect.element(modeRow(screen, "clair").getByText("Inchangé")).toBeVisible();
    await expect.element(modePreview(screen, "sombre", "Avant : #1a66e6")).toBeVisible();
    expect(drawnIn(modePreview(screen, "sombre", "Avant : #1a66e6"), "backgroundColor")).toContain(
      "rgb(26, 102, 230)",
    );
    await expect.element(modePreview(screen, "sombre", "Après : #1a3366")).toBeVisible();
    expect(modeRow(screen, "sombre").getByText("Inchangé").elements()).toHaveLength(0);
    expect(proposalItems(screen).getByText("Nouveau mode").elements()).toHaveLength(0);
    expect(proposalItems(screen).getByText("Nouveau token").elements()).toHaveLength(0);
  });

  it("montre la valeur simple proposée comme aperçu Après de chaque mode d'avant", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [
            makeUpdate({
              validated: makeModalColor({ clair: PRIMARY_BLUE, sombre: NIGHT_BLUE }),
              proposed: { $type: "color", $value: { ...PRIMARY_BLUE } },
            }),
          ],
        }),
      ),
    );

    await expect.element(modePreview(screen, "clair", "Avant : #1a66e6")).toBeVisible();
    await expect.element(modePreview(screen, "clair", "Après : #1a66e6")).toBeVisible();
    await expect.element(modeRow(screen, "clair").getByText("Inchangé")).toBeVisible();
    await expect.element(modePreview(screen, "sombre", "Avant : #1a3366")).toBeVisible();
    await expect.element(modePreview(screen, "sombre", "Après : #1a66e6")).toBeVisible();
    expect(drawnIn(modePreview(screen, "sombre", "Après : #1a66e6"), "backgroundColor")).toContain(
      "rgb(26, 102, 230)",
    );
    expect(modeRow(screen, "sombre").getByText("Inchangé").elements()).toHaveLength(0);
    expect(proposalItems(screen).getByText("Mode retiré").elements()).toHaveLength(0);
    expect(proposalItems(screen).getByText("Nouveau mode").elements()).toHaveLength(0);
    expect(proposalItems(screen).getByRole("figure", { name: /: $/ }).elements()).toHaveLength(0);
  });

  it.each([
    ["absents", null],
    ["en liste", [PRIMARY_BLUE]],
  ])(
    "ne nomme aucun mode quand les modes sont %s, et la proposition reste rejetable",
    async (_case, modes) => {
      const sent: Decision[] = [];
      const { screen } = await renderBatch(
        reading(makeBatch({ proposals: [makeUpdate({ proposed: { $type: "color", modes } })] })),
        {
          reviewProposal: (review) => {
            sent.push(review.decision);
            return reviewedAs("rejected")(review);
          },
        },
      );

      await expect
        .element(proposalItems(screen).getByRole("figure", { name: /^Après/ }))
        .toBeVisible();
      expect(proposalItems(screen).getByRole("group").elements()).toHaveLength(0);
      await proposalItems(screen).nth(0).getByRole("button", { name: "Rejeter" }).click();
      await expect.poll(() => sent).toEqual(["reject"]);
    },
  );
});

describe("relecture d'une proposition depuis la page du lot (ADR 0012 §1, ADR 0044 §6)", () => {
  it("ne propose Valider et Rejeter que pour les propositions Proposées", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [
            makeProposal(),
            makeProposal({ id: "3e8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b", status: "validated" }),
            makeProposal({ id: "4f8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b", status: "rejected" }),
            makeProposal({ id: "5a8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b", status: "replaced" }),
            makeProposal({ id: "6b8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b", status: "unknown" }),
          ],
        }),
      ),
    );

    await expect
      .element(proposalItems(screen).nth(0).getByRole("button", { name: "Valider" }))
      .toBeVisible();
    await expect
      .element(proposalItems(screen).nth(0).getByRole("button", { name: "Rejeter" }))
      .toBeVisible();
    expect(proposalList(screen).getByRole("button").elements()).toHaveLength(2);
  });

  it.each([
    ["Valider", "validate"],
    ["Rejeter", "reject"],
  ] as const)("%s envoie la décision %s pour cette proposition", async (button, decision) => {
    const sent: { proposalId: string; decision: Decision }[] = [];
    const { screen } = await renderBatch(reading(makeBatch()), {
      reviewProposal: (review) => {
        sent.push(review);
        return reviewedAs("validated")(review);
      },
    });

    await proposalItems(screen).nth(0).getByRole("button", { name: button }).click();

    await expect.poll(() => sent).toEqual([{ proposalId: makeProposal().id, decision }]);
  });

  it("désactive les boutons de la proposition pendant l'envoi", async () => {
    const { screen } = await renderBatch(reading(makeBatch()));

    await proposalItems(screen).nth(0).getByRole("button", { name: "Valider" }).click();

    await expect
      .element(proposalItems(screen).nth(0).getByRole("button", { name: "Valider" }))
      .toBeDisabled();
    await expect
      .element(proposalItems(screen).nth(0).getByRole("button", { name: "Rejeter" }))
      .toBeDisabled();
  });

  it("après une validation, relit le lot, les lots du projet et les tokens du projet", async () => {
    const { readBatch, reads } = readingInTurn(
      makeBatch(),
      makeBatch({ proposals: [makeProposal({ status: "validated" })] }),
    );
    const reviewed: string[] = [];
    const listed = { count: 0 };
    const { screen } = await renderBatch(readBatch, {
      reviewProposal: reviewedAs("validated"),
      onReviewed: ({ projectId }) => {
        reviewed.push(projectId);
        return Promise.resolve();
      },
      listBatches: () => {
        listed.count += 1;
        return Promise.resolve(
          ok([{ id: BATCH_ID, intent: "Palette", state: "closed", toReview: 2 - listed.count }]),
        );
      },
    });
    await expect.element(screen.getByText("1 à relire")).toBeVisible();

    await proposalItems(screen).nth(0).getByRole("button", { name: "Valider" }).click();

    await expect
      .element(proposalItems(screen).nth(0).getByText("Validée", { exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText("0 à relire")).toBeVisible();
    expect(screen.getByRole("button").elements()).toHaveLength(0);
    expect(reads.count).toBe(2);
    expect(reviewed).toEqual([PROJECT_ID]);
  });

  it("une proposition déjà relue l'annonce, puis relit le lot et les tokens du projet", async () => {
    const { readBatch, reads } = readingInTurn(
      makeBatch(),
      makeBatch({ proposals: [makeProposal({ status: "replaced" })] }),
    );
    const reviewed: string[] = [];
    const { screen } = await renderBatch(readBatch, {
      reviewProposal: () => Promise.resolve(err("already_reviewed")),
      onReviewed: ({ projectId }) => {
        reviewed.push(projectId);
        return Promise.resolve();
      },
    });

    await proposalItems(screen).nth(0).getByRole("button", { name: "Valider" }).click();

    await expect
      .element(proposalItems(screen).nth(0).getByRole("alert"))
      .toHaveTextContent("Cette proposition a déjà été relue.");
    await expect
      .element(proposalItems(screen).nth(0).getByText("Remplacée", { exact: true }))
      .toBeVisible();
    expect(reads.count).toBe(2);
    expect(reviewed).toEqual([PROJECT_ID]);
  });

  it("une proposition invalide liste ses erreurs, sans relire le lot", async () => {
    const { readBatch, reads } = readingInTurn(makeBatch());
    const reviewed: string[] = [];
    const { screen } = await renderBatch(readBatch, {
      reviewProposal: () =>
        Promise.resolve(
          err({
            reason: "invalid_proposal",
            errors: [
              { path: "name", message: "Nom déjà pris dans le projet" },
              { path: "$value", message: "Référence vers un token non validé" },
            ],
          }),
        ),
      onReviewed: ({ projectId }) => {
        reviewed.push(projectId);
        return Promise.resolve();
      },
    });

    await proposalItems(screen).nth(0).getByRole("button", { name: "Valider" }).click();

    const alert = proposalItems(screen).nth(0).getByRole("alert");
    await expect.element(alert).toHaveTextContent("Cette proposition est invalide :");
    await expect
      .element(alert.getByRole("listitem").nth(0))
      .toHaveTextContent("name : Nom déjà pris dans le projet");
    await expect
      .element(alert.getByRole("listitem").nth(1))
      .toHaveTextContent("$value : Référence vers un token non validé");
    await expect
      .element(proposalItems(screen).nth(0).getByRole("button", { name: "Valider" }))
      .toBeEnabled();
    expect(reads.count).toBe(1);
    expect(reviewed).toEqual([]);
  });

  it("montre deux erreurs sur le même champ, sans que React confonde leurs lignes", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { screen } = await renderBatch(reading(makeBatch()), {
      reviewProposal: () =>
        Promise.resolve(
          err({
            reason: "invalid_proposal",
            errors: [
              { path: "name", message: "Nom déjà pris dans le projet" },
              { path: "name", message: "Nom en conflit de groupe avec le token couleur" },
            ],
          }),
        ),
    });

    await proposalItems(screen).nth(0).getByRole("button", { name: "Valider" }).click();

    const alert = proposalItems(screen).nth(0).getByRole("alert");
    await expect
      .element(alert.getByRole("listitem").nth(1))
      .toHaveTextContent("name : Nom en conflit de groupe avec le token couleur");
    expect(alert.getByRole("listitem").elements()).toHaveLength(2);
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
    consoleError.mockRestore();
  });

  it.each([
    ["not_found", "Cette proposition est introuvable."],
    ["unavailable", "La relecture est indisponible pour le moment."],
    ["invalid_response", "La relecture est indisponible pour le moment."],
  ] as const)("annonce l'échec %s de la relecture", async (failure, message) => {
    const { screen } = await renderBatch(reading(makeBatch()), {
      reviewProposal: () => Promise.resolve(err(failure)),
    });

    await proposalItems(screen).nth(0).getByRole("button", { name: "Rejeter" }).click();

    await expect
      .element(proposalItems(screen).nth(0).getByRole("alert"))
      .toHaveTextContent(message);
  });

  it("renvoie vers la connexion quand la session expire avant la relecture", async () => {
    const { screen } = await renderBatch(reading(makeBatch()), {
      reviewProposal: () => Promise.resolve(err("unauthenticated")),
    });

    await proposalItems(screen).nth(0).getByRole("button", { name: "Valider" }).click();

    await expect.element(screen.getByText("Page de connexion")).toBeVisible();
  });
});

const SECOND_ID = "3e8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";

const makeTwoProposedBatch = (overrides: Partial<Batch> = {}) =>
  makeBatch({
    proposals: [makeProposal(), makeProposal({ id: SECOND_ID, name: "couleur.fond.second" })],
    ...overrides,
  });

const validateBatchButton = (screen: Screen) =>
  screen.getByRole("button", { name: "Valider le lot" });

const batchValidationOutcome = (screen: Screen) =>
  screen.getByRole("region", { name: "Validation du lot" });

describe("validation d'un lot fermé depuis sa page (ADR 0013 §4, ADR 0044 §6)", () => {
  it("donne une case Rejeter dans le lot aux seules propositions Proposées, et un bouton Valider le lot", async () => {
    const { screen } = await renderBatch(
      reading(
        makeBatch({
          proposals: [makeProposal(), makeProposal({ id: SECOND_ID, status: "validated" })],
        }),
      ),
    );

    await expect.element(validateBatchButton(screen)).toBeVisible();
    await expect
      .element(proposalItems(screen).nth(0).getByRole("checkbox", { name: "Rejeter dans le lot" }))
      .not.toBeChecked();
    expect(screen.getByRole("checkbox").elements()).toHaveLength(1);
  });

  it.each([
    ["un lot ouvert", makeBatch({ state: "open" })],
    ["un lot dont l'état est inconnu", makeBatch({ state: "unknown" })],
    [
      "un lot sans proposition à relire",
      makeBatch({ proposals: [makeProposal({ status: "validated" })] }),
    ],
  ])("ne propose pas de valider %s", async (_case, batch) => {
    const { screen } = await renderBatch(reading(batch));

    await expect.element(screen.getByRole("heading")).toBeVisible();
    expect(screen.getByRole("checkbox").elements()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Valider le lot" }).elements()).toHaveLength(0);
  });

  it("envoie le lot avec les seules propositions cochées comme rejetées", async () => {
    const sent: { batchId: string; rejected: readonly string[] }[] = [];
    const { screen } = await renderBatch(reading(makeTwoProposedBatch()), {
      validateBatch: (validation) => {
        sent.push(validation);
        return new Promise(() => {});
      },
    });

    await proposalItems(screen)
      .nth(1)
      .getByRole("checkbox", { name: "Rejeter dans le lot" })
      .click();
    await validateBatchButton(screen).click();

    await expect.poll(() => sent).toEqual([{ batchId: BATCH_ID, rejected: [SECOND_ID] }]);
  });

  it("une case décochée n'est plus rejetée, et les autres le restent", async () => {
    const sent: { batchId: string; rejected: readonly string[] }[] = [];
    const { screen } = await renderBatch(reading(makeTwoProposedBatch()), {
      validateBatch: (validation) => {
        sent.push(validation);
        return new Promise(() => {});
      },
    });
    const boxOf = (index: number) =>
      proposalItems(screen).nth(index).getByRole("checkbox", { name: "Rejeter dans le lot" });

    await boxOf(0).click();
    await boxOf(1).click();
    await boxOf(0).click();
    await validateBatchButton(screen).click();

    await expect.poll(() => sent).toEqual([{ batchId: BATCH_ID, rejected: [SECOND_ID] }]);
  });

  it("désactive le bouton pendant l'envoi", async () => {
    const { screen } = await renderBatch(reading(makeTwoProposedBatch()));

    await validateBatchButton(screen).click();

    await expect.element(validateBatchButton(screen)).toBeDisabled();
  });

  it("après la validation, l'annonce, puis relit le lot, les lots du projet et les tokens du projet", async () => {
    const { readBatch, reads } = readingInTurn(
      makeTwoProposedBatch(),
      makeTwoProposedBatch({
        proposals: [
          makeProposal({ status: "validated" }),
          makeProposal({ id: SECOND_ID, status: "rejected" }),
        ],
      }),
    );
    const reviewed: string[] = [];
    const listed = { count: 0 };
    const { screen } = await renderBatch(readBatch, {
      validateBatch: () =>
        Promise.resolve(ok({ validated: [makeProposal().id], rejected: [SECOND_ID] })),
      onReviewed: ({ projectId }) => {
        reviewed.push(projectId);
        return Promise.resolve();
      },
      listBatches: () => {
        listed.count += 1;
        return Promise.resolve(
          ok([
            { id: BATCH_ID, intent: "Palette", state: "closed", toReview: 4 - 2 * listed.count },
          ]),
        );
      },
    });
    await expect.element(screen.getByText("2 à relire")).toBeVisible();

    await validateBatchButton(screen).click();

    await expect
      .element(batchValidationOutcome(screen))
      .toHaveTextContent("Lot validé : 1 validées, 1 rejetées.");
    await expect
      .element(proposalItems(screen).nth(1).getByText("Rejetée", { exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText("0 à relire")).toBeVisible();
    expect(screen.getByRole("button", { name: "Valider le lot" }).elements()).toHaveLength(0);
    expect(reads.count).toBe(2);
    expect(reviewed).toEqual([PROJECT_ID]);
  });

  it("un lot rouvert entre-temps l'annonce, puis relit le lot", async () => {
    const { readBatch, reads } = readingInTurn(
      makeTwoProposedBatch(),
      makeTwoProposedBatch({ state: "open" }),
    );
    const { screen } = await renderBatch(readBatch, {
      validateBatch: () => Promise.resolve(err("batch_open")),
    });

    await validateBatchButton(screen).click();

    await expect
      .element(batchValidationOutcome(screen).getByRole("alert"))
      .toHaveTextContent("Ce lot est encore ouvert : l'IA peut encore y écrire.");
    await expect.element(screen.getByText("Ouvert", { exact: true })).toBeVisible();
    expect(reads.count).toBe(2);
  });

  it("un lot invalide liste ses erreurs avec le nom de chaque proposition, sans relire le lot", async () => {
    const { readBatch, reads } = readingInTurn(makeTwoProposedBatch());
    const reviewed: string[] = [];
    const unknownId = "7c8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";
    const { screen } = await renderBatch(readBatch, {
      validateBatch: () =>
        Promise.resolve(
          err({
            reason: "invalid_batch",
            errors: [
              {
                path: `proposals.${makeProposal().id}.$value`,
                message: "Référence vers un token non validé",
              },
              { path: `proposals.${SECOND_ID}.name`, message: "Nom déjà pris dans le projet" },
              { path: `proposals.${unknownId}.name`, message: "Nom déjà pris dans le projet" },
            ],
          }),
        ),
      onReviewed: ({ projectId }) => {
        reviewed.push(projectId);
        return Promise.resolve();
      },
    });

    await validateBatchButton(screen).click();

    const alert = batchValidationOutcome(screen).getByRole("alert");
    await expect.element(alert).toHaveTextContent("Ce lot est invalide :");
    await expect
      .element(alert.getByRole("listitem").nth(0))
      .toHaveTextContent("couleur.fond.primaire · $value : Référence vers un token non validé");
    await expect
      .element(alert.getByRole("listitem").nth(1))
      .toHaveTextContent("couleur.fond.second · name : Nom déjà pris dans le projet");
    await expect
      .element(alert.getByRole("listitem").nth(2))
      .toHaveTextContent(`proposals.${unknownId}.name : Nom déjà pris dans le projet`);
    await expect.element(validateBatchButton(screen)).toBeEnabled();
    expect(reads.count).toBe(1);
    expect(reviewed).toEqual([]);
  });

  it("montre tel quel un chemin qui ne désigne pas une proposition", async () => {
    const { screen } = await renderBatch(reading(makeTwoProposedBatch()), {
      validateBatch: () =>
        Promise.resolve(
          err({
            reason: "invalid_batch",
            errors: [{ path: "rejected.1", message: "Proposition hors du lot" }],
          }),
        ),
    });

    await validateBatchButton(screen).click();

    await expect
      .element(batchValidationOutcome(screen).getByRole("alert").getByRole("listitem"))
      .toHaveTextContent("rejected.1 : Proposition hors du lot");
  });

  it("montre deux erreurs sur le même champ du lot, sans que React confonde leurs lignes", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = `proposals.${SECOND_ID}.name`;
    const { screen } = await renderBatch(reading(makeTwoProposedBatch()), {
      validateBatch: () =>
        Promise.resolve(
          err({
            reason: "invalid_batch",
            errors: [
              { path, message: "Nom déjà pris dans le projet" },
              { path, message: "Nom en conflit de groupe avec le token couleur" },
            ],
          }),
        ),
    });

    await validateBatchButton(screen).click();

    const alert = batchValidationOutcome(screen).getByRole("alert");
    await expect
      .element(alert.getByRole("listitem").nth(1))
      .toHaveTextContent(
        "couleur.fond.second · name : Nom en conflit de groupe avec le token couleur",
      );
    expect(alert.getByRole("listitem").elements()).toHaveLength(2);
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
    consoleError.mockRestore();
  });

  it.each([
    ["not_found", "Ce lot est introuvable."],
    ["unavailable", "La validation du lot est indisponible pour le moment."],
    ["invalid_response", "La validation du lot est indisponible pour le moment."],
  ] as const)("annonce l'échec %s de la validation", async (failure, message) => {
    const { screen } = await renderBatch(reading(makeTwoProposedBatch()), {
      validateBatch: () => Promise.resolve(err(failure)),
    });

    await validateBatchButton(screen).click();

    await expect
      .element(batchValidationOutcome(screen).getByRole("alert"))
      .toHaveTextContent(message);
  });

  it("renvoie vers la connexion quand la session expire avant la validation", async () => {
    const { screen } = await renderBatch(reading(makeTwoProposedBatch()), {
      validateBatch: () => Promise.resolve(err("unauthenticated")),
    });

    await validateBatchButton(screen).click();

    await expect.element(screen.getByText("Page de connexion")).toBeVisible();
  });
});

describe("page d'un lot en temps réel (ADR 0046)", () => {
  it("un signal proposals de son projet fait apparaître les nouvelles propositions du lot, sans action du membre", async () => {
    const events = makeProjectEvents();
    const state = { batch: makeBatch() };
    const { screen } = await renderBatch(() => Promise.resolve(ok(state.batch)), { events });
    await expect.element(proposalItems(screen).nth(0)).toBeVisible();

    state.batch = makeBatch({
      proposals: [
        makeProposal(),
        makeProposal({ id: "3e8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b", name: "couleur.bleu.500" }),
      ],
    });
    events.emit(PROJECT_ID, ["proposals"]);

    await expect.element(proposalItems(screen).nth(1)).toHaveTextContent("couleur.bleu.500");
  });

  it("après une coupure, la réouverture relit le lot, sans signal", async () => {
    const events = makeProjectEvents();
    const state = { batch: makeBatch() };
    const { screen } = await renderBatch(() => Promise.resolve(ok(state.batch)), { events });
    await expect.element(proposalItems(screen).nth(0)).toBeVisible();

    state.batch = makeBatch({
      proposals: [
        makeProposal(),
        makeProposal({ id: "3e8f3c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b", name: "couleur.bleu.500" }),
      ],
    });
    events.resync(PROJECT_ID);

    await expect.element(proposalItems(screen).nth(1)).toHaveTextContent("couleur.bleu.500");
  });

  it("s'abonne au projet du lot, et quitter la page ferme l'abonnement", async () => {
    const events = makeProjectEvents();
    const { history, screen } = await renderBatch(reading(makeBatch()), { events });
    await expect.element(proposalItems(screen).nth(0)).toBeVisible();
    expect(events.subscribedProjects()).toEqual([PROJECT_ID]);

    history.push("/connexion");

    await expect.element(screen.getByText("Page de connexion")).toBeVisible();
    expect(events.subscribedProjects()).toEqual([]);
  });

  it("ne s'abonne à rien tant que le lot n'est pas lu, ni quand sa lecture échoue", async () => {
    const loading = makeProjectEvents();
    const failed = makeProjectEvents();
    const { screen } = await renderBatch(() => new Promise(() => {}), { events: loading });
    await expect.element(screen.getByText("Chargement du lot…")).toBeVisible();
    const refused = await renderBatch(() => Promise.resolve(err("not_found")), { events: failed });
    await expect.element(refused.screen.getByRole("alert")).toBeVisible();

    expect([loading.subscribedProjects(), failed.subscribedProjects()]).toEqual([[], []]);
  });

  it("un signal d'un autre sujet ne relit pas le lot", async () => {
    const events = makeProjectEvents();
    const reads: string[] = [];
    const { screen } = await renderBatch(
      ({ batchId }) => {
        reads.push(batchId);
        return reading(makeBatch())({ batchId });
      },
      { events },
    );
    await expect.element(proposalItems(screen).nth(0)).toBeVisible();

    events.emit(PROJECT_ID, ["history"]);
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });

    expect(reads).toEqual([BATCH_ID]);
  });
});
