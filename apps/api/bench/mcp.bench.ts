import { bench, describe } from "vitest";
import { getCurrentSuite } from "vitest/suite";

import {
  BASE_URL,
  callMcp,
  type IdentityApp,
  startIdentityApp,
} from "#testing/authorization-flow.ts";
import {
  benchGroupOf,
  type SqlQueries,
  sqlQueriesOf,
  writeBenchSqlQueries,
} from "#testing/bench-sql-queries.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { addToken, makeColorToken } from "#testing/token-fixtures.ts";

const TOKEN_COUNT = 130;

const indexes = Array.from({ length: TOKEN_COUNT }, (_, index) => index);

const makeColorOf = (seed: number) => {
  const channels = [16, 8, 0].map((shift) => ((seed % 0xffffff) >> shift) & 0xff);
  return {
    colorSpace: "srgb",
    components: channels.map((channel) => channel / 255),
    alpha: 1,
    hex: `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`,
  };
};

const makePaletteTokens = (offset: number) =>
  indexes.map((index) =>
    makeColorToken({ name: `couleur.palette.${index}`, $value: makeColorOf(index + offset) }),
  );

type OpenProject = {
  readonly opened: IdentityApp;
  readonly accessToken: string;
  readonly projectId: string;
};

const openProject = async (): Promise<OpenProject> => {
  const opened = await startIdentityApp();
  const seeded = await seedProject(opened.app, opened.db);
  await makePaletteTokens(0).reduce(async (previous, token) => {
    await previous;
    const added = await addToken(opened.app, { ...seeded, token });
    if (added.status !== 201) {
      throw new Error(`Token du bench refusé : ${await added.text()}`);
    }
  }, Promise.resolve());
  return { opened, accessToken: seeded.accessToken, projectId: seeded.projectId };
};

const callTool = async (
  { opened, accessToken }: OpenProject,
  { name, args }: { readonly name: string; readonly args: object },
) => {
  const response = await callMcp(opened.app, {
    token: accessToken,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const body = await response.json();
  if (response.status !== 200 || body.result === undefined || body.result.isError === true) {
    throw new Error(`${name} a échoué : ${JSON.stringify(body)}`);
  }
  return { content: body.result.structuredContent, response };
};

const validateBatch = async ({ opened, accessToken }: OpenProject, batchId: string) => {
  const response = await opened.app.request(`${BASE_URL}/v1/proposal-batches/${batchId}/validate`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ rejected: [] }),
  });
  if (response.status !== 200) {
    throw new Error(`La validation du lot a échoué : ${await response.text()}`);
  }
  return response;
};

const projectBench = ({
  name,
  run,
}: {
  readonly name: string;
  readonly run: (project: OpenProject, round: number) => Promise<readonly Response[]>;
}) => {
  const { file, suite } = getCurrentSuite();
  if (file === undefined || suite === undefined) {
    throw new Error("Un bench de projet se déclare dans un describe");
  }
  const group = benchGroupOf({ file, suite });
  const fixture: { project?: OpenProject; round: number; sqlQueries?: SqlQueries } = { round: 0 };
  bench(
    name,
    async () => {
      fixture.round += 1;
      if (fixture.project === undefined) {
        throw new Error("Le projet du bench n'est pas ouvert");
      }
      fixture.sqlQueries = sqlQueriesOf(await run(fixture.project, fixture.round));
    },
    {
      setup: async (_task, mode) => {
        if (mode === "warmup") {
          fixture.project = await openProject();
        }
      },
      teardown: async (_task, mode) => {
        if (mode === "run") {
          if (fixture.sqlQueries !== undefined) {
            writeBenchSqlQueries({
              dir: process.cwd(),
              group,
              name,
              sqlQueries: fixture.sqlQueries,
            });
          }
          await fixture.project?.opened.close();
        }
      },
    },
  );
};

describe(`/v1/mcp sur un projet de ${TOKEN_COUNT} tokens`, () => {
  projectBench({
    name: "read_tokens",
    run: async (project) => {
      const { response } = await callTool(project, {
        name: "read_tokens",
        args: { projectId: project.projectId },
      });
      return [response];
    },
  });

  projectBench({
    name: "write_tokens, une proposition par token",
    run: async (project, round) => {
      const { response } = await callTool(project, {
        name: "write_tokens",
        args: { projectId: project.projectId, tokens: makePaletteTokens(round * TOKEN_COUNT) },
      });
      return [response];
    },
  });
});

describe(`/v1/proposal-batches/:id/validate sur un projet de ${TOKEN_COUNT} tokens`, () => {
  projectBench({
    name: `write_tokens, close_proposal_batch, puis validate de ${TOKEN_COUNT} créations`,
    run: async (project, round) => {
      const written = await callTool(project, {
        name: "write_tokens",
        args: {
          projectId: project.projectId,
          tokens: indexes.map((index) =>
            makeColorToken({ name: `couleur.lot${round}.${index}`, $value: makeColorOf(index) }),
          ),
        },
      });
      const closed = await callTool(project, {
        name: "close_proposal_batch",
        args: { projectId: project.projectId },
      });
      const validated = await validateBatch(project, written.content.batch.id);
      return [written.response, closed.response, validated];
    },
  });
});
