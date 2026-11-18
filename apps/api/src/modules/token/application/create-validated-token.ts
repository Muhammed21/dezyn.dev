import type { ProjectToken } from "../domain/reference.ts";
import type {
  FailedWrite,
  ValidatedTokenFailure,
  ValidatedTokenWriter,
  ValidatedWrite,
} from "../domain/token-check.ts";
import { groupConflict } from "../domain/token-name.ts";
import type { TokenDefinition } from "../domain/token.ts";
import {
  checkedValues,
  type CreatedToken,
  type ModeReader,
  type ModeValue,
  modeValueOf,
  type ProjectMode,
  type ProjectTokenReader,
  type TokenWriter,
} from "./token-values.ts";

type Planned<Write extends ValidatedWrite> = {
  readonly known: readonly ProjectToken[];
  readonly created: readonly (CreatedToken & { readonly write: Write })[];
  readonly replaced: readonly {
    readonly token: TokenDefinition;
    readonly values: readonly ModeValue[];
  }[];
  readonly failed?: FailedWrite<Write>;
};

const checkedWrite = (
  { kind, token }: ValidatedWrite,
  {
    known,
    projectModes,
    pending,
  }: {
    readonly known: readonly ProjectToken[];
    readonly projectModes: readonly ProjectMode[];
    readonly pending: readonly { readonly name: string; readonly $type: string }[];
  },
): { readonly failure: ValidatedTokenFailure } | { readonly values: readonly ModeValue[] } => {
  const other =
    kind === "create"
      ? groupConflict(
          token.name,
          known.map(({ name }) => name),
        )
      : undefined;
  if (other !== undefined) {
    return { failure: { code: "name_conflict", other } };
  }
  const checked = checkedValues(token, { projectModes, tokens: known, pending });
  if (!checked.ok) {
    return { failure: checked.error };
  }
  if (kind === "create" && known.some(({ name }) => name === token.name)) {
    return { failure: { code: "name_taken" } };
  }
  return { values: checked.value.map(modeValueOf) };
};

export const validatedTokenWriter = ({
  modes,
  projectTokens,
  tokens,
  newId,
}: {
  readonly modes: ModeReader;
  readonly projectTokens: ProjectTokenReader;
  readonly tokens: TokenWriter;
  readonly newId: () => string;
}): ValidatedTokenWriter => ({
  write: async ({ projectId, writes, pending, createdAt }) => {
    const [known, projectModes] = await Promise.all([
      projectTokens.tokensOf(projectId),
      modes.modesOf(projectId),
    ]);
    type Write = (typeof writes)[number];
    const planned = writes.reduce<Planned<Write>>(
      (plan, write) => {
        if (plan.failed !== undefined) {
          return plan;
        }
        const checked = checkedWrite(write, { known: plan.known, projectModes, pending });
        if ("failure" in checked) {
          return { ...plan, failed: { write, failure: checked.failure } };
        }
        if (write.kind === "update") {
          return {
            ...plan,
            replaced: [...plan.replaced, { token: write.token, values: checked.values }],
          };
        }
        const created = {
          ...write.token,
          id: newId(),
          projectId,
          status: "validated" as const,
          createdAt,
        };
        return {
          ...plan,
          known: [...plan.known, created],
          created: [...plan.created, { write, token: created, values: checked.values }],
        };
      },
      { known, created: [], replaced: [] },
    );
    if (planned.failed !== undefined) {
      return planned.failed;
    }
    const taken = await tokens.createAll(planned.created);
    if (taken !== undefined) {
      return { write: taken.write, failure: { code: "name_taken" } };
    }
    await planned.replaced.reduce<Promise<void>>(async (previous, { token, values }) => {
      await previous;
      await tokens.replace({ ...token, projectId }, values);
    }, Promise.resolve());
    return undefined;
  },
});
