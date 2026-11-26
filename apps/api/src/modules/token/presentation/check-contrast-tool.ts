import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { McpCall } from "#platform/mcp.ts";
import { RECORD_FAILURE_TEXT, type RecordProjectCall } from "#platform/project-call.ts";
import { Uuid } from "@repo/contracts";
import { ok, type Result } from "@repo/result";

import type { TokenUseCases } from "../application/token-use-cases.ts";
import { CheckContrastOutput } from "../contracts/contrast.ts";
import type { PairContrast } from "../domain/contrast.ts";

export const registerCheckContrast =
  ({
    checkContrast,
    recordProjectCall,
  }: Pick<TokenUseCases, "checkContrast"> & { readonly recordProjectCall: RecordProjectCall }) =>
  (server: McpServer, { identity, correlationId }: McpCall) => {
    server.registerTool(
      "check_contrast",
      {
        description:
          "Calcule le contraste WCAG 2.x de chaque paire déclarée dans $extensions[\"dev.dezyn\"].contrastOn des tokens validés d'un projet, dans chaque mode (mode null pour un projet sans modes). Chaque paire rend le token (premier plan), son fond, l'usage, le mode, le ratio tronqué au centième, le seuil (4,5 pour text, 3 pour large-text et ui) et le verdict pass, fail ou indeterminate. Un verdict indeterminate porte sa raison : translucent_background pour un fond translucide, missing_value pour une couleur sans valeur dans ce mode ; son ratio est null. Les alias sont résolus et un premier plan translucide est composé sur son fond. Rapporte ces chiffres tels quels, sans les recalculer.",
        inputSchema: { projectId: Uuid },
        outputSchema: CheckContrastOutput,
      },
      async ({ projectId }) => {
        const checked = await recordProjectCall({
          tool: "check_contrast",
          projectId,
          userId: identity.userId,
          clientId: identity.clientId,
          correlationId,
          input: {},
          run: async (): Promise<Result<readonly PairContrast[], never>> =>
            ok(await checkContrast(projectId)),
        });
        if (!checked.ok) {
          return {
            content: [{ type: "text", text: RECORD_FAILURE_TEXT[checked.error] }],
            isError: true,
          };
        }
        const output = { pairs: checked.value };
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      },
    );
  };
