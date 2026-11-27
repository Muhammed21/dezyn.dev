import { AddModeInput, Uuid } from "@repo/contracts";
import { err, type Result } from "@repo/result";

import type {
  AddedMode,
  ModeAddition,
  ModeAdditionFailure,
  ProjectTokens,
  TokensFailure,
} from "../domain/token.ts";
import type { TokenGateway } from "./token-gateway.ts";

export const tokenUseCases = ({ gateway }: { readonly gateway: TokenGateway }) => ({
  readTokens: async ({
    projectId,
  }: {
    readonly projectId: string;
  }): Promise<Result<ProjectTokens, TokensFailure>> =>
    Uuid.safeParse(projectId).success ? gateway.readTokens({ projectId }) : err("not_found"),
  addMode: async ({
    projectId,
    name,
    copiedFrom,
  }: ModeAddition): Promise<Result<AddedMode, ModeAdditionFailure>> => {
    if (!Uuid.safeParse(projectId).success) {
      return err("not_found");
    }
    const input = AddModeInput.safeParse({ name, copiedFrom });
    if (!input.success) {
      return err("invalid_name");
    }
    return gateway.addMode({ projectId, ...input.data });
  },
});
