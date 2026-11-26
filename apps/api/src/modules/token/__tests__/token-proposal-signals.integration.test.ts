import { describe, expect, it } from "vitest";

import type { LogRecord } from "#platform/logging.ts";
import { type App, BASE_URL, callMcp, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { makeAllSignalsRecorder, makeProposalSignalRecorder } from "#testing/project-signals.ts";
import { addToken, makeColorToken } from "#testing/token-fixtures.ts";

const NIGHT_BLUE = { colorSpace: "srgb", components: [0.1, 0.2, 0.4] };

const PROPOSALS = ["proposals"];

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

const proposeTokens = (
  app: App,
  { accessToken, projectId, names }: { accessToken: string; projectId: string; names: string[] },
) =>
  callTool(app, {
    accessToken,
    name: "write_tokens",
    args: { projectId, tokens: names.map((name) => makeColorToken({ name })) },
  });

const declareFigmaStates = (
  app: App,
  { accessToken, projectId, states }: { accessToken: string; projectId: string; states: object[] },
) => callTool(app, { accessToken, name: "declare_figma_states", args: { projectId, states } });

const DIVERGED_FOND = {
  name: "couleur.fond",
  state: "diverged",
  figmaValue: { $value: NIGHT_BLUE },
};

const importTokens = (
  app: App,
  {
    accessToken,
    projectId,
    document,
  }: { accessToken: string; projectId: string; document: object },
) =>
  app.request(`${BASE_URL}/v1/projects/${projectId}/tokens/import`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(document),
  });

const color = (value: unknown) => ({ $type: "color", $value: value });

describe("declare_figma_states signale les propositions qu'il écrit (ADR 0046)", () => {
  it("une divergence proposée signale proposals une fois, après le commit", () => {
    const recorder = makeProposalSignalRecorder();
    return withIdentityApp(
      async (app, db) => {
        recorder.state.db = db;
        const seeded = await seedProject(app, db);
        await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.fond" }) });

        const declared = await declareFigmaStates(app, { ...seeded, states: [DIVERGED_FOND] });

        expect(declared.isError).not.toBe(true);
        expect(recorder.state.received).toEqual([
          { projectId: seeded.projectId, topics: PROPOSALS, pending: 1 },
        ]);
      },
      { signals: recorder.signals },
    );
  });

  it("une déclaration sans proposition ne signale rien", () => {
    const recorder = makeProposalSignalRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.fond" }) });

        const declared = await declareFigmaStates(app, {
          ...seeded,
          states: [{ name: "couleur.fond", state: "missing_in_figma" }],
        });

        expect(declared.isError).not.toBe(true);
        expect(recorder.state.received).toEqual([]);
      },
      { signals: recorder.signals },
    );
  });

  it("relire la valeur Figma déjà proposée ne signale rien de plus", () => {
    const recorder = makeProposalSignalRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.fond" }) });
        await declareFigmaStates(app, { ...seeded, states: [DIVERGED_FOND] });
        const mark = recorder.state.received.length;

        await declareFigmaStates(app, { ...seeded, states: [DIVERGED_FOND] });

        expect(mark).toBe(1);
        expect(recorder.since(mark)).toEqual([]);
      },
      { signals: recorder.signals },
    );
  });

  it("une déclaration refusée ne signale rien", () => {
    const recorder = makeProposalSignalRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);

        const declared = await declareFigmaStates(app, { ...seeded, states: [DIVERGED_FOND] });

        expect(declared.isError).toBe(true);
        expect(recorder.state.received).toEqual([]);
      },
      { signals: recorder.signals },
    );
  });
});

