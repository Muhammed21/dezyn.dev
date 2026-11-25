import { startIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { followRecipe } from "@repo/recipe-agent";

import { exposeOverHttp, recipePromptOf } from "./dezyn-over-http.ts";
import { fakeFigmaServer } from "./fake-figma.ts";
import { observeProject } from "./observation.ts";
import { RECIPE_SCENARIOS } from "./recipe-scenarios.ts";
import { scenarioFixtureOf } from "./scenario-fixture.ts";
import type { EvalScenario } from "./scenario.ts";
import { settingsOf } from "./settings.ts";

const MAX_TURNS = 80;

const SYSTEM_PROMPT = [
  "Tu es l'IA du client d'une équipe produit, branchée sur deux serveurs MCP : dezyn, la plateforme de design de l'équipe, et figma, qui lit les variables d'un fichier Figma par get_local_variables avec la clé du fichier.",
  "Personne ne te répond pendant ton travail. Si la consigne te demande d'interroger l'utilisateur, arrête-toi et pose ta question dans ton compte rendu final.",
].join("\n");

type RunOutcome = {
  readonly failures: readonly string[];
  readonly costUsd: number;
};

const verboseLog = (line: string): void => {
  process.stdout.write(`    │ ${line}\n`);
};

const runOnce = async ({
  model,
  scenario,
  verbose,
}: {
  readonly model: string;
  readonly scenario: EvalScenario;
  readonly verbose: boolean;
}): Promise<RunOutcome> => {
  const { app, db, close } = await startIdentityApp();
  try {
    return await runOnApp({ app, db, model, scenario, verbose });
  } finally {
    await close();
  }
};

const runOnApp = async ({
  app,
  db,
  model,
  scenario,
  verbose,
}: {
  readonly app: Awaited<ReturnType<typeof startIdentityApp>>["app"];
  readonly db: Awaited<ReturnType<typeof startIdentityApp>>["db"];
  readonly model: string;
  readonly scenario: EvalScenario;
  readonly verbose: boolean;
}): Promise<RunOutcome> => {
  const exposed = await exposeOverHttp(app);
  try {
    const member = await seedProject(app, db);
    await scenario.seed(scenarioFixtureOf({ app, db, member }));
    const before = await observeProject(db, member.projectId);
    const startedAt = new Date();
    const prompt = await recipePromptOf(app, { ...member, recipe: scenario.recipe });
    const session = await followRecipe({
      model,
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      remoteServers: {
        dezyn: {
          url: `${exposed.url}/v1/mcp`,
          headers: { authorization: `Bearer ${member.accessToken}` },
        },
      },
      localServers: { figma: fakeFigmaServer(scenario.figmaFiles) },
      maxTurns: MAX_TURNS,
      requireToolCall: scenario.agentMustCallTools,
      log: verbose ? verboseLog : undefined,
    });
    if (!session.ok) {
      return { failures: [session.error.reason], costUsd: session.error.costUsd };
    }
    const after = await observeProject(db, member.projectId);
    return {
      failures: scenario.check({ before, after, startedAt }),
      costUsd: session.value.costUsd,
    };
  } finally {
    await exposed.close();
  }
};

const runScenario = async ({
  model,
  runs,
  scenario,
  verbose,
}: {
  readonly model: string;
  readonly runs: number;
  readonly scenario: EvalScenario;
  readonly verbose: boolean;
}): Promise<readonly RunOutcome[]> =>
  Array.from({ length: runs }).reduce<Promise<readonly RunOutcome[]>>(
    async (previous, _, index) => {
      const done = await previous;
      const outcome = await runOnce({ model, scenario, verbose }).catch(
        (error: unknown): RunOutcome => ({
          failures: [
            `passage interrompu : ${error instanceof Error ? error.message : String(error)}`,
          ],
          costUsd: 0,
        }),
      );
      const verdict = outcome.failures.length === 0 ? "réussi" : "échoué";
      process.stdout.write(
        `${scenario.recipe}/${scenario.name} — passage ${index + 1}/${runs} : ${verdict} (${outcome.costUsd.toFixed(2)} $)\n`,
      );
      outcome.failures.forEach((failure) => process.stdout.write(`    - ${failure}\n`));
      return [...done, outcome];
    },
    Promise.resolve([]),
  );

const settings = settingsOf({
  env: process.env,
  args: process.argv.slice(2),
  scenarios: RECIPE_SCENARIOS,
});

if (!settings.ok) {
  process.stderr.write(`${settings.error}\n`);
  process.exitCode = 1;
} else {
  const { model, runs, scenarios, verbose } = settings.value;
  process.stdout.write(`Évaluation des recettes avec ${model}, ${runs} passages par scénario\n`);
  const results = await scenarios.reduce<
    Promise<readonly { scenario: EvalScenario; outcomes: readonly RunOutcome[] }[]>
  >(async (previous, scenario) => {
    const done = await previous;
    return [...done, { scenario, outcomes: await runScenario({ model, runs, scenario, verbose }) }];
  }, Promise.resolve([]));
  const failed = results.filter(({ outcomes }) =>
    outcomes.some(({ failures }) => failures.length > 0),
  );
  const cost = results
    .flatMap(({ outcomes }) => outcomes)
    .reduce((total, { costUsd }) => total + costUsd, 0);
  process.stdout.write(
    `\n${results.length - failed.length}/${results.length} scénarios réussis à chaque passage, coût ${cost.toFixed(2)} $\n`,
  );
  failed.forEach(({ scenario }) =>
    process.stdout.write(`  échoué : ${scenario.recipe}/${scenario.name}\n`),
  );
  process.exitCode = failed.length === 0 ? 0 : 1;
}
