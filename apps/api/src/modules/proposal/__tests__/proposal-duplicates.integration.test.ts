import { describe, expect, it } from "vitest";

import {
  type App,
  BASE_URL,
  callMcp,
  GRACE,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { seedProject, seedProjectAsEditor } from "#testing/project-fixtures.ts";
import { addToken, makeColorToken } from "#testing/token-fixtures.ts";

const NIGHT_BLUE = { colorSpace: "srgb", components: [0.1, 0.2, 0.4] };

const BINDING_RULE =
  "Réutilise un token existant par alias ({nom.du.token}) plutôt que de recopier sa valeur ; ne crée un nouveau token que si aucun token ne porte déjà cette valeur.";

const writeTokens = async (
  app: App,
  {
    accessToken,
    projectId,
    tokens,
  }: { accessToken: string; projectId: string; tokens: readonly unknown[] },
) => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: { name: "write_tokens", arguments: { projectId, tokens } },
  });
  const { result } = await response.json();
  return result.structuredContent;
};

const duplicatesOf = (
  written: { proposals: { name: string; duplicates: string[] }[] },
  name: string,
) => written.proposals.find((proposal) => proposal.name === name)?.duplicates;

describe("write_tokens signale à l'IA les tokens qui portent déjà la valeur proposée", () => {
  it("une valeur égale à celle d'un token validé le nomme en doublon", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.bleu.nuit" }) });

      const written = await writeTokens(app, {
        ...seeded,
        tokens: [makeColorToken({ name: "couleur.fond" })],
      });

      expect(duplicatesOf(written, "couleur.fond")).toEqual(["couleur.bleu.nuit"]);
    }));

  it("une valeur égale à celle d'une proposition en attente la nomme en doublon", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await writeTokens(app, { ...seeded, tokens: [makeColorToken({ name: "couleur.bord" })] });

      const written = await writeTokens(app, {
        ...seeded,
        tokens: [makeColorToken({ name: "couleur.fond" })],
      });

      expect(duplicatesOf(written, "couleur.fond")).toEqual(["couleur.bord"]);
    }));

  it("deux tokens de même valeur dans un appel se nomment l'un l'autre", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);

      const written = await writeTokens(app, {
        ...seeded,
        tokens: [
          makeColorToken({ name: "couleur.fond" }),
          makeColorToken({ name: "couleur.bord" }),
        ],
      });

      expect(duplicatesOf(written, "couleur.fond")).toEqual(["couleur.bord"]);
      expect(duplicatesOf(written, "couleur.bord")).toEqual(["couleur.fond"]);
    }));

  it("une valeur unique, ou d'un autre type, n'a pas de doublon", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.bleu.nuit" }) });

      const written = await writeTokens(app, {
        ...seeded,
        tokens: [
          makeColorToken({ name: "couleur.fond", $value: NIGHT_BLUE }),
          { name: "espace.petit", $type: "dimension", $value: { value: 4, unit: "px" } },
        ],
      });

      expect(duplicatesOf(written, "couleur.fond")).toEqual([]);
      expect(duplicatesOf(written, "espace.petit")).toEqual([]);
    }));

  it("une proposition remplacée n'est plus un doublon", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await writeTokens(app, { ...seeded, tokens: [makeColorToken({ name: "couleur.bord" })] });
      await writeTokens(app, {
        ...seeded,
        tokens: [makeColorToken({ name: "couleur.bord", $value: NIGHT_BLUE })],
      });

      const written = await writeTokens(app, {
        ...seeded,
        tokens: [makeColorToken({ name: "couleur.fond" })],
      });

      expect(duplicatesOf(written, "couleur.fond")).toEqual([]);
    }));

  it("une proposition en attente d'un autre projet n'est pas un doublon", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      const other = await seedProjectAsEditor(app, db, { user: GRACE });
      await writeTokens(app, { ...other, tokens: [makeColorToken({ name: "couleur.bord" })] });

      const written = await writeTokens(app, {
        ...seeded,
        tokens: [makeColorToken({ name: "couleur.fond" })],
      });

      expect(duplicatesOf(written, "couleur.fond")).toEqual([]);
    }));

  it("une proposition qui référence un token n'est jamais un doublon", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.bleu.nuit" }) });

      const written = await writeTokens(app, {
        ...seeded,
        tokens: [
          { name: "couleur.fond", $type: "color", $value: "{couleur.bleu.nuit}" },
          { name: "couleur.bord", $type: "color", $value: "{couleur.bleu.nuit}" },
        ],
      });

      expect(duplicatesOf(written, "couleur.fond")).toEqual([]);
    }));

  it("un doublon avertit sans refuser : la proposition est créée", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.bleu.nuit" }) });

      const written = await writeTokens(app, {
        ...seeded,
        tokens: [makeColorToken({ name: "couleur.fond" })],
      });

      expect(written.proposals).toEqual([
        expect.objectContaining({ name: "couleur.fond", status: "proposed" }),
      ]);
    }));

  it.each(["write_tokens", "read_tokens"])(
    "la description de %s énonce la règle de liaison",
    (tool) =>
      withIdentityApp(async (app, db) => {
        const { accessToken } = await seedProject(app, db);

        const response = await callMcp(app, { token: accessToken, method: "tools/list" });
        const { result } = await response.json();

        expect(
          result.tools.find((listed: { name: string }) => listed.name === tool)?.description,
        ).toContain(BINDING_RULE);
      }),
  );
});

const readBatch = async (
  app: App,
  { accessToken, batchId }: { accessToken: string; batchId: string },
) => {
  const response = await app.request(`${BASE_URL}/v1/proposal-batches/${batchId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return response.json();
};

const reject = (
  app: App,
  { accessToken, proposalId }: { accessToken: string; proposalId: string },
) =>
  app.request(`${BASE_URL}/v1/proposals/${proposalId}/reject`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });

describe("la relecture d'un lot montre à l'éditeur les doublons de chaque proposition", () => {
  it("une proposition en attente nomme les tokens validés et en attente de même valeur", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      await addToken(app, { ...seeded, token: makeColorToken({ name: "couleur.bleu.nuit" }) });
      await writeTokens(app, { ...seeded, tokens: [makeColorToken({ name: "couleur.bord" })] });
      const written = await writeTokens(app, {
        ...seeded,
        tokens: [makeColorToken({ name: "couleur.fond" })],
      });

      const batch = await readBatch(app, { ...seeded, batchId: written.batch.id });

      expect(
        batch.proposals.map(({ name, duplicates }: { name: string; duplicates: string[] }) => ({
          name,
          duplicates,
        })),
      ).toEqual([
        { name: "couleur.bord", duplicates: ["couleur.bleu.nuit", "couleur.fond"] },
        { name: "couleur.fond", duplicates: ["couleur.bleu.nuit", "couleur.bord"] },
      ]);
    }));

  it("une proposition déjà relue n'a plus de doublons, et n'en est plus un", () =>
    withIdentityApp(async (app, db) => {
      const seeded = await seedProject(app, db);
      const written = await writeTokens(app, {
        ...seeded,
        tokens: [
          makeColorToken({ name: "couleur.bord" }),
          makeColorToken({ name: "couleur.fond" }),
        ],
      });
      await reject(app, { ...seeded, proposalId: written.proposals[0].id });

      const batch = await readBatch(app, { ...seeded, batchId: written.batch.id });

      expect(
        batch.proposals.map(({ name, duplicates }: { name: string; duplicates: string[] }) => ({
          name,
          duplicates,
        })),
      ).toEqual([
        { name: "couleur.bord", duplicates: [] },
        { name: "couleur.fond", duplicates: [] },
      ]);
    }));
});
