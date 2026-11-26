import { recipeDateOf } from "#modules/recipe/domain/recipe-date.ts";

import type { ObservedBatch } from "./observation.ts";
import {
  type EvalScenario,
  newBatchesOf,
  newEntriesOf,
  same,
  type ScenarioFixture,
  type ScenarioRun,
} from "./scenario.ts";

const RECIPE = "bilan_sante";

type Rgb = readonly [number, number, number];

const WHITE: Rgb = [1, 1, 1];
const DARK: Rgb = [0.1, 0.1, 0.1];
const GREY: Rgb = [0.45, 0.45, 0.45];
const PALE_GREY: Rgb = [0.75, 0.75, 0.75];
const BLUE: Rgb = [0.2, 0.4, 0.8];
const ORANGE: Rgb = [0.9, 0.5, 0.1];

type Definition = {
  readonly name: string;
  readonly $type: string;
  readonly $value: unknown;
  readonly $description?: string;
  readonly $extensions?: Readonly<Record<string, unknown>>;
};

const color = ([r, g, b]: Rgb) => ({ colorSpace: "srgb", components: [r, g, b], alpha: 1 });

const colorToken = (
  name: string,
  value: Rgb | string,
  extra: Omit<Definition, "name" | "$type" | "$value"> = {},
): Definition => ({
  name,
  $type: "color",
  $value: typeof value === "string" ? value : color(value),
  ...extra,
});

const pairsOn = (...entries: readonly unknown[]) => ({
  $extensions: { "dev.dezyn": { contrastOn: entries } },
});

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const comparableValue = (value: unknown): unknown =>
  isRecord(value) && "colorSpace" in value
    ? { colorSpace: value.colorSpace, components: value.components, alpha: value.alpha ?? 1 }
    : value;

const comparableEntry = (entry: unknown): unknown => {
  if (typeof entry === "string") {
    return { on: entry, usage: "text" };
  }
  return isRecord(entry) ? { on: entry.on, usage: entry.usage ?? "text" } : entry;
};

const comparableExtensions = (extensions: unknown): unknown => {
  if (!isRecord(extensions)) {
    return extensions;
  }
  const dezyn = extensions["dev.dezyn"];
  if (!isRecord(dezyn) || !Array.isArray(dezyn.contrastOn)) {
    return extensions;
  }
  const contrastOn: readonly unknown[] = dezyn.contrastOn;
  return { ...extensions, "dev.dezyn": { ...dezyn, contrastOn: contrastOn.map(comparableEntry) } };
};

const comparableDefinition = (token: unknown): unknown => {
  if (!isRecord(token)) {
    return token;
  }
  return {
    $type: token.$type,
    $value: comparableValue(token.$value),
    modes: isRecord(token.modes)
      ? Object.fromEntries(
          Object.entries(token.modes).map(([mode, value]) => [mode, comparableValue(value)]),
        )
      : undefined,
    $description: token.$description,
    $extensions: comparableExtensions(token.$extensions),
  };
};

const seedValidated = (fixture: ScenarioFixture, tokens: readonly Definition[]) =>
  tokens.reduce<Promise<void>>(
    (previous, token) => previous.then(() => fixture.addToken(token)),
    Promise.resolve(),
  );

const batchIdOf = (opened: unknown): string => {
  if (
    isRecord(opened) &&
    isRecord(opened.batch) &&
    "id" in opened.batch &&
    typeof opened.batch.id === "string"
  ) {
    return opened.batch.id;
  }
  throw new Error("open_proposal_batch n'a pas rendu d'identifiant de lot");
};

type ExpectedBatch = {
  readonly intent: string;
  readonly proposals: readonly Definition[];
} | null;

const proposalContentChecks = (
  batch: ObservedBatch,
  expected: readonly Definition[],
): readonly string[] =>
  expected.flatMap((definition) => {
    const proposal = batch.proposals.find(({ name }) => name === definition.name);
    return proposal === undefined
      ? []
      : same(
          `proposition ${definition.name}`,
          comparableDefinition(proposal.token),
          comparableDefinition(definition),
        );
  });

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
      ...same("lots ouverts par le bilan", opened.length, 0),
      ...same("ouvertures de lot dans l'historique", openings.length, 0),
      ...previous,
    ];
  }
  const [batch] = opened;
  if (opened.length !== 1 || batch === undefined) {
    return [...same("lots ouverts par le bilan", opened.length, 1), ...previous];
  }
  return [
    ...same("intention du lot", batch.intent, expected.intent),
    ...same("recette du lot", batch.recipe, RECIPE),
    ...same("état du lot", batch.state, "closed"),
    ...same(
      "propositions du lot",
      batch.proposals.map(({ kind, name }) => `${kind} ${name}`).toSorted(),
      expected.proposals.map(({ name }) => `update ${name}`).toSorted(),
    ),
    ...proposalContentChecks(batch, expected.proposals),
    ...same("ouvertures de lot dans l'historique", openings.length, 1),
    ...previous,
  ];
};

const calledDuringRun = (run: ScenarioRun, tool: string): readonly string[] =>
  same(
    `appel réussi à ${tool} pendant le bilan`,
    newEntriesOf(run).some(
      ({ action, outcome }) => action === `mcp.${tool}` && outcome === "success",
    ),
    true,
  );

