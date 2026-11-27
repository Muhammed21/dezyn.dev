import { describe, expect, it } from "vitest";

import { err, ok } from "@repo/result";

import { createTokens } from "../token-module.ts";

const API_URL = "https://api.dezyn.dev";
const PROJECT_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";

const PRIMARY_BLUE = { colorSpace: "srgb", components: [0.2, 0.4, 0.8], hex: "#3366cc" };
const NIGHT_BLUE = { colorSpace: "srgb", components: [0.1, 0.2, 0.4], hex: "#1a3366" };

const makeTokenOutput = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: "0b6f3c2a-8d4e-4f1a-9c7b-5e2d1a0f9b8c",
  name: "couleur.fond.primaire",
  $type: "color",
  $value: PRIMARY_BLUE,
  status: "validated",
  ...overrides,
});

const makeTokensOutput = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  modes: [],
  tokens: [makeTokenOutput()],
  ...overrides,
});

type Call = { readonly url: string; readonly init: RequestInit };

const answering = (response: () => Response) => {
  const calls: Call[] = [];
  const fetch = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(response());
  };
  return { tokens: createTokens({ apiUrl: API_URL, fetch }), calls };
};

const json =
  (body: unknown, status = 200) =>
  () =>
    Response.json(body, { status });

const reading = { projectId: PROJECT_ID };

