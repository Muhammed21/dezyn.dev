import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { TokenDefinitionInput } from "#modules/token/contracts/token-definition.ts";
import { issuesOfCheck } from "#modules/token/contracts/token-issues.ts";
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

import type { ProposalUseCases } from "../application/proposal-use-cases.ts";
import type { UncheckedTokens, WrittenWithDuplicates } from "../application/write-tokens.ts";
import {
  BatchIdArgument,
  DESIGNATION_REFUSAL_TEXT,
  type DesignationRefusal,
  isDesignationRefusal,
} from "../contracts/batch-designation.ts";
import { WrittenTokensOutput } from "../contracts/proposal.ts";

type InvalidTokens = { readonly code: "invalid_tokens"; readonly issues: readonly string[] };

type WriteFailure = RecordFailure | DesignationRefusal | InvalidTokens | UncheckedTokens;

const MAX_TOKENS_PER_CALL = 500;

const TokensInput = z
  .array(TokenDefinitionInput)
  .min(1)
  .max(MAX_TOKENS_PER_CALL, `${MAX_TOKENS_PER_CALL} tokens au plus par appel`);

const pathOf = (path: readonly PropertyKey[]): string =>
  path.reduce<string>((joined, key) => {
    if (typeof key === "number") {
      return `${joined}[${key}]`;
    }
    return `${joined}.${String(key)}`;
  }, "tokens");

const issuesOf = (failure: InvalidTokens | UncheckedTokens): readonly string[] =>
  failure.code === "invalid_tokens"
    ? failure.issues
    : failure.checks.flatMap(({ index, failure: check }) =>
        issuesOfCheck(check).map(({ path, message }) => `tokens[${index}].${path} : ${message}`),
      );

const errorTextOf = (failure: WriteFailure): string => {
  if (isDesignationRefusal(failure)) {
    return DESIGNATION_REFUSAL_TEXT[failure];
  }
  return typeof failure === "string" ? RECORD_FAILURE_TEXT[failure] : issuesOf(failure).join("\n");
};

const errorOf = (failure: WriteFailure): CallToolResult => ({
  content: [{ type: "text", text: errorTextOf(failure) }],
  isError: true,
});

const writtenOutputOf = ({ batch, proposals, unchanged, replaced }: WrittenWithDuplicates) => ({
  batch: batch === null ? null : { id: batch.id, state: batch.state },
  proposals: proposals.map(({ id, name, kind, status, duplicates }) => ({
    id,
    name,
    kind,
    status,
    duplicates,
  })),
  unchanged,
  replaced,
});

export const registerWriteTokens =
  ({
    writeTokens,
    recordProjectCall,
  }: Pick<ProposalUseCases, "writeTokens"> & { readonly recordProjectCall: RecordProjectCall }) =>
  (server: McpServer, call: McpCall) => {
    const { identity, correlationId } = call;
    const write = async ({
      projectId,
      tokens,
      batchId,
    }: {
      readonly projectId: string;
      readonly tokens?: readonly unknown[];
      readonly batchId?: string;
    }): Promise<Execution<CallToolResult>> => {
      const written = await recordProjectCall({
        tool: "write_tokens",
        projectId,
        userId: identity.userId,
        clientId: identity.clientId,
        correlationId,
        input: { tokens, batchId },
        run: async (
          project,
        ): Promise<
          Result<WrittenWithDuplicates, InvalidTokens | UncheckedTokens | DesignationRefusal>
        > => {
          const parsed = TokensInput.safeParse(tokens);
          if (!parsed.success) {
            return err({
              code: "invalid_tokens",
              issues: parsed.error.issues.map(
                ({ path, message }) => `${pathOf(path)} : ${message}`,
              ),
            });
          }
          return writeTokens({
            projectId,
            spaceId: project.spaceId,
            userId: identity.userId,
            clientId: identity.clientId,
            tokens: parsed.data,
            batchId,
          });
        },
      });
      if (!written.ok) {
        return { response: errorOf(written.error), memorable: !isServerFailure(written.error) };
      }
      const output = writtenOutputOf(written.value);
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
      "write_tokens",
      {
        description:
          "Propose la création ou la modification de tokens DTCG dans un projet : chaque token devient une proposition Proposée, rangée dans le lot ouvert de l'IA, à relire par un éditeur. Un token identique à sa valeur validée ou en attente revient dans unchanged ; une nouvelle valeur remplace la proposition en attente sur le même nom et revient dans replaced. Chaque nom n'apparaît qu'une fois par appel. $extensions garde, sous une clé en notation de domaine inversé (com.figma), les données d'un autre outil que dezyn n'interprète pas : une valeur de design n'y va jamais. Chaque proposition porte duplicates, les noms des tokens validés ou en attente de même type et de même valeur. Réutilise un token existant par alias ({nom.du.token}) plutôt que de recopier sa valeur ; ne crée un nouveau token que si aucun token ne porte déjà cette valeur.",
        inputSchema: {
          projectId: Uuid,
          tokens: z.array(z.unknown()).optional(),
          batchId: BatchIdArgument,
          idempotencyKey: IdempotencyKeyArgument,
        },
        outputSchema: WrittenTokensOutput,
      },
      async (args) =>
        projectCall({
          tool: "write_tokens",
          args,
          input: { tokens: args.tokens, batchId: args.batchId },
          run: () => write(args),
        }),
    );
  };
