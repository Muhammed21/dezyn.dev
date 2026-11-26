import type { ModeRefusal } from "./mode-completeness.ts";
import type { ReferenceRefusal, WrittenToken } from "./reference.ts";
import type { TokenDefinition } from "./token.ts";

export type TokenCheckFailure =
  | { readonly code: "invalid_modes"; readonly refusals: readonly ModeRefusal[] }
  | {
      readonly code: "invalid_references";
      readonly refusals: readonly {
        readonly mode?: string;
        readonly field?: string;
        readonly contrastOn?: number;
        readonly refusal: ReferenceRefusal;
      }[];
    }
  | { readonly code: "type_changed" }
  | { readonly code: "name_conflict"; readonly other: string }
  | { readonly code: "duplicate_name" };

export type TokenCheck = { readonly index: number; readonly failure: TokenCheckFailure };

export type CheckTokens = (written: {
  readonly projectId: string;
  readonly tokens: readonly TokenDefinition[];
}) => Promise<readonly TokenCheck[]>;

export type ValidatedTokenFailure = TokenCheckFailure | { readonly code: "name_taken" };

export type ValidatedWrite = {
  readonly kind: "create" | "update";
  readonly token: TokenDefinition;
};

export type ValidatedTokens<Write extends ValidatedWrite> = {
  readonly projectId: string;
  readonly writes: readonly Write[];
  readonly pending: readonly WrittenToken[];
  readonly createdAt: Date;
};

export type FailedWrite<Write extends ValidatedWrite> = {
  readonly write: Write;
  readonly failure: ValidatedTokenFailure;
};

export interface ValidatedTokenWriter {
  write<Write extends ValidatedWrite>(
    validated: ValidatedTokens<Write>,
  ): Promise<FailedWrite<Write> | undefined>;
}