describe("lecture des tokens d'un projet dans l'app web (ADR 0044)", () => {
  it("demande les tokens du projet à l'API avec le cookie du navigateur", async () => {
    const { tokens, calls } = answering(json(makeTokensOutput()));

    await tokens.readTokens(reading);

    expect(calls).toEqual([
      {
        url: `${API_URL}/v1/projects/${PROJECT_ID}/tokens`,
        init: { method: "GET", credentials: "include" },
      },
    ]);
  });

  it("donne un token sans mode avec sa valeur unique et sa description", async () => {
    const { tokens } = answering(
      json(makeTokensOutput({ tokens: [makeTokenOutput({ $description: "Fond des boutons" })] })),
    );

    expect(await tokens.readTokens(reading)).toEqual(
      ok({
        modes: [],
        tokens: [
          {
            id: makeTokenOutput().id,
            name: "couleur.fond.primaire",
            type: "color",
            value: { kind: "single", value: PRIMARY_BLUE },
            description: "Fond des boutons",
          },
        ],
      }),
    );
  });

  it("donne les modes du projet et la valeur d'un token dans chaque mode", async () => {
    const modal = makeTokenOutput({
      $value: undefined,
      modes: { clair: PRIMARY_BLUE, sombre: NIGHT_BLUE },
    });
    const { tokens } = answering(
      json(makeTokensOutput({ modes: ["clair", "sombre"], tokens: [modal] })),
    );

    expect(await tokens.readTokens(reading)).toEqual(
      ok({
        modes: ["clair", "sombre"],
        tokens: [
          {
            id: modal.id,
            name: "couleur.fond.primaire",
            type: "color",
            value: { kind: "by_mode", values: { clair: PRIMARY_BLUE, sombre: NIGHT_BLUE } },
            description: undefined,
          },
        ],
      }),
    );
  });

  it("donne un projet sans token", async () => {
    const { tokens } = answering(json(makeTokensOutput({ tokens: [] })));

    expect(await tokens.readTokens(reading)).toEqual(ok({ modes: [], tokens: [] }));
  });

  it.each([
    "color",
    "dimension",
    "typography",
    "shadow",
    "gradient",
    "fontFamily",
    "fontWeight",
    "number",
  ])("garde le type %s", async ($type) => {
    const { tokens } = answering(json(makeTokensOutput({ tokens: [makeTokenOutput({ $type })] })));

    const read = await tokens.readTokens(reading);

    expect(read.ok && read.value.tokens.map(({ type }) => type)).toEqual([$type]);
  });

  it("donne unknown pour un type que l'app ne connaît pas encore", async () => {
    const { tokens } = answering(
      json(
        makeTokensOutput({
          tokens: [makeTokenOutput({ $type: "duration", $value: { value: 200, unit: "ms" } })],
        }),
      ),
    );

    const read = await tokens.readTokens(reading);

    expect(read.ok && read.value.tokens.map(({ type }) => type)).toEqual(["unknown"]);
  });

  const DECLARED_AT = "2026-11-20T09:30:00.000Z";

  const makeFigmaOutput = (overrides: Readonly<Record<string, unknown>> = {}) => ({
    state: "synced",
    declaredAt: DECLARED_AT,
    author: { kind: "member", userId: "3e1f2a4b-5c6d-4e7f-8a9b-0c1d2e3f4a5b", name: "Ada" },
    clientId: "claude",
    ...overrides,
  });

  it.each(["synced", "diverged", "missing_in_figma", "duplicate_in_figma"])(
    "donne l'état Figma %s d'un token, avec la date de sa déclaration",
    async (state) => {
      const { tokens } = answering(
        json(
          makeTokensOutput({ tokens: [makeTokenOutput({ figma: makeFigmaOutput({ state }) })] }),
        ),
      );

      const read = await tokens.readTokens(reading);

      expect(read.ok && read.value.tokens.map(({ figma }) => figma)).toEqual([
        { state, declaredAt: new Date(DECLARED_AT) },
      ]);
    },
  );

  it("donne unknown pour un état Figma que l'app ne connaît pas encore", async () => {
    const { tokens } = answering(
      json(
        makeTokensOutput({
          tokens: [makeTokenOutput({ figma: makeFigmaOutput({ state: "renamed_in_figma" }) })],
        }),
      ),
    );

    const read = await tokens.readTokens(reading);

    expect(read.ok && read.value.tokens.map(({ figma }) => figma?.state)).toEqual(["unknown"]);
  });

  const PROPOSAL_ID = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";
  const BATCH_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

  it("donne la proposition en attente d'un token divergent, avec sa valeur Figma unique", async () => {
    const { tokens } = answering(
      json(
        makeTokensOutput({
          tokens: [
            makeTokenOutput({
              figma: makeFigmaOutput({
                state: "diverged",
                proposal: { id: PROPOSAL_ID, batchId: BATCH_ID, value: { $value: NIGHT_BLUE } },
              }),
            }),
          ],
        }),
      ),
    );

    const read = await tokens.readTokens(reading);

    expect(read.ok && read.value.tokens.map(({ figma }) => figma)).toEqual([
      {
        state: "diverged",
        declaredAt: new Date(DECLARED_AT),
        proposal: {
          id: PROPOSAL_ID,
          batchId: BATCH_ID,
          value: { kind: "single", value: NIGHT_BLUE },
        },
      },
    ]);
  });

  it("donne la valeur Figma d'une proposition mode par mode", async () => {
    const { tokens } = answering(
      json(
        makeTokensOutput({
          tokens: [
            makeTokenOutput({
              figma: makeFigmaOutput({
                state: "diverged",
                proposal: {
                  id: PROPOSAL_ID,
                  batchId: BATCH_ID,
                  value: { modes: { clair: PRIMARY_BLUE, sombre: NIGHT_BLUE } },
                },
              }),
            }),
          ],
        }),
      ),
    );

    const read = await tokens.readTokens(reading);

    expect(read.ok && read.value.tokens[0]?.figma?.proposal?.value).toEqual({
      kind: "by_mode",
      values: { clair: PRIMARY_BLUE, sombre: NIGHT_BLUE },
    });
  });

  it("donne la dernière valeur Figma rejetée d'un token divergent", async () => {
    const { tokens } = answering(
      json(
        makeTokensOutput({
          tokens: [
            makeTokenOutput({
              figma: makeFigmaOutput({ state: "diverged", rejectedValue: { $value: NIGHT_BLUE } }),
            }),
          ],
        }),
      ),
    );

    const read = await tokens.readTokens(reading);

    expect(read.ok && read.value.tokens.map(({ figma }) => figma)).toEqual([
      {
        state: "diverged",
        declaredAt: new Date(DECLARED_AT),
        rejectedValue: { kind: "single", value: NIGHT_BLUE },
      },
    ]);
  });

  it("ne donne aucun état Figma à un token qui n'en a pas", async () => {
    const { tokens } = answering(json(makeTokensOutput()));

    const read = await tokens.readTokens(reading);

    expect(read.ok && read.value.tokens.map(({ figma }) => figma)).toEqual([undefined]);
  });

  it.each(["../../auth/sign-out", "..", "projet-1", ""])(
    "donne not_found pour le projet %j, qui n'est pas un UUID, sans appeler l'API",
    async (projectId) => {
      const { tokens, calls } = answering(json(makeTokensOutput()));

      expect(await tokens.readTokens({ projectId })).toEqual(err("not_found"));
      expect(calls).toEqual([]);
    },
  );

  it.each([
    [401, "unauthenticated"],
    [404, "not_found"],
    [500, "unavailable"],
    [503, "unavailable"],
    [429, "unavailable"],
    [403, "invalid_response"],
  ])("donne sur une réponse %i l'échec attendu", async (status, failure) => {
    const { tokens } = answering(json({ title: "Refus" }, status));

    expect(await tokens.readTokens(reading)).toEqual(err(failure));
  });

  it("donne unavailable quand l'API est injoignable", async () => {
    const tokens = createTokens({
      apiUrl: API_URL,
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    expect(await tokens.readTokens(reading)).toEqual(err("unavailable"));
  });

  it.each([
    [
      "un token dont l'identifiant n'est pas un UUID",
      json(makeTokensOutput({ tokens: [makeTokenOutput({ id: "token-1" })] })),
    ],
    ["un corps sans modes", json({ tokens: [] })],
    ["un corps qui n'est pas du JSON", () => new Response("<html>", { status: 200 })],
  ])("donne invalid_response sur %s", async (_case, response) => {
    const { tokens } = answering(response);

    expect(await tokens.readTokens(reading)).toEqual(err("invalid_response"));
  });
});

const makeAddedModeOutput = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  mode: "contraste-eleve",
  copiedFrom: "sombre",
  modes: ["clair", "sombre", "contraste-eleve"],
  ...overrides,
});

