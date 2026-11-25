import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import {
  type App,
  authorizeAnotherAi,
  BASE_URL,
  callMcp,
  GRACE,
  obtainAccessToken,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { seedProject, seedProjectAsEditor } from "#testing/project-fixtures.ts";
import { addToken, historyOf, makeColorToken } from "#testing/token-fixtures.ts";
import { schema } from "@repo/db";

const RECIPE = "releve_figma";

const INTENT = "Relevé Figma du 25 nov. : 1 nouveau token";

const NIGHT_BLUE = { colorSpace: "srgb", components: [0.1, 0.2, 0.4] };

const START = new Date("2026-11-25T09:00:00Z");

const MINUTE = 60 * 1000;

const makeClock = () => {
  let instant = START;
  return {
    now: () => instant,
    at: (elapsed: number) => {
      instant = new Date(START.getTime() + elapsed);
    },
  };
};

const callTool = async (
  app: App,
  { token, name, args }: { token: string; name: string; args: object },
) => {
  const response = await callMcp(app, {
    token,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const { result } = await response.json();
  return result;
};

const openBatch = (
  app: App,
  {
    token,
    projectId,
    intent = INTENT,
    recipe,
  }: { token: string; projectId: string; intent?: string; recipe?: string },
) => callTool(app, { token, name: "open_proposal_batch", args: { projectId, intent, recipe } });

const openDesignatedBatch = async (
  app: App,
  { token, projectId }: { token: string; projectId: string },
): Promise<string> => {
  const opened = await openBatch(app, { token, projectId, recipe: RECIPE });
  return String(opened.structuredContent.batch.id);
};

const closeBatch = (
  app: App,
  { token, projectId, batchId }: { token: string; projectId: string; batchId?: string },
) => callTool(app, { token, name: "close_proposal_batch", args: { projectId, batchId } });

const writeTokens = (
  app: App,
  {
    token,
    projectId,
    name = "couleur.fond.primaire",
    batchId,
  }: { token: string; projectId: string; name?: string; batchId?: string },
) =>
  callTool(app, {
    token,
    name: "write_tokens",
    args: { projectId, tokens: [makeColorToken({ name })], batchId },
  });

const declareFigmaStates = (
  app: App,
  {
    token,
    projectId,
    states,
    batchId,
  }: { token: string; projectId: string; states: unknown; batchId?: string },
) => callTool(app, { token, name: "declare_figma_states", args: { projectId, states, batchId } });

const request = (app: App, { accessToken, path }: { accessToken: string; path: string }) =>
  app.request(`${BASE_URL}/v1${path}`, { headers: { authorization: `Bearer ${accessToken}` } });

const batchOf = async (
  app: App,
  { accessToken, batchId }: { accessToken: string; batchId: string },
) => (await request(app, { accessToken, path: `/proposal-batches/${batchId}` })).json();

const batchesOf = async (
  app: App,
  { accessToken, projectId }: { accessToken: string; projectId: string },
) =>
  (
    await (
      await request(app, { accessToken, path: `/projects/${projectId}/proposal-batches` })
    ).json()
  ).batches;

const seedComparedToken = async (
  app: App,
  { accessToken, projectId }: { accessToken: string; projectId: string },
) => addToken(app, { accessToken, projectId, token: makeColorToken({ name: "couleur.fond" }) });

const figmaStatesOf = (db: PostgresDatabase) =>
  db.orm
    .select({ state: schema.tokenFigmaState.state })
    .from(schema.tokenFigmaState)
    .innerJoin(schema.token, eq(schema.token.id, schema.tokenFigmaState.tokenId));

const createProject = async (
  app: App,
  { accessToken, spaceId }: { accessToken: string; spaceId: string },
): Promise<string> => {
  const created = await app.request(`${BASE_URL}/v1/spaces/${spaceId}/projects`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "Application mobile" }),
  });
  const { id } = await created.json();
  return String(id);
};

const seedFellowEditor = async (
  app: App,
  db: PostgresDatabase,
  { spaceId }: { spaceId: string },
) => {
  const fellow = await obtainAccessToken(app, { user: GRACE });
  await db.orm.insert(schema.spaceMember).values({
    id: randomUUID(),
    spaceId,
    userId: fellow.userId,
    role: "editor",
    joinedAt: new Date(),
  });
  return fellow;
};

