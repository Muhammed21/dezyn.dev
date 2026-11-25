import { isDeepStrictEqual } from "node:util";

import type { FakeFigmaFile } from "./fake-figma.ts";
import type { ObservedBatch, ObservedEntry, Observation } from "./observation.ts";

export type ScenarioRun = {
  readonly before: Observation;
  readonly after: Observation;
  readonly startedAt: Date;
};

export type ScenarioFixture = {
  readonly projectId: string;
  readonly callTool: (name: string, args: Readonly<Record<string, unknown>>) => Promise<unknown>;
  readonly addToken: (token: unknown) => Promise<void>;
  readonly seedModes: (modes: readonly string[]) => Promise<void>;
};

export type EvalScenario = {
  readonly recipe: string;
  readonly name: string;
  readonly figmaFiles: readonly FakeFigmaFile[];
  readonly agentMustCallTools: boolean;
  readonly seed: (fixture: ScenarioFixture) => Promise<void>;
  readonly check: (run: ScenarioRun) => readonly string[];
};

const shown = (value: unknown): string => JSON.stringify(value) ?? "undefined";

export const same = (label: string, actual: unknown, expected: unknown): readonly string[] =>
  isDeepStrictEqual(actual, expected)
    ? []
    : [`${label} : attendu ${shown(expected)}, obtenu ${shown(actual)}`];

export const newBatchesOf = ({ before, after }: ScenarioRun): readonly ObservedBatch[] =>
  after.batches.filter(({ id }) => !before.batches.some((batch) => batch.id === id));

export const newEntriesOf = ({ before, after }: ScenarioRun): readonly ObservedEntry[] =>
  after.history.filter(({ id }) => !before.history.some((entry) => entry.id === id));

export const figmaStatesOf = (observation: Observation): Readonly<Record<string, string | null>> =>
  Object.fromEntries(observation.tokens.map(({ name, figmaState }) => [name, figmaState]));

export const notDeclaredDuring = (run: ScenarioRun): readonly string[] =>
  run.after.tokens
    .filter(
      ({ figmaState, declaredAt }) =>
        figmaState !== null && (declaredAt === null || declaredAt < run.startedAt),
    )
    .map(({ name }) => name);