describe("ajouter un token qui remplace une proposition la signale (ADR 0046)", () => {
  it("l'ajout qui remplace une proposition en attente signale proposals une fois, après le commit", () => {
    const recorder = makeProposalSignalRecorder();
    return withIdentityApp(
      async (app, db) => {
        recorder.state.db = db;
        const seeded = await seedProject(app, db);
        await proposeTokens(app, { ...seeded, names: ["couleur.fond.primaire"] });
        const mark = recorder.state.received.length;

        const response = await addToken(app, seeded);

        expect(response.status).toBe(201);
        expect(recorder.since(mark)).toEqual([
          { projectId: seeded.projectId, topics: PROPOSALS, pending: 0 },
        ]);
      },
      { signals: recorder.signals },
    );
  });

  it("l'ajout sans proposition à remplacer ne signale rien", () => {
    const recorder = makeProposalSignalRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await proposeTokens(app, { ...seeded, names: ["couleur.bord"] });
        const mark = recorder.state.received.length;

        const response = await addToken(app, seeded);

        expect(response.status).toBe(201);
        expect(recorder.since(mark)).toEqual([]);
      },
      { signals: recorder.signals },
    );
  });

  it("un ajout refusé ne signale rien", () => {
    const recorder = makeProposalSignalRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await addToken(app, seeded);
        const mark = recorder.state.received.length;

        const response = await addToken(app, seeded);

        expect(response.status).toBe(400);
        expect(recorder.since(mark)).toEqual([]);
      },
      { signals: recorder.signals },
    );
  });

  it("un signal qui échoue est journalisé, et l'ajout répond comme sans signal", () => {
    const logged: LogRecord[] = [];
    const state = { failing: false };
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await proposeTokens(app, { ...seeded, names: ["couleur.fond.primaire"] });
        state.failing = true;

        const response = await addToken(app, seeded);

        expect(response.status).toBe(201);
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
          signalAt: async () => undefined,
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

describe("un import qui remplace des propositions les signale (ADR 0046)", () => {
  it("un import qui remplace deux propositions signale proposals une seule fois, après le commit", () => {
    const recorder = makeProposalSignalRecorder();
    return withIdentityApp(
      async (app, db) => {
        recorder.state.db = db;
        const seeded = await seedProject(app, db);
        await proposeTokens(app, { ...seeded, names: ["bleu", "rouge"] });
        const mark = recorder.state.received.length;

        const response = await importTokens(app, {
          ...seeded,
          document: { bleu: color(NIGHT_BLUE), rouge: color(NIGHT_BLUE) },
        });

        expect(response.status).toBe(201);
        expect(recorder.since(mark)).toEqual([
          { projectId: seeded.projectId, topics: PROPOSALS, pending: 0 },
        ]);
      },
      { signals: recorder.signals },
    );
  });

  it("un import sans remplacement ne signale rien", () => {
    const recorder = makeProposalSignalRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await proposeTokens(app, { ...seeded, names: ["rouge"] });
        const mark = recorder.state.received.length;

        const response = await importTokens(app, {
          ...seeded,
          document: { bleu: color(NIGHT_BLUE) },
        });

        expect(response.status).toBe(201);
        expect(recorder.since(mark)).toEqual([]);
      },
      { signals: recorder.signals },
    );
  });

  it("un import refusé ne signale rien", () => {
    const recorder = makeProposalSignalRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await proposeTokens(app, { ...seeded, names: ["bleu"] });
        const mark = recorder.state.received.length;

        const response = await importTokens(app, {
          ...seeded,
          document: { bleu: color("{inconnu}") },
        });

        expect(response.status).not.toBe(201);
        expect(recorder.since(mark)).toEqual([]);
      },
      { signals: recorder.signals },
    );
  });
});

describe("declare_figma_states signale tokens, que suit l'indice du dernier relevé Figma (ADR 0059 §6)", () => {
  it("une déclaration sans proposition signale tokens et history", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.fond" }) });
        const mark = recorder.received.length;

        await declareFigmaStates(app, {
          ...seeded,
          states: [{ name: "couleur.fond", state: "synced" }],
        });

        expect(recorder.since(mark)).toEqual([
          { projectId: seeded.projectId, topics: ["tokens"] },
          { projectId: seeded.projectId, topics: ["history"] },
        ]);
      },
      { signals: recorder.signals },
    );
  });

  it("une divergence proposée signale proposals et tokens en un seul signal", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.fond" }) });
        const mark = recorder.received.length;

        await declareFigmaStates(app, { ...seeded, states: [DIVERGED_FOND] });

        expect(recorder.since(mark)).toEqual([
          { projectId: seeded.projectId, topics: ["proposals", "tokens"] },
          { projectId: seeded.projectId, topics: ["history"] },
        ]);
      },
      { signals: recorder.signals },
    );
  });

  it("une déclaration refusée ne signale pas tokens", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        const mark = recorder.received.length;

        await declareFigmaStates(app, { ...seeded, states: [DIVERGED_FOND] });

        expect(recorder.since(mark).filter(({ topics }) => topics.includes("tokens"))).toEqual([]);
      },
      { signals: recorder.signals },
    );
  });
});

