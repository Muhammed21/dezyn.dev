import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "vitest";

import { type App, BASE_URL, callMcp, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { addToken, makeColorToken, PRIMARY_BLUE } from "#testing/token-fixtures.ts";
import { TokensOutput } from "@repo/contracts";

const RELEVE_DAY = new Date("2026-11-25T09:00:00Z");

const FIGMA_URL = "https://www.figma.com/design/aB3dE5fG7hI9jK1lM3nO5p/Design-system";

const ALERT_RED = { colorSpace: "srgb", components: [0.8, 0.1, 0.1], alpha: 1, hex: "#cc1a1a" };

const MINT_GREEN = { colorSpace: "srgb", components: [0.2, 0.8, 0.6], alpha: 1, hex: "#33cc99" };

type FigmaVariable = { readonly name: string; readonly $type: string; readonly $value: unknown };

const makeFigmaVariable = (overrides: Partial<FigmaVariable> = {}): FigmaVariable => ({
  name: "couleur.fond.primaire",
  $type: "color",
  $value: PRIMARY_BLUE,
  ...overrides,
});

type Member = { readonly accessToken: string; readonly projectId: string };

const callTool = async (
  app: App,
  { accessToken, name, args }: Member & { name: string; args: object },
) => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const { result } = await response.json();
  if (result.isError === true) {
    throw new Error(`${name} : ${JSON.stringify(result.content)}`);
  }
  return result.structuredContent;
};

const recipeDateOf = async (app: App, { accessToken, projectId }: Member): Promise<string> => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "prompts/get",
    params: { name: "releve_figma", arguments: { projectId } },
  });
  const { result } = await response.json();
  const text: string = result.messages[0].content.text;
  const dated = /« Relevé Figma du (.+?) : <N> nouveaux tokens/.exec(text);
  if (dated?.[1] === undefined) {
    throw new Error("La recette ne date pas l'intention");
  }
  return dated[1];
};

const plural = (count: number, singular: string, several: string) =>
  `${count} ${count === 1 ? singular : several}`;

const intentOf = ({ date, created, changed }: { date: string; created: number; changed: number }) =>
  `Relevé Figma du ${date} : ${[
    created > 0 ? plural(created, "nouveau token", "nouveaux tokens") : undefined,
    changed > 0 ? plural(changed, "valeur changée", "valeurs changées") : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(", ")}`;

const playReleveFigma = async (
  app: App,
  member: Member & { readonly figma: readonly FigmaVariable[] },
) => {
  const { projectId, figma } = member;
  const date = await recipeDateOf(app, member);
  const { tokens, proposals = [] } = TokensOutput.parse(
    await callTool(app, {
      ...member,
      name: "read_tokens",
      args: { projectId, includeProposals: true },
    }),
  );
  const pendingOf = (name: string) => proposals.find((proposal) => proposal.name === name);
  const created = figma.filter(
    (variable) =>
      !tokens.some(({ name }) => name === variable.name) &&
      !isDeepStrictEqual(pendingOf(variable.name)?.token.$value, variable.$value),
  );
  const compared = tokens.map((token) => {
    const variable = figma.find(({ name }) => name === token.name);
    if (variable === undefined) {
      return { state: { name: token.name, state: "missing_in_figma" }, changed: false };
    }
    if (isDeepStrictEqual(variable.$value, token.$value)) {
      return { state: { name: token.name, state: "synced" }, changed: false };
    }
    return {
      state: { name: token.name, state: "diverged", figmaValue: { $value: variable.$value } },
      changed: !isDeepStrictEqual(pendingOf(token.name)?.token.$value, variable.$value),
    };
  });
  const changed = compared.filter((comparison) => comparison.changed).length;
  const states = compared.map(({ state }) => state);
  if (created.length + changed === 0) {
    if (states.length > 0) {
      await callTool(app, { ...member, name: "declare_figma_states", args: { projectId, states } });
    }
    return;
  }
  const opened = await callTool(app, {
    ...member,
    name: "open_proposal_batch",
    args: {
      projectId,
      recipe: "releve_figma",
      intent: intentOf({ date, created: created.length, changed }),
    },
  });
  const batchId: string = opened.batch.id;
  if (created.length > 0) {
    await callTool(app, {
      ...member,
      name: "write_tokens",
      args: { projectId, batchId, tokens: created },
    });
  }
  if (states.length > 0) {
    await callTool(app, {
      ...member,
      name: "declare_figma_states",
      args: { projectId, batchId, states },
    });
  }
  await callTool(app, { ...member, name: "close_proposal_batch", args: { projectId, batchId } });
};

