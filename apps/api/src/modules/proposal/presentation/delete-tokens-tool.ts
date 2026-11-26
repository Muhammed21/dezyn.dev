import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { citationMessage } from "#modules/token/contracts/token-issues.ts";
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
import { err, type Result } from "@repo/result";

import type { UndeletableTokens } from "../application/delete-tokens.ts";
import type { ProposalUseCases } from "../application/proposal-use-cases.ts";
import type { Written } from "../application/write-tokens.ts";
import {
  BatchIdArgument,
  DESIGNATION_REFUSAL_TEXT,
  type DesignationRefusal,
  isDesignationRefusal,
} from "../contracts/batch-designation.ts";
import { WrittenTokensOutput } from "../contracts/proposal.ts";

type InvalidNames = { readonly code: "invalid_names"; readonly issues: readonly string[] };

type DeleteFailure = RecordFailure | DesignationRefusal | InvalidNames | UndeletableTokens;

const MAX_NAMES_PER_CALL = 500;

const NamesInput = z
  .array(z.string().min(1))
  .min(1)
  .max(MAX_NAMES_PER_CALL, `${MAX_NAMES_PER_CALL} noms au plus par appel`);

const REFUSAL_MESSAGES = {
  duplicate_name: "Token déjà nommé dans cet appel",
  unknown_token: "Token inexistant dans le projet",
  pending_creation: "Token en attente de création : rejeter sa proposition plutôt que le supprimer",
} as const;

const refusalMessage = (failure: UndeletableTokens["refusals"][number]["failure"]): string =>
  failure.code === "cited_token"
    ? citationMessage(failure.citations)
    : REFUSAL_MESSAGES[failure.code];

const pathOf = (path: readonly PropertyKey[]): string =>
  path.reduce<string>(
    (joined, key) => (typeof key === "number" ? `${joined}[${key}]` : `${joined}.${String(key)}`),
    "names",
  );

const errorTextOf = (failure: DeleteFailure): string => {
  if (isDesignationRefusal(failure)) {
    return DESIGNATION_REFUSAL_TEXT[failure];
  }
  if (typeof failure === "string") {
    return RECORD_FAILURE_TEXT[failure];
  }
  return failure.code === "invalid_names"
    ? failure.issues.join("\n")
    : failure.refusals
        .map(({ index, failure: refusal }) => `names[${index}] : ${refusalMessage(refusal)}`)
        .join("\n");
};

const deletedOutputOf = ({ batch, proposals, unchanged, replaced }: Written) => ({
  batch: batch === null ? null : { id: batch.id, state: batch.state },
  proposals: proposals.map(({ id, name, kind, status }) => ({ id, name, kind, status })),
  unchanged,
  replaced,
});

export const registerDeleteTokens =
  ({
    deleteTokens,
    recordProjectCall,
  }: Pick<ProposalUseCases, "deleteTokens"> & { readonly recordProjectCall: RecordProjectCall }) =>
  (server: McpServer, call: McpCall) => {
    const { identity, correlationId } = call;
    const remove = async ({
      projectId,
      names,
      batchId,
    }: {
      readonly projectId: string;
      readonly names?: readonly unknown[];
      readonly batchId?: string;
    }): Promise<Execution<CallToolResult>> => {
      const deleted = await recordProjectCall({
        tool: "delete_tokens",
        projectId,
        userId: identity.userId,
        clientId: identity.clientId,
        correlationId,
        input: { names, batchId },
        run: async (
          project,
        ): Promise<Result<Written, InvalidNames | UndeletableTokens | DesignationRefusal>> => {
          const parsed = NamesInput.safeParse(names);
          if (!parsed.success) {
            return err({
              code: "invalid_names",
              issues: parsed.error.issues.map(
                ({ path, message }) => `${pathOf(path)} : ${message}`,
              ),
            });
          }
          return deleteTokens({
            projectId,
            spaceId: project.spaceId,
            userId: identity.userId,
            clientId: identity.clientId,
            names: parsed.data,
            batchId,
          });
        },
      });
      if (!deleted.ok) {
        return {
          response: {
            content: [{ type: "text", text: errorTextOf(deleted.error) }],
            isError: true,
          },
          memorable: !isServerFailure(deleted.error),
        };
      }
      const output = deletedOutputOf(deleted.value);
      return {
        response: {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        },
        memorable: true,
      };
    };
    const projectCall = idempotentProjectCall({ recordProjectCall, call });
    server.registerTool(
      "delete_tokens",
      {
        description:
          "Propose la suppression de tokens validés d'un projet, par leur nom : chaque suppression devient une proposition Proposée de nature delete, rangée dans le lot ouvert de l'IA comme write_tokens, à relire par un éditeur ; validée, le token disparaît de tous les modes. Un token encore cité par un alias ou par un champ d'un autre token validé ne se supprime pas : propose d'abord, dans le même lot, la modification de ce qui le cite (elle passe avant la suppression à la validation), ou supprime dans le même appel les tokens qui le citent. Une suppression déjà en attente revient dans unchanged ; une modification en attente sur le même nom est remplacée et revient dans replaced. Un nom inconnu, ou celui d'un token seulement en attente de création, est refusé.",
        inputSchema: {
          projectId: Uuid,
          names: z.array(z.unknown()).optional(),
          batchId: BatchIdArgument,
          idempotencyKey: IdempotencyKeyArgument,
        },
        outputSchema: WrittenTokensOutput,
      },
      async (args) =>
        projectCall({
          tool: "delete_tokens",
          args,
          input: { names: args.names, batchId: args.batchId },
          run: () => remove(args),
        }),
    );
  };
