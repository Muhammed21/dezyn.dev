import type { z } from "zod";

import {
  AlreadyMemberProblem,
  AlreadyTeamProblem,
  ChangedRoleOutput,
  CheckoutOutput,
  EmailMismatchProblem,
  LastOwnerProblem,
  MembersOutput,
  MySpaceOutput,
  MySpacesOutput,
  PlanRequiredProblem,
  SelfRemovalProblem,
  SentInvitationOutput,
  SpaceOutput,
} from "@repo/contracts";
import { err, ok } from "@repo/result";

import {
  BAD_REQUEST,
  CONFLICT,
  CREATED,
  failureOf,
  type Fetch,
  FORBIDDEN,
  GONE,
  type HttpFailure,
  NO_CONTENT,
  NOT_FOUND,
  OK,
  parseJson,
  send,
  UNAUTHORIZED,
} from "../../../platform/http.ts";
import type { SpaceGateway } from "../application/space-gateway.ts";
import {
  type AcceptanceFailure,
  type CheckoutFailure,
  type InvitationFailure,
  knownActionsOf,
  planOf,
  type RemovalFailure,
  type RoleChangeFailure,
  roleOf,
  type Space,
  subscriptionStatusOf,
} from "../domain/space.ts";

const spaceOf = ({
  id,
  name,
  plan,
  role,
  allowedActions,
}: z.infer<typeof MySpaceOutput>): Space => ({
  id,
  name,
  plan: planOf(plan),
  role: roleOf(role),
  allowedActions: knownActionsOf(allowedActions),
});

