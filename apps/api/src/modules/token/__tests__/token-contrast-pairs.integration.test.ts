import { describe, expect, it } from "vitest";

import { type App, BASE_URL, callMcp, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { addToken, makeColorToken } from "#testing/token-fixtures.ts";

const INK = { colorSpace: "srgb", components: [0.1, 0.1, 0.1] };

const PAPER = { colorSpace: "srgb", components: [1, 1, 1] };

const SIXTEEN_PX = { value: 16, unit: "px" };

const CONTRAST_PATH = "$extensions.dev.dezyn.contrastOn";

const makeContrastOn = (contrastOn: readonly unknown[]) => ({ "dev.dezyn": { contrastOn } });

const makeForeground = (contrastOn: readonly unknown[], overrides: Record<string, unknown> = {}) =>
  makeColorToken({
    name: "couleur.texte",
    $value: INK,
    $extensions: makeContrastOn(contrastOn),
    ...overrides,
  });

const makeBackground = (name: string) => makeColorToken({ name, $value: PAPER });

const callTool = async (
  app: App,
  { accessToken, name, args }: { accessToken: string; name: string; args: object },
) => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return (await response.json()).result;
};

const writeTokens = (
  app: App,
  { accessToken, projectId, tokens }: { accessToken: string; projectId: string; tokens: object[] },
) => callTool(app, { accessToken, name: "write_tokens", args: { projectId, tokens } });

