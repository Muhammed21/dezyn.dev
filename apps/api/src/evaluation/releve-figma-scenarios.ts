import { releveDateOf } from "#modules/recipe/domain/releve-figma.ts";

import type { FakeFigmaFile, FakeFigmaVariable, FigmaColor } from "./fake-figma.ts";
import {
  type EvalScenario,
  figmaStatesOf,
  newBatchesOf,
  newEntriesOf,
  notDeclaredDuring,
  same,
  type ScenarioFixture,
  type ScenarioRun,
} from "./scenario.ts";

const RECIPE = "releve_figma";

const FIGMA_KEY = "aB3dE5fG7hI9jK1lM3nO5p";

const FIGMA_URL = `https://www.figma.com/design/${FIGMA_KEY}/Design-system`;

type Rgb = readonly [number, number, number];

const BLUE: Rgb = [0.2, 0.4, 0.8];
const DARK: Rgb = [0.1, 0.1, 0.1];
const RED: Rgb = [0.8, 0.1, 0.1];
const ORANGE: Rgb = [0.9, 0.5, 0.1];
const GREEN: Rgb = [0.2, 0.8, 0.6];
const NAVY: Rgb = [0.1, 0.1, 0.3];

const dezynColor = ([r, g, b]: Rgb) => ({ colorSpace: "srgb", components: [r, g, b], alpha: 1 });

const figmaColor = ([r, g, b]: Rgb): FigmaColor => ({ r, g, b, a: 1 });

const colorToken = (name: string, rgb: Rgb) => ({
  name,
  $type: "color",
  $value: dezynColor(rgb),
});

const variable = (name: string, rgb: Rgb): FakeFigmaVariable => ({
  name: name.replaceAll(".", "/"),
  valuesByMode: { Défaut: figmaColor(rgb) },
});

const figmaFileWith = (variables: readonly FakeFigmaVariable[]): FakeFigmaFile => ({
  key: FIGMA_KEY,
  collections: [{ name: "Couleurs", modes: ["Défaut"], variables }],
});

const withFigmaFile = async (fixture: ScenarioFixture) => {
  await fixture.callTool("set_project_figma_file", {
    projectId: fixture.projectId,
    url: FIGMA_URL,
  });
};

const seedValidated = (
  fixture: ScenarioFixture,
  tokens: readonly ReturnType<typeof colorToken>[],
) =>
  tokens.reduce<Promise<void>>(
    (previous, token) => previous.then(() => fixture.addToken(token)),
    Promise.resolve(),
  );

const batchIdOf = (opened: unknown): string => {
  if (
    typeof opened === "object" &&
    opened !== null &&
    "batch" in opened &&
    typeof opened.batch === "object" &&
    opened.batch !== null &&
    "id" in opened.batch &&
    typeof opened.batch.id === "string"
  ) {
    return opened.batch.id;
  }
  throw new Error("open_proposal_batch n'a pas rendu d'identifiant de lot");
};

type ExpectedBatch = { readonly intent: string; readonly proposals: readonly string[] } | null;

const batchChecks = (run: ScenarioRun, expected: ExpectedBatch): readonly string[] => {
  const opened = newBatchesOf(run);
  const openings = newEntriesOf(run).filter(
    ({ action, outcome }) => action === "mcp.open_proposal_batch" && outcome === "success",
  );
  const previous = same(
    "lots précédents, inchangés",
    run.after.batches.filter(({ id }) => run.before.batches.some((batch) => batch.id === id)),
    run.before.batches,
  );
  if (expected === null) {
    return [
      ...same("lots ouverts par le relevé", opened.length, 0),
      ...same("ouvertures de lot dans l'historique", openings.length, 0),
      ...previous,
    ];
  }
  const [batch] = opened;
  if (opened.length !== 1 || batch === undefined) {
    return [...same("lots ouverts par le relevé", opened.length, 1), ...previous];
  }
  return [
    ...same("intention du lot", batch.intent, expected.intent),
    ...same("recette du lot", batch.recipe, RECIPE),
    ...same("état du lot", batch.state, "closed"),
    ...same(
      "propositions du lot",
      batch.proposals.map(({ kind, name }) => `${kind} ${name}`).toSorted(),
      expected.proposals.toSorted(),
    ),
    ...same("ouvertures de lot dans l'historique", openings.length, 1),
    ...previous,
  ];
};

const stateChecks = (
  run: ScenarioRun,
  expected: Readonly<Record<string, string | null>>,
): readonly string[] => [
  ...same("états Figma", figmaStatesOf(run.after), expected),
  ...same("tokens comparés mais pas déclarés pendant le relevé", notDeclaredDuring(run), []),
];

const unchangedProject = (run: ScenarioRun): readonly string[] => [
  ...same("modes du projet", run.after.modes, run.before.modes),
  ...same("fichier Figma du projet", run.after.figmaFile, run.before.figmaFile),
];

const releve = (
  scenario: Omit<EvalScenario, "recipe" | "check" | "agentMustCallTools"> & {
    readonly agentMustCallTools?: boolean;
    readonly batch: (run: ScenarioRun) => ExpectedBatch;
    readonly states: Readonly<Record<string, string | null>>;
  },
): EvalScenario => ({
  recipe: RECIPE,
  name: scenario.name,
  figmaFiles: scenario.figmaFiles,
  agentMustCallTools: scenario.agentMustCallTools ?? true,
  seed: scenario.seed,
  check: (run) => [
    ...batchChecks(run, scenario.batch(run)),
    ...stateChecks(run, scenario.states),
    ...unchangedProject(run),
  ],
});