describe("deux passages de recette du même client écrivent chacun dans leur lot (ADR 0059 §2)", () => {
  it("deux lots désignés du même utilisateur et du même client reçoivent chacun leurs propositions et restent ouverts", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const first = await openBatch(app, { token: accessToken, projectId, recipe: RECIPE });
      const second = await openBatch(app, { token: accessToken, projectId, recipe: RECIPE });
      const firstId = first.structuredContent.batch.id;
      const secondId = second.structuredContent.batch.id;

      const intoFirst = await writeTokens(app, {
        token: accessToken,
        projectId,
        name: "couleur.bleu.500",
        batchId: firstId,
      });
      const intoSecond = await writeTokens(app, {
        token: accessToken,
        projectId,
        name: "couleur.rouge.500",
        batchId: secondId,
      });

      expect(second.structuredContent.closed).toBeNull();
      expect(intoFirst.structuredContent.batch).toEqual({ id: firstId, state: "open" });
      expect(intoSecond.structuredContent.batch).toEqual({ id: secondId, state: "open" });
      expect(await batchOf(app, { accessToken, batchId: firstId })).toMatchObject({
        state: "open",
        proposals: [{ name: "couleur.bleu.500", status: "proposed" }],
      });
      expect(await batchOf(app, { accessToken, batchId: secondId })).toMatchObject({
        state: "open",
        proposals: [{ name: "couleur.rouge.500", status: "proposed" }],
      });
    }));

  it("ouvrir un lot désigné ne ferme pas le lot implicite ouvert", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const implicit = await writeTokens(app, { token: accessToken, projectId });

      const designated = await openBatch(app, { token: accessToken, projectId, recipe: RECIPE });

      expect(designated.structuredContent.closed).toBeNull();
      expect(
        await batchOf(app, { accessToken, batchId: implicit.structuredContent.batch.id }),
      ).toMatchObject({ state: "open" });
    }));

  it("un lot désigné n'est fermé ni par un autre open_proposal_batch, ni par une écriture sans identifiant", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const batchId = await openDesignatedBatch(app, { token: accessToken, projectId });

      const declared = await openBatch(app, { token: accessToken, projectId });
      const written = await writeTokens(app, { token: accessToken, projectId });

      expect(declared.structuredContent.closed).toBeNull();
      expect(written.structuredContent.batch.id).toBe(declared.structuredContent.batch.id);
      expect(await batchOf(app, { accessToken, batchId })).toMatchObject({
        state: "open",
        proposals: [],
      });
    }));

  it("une écriture sans identifiant ne va pas dans le lot désigné, mais dans un lot automatique", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const batchId = await openDesignatedBatch(app, { token: accessToken, projectId });

      const written = await writeTokens(app, { token: accessToken, projectId });

      expect(written.structuredContent.batch.id).not.toBe(batchId);
      expect(await batchOf(app, { accessToken, batchId })).toMatchObject({ state: "open" });
    }));

  it("close_proposal_batch avec l'identifiant ferme ce lot désigné, et lui seul", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const implicit = await writeTokens(app, { token: accessToken, projectId });
      const batchId = await openDesignatedBatch(app, { token: accessToken, projectId });

      const closed = await closeBatch(app, { token: accessToken, projectId, batchId });

      expect(closed.structuredContent).toEqual({
        batch: { id: batchId, state: "closed", intent: INTENT, recipe: RECIPE },
      });
      expect(await batchOf(app, { accessToken, batchId })).toMatchObject({ state: "closed" });
      expect(
        await batchOf(app, { accessToken, batchId: implicit.structuredContent.batch.id }),
      ).toMatchObject({ state: "open" });
    }));

  it("l'identifiant du lot implicite ouvert de l'IA désigne ce lot", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const opened = await openBatch(app, { token: accessToken, projectId });
      const batchId = opened.structuredContent.batch.id;

      const written = await writeTokens(app, { token: accessToken, projectId, batchId });

      expect(written.structuredContent.batch).toEqual({ id: batchId, state: "open" });
    }));

  it("close_proposal_batch sans identifiant ferme le lot implicite, pas le lot désigné", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const batchId = await openDesignatedBatch(app, { token: accessToken, projectId });

      const closed = await closeBatch(app, { token: accessToken, projectId });

      expect(closed.structuredContent).toEqual({ batch: null });
      expect(await batchOf(app, { accessToken, batchId })).toMatchObject({ state: "open" });
    }));

  it("un lot désigné se ferme après 30 minutes sans écriture, et une écriture avec son identifiant est alors refusée", () => {
    const clock = makeClock();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, projectId } = await seedProject(app, db);
        const batchId = await openDesignatedBatch(app, { token: accessToken, projectId });
        clock.at(30 * MINUTE);

        const written = await writeTokens(app, { token: accessToken, projectId, batchId });

        expect(written).toMatchObject({
          isError: true,
          content: [{ type: "text", text: "batchId : Lot fermé" }],
        });
        expect(await batchOf(app, { accessToken, batchId })).toMatchObject({
          state: "closed",
          proposals: [],
        });
      },
      { clock: clock.now },
    );
  });
});

