import { type PairContrast, projectContrast } from "../domain/contrast.ts";
import type { ProjectTokens } from "./read-tokens.ts";

export const checkContrast =
  ({
    readValidatedTokens,
  }: {
    readonly readValidatedTokens: (projectId: string) => Promise<ProjectTokens>;
  }) =>
  async (projectId: string): Promise<readonly PairContrast[]> =>
    projectContrast(await readValidatedTokens(projectId));
