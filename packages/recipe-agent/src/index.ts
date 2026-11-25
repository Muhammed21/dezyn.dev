import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Options, query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Result } from "@repo/result";

import {
  linesOfMessage,
  type RecipeAgentFailure,
  type RecipeAgentRun,
  type Session,
  verdictOf,
} from "./session.ts";

export type { RecipeAgentFailure, RecipeAgentRun } from "./session.ts";

export type RemoteMcpServer = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
};

export type AgentQuery = (params: {
  readonly prompt: string;
  readonly options: Options;
}) => AsyncIterable<unknown>;

const isEnclosingSessionVariable = (name: string): boolean =>
  name === "CLAUDECODE" || name.startsWith("CLAUDE_CODE_");

const agentEnvironmentOf = (
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> =>
  Object.fromEntries(
    Object.entries(environment).filter(([name]) => !isEnclosingSessionVariable(name)),
  );

const optionsOf = ({
  model,
  systemPrompt,
  remoteServers,
  localServers,
  maxTurns,
  workspace,
  log,
  environment,
}: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly model: string;
  readonly systemPrompt: string;
  readonly remoteServers: Readonly<Record<string, RemoteMcpServer>>;
  readonly localServers: Readonly<Record<string, McpServer>>;
  readonly maxTurns: number;
  readonly workspace: string;
  readonly log: ((line: string) => void) | undefined;
}): Options => ({
  env: agentEnvironmentOf(environment),
  model,
  cwd: workspace,
  systemPrompt,
  tools: [],
  allowedTools: [...Object.keys(remoteServers), ...Object.keys(localServers)].map(
    (name) => `mcp__${name}`,
  ),
  permissionMode: "dontAsk",
  settingSources: [],
  strictMcpConfig: true,
  persistSession: false,
  maxTurns,
  mcpServers: {
    ...Object.fromEntries(
      Object.entries(remoteServers).map(([name, { url, headers }]) => [
        name,
        { type: "http" as const, url, headers: { ...headers } },
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(localServers).map(([name, instance]) => [
        name,
        { type: "sdk" as const, name, instance },
      ]),
    ),
  },
  ...(log === undefined
    ? {}
    : {
        stderr: (data: string) =>
          data
            .split("\n")
            .filter((line) => line.trim() !== "")
            .forEach((line) => log(`stderr : ${line}`)),
      }),
});

const collect = async (
  conversation: AsyncIterable<unknown>,
  log: ((line: string) => void) | undefined,
): Promise<Session> => {
  const messages: unknown[] = [];
  try {
    for await (const message of conversation) {
      messages.push(message);
      linesOfMessage(message).forEach((line) => log?.(line));
    }
    return { messages, thrown: undefined };
  } catch (error) {
    const thrown = error instanceof Error ? error.message : String(error);
    log?.(`erreur du SDK : ${thrown}`);
    return { messages, thrown };
  }
};

export const followRecipe = async ({
  model,
  systemPrompt,
  prompt,
  remoteServers,
  localServers,
  maxTurns,
  requireToolCall,
  log,
  query = sdkQuery,
  environment = process.env,
}: {
  readonly model: string;
  readonly systemPrompt: string;
  readonly prompt: string;
  readonly remoteServers: Readonly<Record<string, RemoteMcpServer>>;
  readonly localServers: Readonly<Record<string, McpServer>>;
  readonly maxTurns: number;
  readonly requireToolCall: boolean;
  readonly log?: ((line: string) => void) | undefined;
  readonly query?: AgentQuery;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}): Promise<Result<RecipeAgentRun, RecipeAgentFailure>> => {
  const workspace = await mkdtemp(join(tmpdir(), "dezyn-recette-"));
  try {
    const options = optionsOf({
      model,
      systemPrompt,
      remoteServers,
      localServers,
      maxTurns,
      workspace,
      log,
      environment,
    });
    const session = await collect(
      (async function* () {
        yield* query({ prompt, options });
      })(),
      log,
    );
    return verdictOf({ session, requireToolCall });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
};