describe("la recette enregistrée se lit avec le lot (ADR 0059 §2)", () => {
  it("open_proposal_batch rend l'identifiant du lot et sa recette", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);

      const opened = await openBatch(app, { token: accessToken, projectId, recipe: RECIPE });

      expect(opened.structuredContent).toEqual({
        batch: { id: expect.any(String), state: "open", intent: INTENT, recipe: RECIPE },
        closed: null,
      });
    }));

  it("la lecture du lot rend sa recette", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const batchId = await openDesignatedBatch(app, { token: accessToken, projectId });

      expect(await batchOf(app, { accessToken, batchId })).toMatchObject({
        id: batchId,
        intent: INTENT,
        recipe: RECIPE,
      });
    }));

  it("la lecture d'un lot implicite ne rend pas de recette", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const written = await writeTokens(app, { token: accessToken, projectId });

      expect(
        await batchOf(app, { accessToken, batchId: written.structuredContent.batch.id }),
      ).not.toHaveProperty("recipe");
    }));

  it("l'ouverture du lot entre dans l'historique avec sa recette", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);

      await openDesignatedBatch(app, { token: accessToken, projectId });

      expect((await historyOf(app, { accessToken, projectId }))[0]).toMatchObject({
        action: "mcp.open_proposal_batch",
        after: { outcome: "success", input: { intent: INTENT, recipe: RECIPE } },
      });
    }));

  it.each([
    ["vide", "   "],
    ["qui n'est pas un texte", 42],
  ])("une recette %s est refusée, sans lot", (_, recipe) =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);

      const result = await callTool(app, {
        token: accessToken,
        name: "open_proposal_batch",
        args: { projectId, intent: INTENT, recipe },
      });

      expect(result).toMatchObject({ isError: true });
      expect(await batchesOf(app, { accessToken, projectId })).toEqual([]);
    }),
  );
});

describe("les déclarations d'état Figma faites avec un identifiant sont rattachées au lot (ADR 0059 §2, ADR 0024 §3)", () => {
  it("la déclaration entre dans l'historique avec l'identifiant du lot", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      await seedComparedToken(app, { accessToken, projectId });
      const batchId = await openDesignatedBatch(app, { token: accessToken, projectId });

      await declareFigmaStates(app, {
        token: accessToken,
        projectId,
        batchId,
        states: [{ name: "couleur.fond", state: "synced" }],
      });

      expect((await historyOf(app, { accessToken, projectId }))[0]).toMatchObject({
        action: "mcp.declare_figma_states",
        after: { outcome: "success", input: { batchId } },
      });
      expect(await batchOf(app, { accessToken, batchId })).toMatchObject({ proposals: [] });
    }));

  it("la valeur Figma d'un token divergent devient une proposition du lot désigné", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      await seedComparedToken(app, { accessToken, projectId });
      const implicit = await writeTokens(app, {
        token: accessToken,
        projectId,
        name: "couleur.texte",
      });
      const batchId = await openDesignatedBatch(app, { token: accessToken, projectId });

      const declared = await declareFigmaStates(app, {
        token: accessToken,
        projectId,
        batchId,
        states: [{ name: "couleur.fond", state: "diverged", figmaValue: { $value: NIGHT_BLUE } }],
      });

      expect(declared.structuredContent.states).toMatchObject([
        { name: "couleur.fond", proposal: { batch: { id: batchId, state: "open" } } },
      ]);
      expect(await batchOf(app, { accessToken, batchId })).toMatchObject({
        proposals: [{ name: "couleur.fond", kind: "update", status: "proposed" }],
      });
      expect(
        await batchOf(app, { accessToken, batchId: implicit.structuredContent.batch.id }),
      ).toMatchObject({ proposals: [{ name: "couleur.texte" }] });
    }));
});

type Refused = {
  readonly accessToken: string;
  readonly projectId: string;
  readonly batchId: string;
  readonly text: string;
};

