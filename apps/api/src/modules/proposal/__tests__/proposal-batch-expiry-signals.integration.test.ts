import { describe, expect, it } from "vitest";

import type { LogRecord } from "#platform/logging.ts";
import { type App, BASE_URL, callMcp, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { makeAllSignalsRecorder } from "#testing/project-signals.ts";
import { addToken, makeColorToken } from "#testing/token-fixtures.ts";

const START = new Date("2026-10-19T09:00:00Z");

const MINUTE = 60 * 1000;

const EXPIRY_AFTER_LAST_WRITE = 30 * MINUTE + 1000;

const NIGHT_BLUE = { colorSpace: "srgb", components: [0.1, 0.2, 0.4] };

const makeClock = () => {
  const state = { instant: START };
  return {
    now: () => state.instant,
    at: (elapsed: number) => {
      state.instant = new Date(START.getTime() + elapsed);
    },
  };
};

const after = (elapsed: number) => new Date(START.getTime() + elapsed);

const callTool = async (
  app: App,
  { accessToken, name, args }: { accessToken: string; name: string; args: object },
) => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const { result } = await response.json();
  return result;
};

const writeTokens = async (
  app: App,
  {
    accessToken,
    projectId,
    name = "couleur.fond",
  }: { accessToken: string; projectId: string; name?: string },
) =>
  (
    await callTool(app, {
      accessToken,
      name: "write_tokens",
      args: { projectId, tokens: [makeColorToken({ name })] },
    })
  ).structuredContent;

const batchesOf = async (
  app: App,
  { accessToken, projectId }: { accessToken: string; projectId: string },
) =>
  (
    await (
      await app.request(`${BASE_URL}/v1/projects/${projectId}/proposal-batches`, {
        headers: { authorization: `Bearer ${accessToken}` },
      })
    ).json()
  ).batches;

const expiryOf = ({
  projectId,
  batchId,
  lastWrittenAt,
}: {
  projectId: string;
  batchId: string;
  lastWrittenAt: number;
}) => ({
  projectId,
  key: `batch:${batchId}`,
  topics: ["proposals"],
  at: after(lastWrittenAt + EXPIRY_AFTER_LAST_WRITE),
});

describe("une écriture dans un lot programme le signal de son expiration (ADR 0013 §7, ADR 0046)", () => {
  it("write_tokens programme proposals 30 minutes et 1 seconde après l'écriture, sous la clé du lot", () => {
    const recorder = makeAllSignalsRecorder();
    const clock = makeClock();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);

        const written = await writeTokens(app, seeded);

        expect(recorder.scheduled).toEqual([
          expiryOf({ projectId: seeded.projectId, batchId: written.batch.id, lastWrittenAt: 0 }),
        ]);
      },
      { signals: recorder.signals, clock: clock.now },
    );
  });

  it("une seconde écriture reprogramme la même clé, plus tard", () => {
    const recorder = makeAllSignalsRecorder();
    const clock = makeClock();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        const first = await writeTokens(app, seeded);
        clock.at(10 * MINUTE);

        await writeTokens(app, { ...seeded, name: "couleur.bord" });

        expect(recorder.scheduled.at(-1)).toEqual(
          expiryOf({
            projectId: seeded.projectId,
            batchId: first.batch.id,
            lastWrittenAt: 10 * MINUTE,
          }),
        );
      },
      { signals: recorder.signals, clock: clock.now },
    );
  });

  it("un write_tokens dont tous les tokens sont inchangés ne programme rien", () => {
    const recorder = makeAllSignalsRecorder();
    const clock = makeClock();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await writeTokens(app, seeded);
        const mark = recorder.scheduled.length;

        await writeTokens(app, seeded);

        expect(recorder.scheduled.slice(mark)).toEqual([]);
      },
      { signals: recorder.signals, clock: clock.now },
    );
  });

  it("un write_tokens refusé ne programme rien", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);

        await callTool(app, {
          accessToken: seeded.accessToken,
          name: "write_tokens",
          args: { projectId: seeded.projectId, tokens: [{ name: "x", $type: "color" }] },
        });

        expect(recorder.scheduled).toEqual([]);
      },
      { signals: recorder.signals },
    );
  });

  it("open_proposal_batch programme l'expiration du lot qu'il ouvre", () => {
    const recorder = makeAllSignalsRecorder();
    const clock = makeClock();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        clock.at(5 * MINUTE);

        const opened = (
          await callTool(app, {
            accessToken: seeded.accessToken,
            name: "open_proposal_batch",
            args: { projectId: seeded.projectId, intent: "Refonte des couleurs" },
          })
        ).structuredContent;

        expect(recorder.scheduled).toEqual([
          expiryOf({
            projectId: seeded.projectId,
            batchId: opened.batch.id,
            lastWrittenAt: 5 * MINUTE,
          }),
        ]);
      },
      { signals: recorder.signals, clock: clock.now },
    );
  });

  it("declare_figma_states qui propose une valeur programme l'expiration de son lot", () => {
    const recorder = makeAllSignalsRecorder();
    const clock = makeClock();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.fond" }) });

        await callTool(app, {
          accessToken: seeded.accessToken,
          name: "declare_figma_states",
          args: {
            projectId: seeded.projectId,
            states: [
              { name: "couleur.fond", state: "diverged", figmaValue: { $value: NIGHT_BLUE } },
            ],
          },
        });

        const [batch] = await batchesOf(app, seeded);
        expect(recorder.scheduled).toEqual([
          expiryOf({ projectId: seeded.projectId, batchId: batch.id, lastWrittenAt: 0 }),
        ]);
      },
      { signals: recorder.signals, clock: clock.now },
    );
  });

  it("declare_figma_states qui redéclare la même divergence ne reprogramme rien", () => {
    const recorder = makeAllSignalsRecorder();
    const clock = makeClock();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.fond" }) });
        const declare = () =>
          callTool(app, {
            accessToken: seeded.accessToken,
            name: "declare_figma_states",
            args: {
              projectId: seeded.projectId,
              states: [
                { name: "couleur.fond", state: "diverged", figmaValue: { $value: NIGHT_BLUE } },
              ],
            },
          });
        await declare();
        clock.at(10 * MINUTE);

        await declare();

        expect(recorder.scheduled).toHaveLength(1);
      },
      { signals: recorder.signals, clock: clock.now },
    );
  });

  it("une programmation qui échoue est journalisée, et l'écriture réussit", () => {
    const logged: LogRecord[] = [];
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);

        const written = await writeTokens(app, seeded);

        expect(written.proposals).toHaveLength(1);
        expect(logged).toContainEqual(
          expect.objectContaining({
            level: "error",
            msg: "project signal failed",
            projectId: seeded.projectId,
            error: "Durable Object injoignable",
          }),
        );
      },
      {
        log: (record) => logged.push(record),
        signals: {
          changed: async () => undefined,
          signalAt: async () => {
            throw new Error("Durable Object injoignable");
          },
        },
      },
    );
  });
});
