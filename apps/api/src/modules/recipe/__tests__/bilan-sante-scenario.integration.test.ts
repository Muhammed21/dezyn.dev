import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { type App, BASE_URL, callMcp, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { addToken, makeColorToken, PRIMARY_BLUE } from "#testing/token-fixtures.ts";
import { TokensOutput } from "@repo/contracts";

const BILAN_DAY = new Date("2026-11-25T09:00:00Z");

const WHITE = { colorSpace: "srgb", components: [1, 1, 1], alpha: 1, hex: "#ffffff" };

const DARK = { colorSpace: "srgb", components: [0.1, 0.1, 0.1], alpha: 1, hex: "#1a1a1a" };

type Member = { readonly accessToken: string; readonly projectId: string };

type ReadToken = z.infer<typeof TokensOutput>["tokens"][number];

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
    params: { name: "bilan_sante", arguments: { projectId } },
  });
  const { result } = await response.json();
  const text: string = result.messages[0].content.text;
  const dated = /« Bilan de santé du (.+?) : <A> doublons/.exec(text);
  if (dated?.[1] === undefined) {
    throw new Error("La recette ne date pas l'intention");
  }
  return dated[1];
};

const plural = (count: number, singular: string, several: string) =>
  `${count} ${count === 1 ? singular : several}`;

const intentOf = ({ date, aliases, pairs }: { date: string; aliases: number; pairs: number }) =>
  `Bilan de santé du ${date} : ${[
    aliases > 0
      ? plural(aliases, "doublon remplacé par un alias", "doublons remplacés par un alias")
      : undefined,
    pairs > 0
      ? plural(pairs, "paire de contraste déclarée", "paires de contraste déclarées")
      : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(", ")}`;

const aliasOf = (value: unknown): string | undefined => {
  const cited = typeof value === "string" ? /^\{(.+)\}$/.exec(value) : null;
  return cited?.[1];
};

const writableOf = ({ name, $type, $value, modes, $description, $extensions }: ReadToken) => ({
  name,
  $type,
  ...($value === undefined ? {} : { $value }),
  ...(modes === undefined ? {} : { modes }),
  ...($description === undefined ? {} : { $description }),
  ...($extensions === undefined ? {} : { $extensions }),
});

const declaresPairs = ({ $extensions }: ReadToken) =>
  $extensions !== undefined && "dev.dezyn" in $extensions;

const aliasProposals = (tokens: readonly ReadToken[], pending: ReadonlySet<string>) => {
  const cited = new Set(
    tokens.flatMap(({ $value, modes }) =>
      (modes === undefined ? [$value] : Object.values(modes)).flatMap(
        (value) => aliasOf(value) ?? [],
      ),
    ),
  );
  return tokens.flatMap((token) => {
    const group = [token.name, ...(token.duplicates ?? [])];
    const sources = group.filter((name) => cited.has(name));
    const [source] = sources;
    if (sources.length !== 1 || source === token.name || pending.has(token.name)) {
      return [];
    }
    return [{ ...writableOf(token), $value: `{${source}}` }];
  });
};

const pairProposals = (
  tokens: readonly ReadToken[],
  { pending, aliased }: { pending: ReadonlySet<string>; aliased: ReadonlySet<string> },
) => {
  const backgrounds = tokens.filter(({ name }) => name.includes("fond"));
  const [background] = backgrounds;
  if (backgrounds.length !== 1 || background === undefined) {
    return [];
  }
  return tokens
    .filter(
      (token) =>
        /texte|bordure/.test(token.name) &&
        !declaresPairs(token) &&
        !pending.has(token.name) &&
        !aliased.has(token.name),
    )
    .map((token) => ({
      ...writableOf(token),
      $extensions: {
        ...token.$extensions,
        "dev.dezyn": {
          contrastOn: [
            { on: `{${background.name}}`, usage: token.name.includes("texte") ? "text" : "ui" },
          ],
        },
      },
    }));
};

