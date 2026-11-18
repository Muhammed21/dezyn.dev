import { describe, expect, it } from "vitest";

import type { LogRecord } from "#platform/logging.ts";
import {
  type App,
  BASE_URL,
  callMcp,
  GRACE,
  obtainAccessToken,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { makeProposalSignalRecorder } from "#testing/project-signals.ts";
import { makeColorToken } from "#testing/token-fixtures.ts";

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
  return result.structuredContent;
};

const proposeTokens = (
  app: App,
  { accessToken, projectId, names }: { accessToken: string; projectId: string; names: string[] },
) =>
  callTool(app, {
    accessToken,
    name: "write_tokens",
    args: { projectId, tokens: names.map((name) => makeColorToken({ name })) },
  });

const review = (
  app: App,
  {
    accessToken,
    proposalId,
    decision,
  }: { accessToken: string; proposalId: string; decision: "validate" | "reject" },
) =>
  app.request(`${BASE_URL}/v1/proposals/${proposalId}/${decision}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });

const validateBatch = (
  app: App,
  { accessToken, batchId }: { accessToken: string; batchId: string },
) =>
  app.request(`${BASE_URL}/v1/proposal-batches/${batchId}/validate`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({}),
  });

const PROPOSALS = ["proposals"];

const PROPOSALS_AND_HISTORY = ["proposals", "history"];

describe("les décisions d'un membre signalent les propositions de leur projet (ADR 0046)", () => {
  it.each([
    ["valider", "validate"],
    ["rejeter", "reject"],
  ] as const)(
    "%s une proposition signale proposals une fois, après le commit",
    (_case, decision) => {
      const recorder = makeProposalSignalRecorder();
      return withIdentityApp(
        async (app, db) => {
          recorder.state.db = db;
          const { accessToken, projectId } = await seedProject(app, db);
          const { proposals } = await proposeTokens(app, {
            accessToken,
            projectId,
            names: ["couleur.fond", "couleur.bord"],
          });
          const mark = recorder.state.received.length;

          const response = await review(app, {
            accessToken,
            proposalId: proposals[0].id,
            decision,
          });

          expect(response.status).toBe(200);
          expect(recorder.since(mark)).toEqual([
            { projectId, topics: PROPOSALS_AND_HISTORY, pending: 1 },
          ]);
        },
        { signals: recorder.signals },
      );
    },
  );

  it("relire une proposition déjà relue ne signale rien", () => {
    const recorder = makeProposalSignalRecorder();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const { proposals } = await proposeTokens(app, {
          accessToken,
          projectId,
          names: ["couleur.fond"],
        });
        const proposalId = proposals[0].id;
        await review(app, { accessToken, proposalId, decision: "validate" });
        const mark = recorder.state.received.length;

        const again = await review(app, { accessToken, proposalId, decision: "reject" });

        expect(again.status).toBe(409);
        expect(recorder.since(mark)).toEqual([]);
      },
      { signals: recorder.signals },
    );
  });

  it("la décision d'un non-membre, refusée en 404, ne signale rien", () => {
    const recorder = makeProposalSignalRecorder();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const { proposals } = await proposeTokens(app, {
          accessToken,
          projectId,
          names: ["couleur.fond"],
        });
        const grace = await obtainAccessToken(app, { user: GRACE });
        const mark = recorder.state.received.length;

        const response = await review(app, {
          accessToken: grace.accessToken,
          proposalId: proposals[0].id,
          decision: "validate",
        });

        expect(response.status).toBe(404);
        expect(recorder.since(mark)).toEqual([]);
      },
      { signals: recorder.signals },
    );
  });

  it("valider un lot fermé signale proposals une fois, après le commit", () => {
    const recorder = makeProposalSignalRecorder();
    return withIdentityApp(
      async (app, db) => {
        recorder.state.db = db;
        const { accessToken, projectId } = await seedProject(app, db);
        const { batch } = await proposeTokens(app, {
          accessToken,
          projectId,
          names: ["couleur.fond", "couleur.bord"],
        });
        await callTool(app, { accessToken, name: "close_proposal_batch", args: { projectId } });
        const mark = recorder.state.received.length;

        const response = await validateBatch(app, { accessToken, batchId: batch.id });

        expect(response.status).toBe(200);
        expect(recorder.since(mark)).toEqual([
          { projectId, topics: PROPOSALS_AND_HISTORY, pending: 0 },
        ]);
      },
      { signals: recorder.signals },
    );
  });

  it("valider un lot encore ouvert, refusé, ne signale rien", () => {
    const recorder = makeProposalSignalRecorder();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const { batch } = await proposeTokens(app, {
          accessToken,
          projectId,
          names: ["couleur.fond"],
        });
        const mark = recorder.state.received.length;

        const response = await validateBatch(app, { accessToken, batchId: batch.id });

        expect(response.status).toBe(409);
        expect(recorder.since(mark)).toEqual([]);
      },
      { signals: recorder.signals },
    );
  });

  it("un signal qui échoue est journalisé, et la décision répond comme sans signal", () => {
    const logged: LogRecord[] = [];
    const state = { failing: false };
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const { proposals } = await proposeTokens(app, {
          accessToken,
          projectId,
          names: ["couleur.fond"],
        });
        state.failing = true;

        const response = await review(app, {
          accessToken,
          proposalId: proposals[0].id,
          decision: "validate",
        });

        expect(response.status).toBe(200);
        expect(logged).toContainEqual(
          expect.objectContaining({
            level: "error",
            msg: "project signal failed",
            projectId,
            error: "Durable Object injoignable",
          }),
        );
      },
      {
        log: (record) => logged.push(record),
        signals: {
          changed: async () => {
            if (state.failing) {
              throw new Error("Durable Object injoignable");
            }
          },
        },
      },
    );
  });
});

describe("les lots déclarés par l'IA signalent les propositions de leur projet (ADR 0046)", () => {
  it("open_proposal_batch signale proposals pour son projet", () => {
    const recorder = makeProposalSignalRecorder();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);

        await callTool(app, {
          accessToken,
          name: "open_proposal_batch",
          args: { projectId, intent: "Palette de la marque" },
        });

        expect(recorder.state.received).toEqual([{ projectId, topics: PROPOSALS }]);
      },
      { signals: recorder.signals },
    );
  });

  it("close_proposal_batch signale proposals quand il ferme un lot, et rien sans lot ouvert", () => {
    const recorder = makeProposalSignalRecorder();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const nothingToClose = await callTool(app, {
          accessToken,
          name: "close_proposal_batch",
          args: { projectId },
        });
        await proposeTokens(app, { accessToken, projectId, names: ["couleur.fond"] });
        const mark = recorder.state.received.length;

        const closed = await callTool(app, {
          accessToken,
          name: "close_proposal_batch",
          args: { projectId },
        });

        expect(nothingToClose).toEqual({ batch: null });
        expect(closed.batch).not.toBeNull();
        expect(mark).toBe(1);
        expect(recorder.since(mark)).toEqual([{ projectId, topics: PROPOSALS }]);
      },
      { signals: recorder.signals },
    );
  });
});