const request = (
  app: App,
  {
    accessToken,
    path,
    method = "GET",
    body,
  }: { accessToken: string; path: string; method?: string; body?: unknown },
) =>
  app.request(`${BASE_URL}/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const tokensOf = async (
  app: App,
  { accessToken, projectId }: { accessToken: string; projectId: string },
) =>
  (await (await request(app, { accessToken, path: `/projects/${projectId}/tokens` })).json())
    .tokens;

const readTokens = async (
  app: App,
  { accessToken, projectId }: { accessToken: string; projectId: string },
) =>
  (await callTool(app, { accessToken, name: "read_tokens", args: { projectId } })).structuredContent
    .tokens;

const seedClosedBatch = async (
  app: App,
  seeded: { accessToken: string; projectId: string },
  tokens: object[],
) => {
  const written = (await writeTokens(app, { ...seeded, tokens })).structuredContent;
  await callTool(app, {
    accessToken: seeded.accessToken,
    name: "close_proposal_batch",
    args: { projectId: seeded.projectId },
  });
  return written;
};

const validateBatch = (
  app: App,
  {
    accessToken,
    batchId,
    rejected = [],
  }: { accessToken: string; batchId: string; rejected?: string[] },
) =>
  request(app, {
    accessToken,
    path: `/proposal-batches/${batchId}/validate`,
    method: "POST",
    body: { rejected },
  });

const importTokens = (
  app: App,
  {
    accessToken,
    projectId,
    document,
  }: { accessToken: string; projectId: string; document: unknown },
) =>
  request(app, {
    accessToken,
    path: `/projects/${projectId}/tokens/import`,
    method: "POST",
    body: document,
  });

const PAIRS = ["{couleur.fond}", { on: "{couleur.surface}", usage: "large-text" }];

const OTHER_EXTENSION = { "com.figma": { italic: true } };

describe("un membre déclare une paire de contraste sur un token de couleur (ADR 0061 §1)", () => {
  it("le token se relit tel qu'écrit, avec ses autres extensions, et sort à l'export", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await addToken(app, { ...seeded, token: makeBackground("couleur.fond") });
      await addToken(app, { ...seeded, token: makeBackground("couleur.surface") });
      const $extensions = { ...makeContrastOn(PAIRS), ...OTHER_EXTENSION };
      const foreground = makeForeground(PAIRS, { $extensions });

      const response = await addToken(app, { ...seeded, token: foreground });

      expect(response.status).toBe(201);
      expect(await tokensOf(app, seeded)).toContainEqual(
        expect.objectContaining({ name: "couleur.texte", $extensions }),
      );
      expect(await readTokens(app, seeded)).toContainEqual(
        expect.objectContaining({ name: "couleur.texte", $extensions }),
      );
      const exported = await (
        await request(app, { ...seeded, path: `/projects/${seeded.projectId}/tokens/export` })
      ).json();
      expect(exported.couleur.texte).toEqual({ $type: "color", $value: INK, $extensions });
    }));

  it("une entrée qui cite un token inexistant répond 400 en nommant l'entrée", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await addToken(app, { ...seeded, token: makeBackground("couleur.fond") });

      const response = await addToken(app, {
        ...seeded,
        token: makeForeground(["{couleur.fond}", { on: "{couleur.absente}", usage: "ui" }]),
      });

      expect(response.status).toBe(400);
      expect((await response.json()).errors).toEqual([
        { path: `${CONTRAST_PATH}.1`, message: "Référence vers un token inexistant" },
      ]);
    }));

  it("une entrée qui cite un token qui n'est pas une couleur répond 400", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await addToken(app, {
        ...seeded,
        token: { name: "espace.fond", $type: "dimension", $value: SIXTEEN_PX },
      });

      const response = await addToken(app, { ...seeded, token: makeForeground(["{espace.fond}"]) });

      expect(response.status).toBe(400);
      expect((await response.json()).errors).toEqual([
        { path: `${CONTRAST_PATH}.0`, message: "Référence vers un token d'un autre type" },
      ]);
    }));

  it("une autre propriété sous dev.dezyn répond 400", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);

      const response = await addToken(app, {
        ...seeded,
        token: makeColorToken({ $extensions: { "dev.dezyn": { seuil: 7 } } }),
      });

      expect(response.status).toBe(400);
      expect((await response.json()).errors).toEqual([
        {
          path: "$extensions.dev.dezyn.seuil",
          message: "Seul contrastOn est défini sous dev.dezyn",
        },
      ]);
    }));

  it("les extensions d'un autre outil, même nommées contrastOn, restent libres (ADR 0030 §2)", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      const $extensions = { "com.outil": { contrastOn: ["{couleur.absente}", 3] } };

      const response = await addToken(app, { ...seeded, token: makeColorToken({ $extensions }) });

      expect(response.status).toBe(201);
      expect(await tokensOf(app, seeded)).toMatchObject([{ $extensions }]);
    }));
});

describe("l'IA propose une paire de contraste par write_tokens (ADR 0061 §2)", () => {
  it("une entrée peut citer un fond écrit dans le même appel, et la paire se relit après validation", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      const $extensions = makeContrastOn(["{couleur.fond}"]);
      const { batch } = await seedClosedBatch(app, seeded, [
        makeForeground(["{couleur.fond}"]),
        makeBackground("couleur.fond"),
      ]);

      const response = await validateBatch(app, { ...seeded, batchId: batch.id });

      expect(response.status).toBe(200);
      expect(await readTokens(app, seeded)).toContainEqual(
        expect.objectContaining({ name: "couleur.texte", $extensions }),
      );
    }));

  it("une entrée qui cite un token inexistant est refusée, sans ouvrir de lot", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);

      const result = await writeTokens(app, {
        ...seeded,
        tokens: [makeForeground(["{couleur.absente}"])],
      });

      expect(result).toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: `tokens[0].${CONTRAST_PATH}.0 : Référence vers un token inexistant`,
          },
        ],
      });
      const batches = await request(app, {
        ...seeded,
        path: `/projects/${seeded.projectId}/proposal-batches`,
      });
      expect((await batches.json()).batches).toEqual([]);
    }));

  it("une entrée qui cite un token du même appel qui n'est pas une couleur est refusée", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);

      const result = await writeTokens(app, {
        ...seeded,
        tokens: [
          makeForeground(["{espace.fond}"]),
          { name: "espace.fond", $type: "dimension", $value: SIXTEEN_PX },
        ],
      });

      expect(result).toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: `tokens[0].${CONTRAST_PATH}.0 : Référence vers un token d'un autre type`,
          },
        ],
      });
    }));

  it.each([
    [
      "un usage inconnu",
      makeForeground([{ on: "{couleur.fond}", usage: "AAA" }]),
      `${CONTRAST_PATH}[0].usage : Usage attendu : text, large-text ou ui`,
    ],
    [
      "le token lui-même",
      makeForeground(["{couleur.texte}"]),
      `${CONTRAST_PATH}[0] : Une paire ne cite pas le token qui la déclare`,
    ],
    [
      "deux entrées sur le même fond",
      makeForeground(["{couleur.fond}", { on: "{couleur.fond}", usage: "ui" }]),
      `${CONTRAST_PATH}[1] : Fond déjà cité par une autre paire`,
    ],
    [
      "un token déclarant qui n'est pas une couleur",
      {
        name: "espace.texte",
        $type: "dimension",
        $value: SIXTEEN_PX,
        $extensions: makeContrastOn(["{couleur.fond}"]),
      },
      `${CONTRAST_PATH} : Seul un token de couleur déclare des paires de contraste`,
    ],
  ])("%s est refusé", (_case, token, issue) =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await addToken(app, { ...seeded, token: makeBackground("couleur.fond") });

      const result = await writeTokens(app, { ...seeded, tokens: [token] });

      expect(result).toMatchObject({ isError: true });
      expect(result.content[0].text).toContain(`tokens[0].${issue}`);
    }),
  );
});

