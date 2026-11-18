import { describe, expect, it } from "vitest";

import { type App, BASE_URL, callMcp, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { addToken, makeColorToken } from "#testing/token-fixtures.ts";

type Signal = { readonly projectId: string; readonly topics: readonly string[] };

const NIGHT_BLUE = { colorSpace: "srgb", components: [0.1, 0.2, 0.4] };

const makeAllSignalsRecorder = () => {
  const received: Signal[] = [];
  return {
    received,
    signals: {
      changed: async (signal: Signal) => {
        received.push(signal);
      },
    },
    since: (mark: number) => received.slice(mark),
  };
};

const proposeTokens = async (
  app: App,
  { accessToken, projectId, names }: { accessToken: string; projectId: string; names: string[] },
) => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: {
      name: "write_tokens",
      arguments: { projectId, tokens: names.map((name) => makeColorToken({ name })) },
    },
  });
  const { result } = await response.json();
  return result.structuredContent;
};

const post = (
  app: App,
  { accessToken, path, body }: { accessToken: string; path: string; body?: object },
) =>
  app.request(`${BASE_URL}/v1${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const color = (value: unknown) => ({ $type: "color", $value: value });

describe("les actions d'un membre signalent l'historique de leur projet (ADR 0046)", () => {
  it("ajouter un token signale history une fois", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);

        const response = await addToken(app, seeded);

        expect(response.status).toBe(201);
        expect(recorder.received).toEqual([{ projectId: seeded.projectId, topics: ["history"] }]);
      },
      { signals: recorder.signals },
    );
  });

  it("ajouter un token qui remplace une proposition envoie un seul signal, proposals et history", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await proposeTokens(app, { ...seeded, names: ["couleur.fond.primaire"] });
        const mark = recorder.received.length;

        await addToken(app, seeded);

        expect(recorder.since(mark)).toEqual([
          { projectId: seeded.projectId, topics: ["proposals", "history"] },
        ]);
      },
      { signals: recorder.signals },
    );
  });

  it("un ajout refusé ne signale rien", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await addToken(app, seeded);
        const mark = recorder.received.length;

        const response = await addToken(app, seeded);

        expect(response.status).toBe(400);
        expect(recorder.since(mark)).toEqual([]);
      },
      { signals: recorder.signals },
    );
  });

  it("un import signale history une fois, quel que soit le nombre de tokens", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);

        const response = await post(app, {
          accessToken: seeded.accessToken,
          path: `/projects/${seeded.projectId}/tokens/import`,
          body: { bleu: color(NIGHT_BLUE), rouge: color(NIGHT_BLUE) },
        });

        expect(response.status).toBe(201);
        expect(recorder.received).toEqual([{ projectId: seeded.projectId, topics: ["history"] }]);
      },
      { signals: recorder.signals },
    );
  });

  it("un import qui remplace une proposition envoie un seul signal, proposals et history", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        await proposeTokens(app, { ...seeded, names: ["bleu"] });
        const mark = recorder.received.length;

        await post(app, {
          accessToken: seeded.accessToken,
          path: `/projects/${seeded.projectId}/tokens/import`,
          body: { bleu: color(NIGHT_BLUE) },
        });

        expect(recorder.since(mark)).toEqual([
          { projectId: seeded.projectId, topics: ["proposals", "history"] },
        ]);
      },
      { signals: recorder.signals },
    );
  });

  it("un import qui ne crée que des modes l'écrit dans l'historique, et signale history", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);

        const response = await post(app, {
          accessToken: seeded.accessToken,
          path: `/projects/${seeded.projectId}/tokens/import`,
          body: {
            version: "2025.10",
            modifiers: {
              theme: { contexts: { sombre: [{}], clair: [{}] }, default: "sombre" },
            },
            resolutionOrder: [{ $ref: "#/modifiers/theme" }],
          },
        });

        expect(response.status).toBe(201);
        expect(recorder.received).toEqual([{ projectId: seeded.projectId, topics: ["history"] }]);
      },
      { signals: recorder.signals },
    );
  });

  it("un import vide, qui n'écrit rien dans l'historique, ne signale rien", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);

        const response = await post(app, {
          accessToken: seeded.accessToken,
          path: `/projects/${seeded.projectId}/tokens/import`,
          body: {},
        });

        expect(response.status).toBe(201);
        expect(recorder.received).toEqual([]);
      },
      { signals: recorder.signals },
    );
  });

  it("un import refusé ne signale rien", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);

        const response = await post(app, {
          accessToken: seeded.accessToken,
          path: `/projects/${seeded.projectId}/tokens/import`,
          body: { bleu: color("{inconnu}") },
        });

        expect(response.status).not.toBe(201);
        expect(recorder.received).toEqual([]);
      },
      { signals: recorder.signals },
    );
  });

  it.each(["validate", "reject"])(
    "%s une proposition envoie un seul signal, proposals et history",
    (decision) => {
      const recorder = makeAllSignalsRecorder();
      return withIdentityApp(
        async (app, db) => {
          const seeded = await seedProject(app, db);
          const { proposals } = await proposeTokens(app, { ...seeded, names: ["couleur.fond"] });
          const mark = recorder.received.length;

          const response = await post(app, {
            accessToken: seeded.accessToken,
            path: `/proposals/${proposals[0].id}/${decision}`,
          });

          expect(response.status).toBe(200);
          expect(recorder.since(mark)).toEqual([
            { projectId: seeded.projectId, topics: ["proposals", "history"] },
          ]);
        },
        { signals: recorder.signals },
      );
    },
  );

  it("valider un lot envoie un seul signal, proposals et history", () => {
    const recorder = makeAllSignalsRecorder();
    return withIdentityApp(
      async (app, db) => {
        const seeded = await seedProject(app, db);
        const { batch } = await proposeTokens(app, { ...seeded, names: ["couleur.fond"] });
        await callMcp(app, {
          token: seeded.accessToken,
          method: "tools/call",
          params: { name: "close_proposal_batch", arguments: { projectId: seeded.projectId } },
        });
        const mark = recorder.received.length;

        const response = await post(app, {
          accessToken: seeded.accessToken,
          path: `/proposal-batches/${batch.id}/validate`,
          body: {},
        });

        expect(response.status).toBe(200);
        expect(recorder.since(mark)).toEqual([
          { projectId: seeded.projectId, topics: ["proposals", "history"] },
        ]);
      },
      { signals: recorder.signals },
    );
  });
});
