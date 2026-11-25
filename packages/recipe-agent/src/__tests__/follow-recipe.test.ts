import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";

import { type AgentQuery, followRecipe } from "../index.ts";

const makeInit = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  type: "system",
  subtype: "init",
  model: "claude-opus-5-5",
  apiKeySource: "ANTHROPIC_API_KEY",
  permissionMode: "dontAsk",
  tools: ["mcp__dezyn__list_tokens", "mcp__figma__get_local_variables"],
  mcp_servers: [
    { name: "dezyn", status: "connected" },
    { name: "figma", status: "connected" },
  ],
  ...overrides,
});

const makeToolUse = (name: string, input: unknown = {}) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id: `appel-${name}`, name, input }] },
});

const makeText = (text: string, overrides: Readonly<Record<string, unknown>> = {}) => ({
  type: "assistant",
  message: { content: [{ type: "text", text }] },
  ...overrides,
});

const makeToolResult = (text: string, isError: boolean) => ({
  type: "user",
  message: {
    content: [{ type: "tool_result", tool_use_id: "appel", is_error: isError, content: text }],
  },
});

const makeResult = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 6,
  total_cost_usd: 0.42,
  result: "Relevé terminé.",
  ...overrides,
});

const fakeQuery = (messages: readonly unknown[], failure?: Error): AgentQuery =>
  async function* () {
    yield* messages;
    if (failure !== undefined) {
      throw failure;
    }
  };

const queryWritingToStderr =
  (output: string): AgentQuery =>
  (params) => {
    params.options.stderr?.(output);
    return fakeQuery(SUCCESSFUL_SESSION)(params);
  };

const SUCCESSFUL_SESSION = [
  makeInit(),
  makeToolUse("mcp__figma__get_local_variables", { fileKey: "abc" }),
  makeToolUse("mcp__dezyn__declare_figma_states"),
  makeResult(),
];

const follow = ({
  query,
  requireToolCall = true,
  log,
  environment = { ANTHROPIC_API_KEY: "cle-de-test" },
}: {
  readonly query: AgentQuery;
  readonly requireToolCall?: boolean;
  readonly log?: (line: string) => void;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}) =>
  followRecipe({
    model: "claude-opus-5-5",
    systemPrompt: "Tu es l'IA du client.",
    prompt: "Suis la recette.",
    remoteServers: { dezyn: { url: "http://127.0.0.1:4000/v1/mcp", headers: {} } },
    localServers: { figma: new McpServer({ name: "figma", version: "0.0.0" }) },
    maxTurns: 80,
    requireToolCall,
    log,
    query,
    environment,
  });

const capture = () => {
  const lines: string[] = [];
  return { lines, log: (line: string) => lines.push(line) };
};

