import type { PostgresDatabase } from "#db";
import { type App, callMcp } from "#testing/authorization-flow.ts";
import { seedModes } from "#testing/project-fixtures.ts";
import { addToken } from "#testing/token-fixtures.ts";

import type { ScenarioFixture } from "./scenario.ts";

type Member = { readonly accessToken: string; readonly projectId: string };

const failureTextOf = (result: unknown): string => JSON.stringify(result) ?? "réponse vide";

const structuredContentOf = (name: string, result: unknown): unknown => {
  if (typeof result !== "object" || result === null) {
    throw new Error(`${name} : réponse inattendue ${failureTextOf(result)}`);
  }
  if ("isError" in result && result.isError === true) {
    throw new Error(`${name} : ${failureTextOf(result)}`);
  }
  return "structuredContent" in result ? result.structuredContent : undefined;
};

export const scenarioFixtureOf = ({
  app,
  db,
  member,
}: {
  readonly app: App;
  readonly db: PostgresDatabase;
  readonly member: Member;
}): ScenarioFixture => ({
  projectId: member.projectId,
  callTool: async (name, args) => {
    const response = await callMcp(app, {
      token: member.accessToken,
      method: "tools/call",
      params: { name, arguments: args },
    });
    const { result } = await response.json();
    return structuredContentOf(name, result);
  },
  addToken: async (token) => {
    const response = await addToken(app, { ...member, token });
    if (!response.ok) {
      throw new Error(`Token refusé : ${await response.text()}`);
    }
  },
  seedModes: (modes) => seedModes(db, { projectId: member.projectId, modes }),
});