describe("la validation d'un lot revérifie les paires de contraste (ADR 0061 §2)", () => {
  it("rejeter le fond cité par une paire du lot répond 409, sans rien valider", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      const { batch, proposals } = await seedClosedBatch(app, seeded, [
        makeForeground(["{couleur.fond}"]),
        makeBackground("couleur.fond"),
      ]);

      const response = await validateBatch(app, {
        ...seeded,
        batchId: batch.id,
        rejected: [proposals[1].id],
      });

      expect(response.status).toBe(409);
      expect((await response.json()).errors).toEqual([
        {
          path: `proposals.${proposals[0].id}.${CONTRAST_PATH}.0`,
          message: "Référence vers un token non validé",
        },
      ]);
      expect(await readTokens(app, seeded)).toEqual([]);
    }));

  it("valider seule la proposition dont le fond attend encore répond 409", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      const { proposals } = await seedClosedBatch(app, seeded, [
        makeForeground(["{couleur.fond}"]),
        makeBackground("couleur.fond"),
      ]);

      const response = await request(app, {
        ...seeded,
        path: `/proposals/${proposals[0].id}/validate`,
        method: "POST",
      });

      expect(response.status).toBe(409);
      expect((await response.json()).errors).toEqual([
        { path: `${CONTRAST_PATH}.0`, message: "Référence vers un token non validé" },
      ]);
    }));
});

describe("un import déclare des paires de contraste (ADR 0061 §2)", () => {
  it("une entrée peut citer un fond du même document, et le document ressort à l'export", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      const $extensions = { ...makeContrastOn(["{couleur.fond}"]), ...OTHER_EXTENSION };
      const document = {
        couleur: {
          texte: { $type: "color", $value: INK, $extensions },
          fond: { $type: "color", $value: PAPER },
        },
      };

      const response = await importTokens(app, { ...seeded, document });

      expect(response.status).toBe(201);
      const exported = await (
        await request(app, { ...seeded, path: `/projects/${seeded.projectId}/tokens/export` })
      ).json();
      expect(exported).toEqual(document);
    }));

  it("une entrée qui cite un token absent du projet et du document répond 400", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);

      const response = await importTokens(app, {
        ...seeded,
        document: {
          texte: { $type: "color", $value: INK, $extensions: makeContrastOn(["{fond}"]) },
        },
      });

      expect(response.status).toBe(400);
      expect((await response.json()).errors).toEqual([
        { path: `tokens.texte.${CONTRAST_PATH}.0`, message: "Référence vers un token inexistant" },
      ]);
    }));

  it("une autre propriété sous dev.dezyn répond 400", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);

      const response = await importTokens(app, {
        ...seeded,
        document: {
          texte: { $type: "color", $value: INK, $extensions: { "dev.dezyn": { a: 1 } } },
        },
      });

      expect(response.status).toBe(400);
      expect((await response.json()).errors).toEqual([
        {
          path: "tokens.texte.$extensions.dev.dezyn.a",
          message: "Seul contrastOn est défini sous dev.dezyn",
        },
      ]);
    }));
});