const post = (
  app: App,
  { accessToken, path, body }: { accessToken: string; path: string; body?: object },
) =>
  app.request(`${BASE_URL}/v1${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

describe("rejeter une valeur Figma signale tokens, que suit la liste des tokens (ADR 0046)", () => {
  it("rejeter une proposition née d'une divergence signale proposals, history et tokens", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.fond" }) });
        const declared = await declareFigmaStates(app, { ...seeded, states: [DIVERGED_FOND] });
        const mark = recorder.received.length;

        const response = await post(app, {
          accessToken: seeded.accessToken,
          path: `/proposals/${declared.structuredContent.states[0].proposal.id}/reject`,
        });

        expect(response.status).toBe(200);
        expect(recorder.since(mark)).toEqual([
          { projectId: seeded.projectId, topics: ["proposals", "history", "tokens"] },
        ]);
      },
      { signals: recorder.signals },
    );
  });

  it("valider un lot qui rejette une valeur Figma signale tokens", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.fond" }) });
        const declared = await declareFigmaStates(app, { ...seeded, states: [DIVERGED_FOND] });
        const { proposal } = declared.structuredContent.states[0];
        await callTool(app, {
          accessToken: seeded.accessToken,
          name: "close_proposal_batch",
          args: { projectId: seeded.projectId },
        });
        const mark = recorder.received.length;

        const response = await post(app, {
          accessToken: seeded.accessToken,
          path: `/proposal-batches/${proposal.batch.id}/validate`,
          body: { rejected: [proposal.id] },
        });

        expect(response.status).toBe(200);
        expect(recorder.since(mark)).toEqual([
          { projectId: seeded.projectId, topics: ["proposals", "history", "tokens"] },
        ]);
      },
      { signals: recorder.signals },
    );
  });
});

const DEEP_RED = { colorSpace: "srgb", components: [0.6, 0.1, 0.1] };

type Seeded = { accessToken: string; projectId: string };

const writeFondInRed = (app: App, { accessToken, projectId }: Seeded) =>
  callTool(app, {
    accessToken,
    name: "write_tokens",
    args: { projectId, tokens: [makeColorToken({ name: "couleur.fond", $value: DEEP_RED })] },
  });

describe("remplacer une valeur Figma proposée signale tokens, que suit la liste des tokens (ADR 0046)", () => {
  it("write_tokens qui remplace une proposition née d'une divergence signale proposals et tokens", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.fond" }) });
        await declareFigmaStates(app, { ...seeded, states: [DIVERGED_FOND] });
        const mark = recorder.received.length;

        const written = await writeFondInRed(app, seeded);

        expect(written.structuredContent.replaced).toHaveLength(1);
        expect(recorder.since(mark)).toEqual([
          { projectId: seeded.projectId, topics: ["proposals", "tokens"] },
          { projectId: seeded.projectId, topics: ["history"] },
        ]);
      },
      { signals: recorder.signals },
    );
  });

  it("delete_tokens qui remplace une proposition née d'une divergence signale proposals et tokens", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.fond" }) });
        await declareFigmaStates(app, { ...seeded, states: [DIVERGED_FOND] });
        const mark = recorder.received.length;

        const deleted = await callTool(app, {
          accessToken: seeded.accessToken,
          name: "delete_tokens",
          args: { projectId: seeded.projectId, names: ["couleur.fond"] },
        });

        expect(deleted.structuredContent.replaced).toHaveLength(1);
        expect(recorder.since(mark)).toEqual([
          { projectId: seeded.projectId, topics: ["proposals", "tokens"] },
          { projectId: seeded.projectId, topics: ["history"] },
        ]);
      },
      { signals: recorder.signals },
    );
  });

  it("write_tokens qui remplace une proposition sans état Figma ne signale pas tokens", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.fond" }) });
        await callTool(app, {
          accessToken: seeded.accessToken,
          name: "write_tokens",
          args: {
            projectId: seeded.projectId,
            tokens: [makeColorToken({ name: "couleur.fond", $value: NIGHT_BLUE })],
          },
        });
        const mark = recorder.received.length;

        const written = await writeFondInRed(app, seeded);

        expect(written.structuredContent.replaced).toHaveLength(1);
        expect(recorder.since(mark)).toEqual([
          { projectId: seeded.projectId, topics: ["proposals"] },
          { projectId: seeded.projectId, topics: ["history"] },
        ]);
      },
      { signals: recorder.signals },
    );
  });
});
