import type { ListedProject } from "../application/list-projects.ts";

export const listedProjectOutputOf = ({
  id,
  name,
  createdAt,
  historyPurgedAt,
  figmaFile,
}: ListedProject) => ({
  id,
  name,
  createdAt: createdAt.toISOString(),
  historyPurgedAt: historyPurgedAt?.toISOString() ?? null,
  figmaFile,
});
