import { z } from "zod";

import { Uuid } from "../conventions/schemas.ts";
import { FigmaFileOutput } from "./figma-file.ts";

const ListedProjectOutput = z.looseObject({
  id: Uuid,
  name: z.string(),
  createdAt: z.iso.datetime(),
  historyPurgedAt: z.iso.datetime().nullable(),
  figmaFile: FigmaFileOutput.nullable(),
});

export const ProjectOutput = ListedProjectOutput.extend({ spaceId: Uuid });

export const ProjectsOutput = z.looseObject({
  projects: z.array(ListedProjectOutput),
});
