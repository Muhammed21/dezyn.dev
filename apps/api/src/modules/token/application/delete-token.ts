import type { ProjectSignals } from "#modules/project/contracts/project-signals.ts";
import type { ProjectAccess } from "#modules/space/contracts/membership.ts";
import { err, ok, type Result } from "@repo/result";

import type { CitedToken } from "../domain/citations.ts";
import type { ReplacedProposal, TokenUnitOfWork } from "./add-token.ts";
import { readValidatedTokens } from "./read-tokens.ts";

export type DeletedToken = { readonly name: string; readonly replaced: ReplacedProposal | null };

export type TokenDeletionFailure = "not_found" | CitedToken;

export const deleteToken =
  ({
    access,
    unitOfWork,
    signals,
    now,
  }: {
    readonly access: ProjectAccess;
    readonly unitOfWork: TokenUnitOfWork;
    readonly signals: ProjectSignals;
    readonly now: () => Date;
  }) =>
  async ({
    projectId,
    userId,
    name,
    correlationId,
  }: {
    readonly projectId: string;
    readonly userId: string;
    readonly name: string;
    readonly correlationId: string;
  }): Promise<Result<DeletedToken, TokenDeletionFailure>> => {
    const project = await access({ projectId, userId, action: "token.delete" });
    if (project === undefined) {
      return err("not_found");
    }
    const deleted = await unitOfWork.run(
      async ({
        project: projectLock,
        modes,
        validatedTokens,
        tokens,
        citations,
        history,
        proposals,
      }): Promise<Result<DeletedToken, TokenDeletionFailure>> => {
        await projectLock.write(projectId);
        const read = await readValidatedTokens({ modes, tokens: validatedTokens })(projectId);
        const found = read.tokens.find((token) => token.name === name);
        if (found === undefined) {
          return err("not_found");
        }
        const cited = await citations.citationsOf({ projectId, names: [name] });
        if (cited.length > 0) {
          return err({ code: "cited_token", citations: cited });
        }
        await tokens.deleteAll({ projectId, names: [name] });
        const replaced = await proposals.replace({ projectId, name });
        const { id: _id, status: _status, ...definition } = found;
        await history.append([
          {
            spaceId: project.spaceId,
            projectId,
            action: "token.deleted",
            userId,
            clientId: null,
            before: definition,
            after: { replaced },
            correlationId,
            occurredAt: now(),
          },
        ]);
        return ok({ name, replaced });
      },
    );
    if (deleted.ok) {
      await signals.changed({
        projectId,
        topics:
          deleted.value.replaced === null
            ? ["history", "tokens"]
            : ["proposals", "history", "tokens"],
      });
    }
    return deleted;
  };