const unchangedProject = (run: ScenarioRun): readonly string[] => [
  ...same(
    "tokens validés du projet",
    run.after.tokens.map(({ name }) => name),
    run.before.tokens.map(({ name }) => name),
  ),
  ...same("modes du projet", run.after.modes, run.before.modes),
];

const intentOf = (run: ScenarioRun, counted: string) =>
  `Bilan de santé du ${recipeDateOf(run.startedAt)} : ${counted}`;

const bilan = (scenario: {
  readonly name: string;
  readonly seed: (fixture: ScenarioFixture) => Promise<void>;
  readonly batch: (run: ScenarioRun) => ExpectedBatch;
}): EvalScenario => ({
  recipe: RECIPE,
  name: scenario.name,
  figmaFiles: [],
  agentMustCallTools: true,
  seed: scenario.seed,
  check: (run) => [
    ...calledDuringRun(run, "read_tokens"),
    ...calledDuringRun(run, "check_contrast"),
    ...batchChecks(run, scenario.batch(run)),
    ...unchangedProject(run),
  ],
});

const SOURCE_AND_DUPLICATE = [
  colorToken("couleur.primaire", BLUE),
  colorToken("couleur.accent", "{couleur.primaire}"),
  colorToken("couleur.marque", BLUE),
];

const ALIAS_TO_SOURCE = colorToken("couleur.marque", "{couleur.primaire}");

const TEXT_WITHOUT_PAIR = colorToken("couleur.texte", DARK, {
  $description: "Texte courant",
  $extensions: { "com.figma": { scopes: ["TEXT_FILL"] } },
});

const BORDER_WITHOUT_PAIR = colorToken("couleur.bordure", GREY);

export const BILAN_SANTE_SCENARIOS: readonly EvalScenario[] = [
  bilan({
    name: "projet-sain",
    seed: (fixture) =>
      seedValidated(fixture, [
        colorToken("couleur.fond", WHITE),
        colorToken("couleur.texte", DARK, pairsOn("{couleur.fond}")),
        colorToken("couleur.bordure", GREY, pairsOn({ on: "{couleur.fond}", usage: "ui" })),
      ]),
    batch: () => null,
  }),
  bilan({
    name: "doublon-source-claire",
    seed: (fixture) => seedValidated(fixture, SOURCE_AND_DUPLICATE),
    batch: (run) => ({
      intent: intentOf(run, "1 doublon remplacé par un alias"),
      proposals: [ALIAS_TO_SOURCE],
    }),
  }),
  bilan({
    name: "doublon-ambigu",
    seed: (fixture) =>
      seedValidated(fixture, [
        colorToken("couleur.primaire", BLUE),
        colorToken("couleur.marque", BLUE),
      ]),
    batch: () => null,
  }),
  bilan({
    name: "paire-sous-son-seuil",
    seed: (fixture) =>
      seedValidated(fixture, [
        colorToken("couleur.fond", WHITE),
        colorToken("couleur.texte.courant", DARK, pairsOn("{couleur.fond}")),
        colorToken("couleur.texte.discret", PALE_GREY, pairsOn("{couleur.fond}")),
      ]),
    batch: () => null,
  }),
  bilan({
    name: "nommage-incoherent",
    seed: (fixture) =>
      seedValidated(fixture, [
        colorToken("couleur.fond", WHITE),
        colorToken("couleur.texte", DARK, pairsOn("{couleur.fond}")),
        colorToken("couleur.primaire", BLUE),
        colorToken("colorAccent", ORANGE),
      ]),
    batch: () => null,
  }),
  bilan({
    name: "alias-deja-en-attente",
    seed: async (fixture) => {
      await seedValidated(fixture, SOURCE_AND_DUPLICATE);
      const opened = await fixture.callTool("open_proposal_batch", {
        projectId: fixture.projectId,
        recipe: RECIPE,
        intent: "Bilan de santé du 18 nov. : 1 doublon remplacé par un alias",
      });
      const batchId = batchIdOf(opened);
      await fixture.callTool("write_tokens", {
        projectId: fixture.projectId,
        batchId,
        tokens: [ALIAS_TO_SOURCE],
      });
      await fixture.callTool("close_proposal_batch", { projectId: fixture.projectId, batchId });
    },
    batch: () => null,
  }),
  bilan({
    name: "paires-manquantes",
    seed: (fixture) =>
      seedValidated(fixture, [
        colorToken("couleur.fond", WHITE),
        TEXT_WITHOUT_PAIR,
        BORDER_WITHOUT_PAIR,
      ]),
    batch: (run) => ({
      intent: intentOf(run, "2 paires de contraste déclarées"),
      proposals: [
        {
          ...TEXT_WITHOUT_PAIR,
          $extensions: {
            "com.figma": { scopes: ["TEXT_FILL"] },
            "dev.dezyn": { contrastOn: [{ on: "{couleur.fond}", usage: "text" }] },
          },
        },
        { ...BORDER_WITHOUT_PAIR, ...pairsOn({ on: "{couleur.fond}", usage: "ui" }) },
      ],
    }),
  }),
];
