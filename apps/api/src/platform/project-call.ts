import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { err, ok, type Result } from "@repo/result";

import type { Execution, IdempotencyRefusal } from "./idempotency.ts";
import { IDEMPOTENCY_REFUSAL_TEXT, type McpCall } from "./mcp.ts";

export type RecordFailure = "not_found" | "history_unavailable";

export const RECORD_FAILURE_TEXT: Readonly<Record<RecordFailure, string>> = {
  not_found: "Projet introuvable",
  history_unavailable: "Historique indisponible",
};

export const isServerFailure = (failure: unknown): boolean => failure === "history_unavailable";

export type RecordProjectCall = <T, E>(call: {
  readonly tool: string;
  readonly projectId: string;
  readonly userId: string;
  readonly clientId: string;
  readonly correlationId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly replayed?: boolean;
  readonly run: (project: { readonly spaceId: string }) => Promise<Result<T, E>>;
}) => Promise<Result<T, E | RecordFailure>>;

export type ProjectToolCall = (call: {
  readonly tool: string;
  readonly args: { readonly projectId: string; readonly idempotencyKey?: string } & Readonly<
    Record<string, unknown>
  >;
  readonly input: Readonly<Record<string, unknown>>;
  readonly run: () => Promise<Execution<CallToolResult>>;
}) => Promise<CallToolResult>;

const PROJECT_CALL_FAILURE_TEXT: Readonly<Record<RecordFailure | IdempotencyRefusal, string>> = {
  ...RECORD_FAILURE_TEXT,
  ...IDEMPOTENCY_REFUSAL_TEXT,
};

const failureOf = (failure: RecordFailure | IdempotencyRefusal): CallToolResult => ({
  content: [{ type: "text", text: PROJECT_CALL_FAILURE_TEXT[failure] }],
  isError: true,
});

export const idempotentProjectCall =
  ({
    recordProjectCall,
    call: { identity, correlationId, idempotent },
  }: {
    readonly recordProjectCall: RecordProjectCall;
    readonly call: McpCall;
  }): ProjectToolCall =>
  ({ tool, args, input, run }) => {
    const recorded = {
      tool,
      projectId: args.projectId,
      userId: identity.userId,
      clientId: identity.clientId,
      correlationId,
      input,
    };
    return idempotent({
      tool,
      args,
      run,
      replay: async (stored) => {
        const replayed = await recordProjectCall({
          ...recorded,
          replayed: true,
          run: async (): Promise<Result<CallToolResult, never>> => ok(stored),
        });
        return replayed.ok ? replayed.value : failureOf(replayed.error);
      },
      refuse: async (refusal) => {
        const refused = await recordProjectCall({
          ...recorded,
          run: async (): Promise<Result<never, IdempotencyRefusal>> => err(refusal),
        });
        return refused.ok ? refused.value : failureOf(refused.error);
      },
    });
  };