const seedReleveProject = async (
  app: App,
  db: Parameters<typeof seedProject>[1],
  { validated }: { readonly validated: readonly ReturnType<typeof makeColorToken>[] },
) => {
  const member = await seedProject(app, db);
  await callTool(app, {
    ...member,
    name: "set_project_figma_file",
    args: { projectId: member.projectId, url: FIGMA_URL },
  });
  await validated.reduce<Promise<unknown>>(
    (previous, token) => previous.then(() => addToken(app, { ...member, token })),
    Promise.resolve(),
  );
  return member;
};

const batchesOf = async (app: App, { accessToken, projectId }: Member) => {
  const response = await app.request(`${BASE_URL}/v1/projects/${projectId}/proposal-batches`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const { batches } = await response.json();
  return batches;
};

const batchOf = async (
  app: App,
  { accessToken, batchId }: { accessToken: string; batchId: string },
) =>
  (
    await app.request(`${BASE_URL}/v1/proposal-batches/${batchId}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
  ).json();

const figmaStatesOf = async (app: App, member: Member) => {
  const { tokens } = TokensOutput.parse(
    await callTool(app, { ...member, name: "read_tokens", args: { projectId: member.projectId } }),
  );
  return Object.fromEntries(tokens.map(({ name, figma }) => [name, figma?.state]));
};

describe("un relevé Figma joué par un faux client qui suit la recette (ADR 0059 §5)", () => {
  it("n'ouvre aucun lot quand rien n'a changé, et déclare chaque token comparé synchronisé", () =>
    withIdentityApp(
      async (app, db) => {
        const member = await seedReleveProject(app, db, { validated: [makeColorToken()] });

        await playReleveFigma(app, { ...member, figma: [makeFigmaVariable()] });

        expect(await batchesOf(app, member)).toEqual([]);
        expect(await figmaStatesOf(app, member)).toEqual({ "couleur.fond.primaire": "synced" });
      },
      { clock: () => RELEVE_DAY },
    ));

  it("met les propositions de création et les valeurs divergentes dans le même lot que l'intention", () =>
    withIdentityApp(
      async (app, db) => {
        const member = await seedReleveProject(app, db, {
          validated: [makeColorToken(), makeColorToken({ name: "couleur.texte.lien" })],
        });

        await playReleveFigma(app, {
          ...member,
          figma: [
            makeFigmaVariable({ $value: ALERT_RED }),
            makeFigmaVariable({ name: "couleur.alerte", $value: ALERT_RED }),
            makeFigmaVariable({ name: "couleur.succes", $value: MINT_GREEN }),
          ],
        });
        const [batch] = await batchesOf(app, member);
        const reviewed = await batchOf(app, { ...member, batchId: batch.id });

        expect(await batchesOf(app, member)).toHaveLength(1);
        expect(reviewed).toMatchObject({
          intent: "Relevé Figma du 25 nov. : 2 nouveaux tokens, 1 valeur changée",
          recipe: "releve_figma",
          state: "closed",
        });
        expect(
          reviewed.proposals
            .map(({ name, kind }: { name: string; kind: string }) => `${kind} ${name}`)
            .toSorted(),
        ).toEqual([
          "create couleur.alerte",
          "create couleur.succes",
          "update couleur.fond.primaire",
        ]);
        expect(await figmaStatesOf(app, member)).toEqual({
          "couleur.fond.primaire": "diverged",
          "couleur.texte.lien": "missing_in_figma",
        });
      },
      { clock: () => RELEVE_DAY },
    ));

  it("ne recrée rien quand les nouveautés sont déjà en attente depuis le relevé précédent", () =>
    withIdentityApp(
      async (app, db) => {
        const member = await seedReleveProject(app, db, { validated: [makeColorToken()] });
        const figma = [
          makeFigmaVariable({ $value: ALERT_RED }),
          makeFigmaVariable({ name: "couleur.alerte", $value: ALERT_RED }),
        ];
        await playReleveFigma(app, { ...member, figma });
        const [first] = await batchesOf(app, member);
        const before = await batchOf(app, { ...member, batchId: first.id });

        await playReleveFigma(app, { ...member, figma });

        expect(await batchesOf(app, member)).toHaveLength(1);
        expect(await batchOf(app, { ...member, batchId: first.id })).toEqual(before);
        expect(await figmaStatesOf(app, member)).toEqual({ "couleur.fond.primaire": "diverged" });
      },
      { clock: () => RELEVE_DAY },
    ));
});
