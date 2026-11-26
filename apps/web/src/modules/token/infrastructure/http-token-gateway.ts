import type { z } from "zod";

import { type TokenOutput, TokensOutput } from "@repo/contracts";
import { err, ok } from "@repo/result";

import {
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
});