const makeAddition = (
  overrides: Partial<{ projectId: string; name: string; copiedFrom: string }> = {},
) => ({
  projectId: PROJECT_ID,
  name: "contraste-eleve",
  copiedFrom: "sombre",
  ...overrides,
});

const problem = (body: Readonly<Record<string, unknown>>, status: number) =>
  json({ type: "about:blank", title: "Refus", status, ...body }, status);

describe("ajout d'un mode au projet dans l'app web (ADR 0062)", () => {
  it("envoie le nom rogné et le mode à copier à l'API, avec le cookie du navigateur", async () => {
    const { tokens, calls } = answering(json(makeAddedModeOutput(), 201));

    await tokens.addMode(makeAddition({ name: "  contraste-eleve  " }));

    expect(calls).toEqual([
      {
        url: `${API_URL}/v1/projects/${PROJECT_ID}/modes`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "contraste-eleve", copiedFrom: "sombre" }),
          credentials: "include",
        },
      },
    ]);
  });

  it("donne le mode ajouté, le mode copié et les modes du projet", async () => {
    const { tokens } = answering(json(makeAddedModeOutput(), 201));

    expect(await tokens.addMode(makeAddition())).toEqual(
      ok({
        mode: "contraste-eleve",
        copiedFrom: "sombre",
        modes: ["clair", "sombre", "contraste-eleve"],
      }),
    );
  });

  it.each(["", "   ", "a".repeat(101)])(
    "donne invalid_name pour le nom %j, sans appeler l'API",
    async (name) => {
      const { tokens, calls } = answering(json(makeAddedModeOutput(), 201));

      expect(await tokens.addMode(makeAddition({ name }))).toEqual(err("invalid_name"));
      expect(calls).toEqual([]);
    },
  );

  it("donne not_found pour un projet qui n'est pas un UUID, sans appeler l'API", async () => {
    const { tokens, calls } = answering(json(makeAddedModeOutput(), 201));

    expect(await tokens.addMode(makeAddition({ projectId: "projet-1" }))).toEqual(err("not_found"));
    expect(calls).toEqual([]);
  });

  it.each([
    [
      "des propositions en attente",
      problem(
        {
          type: "https://dezyn.dev/problems/pending-proposals",
          errors: [{ path: "modes", message: "Propositions en attente" }],
        },
        400,
      ),
      "pending_proposals",
    ],
    [
      "un projet sans modes",
      problem({ errors: [{ path: "modes", message: "Projet sans modes" }] }, 400),
      "no_modes",
    ],
    [
      "un mode à copier inconnu",
      problem({ errors: [{ path: "copiedFrom", message: "Mode à copier absent" }] }, 400),
      "unknown_source",
    ],
    [
      "un nom refusé",
      problem({ errors: [{ path: "name", message: "Trop long" }] }, 400),
      "invalid_name",
    ],
    ["un nom déjà pris", problem({}, 409), "name_taken"],
    ["une session expirée", problem({}, 401), "unauthenticated"],
    ["un projet introuvable", problem({}, 404), "not_found"],
    ["une panne", problem({}, 500), "unavailable"],
    ["un refus inattendu", problem({}, 403), "invalid_response"],
  ])("donne pour %s l'échec attendu", async (_case, response, failure) => {
    const { tokens } = answering(response);

    expect(await tokens.addMode(makeAddition())).toEqual(err(failure));
  });

  it("donne invalid_response sur un corps sans les modes du projet", async () => {
    const { tokens } = answering(json({ mode: "contraste-eleve", copiedFrom: "sombre" }, 201));

    expect(await tokens.addMode(makeAddition())).toEqual(err("invalid_response"));
  });
});
