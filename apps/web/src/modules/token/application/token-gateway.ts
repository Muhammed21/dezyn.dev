import type { Result } from "@repo/result";

import type {
  AddedMode,
  ModeAddition,
  ModeAdditionFailure,
  ProjectTokens,
  TokensFailure,
} from "../domain/token.ts";

export type TokenGateway = {
  readonly readTokens: (project: {
    readonly projectId: string;
  }) => Promise<Result<ProjectTokens, TokensFailure>>;
  readonly addMode: (addition: ModeAddition) => Promise<Result<AddedMode, ModeAdditionFailure>>;
};
