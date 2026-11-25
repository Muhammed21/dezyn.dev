import { describe, expect, it } from "vitest";

import {
  ADA,
  type App,
  BASE_URL,
  callMcp,
  GRACE,
  makeClientIp,
  obtainAccessToken,
  signUp,
  withIdentityApp,
} from "@repo/api/testing/authorization-flow.ts";
import { personalSpaceOf, seedTeamSpaceWith } from "@repo/api/testing/space-fixtures.ts";
import { addToken, makeColorToken } from "@repo/api/testing/token-fixtures.ts";
import { err, ok } from "@repo/result";

import { makeApiBrowser } from "../../../testing/api-browser.ts";
import { createProjects } from "../project-module.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNKNOWN_SPACE_ID = "9b8a7f6e-5d4c-4b3a-8f2e-1d0c9b8a7f6e";

const signedIn = async (app: App, user: typeof ADA) => {
  const ip = makeClientIp();
  const userId = await signUp(app, ip, user);
  const fetch = makeApiBrowser(app, { ip });
  await fetch(`${BASE_URL}/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  return { userId, projects: createProjects({ apiUrl: BASE_URL, fetch }) };
};

const signedInAda = (app: App) => signedIn(app, ADA);

const seedProjectOfAda = async (app: App, db: Parameters<typeof personalSpaceOf>[0]) => {
  const { userId, projects } = await signedInAda(app);
  const spaceId = await personalSpaceOf(db, userId);
  const created = await projects.createProject({ spaceId, name: "Site vitrine" });
  if (!created.ok) {
    throw new Error("Le projet d'Ada n'a pas été créé");
  }
  return { userId, spaceId, projectId: created.value.id, projects };
};

describe("création d'un projet par l'app web, contre la vraie API (ADR 0044 §2 et §6)", () => {
  it("un propriétaire connecté crée un projet dans son espace", () =>
    withIdentityApp(async (app, db) => {
      const { userId, projects } = await signedInAda(app);
      const spaceId = await personalSpaceOf(db, userId);

      const created = await projects.createProject({ spaceId, name: "  Site vitrine  " });

      expect(created).toEqual(
        ok({
          id: expect.stringMatching(UUID),
          spaceId,
          name: "Site vitrine",
          createdAt: expect.any(Date),
        }),
      );
      const listed = await projects.listProjects({ spaceId });
      expect(listed.ok && listed.value.map(({ name }) => name)).toEqual(["Site vitrine"]);
    }));

  it("un espace Free à 3 projets donne plan_required avec la limite", () =>
    withIdentityApp(async (app, db) => {
      const { userId, projects } = await signedInAda(app);
      const spaceId = await personalSpaceOf(db, userId);
      for (const name of ["Un", "Deux", "Trois"]) {
        await projects.createProject({ spaceId, name });
      }

      expect(await projects.createProject({ spaceId, name: "Quatre" })).toEqual(
        err({ reason: "plan_required", limit: 3 }),
      );
    }));

  it("sans session, la création donne unauthenticated", () =>
    withIdentityApp(async (app, db) => {
      const { userId } = await signedInAda(app);
      const spaceId = await personalSpaceOf(db, userId);
      const anonymous = createProjects({
        apiUrl: BASE_URL,
        fetch: makeApiBrowser(app, { ip: makeClientIp() }),
      });

      expect(await anonymous.createProject({ spaceId, name: "Site vitrine" })).toEqual(
        err("unauthenticated"),
      );
    }));

  it("un espace inconnu donne not_found", () =>
    withIdentityApp(async (app) => {
      const { projects } = await signedInAda(app);

      expect(
        await projects.createProject({ spaceId: UNKNOWN_SPACE_ID, name: "Site vitrine" }),
      ).toEqual(err("not_found"));
    }));

  it("un éditeur d'un espace Team donne forbidden", () =>
    withIdentityApp(async (app, db) => {
      const { userId, projects } = await signedInAda(app);
      const spaceId = await seedTeamSpaceWith(db, { userId, role: "editor" });

      expect(await projects.createProject({ spaceId, name: "Site vitrine" })).toEqual(
        err("forbidden"),
      );
    }));
});

describe("liste des projets d'un espace par l'app web, contre la vraie API (ADR 0044 §6)", () => {
  it("un membre retrouve les projets qu'il vient de créer, par ordre de nom, sans purge", () =>
    withIdentityApp(async (app, db) => {
      const { userId, projects } = await signedInAda(app);
      const spaceId = await personalSpaceOf(db, userId);
      await projects.createProject({ spaceId, name: "Site vitrine" });
      await projects.createProject({ spaceId, name: "Application" });

      const listed = await projects.listProjects({ spaceId });

      expect(listed).toEqual(
        ok([
          {
            id: expect.stringMatching(UUID),
            spaceId,
            name: "Application",
            createdAt: expect.any(Date),
            historyPurgedAt: undefined,
          },
          {
            id: expect.stringMatching(UUID),
            spaceId,
            name: "Site vitrine",
            createdAt: expect.any(Date),
            historyPurgedAt: undefined,
          },
        ]),
      );
    }));

  it("un espace sans projet donne une liste vide", () =>
    withIdentityApp(async (app, db) => {
      const { userId, projects } = await signedInAda(app);
      const spaceId = await personalSpaceOf(db, userId);

      expect(await projects.listProjects({ spaceId })).toEqual(ok([]));
    }));

  it("l'espace personnel d'un autre membre donne not_found", () =>
    withIdentityApp(async (app, db) => {
      const { projects } = await signedInAda(app);
      const graceId = await signUp(app, makeClientIp(), GRACE);
      const graceSpaceId = await personalSpaceOf(db, graceId);

      expect(await projects.listProjects({ spaceId: graceSpaceId })).toEqual(err("not_found"));
    }));

  it("sans session, la liste donne unauthenticated", () =>
    withIdentityApp(async (app, db) => {
      const { userId } = await signedInAda(app);
      const spaceId = await personalSpaceOf(db, userId);
      const anonymous = createProjects({
        apiUrl: BASE_URL,
        fetch: makeApiBrowser(app, { ip: makeClientIp() }),
      });

      expect(await anonymous.listProjects({ spaceId })).toEqual(err("unauthenticated"));
    }));
});

describe("lecture d'un projet seul par l'app web, contre la vraie API", () => {
  it("un membre lit le projet qu'il vient de créer, avec son espace et sans purge", () =>
    withIdentityApp(async (app, db) => {
      const { spaceId, projectId, projects } = await seedProjectOfAda(app, db);

      expect(await projects.readProject({ projectId })).toEqual(
        ok({
          id: projectId,
          spaceId,
          name: "Site vitrine",
          createdAt: expect.any(Date),
          historyPurgedAt: undefined,
          lastFigmaSurveyAt: undefined,
        }),
      );
    }));

  it("après une déclaration d'état Figma par l'IA, le membre lit la date du dernier relevé", () => {
    const declaredAt = new Date("2026-11-16T10:30:00.000Z");
    return withIdentityApp(
      async (app, db) => {
        const { userId, projectId, projects } = await seedProjectOfAda(app, db);
        const { accessToken } = await obtainAccessToken(app, { user: ADA, registeredId: userId });
        await addToken(app, { accessToken, projectId, token: makeColorToken() });
        await callMcp(app, {
          token: accessToken,
          method: "tools/call",
          params: {
            name: "declare_figma_states",
            arguments: { projectId, states: [{ name: makeColorToken().name, state: "synced" }] },
          },
        });

        expect(await projects.readProject({ projectId })).toEqual(
          ok(expect.objectContaining({ lastFigmaSurveyAt: declaredAt })),
        );
      },
      { clock: () => declaredAt },
    );
  });

  it("le projet d'un espace dont on n'est pas membre donne not_found", () =>
    withIdentityApp(async (app, db) => {
      const { projectId } = await seedProjectOfAda(app, db);
      const grace = await signedIn(app, GRACE);

      expect(await grace.projects.readProject({ projectId })).toEqual(err("not_found"));
    }));
});

const FIGMA_KEY = "aB3dE5fG7hI9jK1lM3nO5p";
const FIGMA_URL = `https://www.figma.com/design/${FIGMA_KEY}/Design-system`;

describe("fichier Figma d'un projet par l'app web, contre la vraie API (ADR 0059 §4)", () => {
  it("un membre renseigne puis retire le fichier Figma, que la lecture du projet rend", () =>
    withIdentityApp(async (app, db) => {
      const { projectId, projects } = await seedProjectOfAda(app, db);

      const set = await projects.setFigmaFile({ projectId, url: FIGMA_URL });
      const read = await projects.readProject({ projectId });
      const removed = await projects.setFigmaFile({ projectId, url: null });

      const figmaFile = { url: FIGMA_URL, key: FIGMA_KEY };
      expect(set).toEqual(ok(figmaFile));
      expect(read).toEqual(ok(expect.objectContaining({ figmaFile })));
      expect(removed).toEqual(ok(undefined));
    }));

  it("le projet d'un espace dont on n'est pas membre donne not_found", () =>
    withIdentityApp(async (app, db) => {
      const { projectId } = await seedProjectOfAda(app, db);
      const grace = await signedIn(app, GRACE);

      expect(await grace.projects.setFigmaFile({ projectId, url: FIGMA_URL })).toEqual(
        err("not_found"),
      );
    }));
});