const playBilanSante = async (app: App, member: Member) => {
  const { projectId } = member;
  const date = await recipeDateOf(app, member);
  const { tokens, proposals = [] } = TokensOutput.parse(
    await callTool(app, {
      ...member,
      name: "read_tokens",
      args: { projectId, includeProposals: true },
    }),
  );
  await callTool(app, { ...member, name: "check_contrast", args: { projectId } });
  const pending = new Set(proposals.map(({ name }) => name));
  const aliases = aliasProposals(tokens, pending);
  const pairs = pairProposals(tokens, {
    pending,
    aliased: new Set(aliases.map(({ name }) => name)),
  });
  const written = [...aliases, ...pairs];
  if (written.length === 0) {
    return;
  }
  const opened = await callTool(app, {
    ...member,
    name: "open_proposal_batch",
    args: {
      projectId,
      recipe: "bilan_sante",
      intent: intentOf({ date, aliases: aliases.length, pairs: pairs.length }),
    },
  });
  const batchId: string = opened.batch.id;
  await callTool(app, {
    ...member,
    name: "write_tokens",
    args: { projectId, batchId, tokens: written },
  });
  await callTool(app, { ...member, name: "close_proposal_batch", args: { projectId, batchId } });
};

const seedBilanProject = async (
  app: App,
  db: Parameters<typeof seedProject>[1],
  { validated }: { readonly validated: readonly ReturnType<typeof makeColorToken>[] },
) => {
  const member = await seedProject(app, db);
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

const onlyBatchOf = async (app: App, member: Member) => {
  const batches = await batchesOf(app, member);
  expect(batches).toHaveLength(1);
  const response = await app.request(`${BASE_URL}/v1/proposal-batches/${batches[0].id}`, {
    headers: { authorization: `Bearer ${member.accessToken}` },
  });
  return response.json();
};

describe("un bilan de santé joué par un faux client qui suit la recette (spec #425)", () => {
  it("n'ouvre aucun lot sur un projet sain", () =>
    withIdentityApp(
      async (app, db) => {
        const member = await seedBilanProject(app, db, {
          validated: [
            makeColorToken({ name: "couleur.fond", $value: WHITE }),
            makeColorToken({
              name: "couleur.texte",
              $value: DARK,
              $extensions: { "dev.dezyn": { contrastOn: ["{couleur.fond}"] } },
            }),
          ],
        });

        await playBilanSante(app, member);

        expect(await batchesOf(app, member)).toEqual([]);
      },
      { clock: () => BILAN_DAY },
    ));

  it("remplace un doublon par un alias vers sa source unique, dans un seul lot à l'intention exacte", () =>
    withIdentityApp(
      async (app, db) => {
        const member = await seedBilanProject(app, db, {
          validated: [
            makeColorToken({ name: "couleur.marque", $value: PRIMARY_BLUE }),
            makeColorToken({ name: "couleur.lien", $value: "{couleur.marque}" }),
            makeColorToken({ name: "couleur.bouton", $value: PRIMARY_BLUE }),
          ],
        });

        await playBilanSante(app, member);
        const batch = await onlyBatchOf(app, member);

        expect(batch).toMatchObject({
          intent: "Bilan de santé du 25 nov. : 1 doublon remplacé par un alias",
          recipe: "bilan_sante",
          state: "closed",
          proposals: [
            {
              name: "couleur.bouton",
              kind: "update",
              proposed: { $type: "color", $value: "{couleur.marque}" },
            },
          ],
        });
      },
      { clock: () => BILAN_DAY },
    ));

  it("propose la paire manquante d'un texte sur son fond, sans rien changer d'autre au token", () =>
    withIdentityApp(
      async (app, db) => {
        const member = await seedBilanProject(app, db, {
          validated: [
            makeColorToken({ name: "couleur.fond", $value: WHITE }),
            makeColorToken({
              name: "couleur.texte",
              $value: DARK,
              $description: "Texte courant",
              $extensions: { "com.figma": { scopes: ["TEXT_FILL"] } },
            }),
          ],
        });

        await playBilanSante(app, member);
        const batch = await onlyBatchOf(app, member);
        const [proposal] = batch.proposals;

        expect(batch).toMatchObject({
          intent: "Bilan de santé du 25 nov. : 1 paire de contraste déclarée",
          recipe: "bilan_sante",
          state: "closed",
        });
        expect(batch.proposals).toHaveLength(1);
        expect(proposal.proposed).toEqual({
          ...proposal.validated,
          $extensions: {
            "com.figma": { scopes: ["TEXT_FILL"] },
            "dev.dezyn": { contrastOn: [{ on: "{couleur.fond}", usage: "text" }] },
          },
        });
        expect(proposal.validated).toMatchObject({
          $description: "Texte courant",
          $extensions: { "com.figma": { scopes: ["TEXT_FILL"] } },
        });
      },
      { clock: () => BILAN_DAY },
    ));
});
