import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { McpCall } from "#platform/mcp.ts";
import { Uuid } from "@repo/contracts";
import { ProjectsOutput } from "@repo/contracts";

import type { ProjectUseCases } from "../application/project-use-cases.ts";
import { listedProjectOutputOf } from "./project-output.ts";

export const registerListProjects =
  ({ listProjects }: Pick<ProjectUseCases, "listProjects">) =>
  (server: McpServer, { identity }: McpCall) => {
    server.registerTool(
      "list_projects",
      {
        description:
          "Liste les projets d'un espace dont l'utilisateur est membre, triés par nom, avec leur id, leur date de création et leur fichier Figma (lien et clé, ou null). Les espaces viennent de list_spaces.",
        inputSchema: { spaceId: Uuid },
        outputSchema: ProjectsOutput,
      },
      async ({ spaceId }) => {
        const listed = await listProjects({ spaceId, userId: identity.userId });
        if (!listed.ok) {
          return { content: [{ type: "text", text: "Espace introuvable" }], isError: true };
        }
        const output = {
          projects: listed.value.map(listedProjectOutputOf),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      },
    );
  };