const refusalOf = async (response: Response): Promise<AcceptanceFailure> => {
  if (response.status === UNAUTHORIZED) {
    return "unauthenticated";
  }
  if (response.status === GONE) {
    return "gone";
  }
  if (response.status !== FORBIDDEN && response.status !== CONFLICT) {
    return failureOf(response);
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (EmailMismatchProblem.safeParse(body).success) {
    return "email_mismatch";
  }
  if (AlreadyMemberProblem.safeParse(body).success) {
    return "already_member";
  }
  return PlanRequiredProblem.safeParse(body).success ? "plan_required" : "invalid_response";
};

const invitationRefusalOf = async (response: Response): Promise<InvitationFailure> => {
  if (response.status === BAD_REQUEST) {
    return "invalid_email";
  }
  if (response.status === UNAUTHORIZED) {
    return "unauthenticated";
  }
  if (response.status === NOT_FOUND) {
    return "not_found";
  }
  if (response.status === FORBIDDEN) {
    return (await parseJson(response, PlanRequiredProblem)).ok ? "plan_required" : "forbidden";
  }
  if (response.status === CONFLICT) {
    return (await parseJson(response, AlreadyMemberProblem)).ok
      ? "already_member"
      : "invalid_response";
  }
  return failureOf(response);
};

const memberChangeRefusalOf =
  <Conflict extends string>({
    conflictProblem,
    conflict,
  }: {
    readonly conflictProblem: z.ZodType<unknown>;
    readonly conflict: Conflict;
  }) =>
  async (
    response: Response,
  ): Promise<"unauthenticated" | "not_found" | "forbidden" | Conflict | HttpFailure> => {
    if (response.status === UNAUTHORIZED) {
      return "unauthenticated";
    }
    if (response.status === NOT_FOUND) {
      return "not_found";
    }
    if (response.status === FORBIDDEN) {
      return "forbidden";
    }
    if (response.status === CONFLICT) {
      return (await parseJson(response, conflictProblem)).ok ? conflict : "invalid_response";
    }
    return failureOf(response);
  };

const roleChangeRefusalOf: (response: Response) => Promise<RoleChangeFailure> =
  memberChangeRefusalOf({ conflictProblem: LastOwnerProblem, conflict: "last_owner" });

const removalRefusalOf: (response: Response) => Promise<RemovalFailure> = memberChangeRefusalOf({
  conflictProblem: SelfRemovalProblem,
  conflict: "self_removal",
});

const checkoutRefusalOf = async (response: Response): Promise<CheckoutFailure> => {
  if (response.status === UNAUTHORIZED) {
    return "unauthenticated";
  }
  if (response.status === NOT_FOUND) {
    return "not_found";
  }
  if (response.status === FORBIDDEN) {
    return "forbidden";
  }
  if (response.status === CONFLICT) {
    return (await parseJson(response, AlreadyTeamProblem)).ok ? "already_team" : "invalid_response";
  }
  return failureOf(response);
};

export const createHttpSpaceGateway = ({
  apiUrl,
  fetch,
}: {
  readonly apiUrl: string;
  readonly fetch: Fetch;
}): SpaceGateway => ({
  listMySpaces: async () => {
    const sent = await send(fetch, `${apiUrl}/v1/spaces`, { method: "GET" });
    if (!sent.ok) {
      return sent;
    }
    const response = sent.value;
    if (response.status === UNAUTHORIZED) {
      return err("unauthenticated");
    }
    if (!response.ok) {
      return err(failureOf(response));
    }
    const body = await parseJson(response, MySpacesOutput);
    return body.ok ? ok(body.value.spaces.map(spaceOf)) : body;
  },
  readSpace: async ({ spaceId }) => {
    const sent = await send(fetch, `${apiUrl}/v1/spaces/${spaceId}`, { method: "GET" });
    if (!sent.ok) {
      return sent;
    }
    const response = sent.value;
    if (response.status === UNAUTHORIZED) {
      return err("unauthenticated");
    }
    if (response.status === NOT_FOUND) {
      return err("not_found");
    }
    if (!response.ok) {
      return err(failureOf(response));
    }
    const body = await parseJson(response, SpaceOutput);
    return body.ok
      ? ok({
          ...spaceOf(body.value),
          storage: {
            usedBytes: body.value.storage.usedBytes,
            limitBytes: body.value.storage.limitBytes,
            alertReached: body.value.storage.alertReached,
          },
          ...(body.value.subscription === undefined
            ? {}
            : { subscription: { status: subscriptionStatusOf(body.value.subscription.status) } }),
        })
      : body;
  },
  acceptInvitation: async ({ token }) => {
    const sent = await send(fetch, `${apiUrl}/v1/invitations/${token}/accept`, {
      method: "POST",
    });
    if (!sent.ok) {
      return sent;
    }
    const response = sent.value;
    if (!response.ok) {
      return err(await refusalOf(response));
    }
    const body = await parseJson(response, MySpaceOutput);
    return body.ok ? ok(spaceOf(body.value)) : body;
  },
  inviteMember: async ({ spaceId, email }) => {
    const sent = await send(fetch, `${apiUrl}/v1/spaces/${spaceId}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!sent.ok) {
      return sent;
    }
    const response = sent.value;
    if (response.status !== CREATED) {
      return err(await invitationRefusalOf(response));
    }
    const body = await parseJson(response, SentInvitationOutput);
    return body.ok
      ? ok({
          id: body.value.id,
          email: body.value.email,
          expiresAt: new Date(body.value.expiresAt),
        })
      : body;
  },
  listMembers: async ({ spaceId }) => {
    const sent = await send(fetch, `${apiUrl}/v1/spaces/${spaceId}/members`, { method: "GET" });
    if (!sent.ok) {
      return sent;
    }
    const response = sent.value;
    if (response.status === UNAUTHORIZED) {
      return err("unauthenticated");
    }
    if (response.status === NOT_FOUND) {
      return err("not_found");
    }
    if (!response.ok) {
      return err(failureOf(response));
    }
    const body = await parseJson(response, MembersOutput);
    return body.ok
      ? ok(
          body.value.members.map(({ userId, name, email, role }) => ({
            userId,
            name,
            email,
            role: roleOf(role),
          })),
        )
      : body;
  },
  changeRole: async ({ spaceId, memberId, role }) => {
    const sent = await send(fetch, `${apiUrl}/v1/spaces/${spaceId}/members/${memberId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!sent.ok) {
      return sent;
    }
    const response = sent.value;
    if (response.status !== OK) {
      return err(await roleChangeRefusalOf(response));
    }
    const body = await parseJson(response, ChangedRoleOutput);
    return body.ok ? ok({ userId: body.value.userId, role: roleOf(body.value.role) }) : body;
  },
  startCheckout: async ({ spaceId }) => {
    const sent = await send(fetch, `${apiUrl}/v1/spaces/${spaceId}/checkout`, { method: "POST" });
    if (!sent.ok) {
      return sent;
    }
    const response = sent.value;
    if (response.status !== CREATED) {
      return err(await checkoutRefusalOf(response));
    }
    const body = await parseJson(response, CheckoutOutput);
    return body.ok ? ok({ url: body.value.url }) : body;
  },
  removeMember: async ({ spaceId, memberId }) => {
    const sent = await send(fetch, `${apiUrl}/v1/spaces/${spaceId}/members/${memberId}`, {
      method: "DELETE",
    });
    if (!sent.ok) {
      return sent;
    }
    const response = sent.value;
    return response.status === NO_CONTENT ? ok(undefined) : err(await removalRefusalOf(response));
  },
});
