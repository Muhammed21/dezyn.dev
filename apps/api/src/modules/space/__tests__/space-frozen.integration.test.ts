import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import {
  type App,
  BASE_URL,
  callMcp,
  GRACE,
  obtainAccessToken,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { seedProjectStoring, seedStoredBytes } from "#testing/project-storage.ts";
import { personalSpaceOf, switchToTeam } from "#testing/space-fixtures.ts";
import { seedEndedSubscription } from "#testing/subscription-fixtures.ts";
import { addToken } from "#testing/token-fixtures.ts";
import { SpaceFrozenProblem, SpaceOutput } from "@repo/contracts";
import { schema } from "@repo/db";

const SPACE_FROZEN = {
  type: "https://dezyn.dev/problems/space-frozen",
  title: "Espace gelé",
  status: 403,
};

const seedEditor = async (app: App, db: PostgresDatabase, spaceId: string) => {
  const editor = await obtainAccessToken(app, { user: GRACE });
  await db.orm.insert(schema.spaceMember).values({
    id: randomUUID(),
    spaceId,
    userId: editor.userId,
    role: "editor",
    joinedAt: new Date(),
  });
  return editor;
};

const seedSpaceWithEditor = async (app: App, db: PostgresDatabase) => {
  const owner = await obtainAccessToken(app);
  const spaceId = await personalSpaceOf(db, owner.userId);
  const projectId = randomUUID();
  await db.orm
    .insert(schema.project)
    .values({ id: projectId, spaceId, name: "Site vitrine", createdAt: new Date() });
  const editor = await seedEditor(app, db, spaceId);
  return { owner, editor, spaceId, projectId };
};

const seedFrozenSpaceWithEditor = async (app: App, db: PostgresDatabase) => {
  const seeded = await seedSpaceWithEditor(app, db);
  await seedEndedSubscription(db, { spaceId: seeded.spaceId, payerId: seeded.owner.userId });
  return seeded;
};

const get = (app: App, { accessToken, path }: { accessToken: string; path: string }) =>
  app.request(`${BASE_URL}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });

const readTokensByMcp = async (
  app: App,
  { accessToken, projectId }: { accessToken: string; projectId: string },
) => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: { name: "read_tokens", arguments: { projectId } },
  });
  const { result } = await response.json();
  return result;
};

const EDITOR_REQUESTS = [
  ["la lecture de l'espace", ({ spaceId }: { spaceId: string }) => `/v1/spaces/${spaceId}`],
  [
    "la liste de ses projets",
    ({ spaceId }: { spaceId: string }) => `/v1/spaces/${spaceId}/projects`,
  ],
  [
    "la liste de ses membres",
    ({ spaceId }: { spaceId: string }) => `/v1/spaces/${spaceId}/members`,
  ],
  ["la lecture d'un projet", ({ projectId }: { projectId: string }) => `/v1/projects/${projectId}`],
  [
    "les tokens d'un projet",
    ({ projectId }: { projectId: string }) => `/v1/projects/${projectId}/tokens`,
  ],
  [
    "l'historique d'un projet",
    ({ projectId }: { projectId: string }) => `/v1/projects/${projectId}/history`,
  ],
] as const;

describe("un éditeur d'un espace gelé est suspendu, en HTTP comme en MCP (ADR 0050 §5)", () => {
  it.each(EDITOR_REQUESTS)("refuse à l'éditeur %s par le problème space-frozen", (_case, pathOf) =>
    withIdentityApp(async (app, db) => {
      const { editor, spaceId, projectId } = await seedFrozenSpaceWithEditor(app, db);

      const response = await get(app, {
        accessToken: editor.accessToken,
        path: pathOf({ spaceId, projectId }),
      });

      expect(response.status).toBe(403);
      expect(response.headers.get("content-type")).toBe("application/problem+json");
      expect(SpaceFrozenProblem.parse(await response.json())).toMatchObject(SPACE_FROZEN);
    }),
  );

  it("refuse une écriture de l'éditeur, sans rien écrire", () =>
    withIdentityApp(async (app, db) => {
      const { editor, projectId } = await seedFrozenSpaceWithEditor(app, db);

      const response = await addToken(app, { accessToken: editor.accessToken, projectId });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject(SPACE_FROZEN);
      expect(
        await db.orm.select().from(schema.token).where(eq(schema.token.projectId, projectId)),
      ).toEqual([]);
    }));

  it("refuse un outil MCP à l'éditeur, avec le code space_frozen", () =>
    withIdentityApp(async (app, db) => {
      const { editor, projectId } = await seedFrozenSpaceWithEditor(app, db);

      const result = await readTokensByMcp(app, { accessToken: editor.accessToken, projectId });

      expect(result).toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: "space_frozen : cet espace est gelé ; l'accès des éditeurs est suspendu jusqu'à son retour au plan Team.",
          },
        ],
      });
    }));

  it("garde l'appartenance de l'éditeur refusé", () =>
    withIdentityApp(async (app, db) => {
      const { editor, spaceId } = await seedFrozenSpaceWithEditor(app, db);
      await get(app, { accessToken: editor.accessToken, path: `/v1/spaces/${spaceId}` });

      const [membership] = await db.orm
        .select({ role: schema.spaceMember.role, closedAt: schema.spaceMember.closedAt })
        .from(schema.spaceMember)
        .where(
          and(
            eq(schema.spaceMember.userId, editor.userId),
            eq(schema.spaceMember.spaceId, spaceId),
          ),
        );

      expect(membership).toEqual({ role: "editor", closedAt: null });
    }));
});

describe("le propriétaire d'un espace gelé continue de tout faire, MCP compris (ADR 0006 §3, ADR 0050 §5)", () => {
  it("lit l'espace, qui se dit gelé avec la limite dépassée", () =>
    withIdentityApp(async (app, db) => {
      const { owner, spaceId } = await seedFrozenSpaceWithEditor(app, db);

      const response = await get(app, {
        accessToken: owner.accessToken,
        path: `/v1/spaces/${spaceId}`,
      });

      expect(response.status).toBe(200);
      expect(SpaceOutput.parse(await response.json())).toMatchObject({
        plan: "free",
        frozen: true,
        exceededFreeLimits: ["members"],
      });
    }));

  it("écrit un token", () =>
    withIdentityApp(async (app, db) => {
      const { owner, projectId } = await seedFrozenSpaceWithEditor(app, db);

      const response = await addToken(app, { accessToken: owner.accessToken, projectId });

      expect(response.status).toBe(201);
    }));

  it("lit les tokens par le MCP", () =>
    withIdentityApp(async (app, db) => {
      const { owner, projectId } = await seedFrozenSpaceWithEditor(app, db);

      const result = await readTokensByMcp(app, { accessToken: owner.accessToken, projectId });

      expect(result.isError).not.toBe(true);
    }));
});

describe("le gel n'est pas stocké : il se lève seul (ADR 0050 §5)", () => {
  it("l'éditeur retrouve son accès, sans réinvitation, quand l'espace repasse Team", () =>
    withIdentityApp(async (app, db) => {
      const { editor, spaceId } = await seedFrozenSpaceWithEditor(app, db);
      const frozen = await get(app, {
        accessToken: editor.accessToken,
        path: `/v1/spaces/${spaceId}`,
      });
      expect(frozen.status).toBe(403);

      await switchToTeam(db, spaceId);

      const read = await get(app, {
        accessToken: editor.accessToken,
        path: `/v1/spaces/${spaceId}`,
      });
      expect(read.status).toBe(200);
      expect(SpaceOutput.parse(await read.json())).toMatchObject({ role: "editor", frozen: false });
    }));

  it("l'espace n'est plus gelé quand il revient sous toutes les limites Free", () =>
    withIdentityApp(async (app, db) => {
      const owner = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, owner.userId);
      const projectId = await seedProjectStoring(db, { spaceId, bytes: 3_000_000_000 });
      await seedEndedSubscription(db, { spaceId, payerId: owner.userId });
      const readFrozen = async () =>
        SpaceOutput.parse(
          await (
            await get(app, { accessToken: owner.accessToken, path: `/v1/spaces/${spaceId}` })
          ).json(),
        ).frozen;
      expect(await readFrozen()).toBe(true);

      await seedStoredBytes(db, { projectId, bytes: 500_000_000 });

      expect(await readFrozen()).toBe(false);
    }));

  it("un espace Free sans abonnement passé, avec un éditeur, ne gèle pas", () =>
    withIdentityApp(async (app, db) => {
      const { editor, spaceId } = await seedSpaceWithEditor(app, db);

      const response = await get(app, {
        accessToken: editor.accessToken,
        path: `/v1/spaces/${spaceId}`,
      });

      expect(response.status).toBe(200);
      expect(SpaceOutput.parse(await response.json())).toMatchObject({
        plan: "free",
        frozen: false,
        exceededFreeLimits: [],
      });
    }));
});
