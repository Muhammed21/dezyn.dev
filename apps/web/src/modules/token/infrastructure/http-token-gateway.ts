import { z } from "zod";

import {
  AddedModeOutput,
  PendingProposalsProblem,
  type TokenOutput,
  TokensOutput,
} from "@repo/contracts";
import { err, ok } from "@repo/result";

import {
  BAD_REQUEST,
  CONFLICT,
  CREATED,
  failureOf,
  type Fetch,
  NOT_FOUND,
  OK,
  parseJson,
  send,
  UNAUTHORIZED,
} from "../../../platform/http.ts";
import type { TokenGateway } from "../application/token-gateway.ts";
import {
  figmaStateOf,
  type ModeAdditionFailure,
  type Token,
  type TokenFigmaState,
  type TokenValue,
  tokenTypeOf,
} from "../domain/token.ts";

type FigmaOutput = NonNullable<z.infer<typeof TokenOutput>["figma"]>;

const valueOf = ({
  $value,
  modes,
}: {
  readonly $value?: unknown;
  readonly modes?: Readonly<Record<string, unknown>> | undefined;
}): TokenValue =>
  modes === undefined ? { kind: "single", value: $value } : { kind: "by_mode", values: modes };

const figmaOf = ({ state, declaredAt, proposal, rejectedValue }: FigmaOutput): TokenFigmaState => ({
  state: figmaStateOf(state),
  declaredAt: new Date(declaredAt),
  ...(proposal === undefined
    ? {}
    : { proposal: { id: proposal.id, batchId: proposal.batchId, value: valueOf(proposal.value) } }),
  ...(rejectedValue === undefined ? {} : { rejectedValue: valueOf(rejectedValue) }),
});

const tokenOf = ({
  id,
  name,
  $type,
  $value,
  modes,
  $description,
  figma,
}: z.infer<typeof TokenOutput>): Token => ({
  id,
  name,
  type: tokenTypeOf($type),
  value: valueOf({ $value, modes }),
  description: $description,
  figma: figma === undefined ? undefined : figmaOf(figma),
});

const InvalidRequestProblem = z.looseObject({
  errors: z.array(z.looseObject({ path: z.string() })),
});

const INVALID_PATHS: ReadonlyMap<string, ModeAdditionFailure> = new Map([
  ["modes", "no_modes"],
  ["copiedFrom", "unknown_source"],
]);

const invalidAdditionOf = async (response: Response): Promise<ModeAdditionFailure> => {
  const body: unknown = await response.json().catch(() => undefined);
  if (PendingProposalsProblem.safeParse(body).success) {
    return "pending_proposals";
  }
  const paths = InvalidRequestProblem.safeParse(body).data?.errors.map(({ path }) => path) ?? [];
  return (
    paths.map((path) => INVALID_PATHS.get(path)).find((failure) => failure !== undefined) ??
    "invalid_name"
  );
};

const additionRefusalOf = async (response: Response): Promise<ModeAdditionFailure> => {
  if (response.status === BAD_REQUEST) {
    return invalidAdditionOf(response);
  }
  if (response.status === CONFLICT) {
    return "name_taken";
  }
  if (response.status === UNAUTHORIZED) {
    return "unauthenticated";
  }
  if (response.status === NOT_FOUND) {
    return "not_found";
  }
  return failureOf(response);
};

export const createHttpTokenGateway = ({
  apiUrl,
  fetch,
}: {
  readonly apiUrl: string;
  readonly fetch: Fetch;
}): TokenGateway => ({
  readTokens: async ({ projectId }) => {
    const sent = await send(fetch, `${apiUrl}/v1/projects/${projectId}/tokens`, { method: "GET" });
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
    if (response.status !== OK) {
      return err(failureOf(response));
    }
    const body = await parseJson(response, TokensOutput);
    if (!body.ok) {
      return body;
    }
    return ok({ modes: body.value.modes, tokens: body.value.tokens.map(tokenOf) });
  },
  addMode: async ({ projectId, name, copiedFrom }) => {
    const sent = await send(fetch, `${apiUrl}/v1/projects/${projectId}/modes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, copiedFrom }),
    });
    if (!sent.ok) {
      return sent;
    }
    const response = sent.value;
    if (response.status !== CREATED) {
      return err(await additionRefusalOf(response));
    }
    const body = await parseJson(response, AddedModeOutput);
    if (!body.ok) {
      return body;
    }
    const { mode, copiedFrom: copied, modes } = body.value;
    return ok({ mode, copiedFrom: copied, modes });
  },
});
