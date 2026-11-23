import { z } from "zod";

import { AccountDeletionOutput, LastOwnerProblem, WrongPasswordProblem } from "@repo/contracts";
import { err, ok, type Result } from "@repo/result";

import {
  BAD_REQUEST,
  CONFLICT,
  failureOf,
  type Fetch,
  FORBIDDEN,
  type HttpFailure,
  parseJson,
  send,
  NO_CONTENT,
  TOO_MANY_REQUESTS,
  UNAUTHORIZED,
  UNPROCESSABLE_ENTITY,
} from "../../../platform/http.ts";
import type { IdentityGateway, SignUpFailure } from "../application/identity-gateway.ts";
import type {
  AccountDeletion,
  AccountDeletionFailure,
  DeleteAccountFailure,
} from "../domain/account.ts";
import type { Session } from "../domain/session.ts";

const AuthUser = z.object({ id: z.string(), email: z.string() });

const SignInResponse = z.object({ user: AuthUser });

const GetSessionResponse = z.object({ user: AuthUser }).nullable();

const BetterAuthRefusal = z.object({ code: z.string() });

const REFUSALS: ReadonlyMap<string, SignUpFailure> = new Map([
  ["USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", "email_taken"],
  ["INVALID_EMAIL", "invalid_email"],
  ["PASSWORD_TOO_SHORT", "invalid_password"],
  ["PASSWORD_TOO_LONG", "invalid_password"],
  ["FAILED_TO_CREATE_USER", "unavailable"],
  ["FAILED_TO_CREATE_SESSION", "unavailable"],
]);

const signUpRefusalOf = async (response: Response): Promise<SignUpFailure> => {
  if (response.status === TOO_MANY_REQUESTS) {
    return "rate_limited";
  }
  if (response.status === BAD_REQUEST || response.status === UNPROCESSABLE_ENTITY) {
    const refusal = await parseJson(response, BetterAuthRefusal);
    return (refusal.ok && REFUSALS.get(refusal.value.code)) || "invalid_response";
  }
  return failureOf(response);
};

const deletionFailureOf = (response: Response): AccountDeletionFailure =>
  response.status === UNAUTHORIZED ? "unauthenticated" : failureOf(response);

const accountDeletionOf = ({
  paidSpaces,
  lastOwnerSpaces,
}: z.infer<typeof AccountDeletionOutput>): AccountDeletion => ({
  paidSpaces: paidSpaces.map(({ id, name, currentPeriodEnd }) => ({
    id,
    name,
    currentPeriodEnd: currentPeriodEnd === null ? undefined : new Date(currentPeriodEnd),
  })),
  lastOwnerSpaces: lastOwnerSpaces.map(({ id, name }) => ({ id, name })),
});

const LastOwnerSpaces = LastOwnerProblem.extend({
  spaces: z.array(z.object({ id: z.string(), name: z.string() })),
});

const deleteRefusalOf = async (response: Response): Promise<DeleteAccountFailure> => {
  if (response.status === TOO_MANY_REQUESTS) {
    return { kind: "rate_limited" };
  }
  if (response.status === FORBIDDEN) {
    const problem = await parseJson(response, WrongPasswordProblem);
    return { kind: problem.ok ? "wrong_password" : problem.error };
  }
  if (response.status !== CONFLICT) {
    return { kind: deletionFailureOf(response) };
  }
  const problem = await parseJson(response, LastOwnerSpaces);
  return problem.ok
    ? {
        kind: "last_owner",
        spaces: problem.value.spaces.map(({ id, name }) => ({ id, name })),
      }
    : { kind: "invalid_response" };
};

const sessionOf = ({ id, email }: z.infer<typeof AuthUser>): Session => ({ userId: id, email });

export const createHttpIdentityGateway = ({
  apiUrl,
  fetch,
}: {
  readonly apiUrl: string;
  readonly fetch: Fetch;
}): IdentityGateway => ({
  signIn: async (credentials) => {
    const sent = await send(fetch, `${apiUrl}/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
    });
    if (!sent.ok) {
      return sent;
    }
    const response = sent.value;
    if (response.status === UNAUTHORIZED) {
      return err("invalid_credentials");
    }
    if (response.status === TOO_MANY_REQUESTS) {
      return err("rate_limited");
    }
    if (!response.ok) {
      return err(failureOf(response));
    }
    const body = await parseJson(response, SignInResponse);
    return body.ok ? ok(sessionOf(body.value.user)) : body;
  },
  signUp: async (registration) => {
    const sent = await send(fetch, `${apiUrl}/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(registration),
    });
    if (!sent.ok) {
      return sent;
    }
    const response = sent.value;
    if (!response.ok) {
      return err(await signUpRefusalOf(response));
    }
    const body = await parseJson(response, SignInResponse);
    return body.ok ? ok(sessionOf(body.value.user)) : body;
  },
  signOut: async () => {
    const sent = await send(fetch, `${apiUrl}/auth/sign-out`, { method: "POST" });
    if (!sent.ok) {
      return sent;
    }
    return sent.value.ok ? ok(undefined) : err(failureOf(sent.value));
  },
  currentSession: async (): Promise<Result<Session | undefined, HttpFailure>> => {
    const sent = await send(fetch, `${apiUrl}/auth/get-session`, { method: "GET" });
    if (!sent.ok) {
      return sent;
    }
    const response = sent.value;
    if (!response.ok) {
      return err(failureOf(response));
    }
    const body = await parseJson(response, GetSessionResponse);
    if (!body.ok) {
      return body;
    }
    return ok(body.value === null ? undefined : sessionOf(body.value.user));
  },
  accountDeletion: async () => {
    const sent = await send(fetch, `${apiUrl}/v1/account/deletion`, { method: "GET" });
    if (!sent.ok) {
      return sent;
    }
    const response = sent.value;
    if (!response.ok) {
      return err(deletionFailureOf(response));
    }
    const body = await parseJson(response, AccountDeletionOutput);
    return body.ok ? ok(accountDeletionOf(body.value)) : body;
  },
  deleteAccount: async (password) => {
    const sent = await send(fetch, `${apiUrl}/v1/account`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!sent.ok) {
      return err({ kind: sent.error });
    }
    const response = sent.value;
    return response.status === NO_CONTENT ? ok(undefined) : err(await deleteRefusalOf(response));
  },
});
