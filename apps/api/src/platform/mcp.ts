import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { type CallToolResult, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Context } from "hono";
import { z } from "zod";

import type { AccessTokenIdentity } from "@repo/auth-verifier";

import type { AuthenticatedEnv } from "./access-token.ts";
import {
  type Execution,
  fingerprintOf,
  type Idempotent,
  type IdempotencyRefusal,
} from "./idempotency.ts";

const REFUSAL_TEXT: Readonly<Record<IdempotencyRefusal, string>> = {
  invalid_idempotency_key: "idempotencyKey compte de 1 à 255 caractères ASCII imprimables.",
  idempotency_in_progress:
    "un appel avec cette clé d'idempotence est encore en cours ; réessaie dans un instant.",
  idempotency_key_reused:
    "cette clé d'idempotence a déjà servi avec d'autres arguments ; choisis une clé nouvelle pour une autre écriture.",
};

export const IdempotencyKeyArgument = z
  .string()
  .optional()
  .describe(
    "Choisis une clé nouvelle par écriture voulue ; réutilise la même seulement pour relancer un appel resté sans réponse.",
  );

export type IdempotentToolCall = (call: {
  readonly tool: string;
  readonly args: { readonly idempotencyKey?: string } & Readonly<Record<string, unknown>>;
  readonly run: () => Promise<Execution<CallToolResult>>;
  readonly replay: (stored: CallToolResult) => Promise<CallToolResult>;
}) => Promise<CallToolResult>;

export type McpCall = {
  readonly identity: AccessTokenIdentity;
  readonly correlationId: string;
  readonly idempotent: IdempotentToolCall;
};

export type McpTools = (server: McpServer, call: McpCall) => void;

const idempotentToolCall =
  (idempotent: Idempotent, userId: string): IdempotentToolCall =>
  async ({ tool, args: { idempotencyKey, ...args }, run, replay }) => {
    if (idempotencyKey === undefined) {
      return (await run()).response;
    }
    const outcome = await idempotent({
      claim: {
        userId,
        scope: `mcp:${tool}`,
        key: idempotencyKey,
        fingerprint: fingerprintOf(args),
      },
      parse: (stored) => CallToolResultSchema.parse(stored),
      run,
      replay,
    });
    if ("refusal" in outcome) {
      return {
        content: [{ type: "text", text: `${outcome.refusal} : ${REFUSAL_TEXT[outcome.refusal]}` }],
        isError: true,
      };
    }
    return outcome.response;
  };

export const mcpEndpoint =
  ({
    registerTools,
    idempotent,
  }: {
    readonly registerTools: McpTools;
    readonly idempotent: Idempotent;
  }) =>
  async (c: Context<AuthenticatedEnv>) => {
    const server = new McpServer({ name: "dezyn", version: "0.0.0" });
    const identity = c.get("identity");
    registerTools(server, {
      identity,
      correlationId: c.get("correlationId"),
      idempotent: idempotentToolCall(idempotent, identity.userId),
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  };
