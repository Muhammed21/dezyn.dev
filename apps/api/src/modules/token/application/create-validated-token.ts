import type { ProjectToken, WrittenToken } from "../domain/reference.ts";
import type {
  FailedWrite,
  ValidatedTokenFailure,
  ValidatedTokenWriter,
  ValidatedWrite,
} from "../domain/token-check.ts";
import { groupConflict } from "../domain/token-name.ts";
import {
  type CitationReader,
  checkedValues,
  type CreatedToken,
  type ModeReader,
  type ModeValue,
  modeValueOf,
  type ProjectMode,
  type ProjectTokenReader,
  type ReplacedToken,
  type TokenWriter,
} from "./token-values.ts";

type Planned<Write extends ValidatedWrite> = {
  readonly known: readonly ProjectToken[];
  readonly created: readonly (CreatedToken & { readonly write: Write })[];
  readonly replaced: readonly ReplacedToken[];
  readonly deleted: readonly Write[];
  readonly failed?: FailedWrite<Write>;
};

const checkedWrite = (
  { kind, token }: ValidatedWrite,
  {
    known,
    projectModes,
    pending,
    writtenTogether,
  }: {
    readonly known: readonly ProjectToken[];
    readonly projectModes: readonly ProjectMode[];
    readonly pending: readonly WrittenToken[];
    readonly writtenTogether: readonly WrittenToken[];
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
  const checked = checkedValues(token, { projectModes, tokens: known, pending, writtenTogether });
  if (!checked.ok) {
    return { failure: checked.error };
  }
  if (kind === "create" && known.some(({ name }) => name === token.name)) {
    return { failure: { code: "name_taken" } };
  }
  return { values: checked.value.map(modeValueOf) };
};

const citedDeletion = async <Write extends ValidatedWrite>(
  citations: CitationReader,
  { projectId, deleted }: { readonly projectId: string; readonly deleted: readonly Write[] },
): Promise<FailedWrite<Write> | undefined> => {
  const found = await citations.citationsOf({
    projectId,
    names: deleted.map(({ token }) => token.name),
  });
  const cited = deleted.find(({ token }) => found.some(({ cited: name }) => name === token.name));
  return cited === undefined
    ? undefined
    : {
        write: cited,
        failure: {
          code: "cited_token",
          citations: found.filter(({ cited: name }) => name === cited.token.name),
        },
      };
};

export const validatedTokenWriter = ({
  modes,
  projectTokens,
  tokens,
  citations,
  newId,
}: {
  readonly modes: ModeReader;
  readonly projectTokens: ProjectTokenReader;
  readonly tokens: TokenWriter;
  readonly citations: CitationReader;
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
        if (write.kind === "delete") {
          return { ...plan, deleted: [...plan.deleted, write] };
        }
        const checked = checkedWrite(write, {
          known: plan.known,
          projectModes,
          pending,
          writtenTogether: writes.filter(({ kind }) => kind !== "delete").map(({ token }) => token),
        });
        if ("failure" in checked) {
          return { ...plan, failed: { write, failure: checked.failure } };
        }
        if (write.kind === "update") {
          return {
            ...plan,
            replaced: [
              ...plan.replaced,
              { token: { ...write.token, projectId }, values: checked.values },
            ],
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
      { known, created: [], replaced: [], deleted: [] },
    );
    if (planned.failed !== undefined) {
      return planned.failed;
    }
    const taken = await tokens.createAll(planned.created);
    if (taken !== undefined) {
      return { write: taken.write, failure: { code: "name_taken" } };
    }
    await tokens.replaceAll(planned.replaced);
    const cited = await citedDeletion(citations, { projectId, deleted: planned.deleted });
    if (cited !== undefined) {
      return cited;
    }
    await tokens.deleteAll({ projectId, names: planned.deleted.map(({ token }) => token.name) });
    return undefined;
  },
});
