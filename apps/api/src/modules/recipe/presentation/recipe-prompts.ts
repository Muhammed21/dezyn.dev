import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, type GetPromptResult, McpError } from "@modelcontextprotocol/sdk/types.js";

import type { McpCall } from "#platform/mcp.ts";
import { RECORD_FAILURE_TEXT, type RecordProjectCall } from "#platform/project-call.ts";
import { Uuid } from "@repo/contracts";

import type { RecipeUseCases } from "../application/recipe-use-cases.ts";

const ProjectIdArgument = Uuid.describe(
  "Le projet visé par la recette ; list_projects rend les projets d'un espace.",
);

export const registerRecipePrompts =
  ({
    recipes,
    instructionsOf,
    recordProjectCall,
  }: RecipeUseCases & { readonly recordProjectCall: RecordProjectCall }) =>
  (server: McpServer, { identity, correlationId }: McpCall) => {
    recipes.forEach((recipe) => {
      server.registerPrompt(
        recipe.name,
        {
          title: recipe.title,
          description: recipe.description,
          argsSchema: { projectId: ProjectIdArgument },
        },
        async ({ projectId }): Promise<GetPromptResult> => {
          const instructions = await recordProjectCall({
            tool: recipe.name,
            projectId,
            userId: identity.userId,
            clientId: identity.clientId,
            correlationId,
            input: {},
            run: () => instructionsOf({ recipe, projectId, userId: identity.userId }),
          });
          if (!instructions.ok) {
            throw new McpError(
              instructions.error === "not_found"
                ? ErrorCode.InvalidParams
                : ErrorCode.InternalError,
              RECORD_FAILURE_TEXT[instructions.error],
            );
          }
          return {
            description: recipe.description,
            messages: [{ role: "user", content: { type: "text", text: instructions.value } }],
          };
        },
      );
    });
  };
