import { describe, expect, it } from "vitest";

import {
  type App,
  callMcp,
  GRACE,
  obtainAccessToken,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { seedModes, seedProject } from "#testing/project-fixtures.ts";
import { addToken, historyOf, makeColorToken } from "#testing/token-fixtures.ts";

const BLACK = { colorSpace: "srgb", components: [0, 0, 0] };

const WHITE = { colorSpace: "srgb", components: [1, 1, 1] };

const HALF_BLACK = { ...BLACK, alpha: 0.5 };

const HALF_WHITE = { ...WHITE, alpha: 0.5 };

const makeModalColor = (name: string, modes: Record<string, unknown>, contrastOn?: unknown[]) => ({
  name,
  $type: "color",
  modes,
  ...(contrastOn === undefined ? {} : { $extensions: { "dev.dezyn": { contrastOn } } }),
});

const checkContrast = async (
  app: App,
  { accessToken, projectId }: { accessToken: string; projectId: string },
) => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: { name: "check_contrast", arguments: { projectId } },
  });
  return (await response.json()).result;
};

const seedTokens = (
  app: App,
  seeded: { accessToken: string; projectId: string },
  tokens: readonly unknown[],
) =>
  tokens.reduce<Promise<void>>(async (previous, token) => {
    await previous;
    const response = await addToken(app, { ...seeded, token });
    expect(response.status).toBe(201);
  }, Promise.resolve());

describe("l'IA obtient le contraste de toutes les paires déclarées par check_contrast (ADR 0061 §4)", () => {
  it("rend chaque paire dans chaque mode, alias résolus, premier plan composé, fond translucide indéterminé, et l'appel entre dans l'historique", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await seedModes(db, { projectId: seeded.projectId, modes: ["clair", "sombre"] });
      await seedTokens(app, seeded, [
        makeModalColor("couleur.noir", { clair: BLACK, sombre: BLACK }),
        makeModalColor("couleur.blanc", { clair: WHITE, sombre: WHITE }),
        makeModalColor("couleur.fond", { clair: "{couleur.blanc}", sombre: "{couleur.noir}" }),
        makeModalColor("couleur.voile", { clair: HALF_WHITE, sombre: HALF_WHITE }),
        makeModalColor("couleur.texte", { clair: "{couleur.noir}", sombre: "{couleur.blanc}" }, [
          "{couleur.fond}",
          { on: "{couleur.voile}", usage: "large-text" },
        ]),
        makeModalColor("couleur.bordure", { clair: HALF_BLACK, sombre: HALF_WHITE }, [
          { on: "{couleur.fond}", usage: "ui" },
        ]),
      ]);

      const result = await checkContrast(app, seeded);

      const translucent = {
        token: "couleur.texte",
        background: "couleur.voile",
        usage: "large-text",
        ratio: null,
        threshold: 3,
        verdict: "indeterminate",
        reason: "translucent_background",
      };
      const pairs = [
        ...[
          ["clair", 3.97],
          ["sombre", 5.28],
        ].map(([mode, ratio]) => ({
          token: "couleur.bordure",
          background: "couleur.fond",
          usage: "ui",
          mode,
          ratio,
          threshold: 3,
          verdict: "pass",
        })),
        ...["clair", "sombre"].map((mode) => ({
          token: "couleur.texte",
          background: "couleur.fond",
          usage: "text",
          mode,
          ratio: 21,
          threshold: 4.5,
          verdict: "pass",
        })),
        { ...translucent, mode: "clair" },
        { ...translucent, mode: "sombre" },
      ];
      expect(result.structuredContent).toEqual({ pairs });
      expect(JSON.parse(result.content[0].text)).toEqual({ pairs });
      expect((await historyOf(app, seeded))[0]).toMatchObject({
        action: "mcp.check_contrast",
        projectId: seeded.projectId,
        after: { outcome: "success", input: {} },
      });
    }));

  it("un projet sans paire rend une liste vide", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await addToken(app, { ...seeded, token: makeColorToken() });

      const result = await checkContrast(app, seeded);

      expect(result.structuredContent).toEqual({ pairs: [] });
    }));

  it("un non-membre reçoit « Projet introuvable », comme pour un projet inexistant", () =>
    withIdentityApp(async (app, db) => {
      const { projectId } = await seedProject(app, db);
      const grace = await obtainAccessToken(app, { user: GRACE });

      const result = await checkContrast(app, { accessToken: grace.accessToken, projectId });

      expect(result).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "Projet introuvable" }],
      });
      expect(result.structuredContent).toBeUndefined();
    }));
});
