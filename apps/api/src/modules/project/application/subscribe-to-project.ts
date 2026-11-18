import type { ProjectAccess } from "#modules/space/contracts/membership.ts";
import { err, ok, type Result } from "@repo/result";

import type { ProjectChannel } from "../domain/project-channel.ts";

export const subscribeToProject =
  ({ access, channel }: { readonly access: ProjectAccess; readonly channel: ProjectChannel }) =>
  async ({
    projectId,
    userId,
    request,
  }: {
    readonly projectId: string;
    readonly userId: string;
    readonly request: Request;
  }): Promise<Result<Response, "not_found">> => {
    if ((await access({ projectId, userId, action: "space.read" })) === undefined) {
      return err("not_found");
    }
    return ok(await channel.connect({ projectId, request }));
  };