const REFUSALS: readonly (readonly [
  string,
  (app: App, db: PostgresDatabase) => Promise<Refused>,
])[] = [
  [
    "un identifiant inconnu",
    async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      return { accessToken, projectId, batchId: randomUUID(), text: "batchId : Lot introuvable" };
    },
  ],
  [
    "l'identifiant d'un lot fermé",
    async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const batchId = await openDesignatedBatch(app, { token: accessToken, projectId });
      await closeBatch(app, { token: accessToken, projectId, batchId });
      return { accessToken, projectId, batchId, text: "batchId : Lot fermé" };
    },
  ],
  [
    "l'identifiant d'un lot d'un autre client",
    async (app, db) => {
      const { accessToken, browser, projectId } = await seedProject(app, db);
      const other = await authorizeAnotherAi(app, { browser, clientName: "Cursor" });
      const batchId = await openDesignatedBatch(app, { token: other.accessToken, projectId });
      return { accessToken, projectId, batchId, text: "batchId : Lot introuvable" };
    },
  ],
  [
    "l'identifiant d'un lot d'un autre projet",
    async (app, db) => {
      const { accessToken, spaceId, projectId } = await seedProject(app, db);
      const otherProjectId = await createProject(app, { accessToken, spaceId });
      const batchId = await openDesignatedBatch(app, {
        token: accessToken,
        projectId: otherProjectId,
      });
      return { accessToken, projectId, batchId, text: "batchId : Lot introuvable" };
    },
  ],
  [
    "l'identifiant d'un lot d'un autre utilisateur",
    async (app, db) => {
      const { accessToken, spaceId, projectId } = await seedProjectAsEditor(app, db);
      const fellow = await seedFellowEditor(app, db, { spaceId });
      const batchId = await openDesignatedBatch(app, { token: fellow.accessToken, projectId });
      return { accessToken, projectId, batchId, text: "batchId : Lot introuvable" };
    },
  ],
];

describe("un identifiant de lot qui ne désigne pas un lot ouvert de l'appelant est refusé (ADR 0059 §2)", () => {
  it.each(REFUSALS)(
    "write_tokens avec %s est refusé : rien n'est écrit, aucun lot n'est ouvert",
    (_, seed) =>
      withIdentityApp(async (app, db) => {
        const { accessToken, projectId, batchId, text } = await seed(app, db);
        const before = await batchesOf(app, { accessToken, projectId });

        const result = await writeTokens(app, { token: accessToken, projectId, batchId });

        expect(result).toMatchObject({ isError: true, content: [{ type: "text", text }] });
        expect(await batchesOf(app, { accessToken, projectId })).toEqual(before);
      }),
  );

  it.each(REFUSALS)(
    "declare_figma_states avec %s est refusé : aucun état déclaré, aucune proposition",
    (_, seed) =>
      withIdentityApp(async (app, db) => {
        const { accessToken, projectId, batchId, text } = await seed(app, db);
        await seedComparedToken(app, { accessToken, projectId });
        const before = await batchesOf(app, { accessToken, projectId });

        const result = await declareFigmaStates(app, {
          token: accessToken,
          projectId,
          batchId,
          states: [{ name: "couleur.fond", state: "diverged", figmaValue: { $value: NIGHT_BLUE } }],
        });

        expect(result).toMatchObject({ isError: true, content: [{ type: "text", text }] });
        expect(await batchesOf(app, { accessToken, projectId })).toEqual(before);
        expect(await figmaStatesOf(db)).toEqual([]);
      }),
  );

  it.each(REFUSALS)("close_proposal_batch avec %s est refusé, sans rien fermer", (_, seed) =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId, batchId, text } = await seed(app, db);
      await writeTokens(app, { token: accessToken, projectId, name: "couleur.vert.500" });
      const before = await batchesOf(app, { accessToken, projectId });

      const result = await closeBatch(app, { token: accessToken, projectId, batchId });

      expect(result).toMatchObject({ isError: true, content: [{ type: "text", text }] });
      expect(await batchesOf(app, { accessToken, projectId })).toEqual(before);
    }),
  );

  it("le refus entre dans l'historique avec l'identifiant refusé", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId } = await seedProject(app, db);
      const batchId = randomUUID();

      await writeTokens(app, { token: accessToken, projectId, batchId });

      expect((await historyOf(app, { accessToken, projectId }))[0]).toMatchObject({
        action: "mcp.write_tokens",
        after: { outcome: "error", input: { batchId } },
      });
    }));
});

describe("les outils de lot annoncent la recette et l'identifiant à l'IA", () => {
  it("tools/list annonce recipe pour open_proposal_batch et batchId pour les écritures et la fermeture", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken } = await seedProject(app, db);

      const response = await callMcp(app, { token: accessToken, method: "tools/list" });
      const { tools } = (await response.json()).result;
      const propertiesOf = (name: string) =>
        Object.keys(
          tools.find((tool: { name: string }) => tool.name === name).inputSchema.properties,
        );

      expect(propertiesOf("open_proposal_batch")).toContain("recipe");
      expect(propertiesOf("write_tokens")).toContain("batchId");
      expect(propertiesOf("declare_figma_states")).toContain("batchId");
      expect(propertiesOf("close_proposal_batch")).toContain("batchId");
    }));
});