export const RELEVE_FIGMA_SCENARIOS: readonly EvalScenario[] = [
  releve({
    name: "premier-releve",
    figmaFiles: [
      figmaFileWith([
        variable("couleur.fond.primaire", BLUE),
        variable("couleur.texte", DARK),
        variable("couleur.alerte", RED),
      ]),
    ],
    seed: async (fixture) => {
      await withFigmaFile(fixture);
      await seedValidated(fixture, [
        colorToken("couleur.fond.primaire", BLUE),
        colorToken("couleur.texte", DARK),
      ]);
    },
    batch: ({ startedAt }) => ({
      intent: `Relevé Figma du ${releveDateOf(startedAt)} : 1 nouveau token`,
      proposals: ["create couleur.alerte"],
    }),
    states: { "couleur.fond.primaire": "synced", "couleur.texte": "synced" },
  }),
  releve({
    name: "semaine-sans-changement",
    figmaFiles: [
      figmaFileWith([variable("couleur.fond.primaire", BLUE), variable("couleur.texte", DARK)]),
    ],
    seed: async (fixture) => {
      await withFigmaFile(fixture);
      await seedValidated(fixture, [
        colorToken("couleur.fond.primaire", BLUE),
        colorToken("couleur.texte", DARK),
      ]);
      await fixture.callTool("declare_figma_states", {
        projectId: fixture.projectId,
        states: [
          { name: "couleur.fond.primaire", state: "synced" },
          { name: "couleur.texte", state: "synced" },
        ],
      });
    },
    batch: () => null,
    states: { "couleur.fond.primaire": "synced", "couleur.texte": "synced" },
  }),
  releve({
    name: "deux-nouveaux-tokens-une-valeur-changee",
    figmaFiles: [
      figmaFileWith([
        variable("couleur.fond.primaire", RED),
        variable("couleur.texte", DARK),
        variable("couleur.alerte", ORANGE),
        variable("couleur.succes", GREEN),
      ]),
    ],
    seed: async (fixture) => {
      await withFigmaFile(fixture);
      await seedValidated(fixture, [
        colorToken("couleur.fond.primaire", BLUE),
        colorToken("couleur.texte", DARK),
      ]);
    },
    batch: ({ startedAt }) => ({
      intent: `Relevé Figma du ${releveDateOf(startedAt)} : 2 nouveaux tokens, 1 valeur changée`,
      proposals: ["create couleur.alerte", "create couleur.succes", "update couleur.fond.primaire"],
    }),
    states: { "couleur.fond.primaire": "diverged", "couleur.texte": "synced" },
  }),
  releve({
    name: "nouveautes-deja-en-attente",
    figmaFiles: [
      figmaFileWith([variable("couleur.fond.primaire", RED), variable("couleur.alerte", ORANGE)]),
    ],
    seed: async (fixture) => {
      await withFigmaFile(fixture);
      await seedValidated(fixture, [colorToken("couleur.fond.primaire", BLUE)]);
      const opened = await fixture.callTool("open_proposal_batch", {
        projectId: fixture.projectId,
        recipe: RECIPE,
        intent: "Relevé Figma du 18 nov. : 1 nouveau token, 1 valeur changée",
      });
      const batchId = batchIdOf(opened);
      await fixture.callTool("write_tokens", {
        projectId: fixture.projectId,
        batchId,
        tokens: [colorToken("couleur.alerte", ORANGE)],
      });
      await fixture.callTool("declare_figma_states", {
        projectId: fixture.projectId,
        batchId,
        states: [
          {
            name: "couleur.fond.primaire",
            state: "diverged",
            figmaValue: { $value: dezynColor(RED) },
          },
        ],
      });
      await fixture.callTool("close_proposal_batch", { projectId: fixture.projectId, batchId });
    },
    batch: () => null,
    states: { "couleur.fond.primaire": "diverged" },
  }),
  releve({
    name: "token-absent-de-figma",
    figmaFiles: [figmaFileWith([variable("couleur.fond.primaire", BLUE)])],
    seed: async (fixture) => {
      await withFigmaFile(fixture);
      await seedValidated(fixture, [
        colorToken("couleur.fond.primaire", BLUE),
        colorToken("couleur.ancienne", GREEN),
      ]);
    },
    batch: () => null,
    states: { "couleur.ancienne": "missing_in_figma", "couleur.fond.primaire": "synced" },
  }),
  releve({
    name: "mode-seulement-dans-figma",
    figmaFiles: [
      {
        key: FIGMA_KEY,
        collections: [
          {
            name: "Couleurs",
            modes: ["Clair", "Sombre"],
            variables: [
              {
                name: "couleur/fond/primaire",
                valuesByMode: { Clair: figmaColor(BLUE), Sombre: figmaColor(NAVY) },
              },
            ],
          },
        ],
      },
    ],
    seed: async (fixture) => {
      await withFigmaFile(fixture);
      await fixture.seedModes(["Clair"]);
      await fixture.addToken({
        name: "couleur.fond.primaire",
        $type: "color",
        modes: { Clair: dezynColor(BLUE) },
      });
    },
    batch: () => null,
    states: { "couleur.fond.primaire": "synced" },
  }),
  releve({
    name: "fichier-figma-non-renseigne",
    agentMustCallTools: false,
    figmaFiles: [figmaFileWith([variable("couleur.fond.primaire", RED)])],
    seed: async (fixture) => {
      await seedValidated(fixture, [colorToken("couleur.fond.primaire", BLUE)]);
    },
    batch: () => null,
    states: { "couleur.fond.primaire": null },
  }),
];