describe("faire suivre une recette à l'IA (ADR 0059 §3)", () => {
  it("rend le compte rendu, le coût, les tours et les outils MCP appelés d'une session réussie", async () => {
    expect(await follow({ query: fakeQuery(SUCCESSFUL_SESSION) })).toEqual({
      ok: true,
      value: {
        result: "Relevé terminé.",
        costUsd: 0.42,
        turns: 6,
        toolCalls: ["mcp__figma__get_local_variables", "mcp__dezyn__declare_figma_states"],
      },
    });
  });

  it("branche les serveurs MCP de la recette et n'autorise qu'eux", async () => {
    const calls: Parameters<AgentQuery>[0][] = [];
    const query: AgentQuery = (params) => {
      calls.push(params);
      return fakeQuery(SUCCESSFUL_SESSION)(params);
    };

    await follow({ query });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toBe("Suis la recette.");
    expect(calls[0]?.options).toMatchObject({
      model: "claude-opus-5-5",
      tools: [],
      allowedTools: ["mcp__dezyn", "mcp__figma"],
      permissionMode: "dontAsk",
      maxTurns: 80,
      mcpServers: {
        dezyn: { type: "http", url: "http://127.0.0.1:4000/v1/mcp" },
        figma: { type: "sdk", name: "figma" },
      },
    });
  });

  it("lance l'agent avec la clé d'API mais sans l'environnement d'une session Claude Code englobante", async () => {
    const calls: Parameters<AgentQuery>[0][] = [];
    const query: AgentQuery = (params) => {
      calls.push(params);
      return fakeQuery(SUCCESSFUL_SESSION)(params);
    };

    await follow({
      query,
      environment: {
        ANTHROPIC_API_KEY: "cle-de-test",
        PATH: "/usr/bin",
        CLAUDECODE: "1",
        CLAUDE_CODE_ENTRYPOINT: "cli",
        CLAUDE_CODE_CHILD_SESSION: "1",
      },
    });

    expect(calls[0]?.options.env).toEqual({ ANTHROPIC_API_KEY: "cle-de-test", PATH: "/usr/bin" });
  });

  describe("échoue avec l'erreur exacte du SDK", () => {
    it("quand le résultat est en erreur malgré le sous-type success, par exemple une clé refusée", async () => {
      const outcome = await follow({
        query: fakeQuery(
          [
            makeInit(),
            makeText("Invalid API key · Fix external API key", { error: "authentication_failed" }),
            makeResult({
              is_error: true,
              num_turns: 1,
              total_cost_usd: 0,
              result: "Invalid API key · Fix external API key",
              api_error_status: 401,
              api_error_type: "authentication_error",
            }),
          ],
          new Error("Claude Code returned an error result: Invalid API key · Fix external API key"),
        ),
      });

      expect(outcome).toEqual({
        ok: false,
        error: {
          reason: expect.stringContaining("Invalid API key · Fix external API key"),
          costUsd: 0,
        },
      });
      expect(outcome.ok ? "" : outcome.error.reason).toContain("401 authentication_error");
      expect(outcome.ok ? "" : outcome.error.reason).toContain("authentication_failed");
    });

    it("quand le sous-type du résultat est une erreur, avec les erreurs qu'il porte", async () => {
      const outcome = await follow({
        query: fakeQuery([
          makeInit(),
          makeToolUse("mcp__dezyn__list_tokens"),
          makeResult({
            subtype: "error_during_execution",
            is_error: true,
            total_cost_usd: 0.1,
            result: undefined,
            errors: ["MCP server dezyn failed"],
          }),
        ]),
      });

      expect(outcome).toEqual({
        ok: false,
        error: {
          reason: expect.stringMatching(/error_during_execution.*MCP server dezyn failed/),
          costUsd: 0.1,
        },
      });
    });

    it("quand le SDK lève une erreur avant tout résultat", async () => {
      expect(
        await follow({
          query: fakeQuery([], new Error("Claude Code executable not found at /x/claude")),
        }),
      ).toEqual({
        ok: false,
        error: {
          reason: expect.stringContaining("Claude Code executable not found at /x/claude"),
          costUsd: 0,
        },
      });
    });

    it("quand le SDK lève une erreur après un résultat réussi", async () => {
      expect(
        await follow({
          query: fakeQuery(SUCCESSFUL_SESSION, new Error("processus claude tué")),
        }),
      ).toMatchObject({
        ok: false,
        error: { reason: expect.stringContaining("processus claude tué") },
      });
    });

    it("quand la session s'arrête sans résultat", async () => {
      expect(await follow({ query: fakeQuery([makeInit()]) })).toEqual({
        ok: false,
        error: { reason: expect.stringContaining("sans résultat"), costUsd: 0 },
      });
    });

    it("quand la session n'a fait aucun tour", async () => {
      expect(
        await follow({
          query: fakeQuery([...SUCCESSFUL_SESSION.slice(0, 3), makeResult({ num_turns: 0 })]),
        }),
      ).toMatchObject({ ok: false, error: { reason: expect.stringContaining("aucun tour") } });
    });

    it("quand la session n'a rien coûté, donc que l'IA n'a jamais répondu", async () => {
      expect(
        await follow({
          query: fakeQuery([...SUCCESSFUL_SESSION.slice(0, 3), makeResult({ total_cost_usd: 0 })]),
        }),
      ).toMatchObject({ ok: false, error: { reason: expect.stringContaining("coût nul") } });
    });

    it("quand l'IA n'appelle aucun outil MCP alors que la recette en demande", async () => {
      expect(
        await follow({ query: fakeQuery([makeInit(), makeText("Fini."), makeResult()]) }),
      ).toMatchObject({
        ok: false,
        error: { reason: expect.stringContaining("aucun appel d'outil MCP"), costUsd: 0.42 },
      });
    });

    it("en nommant les serveurs MCP qui ne se sont pas connectés", async () => {
      expect(
        await follow({
          query: fakeQuery([
            makeInit({
              mcp_servers: [
                { name: "dezyn", status: "failed" },
                { name: "figma", status: "connected" },
              ],
            }),
            makeText("Je ne vois pas dezyn."),
            makeResult(),
          ]),
        }),
      ).toMatchObject({
        ok: false,
        error: { reason: expect.stringContaining("dezyn (failed)") },
      });
    });
  });

  it("laisse finir sans appel d'outil une recette qui n'en demande pas", async () => {
    expect(
      await follow({
        query: fakeQuery([
          makeInit(),
          makeText("Quel est le lien du fichier Figma ?"),
          makeResult(),
        ]),
        requireToolCall: false,
      }),
    ).toMatchObject({ ok: true, value: { toolCalls: [] } });
  });

  describe("en mode détaillé", () => {
    it("journalise l'initialisation, les appels d'outils, leurs erreurs et le résultat final", async () => {
      const { lines, log } = capture();

      await follow({
        query: fakeQuery([
          makeInit(),
          makeToolUse("mcp__figma__get_local_variables", { fileKey: "abc" }),
          makeToolResult("Fichier introuvable", true),
          makeText("Je relève."),
          makeResult(),
        ]),
        log,
      });

      expect(lines).toEqual([
        "init : modèle claude-opus-5-5, clé ANTHROPIC_API_KEY, permissions dontAsk",
        "init : serveurs MCP dezyn (connected), figma (connected)",
        "init : outils mcp__dezyn__list_tokens, mcp__figma__get_local_variables",
        'outil : mcp__figma__get_local_variables {"fileKey":"abc"}',
        "erreur d'outil : Fichier introuvable",
        "texte : Je relève.",
        "résultat : success, 6 tours, 0.42 $ : Relevé terminé.",
      ]);
    });

    it("journalise l'erreur levée par le SDK", async () => {
      const { lines, log } = capture();

      await follow({ query: fakeQuery([], new Error("spawn claude ENOENT")), log });

      expect(lines).toEqual(["erreur du SDK : spawn claude ENOENT"]);
    });

    it("transmet la sortie d'erreur du processus de l'agent", async () => {
      const { lines, log } = capture();
      await follow({ query: queryWritingToStderr("Connexion MCP refusée\n"), log });

      expect(lines).toContain("stderr : Connexion MCP refusée");
    });
  });
});
