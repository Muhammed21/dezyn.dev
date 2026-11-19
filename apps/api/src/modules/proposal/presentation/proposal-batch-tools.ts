import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { Execution } from "#platform/idempotency.ts";
import { IdempotencyKeyArgument, type McpCall } from "#platform/mcp.ts";
import {
  idempotentProjectCall,
  isServerFailure,
  RECORD_FAILURE_TEXT,
  type RecordFailure,
  type RecordProjectCall,
} from "#platform/project-call.ts";
import { Uuid } from "@repo/contracts";
import { err, ok, type Result } from "@repo/result";

import type { ClosedBatch, OpenedBatch } from "../application/proposal-batches.ts";
import type { ProposalUseCases } from "../application/proposal-use-cases.ts";
import { ClosedBatchOutput, OpenedBatchOutput } from "../contracts/proposal.ts";
import type { ProposalBatch } from "../domain/proposal.ts";

type BatchFailure = RecordFailure | "invalid_intent";

const ERROR_TEXT: Readonly<Record<BatchFailure, string>> = {
  ...RECORD_FAILURE_TEXT,
  invalid_intent: "intent : Intention requise",
};

const Intent = z.string().trim().min(1);

const failed = (failure: BatchFailure): Execution<CallToolResult> => ({
  response: { content: [{ type: "text", text: ERROR_TEXT[failure] }], isError: true },
  memorable: !isServerFailure(failure),
});

const structured = (output: Record<string, unknown>): Execution<CallToolResult> => ({
  response: {
    content: [{ type: "text", text: JSON.stringify(output) }],
    structuredContent: output,
  },
  memorable: true,
});

const batchOutputOf = ({ id, state, intent }: ProposalBatch) => ({ id, state, intent });

export const registerProposalBatchTools =
  ({
    openBatch,
    closeBatch,
    recordProjectCall,
  }: Pick<ProposalUseCases, "openBatch" | "closeBatch"> & {
    readonly recordProjectCall: RecordProjectCall;
  }) =>
  (server: McpServer, call: McpCall) => {
    const { identity, correlationId } = call;
    const writer = { userId: identity.userId, clientId: identity.clientId, correlationId };
    const projectCall = idempotentProjectCall({ recordProjectCall, call });
    const open = async ({
      projectId,
      intent,
    }: {
      readonly projectId: string;
      readonly intent?: string;
    }): Promise<Execution<CallToolResult>> => {
      const opened = await recordProjectCall({
        ...writer,
        tool: "open_proposal_batch",
        projectId,
        input: { intent },
        run: async (): Promise<Result<OpenedBatch, "invalid_intent">> => {
          const parsed = Intent.safeParse(intent);
          if (!parsed.success) {
            return err("invalid_intent");
          }
          return ok(
            await openBatch({
              projectId,
              userId: identity.userId,
              clientId: identity.clientId,
              intent: parsed.data,
            }),
          );
        },
      });
      if (!opened.ok) {
        return failed(opened.error);
      }
      const { batch, closed } = opened.value;
      return structured({
        batch: batchOutputOf(batch),
        closed: closed === null ? null : { id: closed.id },
      });
    };
    const close = async ({
      projectId,
    }: {
      readonly projectId: string;
    }): Promise<Execution<CallToolResult>> => {
      const closed = await recordProjectCall({
        ...writer,
        tool: "close_proposal_batch",
        projectId,
        input: {},
        run: async (): Promise<Result<ClosedBatch, never>> =>
          ok(
            await closeBatch({
              projectId,
              userId: identity.userId,
              clientId: identity.clientId,
            }),
          ),
      });
      if (!closed.ok) {
        return failed(closed.error);
      }
      const { batch } = closed.value;
      return structured({ batch: batch === null ? null : batchOutputOf(batch) });
    };
    server.registerTool(
      "open_proposal_batch",
      {
        description:
          "Ouvre un lot de propositions dans un projet en déclarant l'intention de l'IA, par exemple « Import du Figma Healthcare » ; les écritures suivantes y vont, et le lot ouvert précédent de l'IA dans ce projet se ferme.",
        inputSchema: {
          projectId: Uuid,
          intent: z.string().optional(),
          idempotencyKey: IdempotencyKeyArgument,
        },
        outputSchema: OpenedBatchOutput,
      },
      async (args) =>
        projectCall({
          tool: "open_proposal_batch",
          args,
          input: { intent: args.intent },
          run: () => open(args),
        }),
    );
    server.registerTool(
      "close_proposal_batch",
      {
        description:
          "Ferme le lot de propositions ouvert de l'IA dans un projet ; l'éditeur peut alors le valider en entier.",
        inputSchema: { projectId: Uuid, idempotencyKey: IdempotencyKeyArgument },
        outputSchema: ClosedBatchOutput,
      },
      async (args) =>
        projectCall({
          tool: "close_proposal_batch",
          args,
          input: {},
          run: () => close(args),
        }),
    );
  };
