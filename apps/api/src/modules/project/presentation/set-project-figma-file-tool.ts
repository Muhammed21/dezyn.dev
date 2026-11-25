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
import { type FigmaFile, FigmaFileInput, FigmaFileOutput, Uuid } from "@repo/contracts";
import { err, type Result } from "@repo/result";

import type { ProjectUseCases } from "../application/project-use-cases.ts";
import type { FigmaFileFailure } from "../application/set-figma-file.ts";

type InvalidUrl = { readonly code: "invalid_url"; readonly issues: readonly string[] };

type SetFailure = RecordFailure | FigmaFileFailure | InvalidUrl;

const INVALID_FIGMA_FILE_TEXT = "url : Lien de fichier Figma attendu";

const errorTextOf = (failure: SetFailure): string => {
  if (typeof failure !== "string") {
    return failure.issues.join("\n");
  }
  if (failure === "invalid_figma_file") {
    return INVALID_FIGMA_FILE_TEXT;
  }
  return RECORD_FAILURE_TEXT[failure];
};

const SetFigmaFileOutput = z.looseObject({ figmaFile: FigmaFileOutput.nullable() });

export const registerSetProjectFigmaFile =
  ({
    setFigmaFile,
    recordProjectCall,
  }: Pick<ProjectUseCases, "setFigmaFile"> & {
    readonly recordProjectCall: RecordProjectCall;
  }) =>
  (server: McpServer, call: McpCall) => {
    const { identity, correlationId } = call;
    const projectCall = idempotentProjectCall({ recordProjectCall, call });
    const set = async ({
      projectId,
      url,
    }: {
      readonly projectId: string;
      readonly url?: unknown;
    }): Promise<Execution<CallToolResult>> => {
      const result = await recordProjectCall({
        tool: "set_project_figma_file",
        projectId,
        userId: identity.userId,
        clientId: identity.clientId,
        correlationId,
        input: { url },
        run: async (): Promise<Result<FigmaFile | null, FigmaFileFailure | InvalidUrl>> => {
          const parsed = FigmaFileInput.safeParse({ url });
          if (!parsed.success) {
            return err({
              code: "invalid_url",
              issues: parsed.error.issues.map(
                ({ path, message }) => `${path.join(".")} : ${message}`,
              ),
            });
          }
          return setFigmaFile({
            projectId,
            userId: identity.userId,
            clientId: identity.clientId,
            url: parsed.data.url,
            correlationId,
          });
        },
      });
      if (!result.ok) {
        return {
          response: { content: [{ type: "text", text: errorTextOf(result.error) }], isError: true },
          memorable: !isServerFailure(result.error),
        };
      }
      const output = { figmaFile: result.value };
      return {
        response: {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        },
        memorable: true,
      };
    };
    server.registerTool(
      "set_project_figma_file",
      {
        description:
          "Renseigne, modifie ou retire le fichier Figma d'un projet : url est le lien d'un fichier Figma (https://www.figma.com/design/<clé>/…), ou null pour le retirer. Un projet a au plus un fichier Figma ; le lien remplace le précédent. Rend le lien et la clé enregistrés. list_projects les rend avec chaque projet.",
        inputSchema: {
          projectId: Uuid,
          url: z
            .unknown()
            .optional()
            .describe("Lien du fichier Figma (texte), ou null pour retirer le fichier Figma."),
          idempotencyKey: IdempotencyKeyArgument,
        },
        outputSchema: SetFigmaFileOutput,
      },
      async (args) =>
        projectCall({
          tool: "set_project_figma_file",
          args,
          input: { url: args.url },
          run: () => set(args),
        }),
    );
  };
